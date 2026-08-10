import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseConfig } from '@/config'
import { marketCapOpportunityFactor } from '@/engines/tenbagger/factors/market-cap-opportunity'
import { competitiveAdvantageFactor } from '@/engines/tenbagger/factors/competitive-advantage'
import { balanceSheetFactor } from '@/engines/tenbagger/factors/balance-sheet'
import { institutionalInsiderFactor } from '@/engines/tenbagger/factors/institutional-insider'
import type { FactorContext } from '@/engines/tenbagger/factor-utils'
import type { CompanySnapshot, FinancialPeriod, RedFlag } from '@/domain/types'

const cfg = parseConfig(readFileSync('config.yaml', 'utf8'))

function fp(periodEnd: string, over: Partial<FinancialPeriod> = {}): FinancialPeriod {
  return {
    periodEnd, periodType: 'TTM', revenue: null, grossProfit: null,
    operatingIncome: null, netIncome: null, ocf: null, capex: null, fcf: null,
    cash: null, totalDebt: null, equity: null, sharesDiluted: null,
    sharesOutstanding: null, sbc: null, rdExpense: null, ...over,
  }
}

function ctx(over: Partial<CompanySnapshot>, flags: RedFlag[] = []): FactorContext {
  return {
    cfg, flags,
    snapshot: {
      cik: 1, ticker: 'T', name: 'T',
      themeSlug: 'ai-software-semi', industrySlug: 'semiconductors',
      industry: {
        slug: 'semiconductors', name: 'Semiconductors', themeSlug: 'ai-software-semi',
        tamUsd: null, tamCagr: null, tamSource: null, tamAsOf: null,
      },
      classificationSource: 'sic', marketCap: 1e9, price: 10,
      priceDate: '2026-08-08', sharesOutstanding: 1e8, sharesBasis: 'reported',
      ttm: [], annual: [], quarterly: [],
      industryStats: {
        candidateCount: 5, medianGrossMargin: 0.60,
        medianRevenueGrowth: 0.18, distributions: {},
      },
      asOf: '2026-08-09', ...over,
    },
  }
}

/**
 * 성장 중인 TTM 계열 — 게이트를 통과시키기 위한 기본값.
 * 매출 규모 게이트(zero_if_revenue_below: $10M)를 실제로 넘어서야 하므로
 * 다른 factor 테스트의 toy-scale(예: revenue: 1000)이 아닌 실제 달러 규모로 표현한다.
 */
function growingTtm(over: Partial<FinancialPeriod> = {}): FinancialPeriod[] {
  const now = fp('2025-03-31', { revenue: 1_250_000_000, ...over })
  const mid = [1, 2, 3].map((i) => fp(`2024-${12 - i}-31`))
  const prior = fp('2024-03-31', { revenue: 1_000_000_000 })
  return [now, ...mid, prior]
}

const WARNING: RedFlag = {
  code: 'DILUTION', severity: 'WARNING', message: 'x', evidence: {},
}

describe('marketCapOpportunityFactor', () => {
  it('$1B 미만은 만점 15점', () => {
    const r = marketCapOpportunityFactor(ctx({ marketCap: 5e8, ttm: growingTtm() }))
    expect(r.key).toBe('market_cap_opportunity')
    expect(r.points).toBe(15)
    expect(r.raw).toBe(5e8)
  })

  it('$100B 이상은 1점', () => {
    expect(marketCapOpportunityFactor(ctx({ marketCap: 2e11, ttm: growingTtm() })).points)
      .toBe(1)
  })

  it('구간 경계는 상한 미만 기준', () => {
    expect(marketCapOpportunityFactor(ctx({ marketCap: 3e9, ttm: growingTtm() })).points)
      .toBe(12)   // 3e9는 $1B~$3B 구간의 상한이므로 다음 구간
  })

  it('매출이 감소 중이면 게이트 0', () => {
    const shrinking = [
      fp('2025-03-31', { revenue: 800 }),
      fp('2024-12-31'), fp('2024-09-30'), fp('2024-06-30'),
      fp('2024-03-31', { revenue: 1000 }),
    ]
    const r = marketCapOpportunityFactor(ctx({ marketCap: 5e8, ttm: shrinking }))
    expect(r.points).toBe(0)
    expect(r.detail).toContain('매출 감소')
  })

  it('매출이 $10M 미만이면 게이트 0', () => {
    const tiny = growingTtm({ revenue: 5_000_000 })
    tiny[4] = fp('2024-03-31', { revenue: 4_000_000 })
    const r = marketCapOpportunityFactor(ctx({ marketCap: 5e8, ttm: tiny }))
    expect(r.points).toBe(0)
    expect(r.detail).toContain('매출 규모')
  })

  it('WARNING Red Flag가 있으면 절반', () => {
    const r = marketCapOpportunityFactor(ctx({ marketCap: 5e8, ttm: growingTtm() }, [WARNING]))
    expect(r.points).toBe(7.5)
    expect(r.detail).toContain('WARNING')
  })

  it('시가총액이 없으면 NO_DATA', () => {
    expect(marketCapOpportunityFactor(ctx({ marketCap: null, ttm: growingTtm() })).status)
      .toBe('NO_DATA')
  })

  it('희석평균주식수 폴백으로 계산된 시가총액이면 detail에 근사치임을 밝힌다', () => {
    const r = marketCapOpportunityFactor(
      ctx({ marketCap: 5e8, ttm: growingTtm(), sharesBasis: 'diluted_fallback' }),
    )
    expect(r.detail).toContain('근사치')
    expect(r.detail).toContain('희석평균주식수')
  })

  it('표지 발행주식수 기반이면 근사치 문구가 없다', () => {
    const r = marketCapOpportunityFactor(
      ctx({ marketCap: 5e8, ttm: growingTtm(), sharesBasis: 'reported' }),
    )
    expect(r.detail).not.toContain('근사치')
  })
})

