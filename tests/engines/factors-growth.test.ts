import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseConfig } from '@/config'
import { revenueGrowthFactor } from '@/engines/tenbagger/factors/revenue-growth'
import { revenueAccelerationFactor } from '@/engines/tenbagger/factors/revenue-acceleration'
import { tamIndustryGrowthFactor } from '@/engines/tenbagger/factors/tam-industry-growth'
import { marketCapOpportunityFactor } from '@/engines/tenbagger/factors/market-cap-opportunity'
import {
  pct, bpsPerYear, usdCompact, type FactorContext,
} from '@/engines/tenbagger/factor-utils'
import type { CompanySnapshot, FinancialPeriod } from '@/domain/types'

const cfg = parseConfig(readFileSync('config.yaml', 'utf8'))

function fp(periodEnd: string, over: Partial<FinancialPeriod> = {}): FinancialPeriod {
  return {
    periodEnd, periodType: 'TTM', revenue: null, grossProfit: null,
    operatingIncome: null, netIncome: null, ocf: null, capex: null, fcf: null,
    cash: null, totalDebt: null, equity: null, sharesDiluted: null,
    sharesOutstanding: null, sbc: null, rdExpense: null, ...over,
  }
}

function ctx(over: Partial<CompanySnapshot>): FactorContext {
  const snapshot: CompanySnapshot = {
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
      candidateCount: 5, medianGrossMargin: 0.6, medianRevenueGrowth: 0.18, distributions: {},
    },
    asOf: '2026-08-09', ...over,
  }
  return { snapshot, cfg, flags: [] }
}

/**
 * TTM 계열 — index 0이 현재, 4가 1년 전, 12가 3년 전.
 * 값은 백만 달러 단위로 스케일한다: scoring.revenue_scale_damping이 TTM 매출의
 * 절대 규모를 보므로, 매출을 "1000달러"로 두면 감쇠 곡선 바닥(×0.40)에 걸려
 * 곡선·블렌드를 검증하려던 기대값이 감쇠와 뒤섞인다. 감쇠 자체는 아래 별도
 * describe에서 검증한다.
 */
const M = 1_000_000
function ttmOf(map: Record<number, number>): FinancialPeriod[] {
  const out: FinancialPeriod[] = []
  for (let i = 0; i <= 12; i++) {
    out.push(fp(`2025-${String(i).padStart(2, '0')}`, { revenue: (map[i] ?? 1000) * M }))
  }
  return out
}

describe('revenueGrowthFactor', () => {
  it('TTM YoY와 3년 CAGR을 블렌드한다', () => {
    const r = revenueGrowthFactor(ctx({ ttm: ttmOf({ 0: 1400, 4: 1000, 12: 700 }) }))
    expect(r.key).toBe('revenue_growth')
    expect(r.weight).toBe(20)
    expect(r.status).toBe('SCORED')
    expect(r.raw).toBeCloseTo(0.40)          // raw는 TTM YoY
    expect(r.points!).toBeGreaterThan(14)     // 40% 성장은 곡선상 0.85 → 17점 부근
    expect(r.detail).toContain('+40.0%')
  })

  it('3년 이력이 없으면 TTM YoY만으로 채점한다', () => {
    const r = revenueGrowthFactor(ctx({ ttm: ttmOf({ 0: 1250, 4: 1000 }).slice(0, 5) }))
    expect(r.status).toBe('SCORED')
    expect(r.detail).toContain('3Y CAGR 없음')
    // TTM YoY = (1250-1000)/1000 = 0.25 — 블렌드하지 않고 그 값 단독으로 채점된다.
    // curve의 [0.25, 0.60] 점과 정확히 일치하므로 normalized = 0.60, points = 20 × 0.60 = 12.
    // 만약 블렌드 비율(0.6/0.4)이 단일 입력에도 적용되어 나머지를 0으로 친다면
    // normalized는 0.6×0.60=0.36, points=7.2로 절반 가까이 깎여 이 값과 어긋난다.
    expect(r.raw).toBeCloseTo(0.25)
    expect(r.points).toBeCloseTo(12)
  })

  it('성장률을 계산할 수 없으면 NO_DATA', () => {
    const r = revenueGrowthFactor(ctx({ ttm: [] }))
    expect(r.status).toBe('NO_DATA')
    expect(r.points).toBeNull()
  })

  it('역성장은 최저점 부근', () => {
    const r = revenueGrowthFactor(ctx({ ttm: ttmOf({ 0: 800, 4: 1000, 12: 1200 }) }))
    expect(r.points!).toBeLessThan(2)
  })
})

