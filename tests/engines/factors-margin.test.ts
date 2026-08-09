import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseConfig } from '@/config'
import { grossMarginFactor } from '@/engines/tenbagger/factors/gross-margin'
import { operatingLeverageFactor } from '@/engines/tenbagger/factors/operating-leverage'
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
  return {
    cfg, flags: [],
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
        candidateCount: 5, medianGrossMargin: 0.6,
        medianRevenueGrowth: 0.18, distributions: {},
      },
      asOf: '2026-08-09', ...over,
    },
  }
}

/** 마진이 개선되는 8개 분기 (최근순) */
function improvingQuarters(): FinancialPeriod[] {
  return [0.74, 0.72, 0.70, 0.68, 0.66, 0.64, 0.62, 0.60].map((gm, i) =>
    fp(`2025-${String(20 - i).padStart(2, '0')}`, {
      periodType: 'Q', revenue: 100, grossProfit: gm * 100,
    }),
  )
}

describe('grossMarginFactor', () => {
  it('수준과 추세를 블렌드한다', () => {
    const r = grossMarginFactor(
      ctx({
        ttm: [fp('2025-03-31', { revenue: 1000, grossProfit: 740 })],
        quarterly: improvingQuarters(),
      }),
    )
    expect(r.key).toBe('gross_margin')
    expect(r.weight).toBe(10)
    expect(r.status).toBe('SCORED')
    expect(r.raw).toBeCloseTo(0.74)
    expect(r.points!).toBeGreaterThan(9)   // 74% + 개선 추세
    expect(r.detail).toContain('74.0%')
    expect(r.detail).toContain('bp')
  })

  it('분기가 부족하면 수준만으로 채점한다', () => {
    const r = grossMarginFactor(
      ctx({ ttm: [fp('2025-03-31', { revenue: 1000, grossProfit: 400 })] }),
    )
    expect(r.status).toBe('SCORED')
    expect(r.detail).toContain('추세 산출 불가')
  })

  it('매출총이익이 없으면 NO_DATA', () => {
    const r = grossMarginFactor(ctx({ ttm: [fp('2025-03-31', { revenue: 1000 })] }))
    expect(r.status).toBe('NO_DATA')
  })
})

describe('operatingLeverageFactor', () => {
  /** 현재와 1년 전 TTM. index 4가 1년 전 */
  function ttmPair(now: Partial<FinancialPeriod>, prior: Partial<FinancialPeriod>) {
    const out = [fp('2025-03-31', now)]
    for (let i = 1; i < 4; i++) out.push(fp(`2024-${12 - i}-31`))
    out.push(fp('2024-03-31', prior))
    return out
  }

  it('마진이 개선되고 opex가 매출보다 느리게 늘면 고득점', () => {
    const r = operatingLeverageFactor(
      ctx({
        ttm: ttmPair(
          { revenue: 1500, grossProfit: 1050, operatingIncome: 300 },  // opex 750, 마진 20%
          { revenue: 1000, grossProfit: 700, operatingIncome: 100 },   // opex 600, 마진 10%
        ),
      }),
    )
    expect(r.key).toBe('operating_leverage')
    expect(r.status).toBe('SCORED')
    // 매출 +50%, opex +25% → 격차 +25%p, 영업이익률 +10%p
    expect(r.points!).toBeGreaterThan(9)
    expect(r.detail).toContain('영업이익률')
  })

  it('opex가 매출보다 빨리 늘면 저득점', () => {
    const r = operatingLeverageFactor(
      ctx({
        ttm: ttmPair(
          { revenue: 1100, grossProfit: 770, operatingIncome: -50 },
          { revenue: 1000, grossProfit: 700, operatingIncome: 100 },
        ),
      }),
    )
    expect(r.points!).toBeLessThan(3)
  })

  it('1년 전 TTM이 없으면 NO_DATA', () => {
    const r = operatingLeverageFactor(
      ctx({ ttm: [fp('2025-03-31', { revenue: 1000, operatingIncome: 100 })] }),
    )
    expect(r.status).toBe('NO_DATA')
  })
})
