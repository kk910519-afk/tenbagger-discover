import type { CompanySnapshot, FinancialPeriod, IndustryStats } from '@/domain/types'

const INDUSTRY = {
  slug: 'software-application', name: 'Software', themeSlug: 'ai-software-semi',
  tamUsd: null, tamCagr: null, tamSource: null, tamAsOf: null,
}

const STATS: IndustryStats = {
  candidateCount: 5, medianGrossMargin: 0.6, medianRevenueGrowth: 0.15, distributions: {},
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

function base(over: Partial<CompanySnapshot>): CompanySnapshot {
  return {
    cik: 900, ticker: 'VAL', name: 'Valuation Test Co',
    themeSlug: 'ai-software-semi', industrySlug: 'software-application',
    industry: INDUSTRY, classificationSource: 'sic',
    marketCap: 2_000_000_000, price: 20, priceDate: '2026-08-08', sharesOutstanding: 100_000_000,
    ttm: [], annual: [], quarterly: [], industryStats: STATS, asOf: '2026-08-09', ...over,
  }
}

/** n개 TTM(최근순). quarterlyGrowth는 분기당 성장 배수. shape(revenue)는 해당 분기의 나머지 필드를 만든다. */
function ttmSeries(
  n: number, latestRevenue: number, quarterlyGrowth: number,
  shape: (revenue: number) => Partial<FinancialPeriod>,
): FinancialPeriod[] {
  return Array.from({ length: n }, (_, i) => {
    const rev = latestRevenue / Math.pow(1 + quarterlyGrowth, i)
    return period(`2025-${String(40 - i).padStart(2, '0')}`, 'TTM', { revenue: rev, ...shape(rev) })
  })
}

/** invested capital을 100으로 고정하고 영업이익만 바꿔 ROIC를 통제한다. */
function annualPeriod(year: number, operatingIncome: number): FinancialPeriod {
  return period(`${year}-12-31`, 'A', {
    revenue: operatingIncome * 3, operatingIncome,
    totalDebt: 60, equity: 50, cash: 10, // invested = 60 + 50 - 10 = 100
  })
}

// --- Fair Value 게이트 픽스처 -------------------------------------------------

/** 5개 게이트를 모두 통과 — OK가 나와야 하는 기준 픽스처. */
export function eligibleForFairValue(): CompanySnapshot {
  const shape = (rev: number) => ({
    grossProfit: rev * 0.7, operatingIncome: rev * 0.2, fcf: rev * 0.15,
    cash: 500_000_000, totalDebt: 100_000_000, sharesDiluted: 100_000_000,
    equity: 800_000_000,
  })
  return base({
    ticker: 'GOOD', price: 20,
    ttm: ttmSeries(13, 1_000_000_000, 0.05, shape),
  })
}

/** 최근 TTM 매출이 0 이하 — NON_POSITIVE_REVENUE */
export function preRevenueCompany(): CompanySnapshot {
  return base({
    ticker: 'PRE',
    ttm: [
      period('2025-40', 'TTM', { revenue: 0, operatingIncome: -5_000_000 }),
      period('2025-39', 'TTM', { revenue: 0, operatingIncome: -4_000_000 }),
    ],
  })
}

/** 최근 매출은 양수지만 성장률을 낼 이력(5분기)이 없음 — INSUFFICIENT_REVENUE_HISTORY */
export function shortRevenueHistoryCompany(): CompanySnapshot {
  return base({
    ticker: 'SHORT',
    ttm: [
      period('2025-40', 'TTM', { revenue: 100_000_000, operatingIncome: 10_000_000 }),
      period('2025-39', 'TTM', { revenue: 95_000_000, operatingIncome: 9_000_000 }),
      period('2025-38', 'TTM', { revenue: 90_000_000, operatingIncome: 8_000_000 }),
    ],
  })
}

/** 매출·성장 이력은 충분하지만 FCF와 영업이익이 모두 적자 — NOT_CASH_GENERATIVE (현금 소각 기업) */
export function cashBurningCompany(): CompanySnapshot {
  const shape = (rev: number) => ({
    grossProfit: rev * 0.4, operatingIncome: -rev * 0.3, fcf: -rev * 0.35,
    cash: 50_000_000, totalDebt: 20_000_000, sharesDiluted: 80_000_000, equity: 30_000_000,
  })
  return base({
    ticker: 'BURN',
    ttm: ttmSeries(13, 200_000_000, 0.06, shape),
  })
}

/** 현금전환 증거까지는 있지만 희석주식수·발행주식수 모두 없음 — NO_SHARE_COUNT */
export function noShareCountCompany(): CompanySnapshot {
  const shape = (rev: number) => ({
    grossProfit: rev * 0.6, operatingIncome: rev * 0.2, fcf: rev * 0.15,
    cash: 100_000_000, totalDebt: 20_000_000, sharesDiluted: null, equity: 200_000_000,
  })
  return base({
    ticker: 'NOSHR', sharesOutstanding: null,
    ttm: ttmSeries(13, 500_000_000, 0.04, shape),
  })
}

/** 현금·주식수까지는 있지만 재무상태표(현금 또는 총부채)가 없음 — NO_BALANCE_SHEET_DATA */
export function noBalanceSheetCompany(): CompanySnapshot {
  const shape = (rev: number) => ({
    grossProfit: rev * 0.6, operatingIncome: rev * 0.2, fcf: rev * 0.15,
    cash: null, totalDebt: null, sharesDiluted: 90_000_000, equity: 200_000_000,
  })
  return base({
    ticker: 'NOBS',
    ttm: ttmSeries(13, 500_000_000, 0.04, shape),
  })
}

// --- 해자(Moat) 신호 픽스처 ---------------------------------------------------

/** 연간 8개 기간 중 6개(75%)에서 ROIC가 WACC(9%)를 상회 — WIDE */
export function wideMoatCompany(): CompanySnapshot {
  return base({
    ticker: 'WIDE',
    annual: [
      annualPeriod(2025, 15), annualPeriod(2024, 16), annualPeriod(2023, 14),
      annualPeriod(2022, 15), annualPeriod(2021, 13), annualPeriod(2020, 14),
      annualPeriod(2019, 1), annualPeriod(2018, 1),
    ],
  })
}

/** 연간 8개 기간 중 4개(50%)에서만 상회 — NARROW */
export function narrowMoatCompany(): CompanySnapshot {
  return base({
    ticker: 'NARROW',
    annual: [
      annualPeriod(2025, 15), annualPeriod(2024, 16), annualPeriod(2023, 1),
      annualPeriod(2022, 15), annualPeriod(2021, 13), annualPeriod(2020, 1),
      annualPeriod(2019, 1), annualPeriod(2018, 1),
    ],
  })
}

/** 6개 기간 중 딱 1개만 강했던 해 — "한 해 반짝"으로는 WIDE(는커녕 NARROW도) 얻지 못한다 */
export function oneStrongYearCompany(): CompanySnapshot {
  return base({
    ticker: 'ONEYR',
    annual: [
      annualPeriod(2025, 20), // 유일하게 WACC를 상회하는 해
      annualPeriod(2024, 1), annualPeriod(2023, 1), annualPeriod(2022, 1),
      annualPeriod(2021, 1), annualPeriod(2020, 1),
    ],
  })
}

/** ROIC를 계산할 수 있는 연간 기간이 3개뿐(최소 4개 필요) — INSUFFICIENT_DATA */
export function insufficientMoatHistoryCompany(): CompanySnapshot {
  return base({
    ticker: 'THINHX',
    annual: [annualPeriod(2025, 15), annualPeriod(2024, 15), annualPeriod(2023, 15)],
  })
}

export { base as valuationBase, period as valuationPeriod, ttmSeries as valuationTtmSeries }