describe('revenueAccelerationFactor', () => {
  function quarters(revs: number[]): FinancialPeriod[] {
    return revs.map((r, i) =>
      fp(`2025-${String(20 - i).padStart(2, '0')}`, { periodType: 'Q', revenue: r * M }),
    )
  }

  it('가속 중이면 높은 점수', () => {
    const r = revenueAccelerationFactor(
      ctx({
        ttm: ttmOf({ 0: 500 }),
        quarterly: quarters([160, 130, 110, 100, 100, 90, 85, 80]),
      }),
    )
    expect(r.key).toBe('revenue_acceleration')
    expect(r.weight).toBe(10)
    expect(r.status).toBe('SCORED')
    expect(r.raw!).toBeGreaterThan(0.2)
    expect(r.points!).toBeGreaterThan(9)
  })

  it('분기가 8개 미만이면 NO_DATA', () => {
    expect(revenueAccelerationFactor(ctx({ quarterly: quarters([100, 90]) })).status)
      .toBe('NO_DATA')
  })
})

describe('매출 규모 감쇠 (scoring.revenue_scale_damping)', () => {
  function quarters(revs: number[]): FinancialPeriod[] {
    return revs.map((r, i) =>
      fp(`2025-${String(20 - i).padStart(2, '0')}`, { periodType: 'Q', revenue: r }),
    )
  }
  /**
   * **기저** 매출만 다르고 성장 패턴은 동일한 회사를 만든다. 감쇠가 보는 것은 최신
   * 매출이 아니라 성장률의 분모가 된 기간이므로 눈금도 기저 매출이다.
   * 1년 전·3년 전 TTM을 모두 base로 두고 최신 TTM은 8배 — TTM YoY +700%,
   * 3Y CAGR +100%로 둘 다 곡선 상한(1.00)에 닿는다.
   */
  function growthAtBase(base: number) {
    return revenueGrowthFactor(
      ctx({ ttm: ttmOf({ 0: (base * 8) / M, 4: base / M, 12: base / M }) }),
    )
  }

  it('기저 매출 5천만 달러 이상은 감쇠하지 않는다 — 상위 100의 50M~500M 구간을 지킨다', () => {
    for (const base of [50e6, 120e6, 900e6, 20e9]) {
      const r = growthAtBase(base)
      expect(r.status).toBe('SCORED')
      expect(r.points).toBeCloseTo(20, 6)        // 700% 성장 → 곡선 상한 1.0 → 만점
      expect(r.detail).not.toContain('매출 규모 감쇠')
    }
  })

  it('기저 매출이 작을수록 같은 성장률의 점수가 단조 감소한다', () => {
    const pts = [5e6, 10e6, 20e6, 35e6, 50e6].map((base) => growthAtBase(base).points!)
    for (let i = 1; i < pts.length; i++) expect(pts[i]!).toBeGreaterThan(pts[i - 1]!)
    expect(pts[0]).toBeCloseTo(20 * 0.40, 6)     // 곡선 바닥
    expect(pts[1]).toBeCloseTo(20 * 0.55, 6)     // $10M — market_cap gate와 같은 지점
    expect(pts[4]).toBeCloseTo(20, 6)
    // 바닥 아래는 clamp — $5M 미만에서 더 깎지 않는다(하한선 방식은 거부됐다)
    expect(growthAtBase(2e6).points!).toBeCloseTo(pts[0]!, 6)
  })

  /**
   * 이 변경의 핵심. 감쇠 전에는 최신 TTM 매출($98.88M)만 봤으므로 SEPN은 감쇠 구간
   * 바깥에서 20/20을 받았다. 그 +13,520%의 분모는 $726K다.
   * 값은 실제 DB(2026-08-11, SEPN)에서 그대로 가져왔다.
   */
  it('감쇠는 최신 매출이 아니라 성장률의 분모가 된 기저 매출을 본다 (SEPN 실측)', () => {
    const r = revenueGrowthFactor(
      ctx({ ttm: [fp('2026-06-30', { revenue: 98_882_000 }), fp('a'), fp('b'), fp('c'),
                  fp('2025-06-30', { revenue: 726_000 })] }),
    )
    expect(r.status).toBe('SCORED')
    expect(r.raw).toBeCloseTo(135.2011019, 6)   // +13,520.1% — raw는 감쇠 전 원시값
    // 최신 매출 $98.88M은 감쇠 구간 밖이라 예전에는 20점 만점이었다.
    expect(r.points).toBeCloseTo(20 * 0.40, 6)
    expect(r.detail).toContain('기저 TTM 매출 $726K — 매출 규모 감쇠 ×0.40')
  })

  it('기저와 현재 중 감쇠가 센 쪽을 채택한다 — 매출이 줄어든 회사는 현재 쪽이 잡힌다', () => {
    // 기저 $200M → 현재 $6M. 기저만 보면 감쇠가 없지만 비율의 한쪽이 잡음 구간이다.
    const r = revenueGrowthFactor(ctx({ ttm: ttmOf({ 0: 6, 4: 200 }) }))
    expect(r.detail).toContain('현재 TTM 매출 $6.0M — 매출 규모 감쇠 ×0.43')
  })

  it('감쇠를 detail에 드러낸다 — 점수만 조용히 낮추지 않는다', () => {
    const r = growthAtBase(10e6)
    expect(r.detail).toContain('매출 규모 감쇠')
    expect(r.detail).toContain('×0.55')
    expect(r.detail).toContain('$10.0M')
  })

  it('raw는 감쇠 전 원시 성장률을 유지한다 — 산업 백분위가 감쇠에 오염되지 않아야 한다', () => {
    expect(growthAtBase(2e6).raw).toBeCloseTo(7.0, 6)
    expect(growthAtBase(2e6).raw).toBeCloseTo(growthAtBase(500e6).raw!, 6)
  })

  it('revenue_acceleration도 같은 곡선으로 감쇠한다', () => {
    const q = [16, 13, 11, 10, 10, 9, 8.5, 8]
    const small = revenueAccelerationFactor(
      ctx({ ttm: ttmOf({ 0: 5 }), quarterly: quarters(q.map((x) => (x * 1e6) / 20)) }),
    )
    const large = revenueAccelerationFactor(
      ctx({ ttm: ttmOf({ 0: 500 }), quarterly: quarters(q.map((x) => x * 1e7)) }),
    )
    expect(small.raw).toBeCloseTo(large.raw!, 6)      // 가속도(원시값)는 동일
    expect(small.points!).toBeCloseTo(large.points! * 0.40, 6)
    expect(small.detail).toContain('매출 규모 감쇠')
  })

  /**
   * 가속도는 분기 0~3의 YoY 네 개를 비교하고, 그 네 개의 **분모가 정확히 분기 4~7**이다.
   * 그 합계는 1년 전 TTM 매출과 같다. TTM 계열을 전혀 주지 않아도 감쇠가 걸려야
   * "최신 TTM을 본다"가 아니라 "분모를 본다"임이 확인된다.
   */
  it('revenue_acceleration은 1년 전 4개 분기 매출 합계를 기저로 본다 (SEPN 실측)', () => {
    const K = 1_000
    const r = revenueAccelerationFactor(
      ctx({
        ttm: [],   // TTM 계열 없음 — 예전 구현은 여기서 감쇠하지 않았다
        quarterly: quarters(
          [26_746, 26_523, 24_118, 21_495, 119, 219, 212, 176].map((x) => x * K),
        ),
      }),
    )
    expect(r.status).toBe('SCORED')
    expect(r.raw).toBeCloseTo(54.98550, 4)          // +5,498.6%p
    expect(r.points).toBeCloseTo(10 * 0.40, 6)
    expect(r.detail).toContain('1년 전 분기 매출 합계 $726K — 매출 규모 감쇠 ×0.40')
  })

  it('매출을 모르면 감쇠하지 않는다 — 결측을 0으로 치지 않는다', () => {
    const r = revenueAccelerationFactor(
      ctx({ ttm: [], quarterly: quarters([160e6, 130e6, 110e6, 100e6, 100e6, 90e6, 85e6, 80e6]) }),
    )
    expect(r.status).toBe('SCORED')
    expect(r.detail).not.toContain('매출 규모 감쇠')
  })

  it('market_cap_opportunity는 감쇠 대상이 아니다 — 작은 시총 고득점은 의도된 설계다', () => {
    const r = marketCapOpportunityFactor(
      ctx({ marketCap: 5e8, ttm: ttmOf({ 0: 20, 4: 10 }) }),   // TTM 매출 $20M
    )
    expect(r.status).toBe('SCORED')
    expect(r.points).toBe(15)
    expect(r.detail).not.toContain('매출 규모 감쇠')
  })
})