describe('competitiveAdvantageFactor', () => {
  function stableQuarters(gm: number): FinancialPeriod[] {
    return Array.from({ length: 8 }, (_, i) =>
      fp(`2025-${String(20 - i).padStart(2, '0')}`, {
        periodType: 'Q', revenue: 100, grossProfit: gm * 100,
      }),
    )
  }

  it('ROIC·마진 안정성·산업 대비 마진·R&D를 종합한다', () => {
    const r = competitiveAdvantageFactor(
      ctx({
        ttm: [fp('2025-03-31', {
          revenue: 1000, grossProfit: 800, operatingIncome: 400,
          totalDebt: 500, equity: 2000, cash: 500, rdExpense: 200,
        })],
        quarterly: stableQuarters(0.80),
      }),
    )
    expect(r.key).toBe('competitive_advantage')
    expect(r.weight).toBe(10)
    expect(r.status).toBe('SCORED')
    // ROIC 0.645 · 마진안정성 1.00 · 산업대비마진 0.9333 · R&D 0.925 → 평균 0.875833
    expect(r.points!).toBeCloseTo(8.758333, 5)
    expect(r.raw).toBeCloseTo(0.875833, 5)
    expect(r.detail).toContain('ROIC')
    expect(r.detail).toContain('감쇠 없음')
  })

  it('신호가 하나도 없으면 NO_DATA', () => {
    expect(competitiveAdvantageFactor(ctx({ ttm: [], quarterly: [] })).status).toBe('NO_DATA')
  })

  it('신호가 1개뿐이면 NO_DATA — 증거 1개짜리 만점을 막는다', () => {
    // SCYX 사례: R&D 집약도 +145% 하나로 10/10을 받았다. 임상단계 제약사의 현금
    // 소진이지 경쟁우위가 아니다. 전체 점수는 SCORED 가중치로만 정규화되므로
    // 이 팩터가 빠져도 왜곡되지 않는다(설계문서 §8.1).
    const r = competitiveAdvantageFactor(
      ctx({ ttm: [fp('2025-03-31', { revenue: 1000, rdExpense: 1450 })] }),
    )
    expect(r.status).toBe('NO_DATA')
    expect(r.points).toBeNull()
    expect(r.detail).toContain('최소 2개 필요')
    expect(r.detail).toContain('R&D 집약도')      // 무엇 하나가 있었는지는 밝힌다
  })

  it('신호 2개는 커버리지 비율(2/4)로 감쇠한다', () => {
    // ROIC(0.645)와 R&D(0.925)만 계산 가능 — 마진 안정성은 분기 부족, 산업 대비
    // 마진은 회사 GM 부재. 둘 다 회사 사유이므로 분모는 4다.
    const r = competitiveAdvantageFactor(
      ctx({
        ttm: [fp('2025-03-31', {
          revenue: 1000, operatingIncome: 400,
          totalDebt: 500, equity: 2000, cash: 500, rdExpense: 200,
        })],
      }),
    )
    expect(r.status).toBe('SCORED')
    // 평균 (0.645+0.925)/2 = 0.785 → ×0.50 = 0.3925
    expect(r.raw).toBeCloseTo(0.3925, 5)
    expect(r.points!).toBeCloseTo(3.925, 5)
    expect(r.detail).toContain('평가 가능 4개 중 2개')
    expect(r.detail).toContain('×0.50')
  })

  it('회사 사유로 신호 하나가 빠지면 3/4로 감쇠한다', () => {
    // 마진 안정성만 빠진다(분기 8개 미만 = 보고 이력이 짧다는 그 회사의 사실).
    const r = competitiveAdvantageFactor(
      ctx({
        ttm: [fp('2025-03-31', {
          revenue: 1000, grossProfit: 800, operatingIncome: 400,
          totalDebt: 500, equity: 2000, cash: 500, rdExpense: 200,
        })],
        quarterly: stableQuarters(0.80).slice(0, 4),
      }),
    )
    // 평균 (0.645 + 0.93333 + 0.925)/3 = 0.834444 → ×0.75
    expect(r.points!).toBeCloseTo(6.258333, 5)
    expect(r.detail).toContain('평가 가능 4개 중 3개')
    expect(r.detail).toContain('×0.75')
  })

  it('산업 후보 부족(우리 taxonomy의 한계)은 분모에서 빠져 감쇠하지 않는다 — NVIDIA 케이스', () => {
    // NVIDIA가 신호 3개인 이유는 AI Infrastructure 산업 후보가 1개뿐이기 때문이다.
    // 우리 분류 체계가 얇은 것을 회사에서 깎으면 새로운 불공정이 된다. 분모는 3이고
    // 나머지 3개를 다 계산했으므로 감쇠 없이 만점이 가능해야 한다.
    const ttm = [fp('2025-03-31', {
      revenue: 1000, grossProfit: 800, operatingIncome: 400,
      totalDebt: 500, equity: 2000, cash: 500, rdExpense: 200,
    })]
    const quarterly = stableQuarters(0.80)

    const thinIndustry = competitiveAdvantageFactor(
      ctx({
        ttm, quarterly,
        industryStats: {
          candidateCount: 1, medianGrossMargin: 0.60,
          medianRevenueGrowth: 0.18, distributions: {},
        },
      }),
    )
    expect(thinIndustry.status).toBe('SCORED')
    expect(thinIndustry.detail).toContain('평가 가능 3개 신호 전부')
    expect(thinIndustry.detail).toContain('감쇠 없음')
    expect(thinIndustry.detail).toContain('분모에서 제외')
    // ROIC 0.645 · 마진 안정성 1.00 · R&D 0.925 → 평균 0.856667, 감쇠 ×1.00
    expect(thinIndustry.points!).toBeCloseTo(8.566667, 5)
    expect(thinIndustry.raw).toBeCloseTo(0.856667, 5)

    // 같은 신호 3개라도 결측이 회사 사유면(후보 5개 산업인데 회사 GM이 없음)
    // 분모가 4가 되어 ×0.75로 감쇠된다 — 두 케이스가 반드시 달라야 한다.
    const companyGap = competitiveAdvantageFactor(
      ctx({
        ttm: [fp('2025-03-31', {
          revenue: 1000, operatingIncome: 400,
          totalDebt: 500, equity: 2000, cash: 500, rdExpense: 200,
        })],
        quarterly,
      }),
    )
    expect(companyGap.detail).toContain('×0.75')
    expect(companyGap.points!).toBeLessThan(thinIndustry.points!)
  })

  it('산업 중앙값 자체가 없으면 후보 수와 무관하게 분모에서 제외한다', () => {
    const r = competitiveAdvantageFactor(
      ctx({
        ttm: [fp('2025-03-31', {
          revenue: 1000, grossProfit: 800, operatingIncome: 400,
          totalDebt: 500, equity: 2000, cash: 500, rdExpense: 200,
        })],
        quarterly: stableQuarters(0.80),
        industryStats: {
          candidateCount: 12, medianGrossMargin: null,
          medianRevenueGrowth: 0.18, distributions: {},
        },
      }),
    )
    expect(r.detail).toContain('평가 가능 3개 신호 전부')
    expect(r.points!).toBeCloseTo(8.566667, 5)
  })

  it('신호가 많을수록 유리해야 한다 — 같은 신호 품질이면 4-of-4가 2-of-4를 앞선다', () => {
    const full = competitiveAdvantageFactor(
      ctx({
        ttm: [fp('2025-03-31', {
          revenue: 1000, grossProfit: 800, operatingIncome: 400,
          totalDebt: 500, equity: 2000, cash: 500, rdExpense: 200,
        })],
        quarterly: stableQuarters(0.80),
      }),
    )
    const partial = competitiveAdvantageFactor(
      ctx({
        ttm: [fp('2025-03-31', {
          revenue: 1000, operatingIncome: 400,
          totalDebt: 500, equity: 2000, cash: 500, rdExpense: 200,
        })],
      }),
    )
    expect(full.points!).toBeGreaterThan(partial.points!)
  })
})

