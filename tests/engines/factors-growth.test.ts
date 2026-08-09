import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseConfig } from '@/config'
import { revenueGrowthFactor } from '@/engines/tenbagger/factors/revenue-growth'
import { revenueAccelerationFactor } from '@/engines/tenbagger/factors/revenue-acceleration'
import { tamIndustryGrowthFactor } from '@/engines/tenbagger/factors/tam-industry-growth'
import type { FactorContext } from '@/engines/tenbagger/factor-utils'
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
    priceDate: '2026-08-08', sharesOutstanding: 1e8,
    ttm: [], annual: [], quarterly: [],
    industryStats: {
      candidateCount: 5, medianGrossMargin: 0.6, medianRevenueGrowth: 0.18, distributions: {},
    },
    asOf: '2026-08-09', ...over,
  }
  return { snapshot, cfg, flags: [] }
}

/** TTM 계열 — index 0이 현재, 4가 1년 전, 12가 3년 전 */
function ttmOf(map: Record<number, number>): FinancialPeriod[] {
  const out: FinancialPeriod[] = []
  for (let i = 0; i <= 12; i++) {
    out.push(fp(`2025-${String(i).padStart(2, '0')}`, { revenue: map[i] ?? 1000 }))
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
      fp(`2025-${String(20 - i).padStart(2, '0')}`, { periodType: 'Q', revenue: r }),
    )
  }

  it('가속 중이면 높은 점수', () => {
    const r = revenueAccelerationFactor(
      ctx({ quarterly: quarters([160, 130, 110, 100, 100, 90, 85, 80]) }),
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

describe('tamIndustryGrowthFactor', () => {
  it('TAM이 큐레이션되어 있으면 그것을 쓴다', () => {
    const r = tamIndustryGrowthFactor(
      ctx({
        industry: {
          slug: 'cybersecurity', name: 'Cybersecurity', themeSlug: 'ai-software-semi',
          tamUsd: 200_000_000_000, tamCagr: 0.15,
          tamSource: 'Example Report 2025', tamAsOf: '2025-12-31',
        },
        ttm: ttmOf({ 0: 1_000_000_000 }),
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
    const low = tamIndustryGrowthFactor(ctx({ industry, ttm: ttmOf({ 0: 10_000_000 }) }))
    const high = tamIndustryGrowthFactor(ctx({ industry, ttm: ttmOf({ 0: 600_000_000 }) }))
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
})