describe('극단 비율 표기 (scoring.extreme_display)', () => {
  function quarters(revs: number[]): FinancialPeriod[] {
    return revs.map((r, i) =>
      fp(`2025-${String(20 - i).padStart(2, '0')}`, { periodType: 'Q', revenue: r }),
    )
  }

  it('성장률이 한계를 넘으면 퍼센트 대신 기저 → 현재 금액과 배수를 적는다 (SEPN 실측)', () => {
    const r = revenueGrowthFactor(
      ctx({ ttm: [fp('2026-06-30', { revenue: 98_882_000 }), fp('a'), fp('b'), fp('c'),
                  fp('2025-06-30', { revenue: 726_000 })] }),
    )
    expect(r.detail).toContain('TTM 매출 $726K → $98.9M (136배)')
    // 화면에 다섯 자리 퍼센트가 남으면 안 된다 — "+13520.1%"가 바로 그 문자열이었다.
    expect(r.detail).not.toContain('13520')
    expect(r.detail).not.toMatch(/\d{5,}(\.\d+)?%/)
  })

  it('한계 아래 성장률은 그대로 퍼센트로 적는다 — 정상 구간을 건드리지 않는다', () => {
    const r = revenueGrowthFactor(ctx({ ttm: ttmOf({ 0: 900, 4: 500, 12: 300 }) }))
    expect(r.detail).toContain('TTM 매출 +80.0%')
    expect(r.detail).not.toContain('배)')
  })

  it('가속도가 한계를 넘으면 %p 대신 1년 전 기저 매출을 적는다 (SEPN 실측)', () => {
    const K = 1_000
    const r = revenueAccelerationFactor(
      ctx({
        quarterly: quarters(
          [26_746, 26_523, 24_118, 21_495, 119, 219, 212, 176].map((x) => x * K),
        ),
      }),
    )
    expect(r.detail).toContain('최근 2개 분기 성장률 급가속 — 1년 전 기저 매출 $726K')
    expect(r.detail).not.toContain('5498')
  })

  it('3Y CAGR이 한계를 넘으면 3년 누적 배수로 적는다', () => {
    const ttm = ttmOf({ 0: 5000, 4: 4000 })
    ttm[12] = fp('2022-12-31', { revenue: 1 })      // 3년 전 매출 $1 → CAGR이 폭주한다
    const r = revenueGrowthFactor(ctx({ ttm }))
    expect(r.detail).toContain('3Y CAGR $1 → $5.00B (3년 5000000000배)')
    expect(r.detail).not.toMatch(/\d{5,}(\.\d+)?%/)
  })
})

