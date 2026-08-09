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
      priceDate: '2026-08-08', sharesOutstanding: 1e8,
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
  })

  it('신호가 하나도 없으면 NO_DATA', () => {
    expect(competitiveAdvantageFactor(ctx({ ttm: [], quarterly: [] })).status).toBe('NO_DATA')
  })

  it('일부 신호만 있어도 그 신호로만 정규화한다', () => {
    const r = competitiveAdvantageFactor(
      ctx({ ttm: [fp('2025-03-31', { revenue: 1000, rdExpense: 200 })] }),
    )
    expect(r.status).toBe('SCORED')
    // R&D 집약도 0.2 → 신호 1개(0.925)만으로 정규화 → 9.25점
    expect(r.points!).toBeCloseTo(9.25, 5)
    expect(r.raw).toBeCloseTo(0.925, 5)
    expect(r.detail).toContain('4개 중 1개')
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