describe('balanceSheetFactor', () => {
  it('흑자 기업은 순현금과 레버리지로 채점한다', () => {
    // revenue/operatingIncome/fcf도 cash/totalDebt/marketCap과 같은 실제 달러 규모여야
    // debtToEbitda(=totalDebt/operatingIncome)가 왜곡되지 않는다.
    const r = balanceSheetFactor(
      ctx({
        marketCap: 1e10,
        ttm: [fp('2025-03-31', {
          revenue: 1e9, operatingIncome: 3e8, fcf: 2.5e8,
          cash: 3e9, totalDebt: 5e8,
        })],
      }),
    )
    expect(r.key).toBe('balance_sheet')
    expect(r.weight).toBe(5)
    // 순현금 0.25 → 1.00 · 레버리지 1.667배 → 0.6833 → 0.6*1.00+0.4*0.6833=0.8733 → 4.3667점
    expect(r.points!).toBeCloseTo(4.366667, 5)
    expect(r.raw).toBeCloseTo(0.25, 5)
    expect(r.detail).toContain('순현금')
  })

  it('적자 기업은 현금 런웨이로 채점한다', () => {
    const r = balanceSheetFactor(
      ctx({ ttm: [fp('2025-03-31', { fcf: -400, cash: 4000 })] }),   // 런웨이 40분기
    )
    expect(r.points).toBe(5)
    expect(r.detail).toContain('런웨이')
  })

  it('런웨이가 짧으면 저득점', () => {
    const r = balanceSheetFactor(ctx({ ttm: [fp('2025-03-31', { fcf: -400, cash: 300 })] }))
    expect(r.points!).toBeLessThan(1)
  })

  it('재무 데이터가 없으면 NO_DATA', () => {
    expect(balanceSheetFactor(ctx({ ttm: [fp('2025-03-31', {})] })).status).toBe('NO_DATA')
  })

  // 브리프가 다루지 않는 분기: 순현금/레버리지 중 하나만 산출 가능한 경우.
  // "흑자 기업" 테스트는 둘 다 있는 경우만 다루므로, 레버리지가 없을 때
  // net_cash_curve 단독으로, 순현금이 없을 때 leverage_curve 단독으로
  // 점수화되는지 별도로 확인한다.
  it('순현금만 산출 가능하면 net_cash_curve만으로 채점한다 (영업이익 없음)', () => {
    const r = balanceSheetFactor(
      ctx({
        marketCap: 1e10,
        ttm: [fp('2025-03-31', { cash: 3e9, totalDebt: 5e8 })],
      }),
    )
    expect(r.raw).toBeCloseTo(0.25, 5)
    expect(r.points!).toBeCloseTo(5, 5)
    expect(r.detail).toContain('순현금')
    expect(r.detail).toContain('레버리지 산출 불가')
  })

  it('레버리지만 산출 가능하면 leverage_curve만으로 채점한다 (현금 없음)', () => {
    const r = balanceSheetFactor(
      ctx({
        ttm: [fp('2025-03-31', { operatingIncome: 3e8, totalDebt: 5e8 })],
      }),
    )
    expect(r.raw).toBeCloseTo(1.666667, 5)
    expect(r.points!).toBeCloseTo(3.416667, 5)
    expect(r.detail).toContain('부채/영업이익')
    expect(r.detail).toContain('순현금 산출 불가')
  })
})

describe('institutionalInsiderFactor', () => {
  it('항상 NOT_IMPLEMENTED이며 5점 가중치를 보고한다', () => {
    const r = institutionalInsiderFactor(ctx({}))
    expect(r.key).toBe('institutional_insider')
    expect(r.weight).toBe(5)
    expect(r.status).toBe('NOT_IMPLEMENTED')
    expect(r.points).toBeNull()
    expect(r.detail).toContain('Phase 4')
  })
})