describe('pct — 다섯 자리 퍼센트는 만 단위로 옮긴다', () => {
  it('한계 아래는 그대로 퍼센트', () => {
    expect(pct(1.234)).toBe('+123.4%')
    expect(pct(-0.05)).toBe('-5.0%')
    expect(pct(99.99)).toBe('+9999.0%')
  })

  it('만 단위 경계 위는 "N.N만%" — 값을 깎는 것이 아니라 단위를 옮긴다', () => {
    expect(pct(100)).toBe('+1.0만%')
    expect(pct(1764.601)).toBe('+17.6만%')      // CLDX R&D 집약도 +176460.1%
    expect(pct(-120.327)).toBe('-1.2만%')       // FFAI 매출총이익률 -12032.7%
  })

  it('유한하지 않은 값은 대시', () => {
    expect(pct(null)).toBe('—')
    expect(pct(Number.POSITIVE_INFINITY)).toBe('—')
    expect(pct(Number.NaN)).toBe('—')
  })

  it('bpsPerYear도 같은 경계를 쓴다 — FFAI 매출총이익률 추세 +4145244bp/년', () => {
    expect(bpsPerYear(288)).toBe('+288bp/년')
    expect(bpsPerYear(4_145_244)).toBe('+414.5만bp/년')
  })

  it('usdCompact은 백만 달러 미만을 천 단위로 적는다 — $726K가 요점이다', () => {
    expect(usdCompact(726_000)).toBe('$726K')
    expect(usdCompact(98_882_000)).toBe('$98.9M')
    expect(usdCompact(1_750_000_000)).toBe('$1.75B')
    expect(usdCompact(-102_156_000)).toBe('-$102.2M')
    expect(usdCompact(null)).toBe('—')
  })
})

