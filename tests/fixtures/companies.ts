import type { CompanySnapshot, FinancialPeriod, IndustryStats } from '@/domain/types'

const INDUSTRY = {
  slug: 'semiconductors', name: 'Semiconductors', themeSlug: 'ai-software-semi',
  tamUsd: null, tamCagr: null, tamSource: null, tamAsOf: null,
}

const STATS: IndustryStats = {
  candidateCount: 12, medianGrossMargin: 0.55,
  medianRevenueGrowth: 0.15, distributions: {},
}

function period(
  periodEnd: string, periodType: 'Q' | 'A' | 'TTM', over: Partial<FinancialPeriod>,
): FinancialPeriod {
  return {
    periodEnd, periodType, revenue: null, grossProfit: null, operatingIncome: null,
    netIncome: null, ocf: null, capex: null, fcf: null, cash: null, totalDebt: null,
    equity: null, sharesDiluted: null, sharesOutstanding: null, sbc: null,
    rdExpense: null, ...over,
  }
}

/** TTM 13개(3년) 생성. scale은 분기마다의 성장 배수. */
function ttmSeries(
  latestRevenue: number, quarterlyGrowth: number, shape: Partial<FinancialPeriod>,
): FinancialPeriod[] {
  return Array.from({ length: 13 }, (_, i) =>
    period(`2025-${String(40 - i).padStart(2, '0')}`, 'TTM', {
      ...shape,
      revenue: latestRevenue / Math.pow(1 + quarterlyGrowth, i),
      grossProfit:
        shape.grossProfit == null
          ? null
          : (latestRevenue / Math.pow(1 + quarterlyGrowth, i)) *
            (shape.grossProfit / (shape.revenue ?? 1)),
    }),
  )
}

function quarterSeries(
  latestRevenue: number, quarterlyGrowth: number, gm: number,
): FinancialPeriod[] {
  return Array.from({ length: 12 }, (_, i) => {
    const rev = latestRevenue / Math.pow(1 + quarterlyGrowth, i)
    return period(`2025-${String(40 - i).padStart(2, '0')}`, 'Q', {
      revenue: rev, grossProfit: rev * gm,
    })
  })
}

function base(over: Partial<CompanySnapshot>): CompanySnapshot {
  return {
    cik: 1, ticker: 'X', name: 'X Inc',
    themeSlug: 'ai-software-semi', industrySlug: 'semiconductors',
    industry: INDUSTRY, classificationSource: 'sic',
    marketCap: null, price: 10, priceDate: '2026-08-08', sharesOutstanding: 1e8,
    ttm: [], annual: [], quarterly: [], industryStats: STATS,
    asOf: '2026-08-09', ...over,
  }
}

/** 고성장·고마진·소형 — 높은 점수가 나와야 한다 */
export function earlyTenbagger(): CompanySnapshot {
  const shape = {
    revenue: 400_000_000, grossProfit: 320_000_000, operatingIncome: 40_000_000,
    ocf: 60_000_000, capex: 10_000_000, fcf: 50_000_000,
    cash: 500_000_000, totalDebt: 50_000_000, equity: 700_000_000,
    sharesDiluted: 100_000_000, sharesOutstanding: 100_000_000,
    sbc: 40_000_000, rdExpense: 80_000_000,
  }
  return base({
    ticker: 'GROW', marketCap: 2_500_000_000,
    ttm: ttmSeries(400_000_000, 0.09, shape),
    quarterly: quarterSeries(110_000_000, 0.09, 0.80),
  })
}

/** 매출 감소 소형주 — 낮은 점수와 게이트 0이 나와야 한다 */
export function valueTrap(): CompanySnapshot {
  const shape = {
    revenue: 200_000_000, grossProfit: 60_000_000, operatingIncome: -20_000_000,
    ocf: -15_000_000, capex: 5_000_000, fcf: -20_000_000,
    cash: 30_000_000, totalDebt: 120_000_000, equity: 40_000_000,
    sharesDiluted: 90_000_000, sharesOutstanding: 90_000_000,
    sbc: 10_000_000, rdExpense: 8_000_000,
  }
  return base({
    ticker: 'TRAP', marketCap: 400_000_000,
    ttm: ttmSeries(200_000_000, -0.04, shape),
    quarterly: quarterSeries(48_000_000, -0.04, 0.30),
    annual: [
      period('2024-12-31', 'A', { revenue: 200_000_000 }),
      period('2023-12-31', 'A', { revenue: 240_000_000 }),
      period('2022-12-31', 'A', { revenue: 280_000_000 }),
    ],
  })
}

/** 펀더멘털은 우수하나 시가총액 $200B — 시총 기회 1점이 나와야 한다 */
export function megaCap(): CompanySnapshot {
  const shape = {
    revenue: 120_000_000_000, grossProfit: 90_000_000_000,
    operatingIncome: 60_000_000_000, ocf: 65_000_000_000, capex: 5_000_000_000,
    fcf: 60_000_000_000, cash: 40_000_000_000, totalDebt: 10_000_000_000,
    equity: 80_000_000_000, sharesDiluted: 24_000_000_000,
    sharesOutstanding: 24_000_000_000, sbc: 4_000_000_000, rdExpense: 12_000_000_000,
  }
  return base({
    ticker: 'MEGA', marketCap: 200_000_000_000,
    ttm: ttmSeries(120_000_000_000, 0.05, shape),
    quarterly: quarterSeries(32_000_000_000, 0.05, 0.75),
  })
}

/** TTM이 2개뿐 — completeness가 낮게 나와야 한다 */
export function sparseData(): CompanySnapshot {
  return base({
    ticker: 'SPARSE', marketCap: 800_000_000,
    ttm: [
      period('2025-03-31', 'TTM', { revenue: 50_000_000 }),
      period('2024-12-31', 'TTM', { revenue: 48_000_000 }),
    ],
  })
}