describe('tamIndustryGrowthFactor', () => {
  it('TAM이 큐레이션되어 있으면 그것을 쓴다', () => {
    const r = tamIndustryGrowthFactor(
      ctx({
        industry: {
          slug: 'cybersecurity', name: 'Cybersecurity', themeSlug: 'ai-software-semi',
          tamUsd: 200_000_000_000, tamCagr: 0.15,
          tamSource: 'Example Report 2025', tamAsOf: '2025-12-31',
        },
        ttm: ttmOf({ 0: 1000 }),            // $1B (ttmOf는 백만 달러 단위)
      }),
    )
    expect(r.status).toBe('SCORED')
    expect(r.weight).toBe(15)
    expect(r.raw).toBeCloseTo(0.15)
    expect(r.detail).toContain('Example Report 2025')
  })

  it('TAM이 없으면 산업 매출성장률 중앙값으로 대체한다', () => {
    const r = tamIndustryGrowthFactor(ctx({ ttm: ttmOf({ 0: 1000 }) }))
    expect(r.status).toBe('SCORED')
    expect(r.raw).toBeCloseTo(0.18)
    expect(r.detail).toContain('산업 매출성장률 중앙값')
  })

  it('침투율이 높으면 감점된다', () => {
    const industry = {
      slug: 'x', name: 'X', themeSlug: 'ai-software-semi',
      tamUsd: 1_000_000_000, tamCagr: 0.15, tamSource: 'src', tamAsOf: '2025-12-31',
    }
    const low = tamIndustryGrowthFactor(ctx({ industry, ttm: ttmOf({ 0: 10 }) }))       // $10M
    const high = tamIndustryGrowthFactor(ctx({ industry, ttm: ttmOf({ 0: 600 }) }))     // $600M
    expect(high.points!).toBeLessThan(low.points!)
  })

  it('TAM도 산업 중앙값도 없으면 NO_DATA', () => {
    const r = tamIndustryGrowthFactor(
      ctx({
        industryStats: {
          candidateCount: 1, medianGrossMargin: null,
          medianRevenueGrowth: null, distributions: {},
        },
      }),
    )
    expect(r.status).toBe('NO_DATA')
  })

  it('산업 후보가 min_industry_candidates 미만이면 중앙값이 있어도 대체하지 않는다 (자기참조 방지)', () => {
    // candidateCount: 1 — 이 산업의 중앙값은 채점 대상 기업 자기 자신의 매출성장률과 같다.
    // 이를 대체값으로 쓰면 revenue_growth와 사실상 같은 신호가 15점을 한 번 더 얹어주게 된다.
    const r = tamIndustryGrowthFactor(
      ctx({
        industryStats: {
          candidateCount: 1, medianGrossMargin: 0.6,
          medianRevenueGrowth: 0.40, distributions: {},
        },
        ttm: ttmOf({ 0: 1400, 4: 1000 }),
      }),
    )
    expect(r.status).toBe('NO_DATA')
    expect(r.points).toBeNull()
    expect(r.detail).toContain('산업 후보 1개')
    expect(r.detail).toContain('최소 3개 필요')
  })

  it('산업 후보가 적어도 TAM이 큐레이션되어 있으면 그대로 채점한다', () => {
    const r = tamIndustryGrowthFactor(
      ctx({
        industry: {
          slug: 'niche', name: 'Niche', themeSlug: 'ai-software-semi',
          tamUsd: 50_000_000_000, tamCagr: 0.20,
          tamSource: 'Curated Report', tamAsOf: '2025-12-31',
        },
        industryStats: {
          candidateCount: 1, medianGrossMargin: 0.6,
          medianRevenueGrowth: 0.40, distributions: {},
        },
        ttm: ttmOf({ 0: 1 }),               // $1M
      }),
    )
    expect(r.status).toBe('SCORED')
    expect(r.raw).toBeCloseTo(0.20)
    expect(r.detail).toContain('Curated Report')
  })
})
