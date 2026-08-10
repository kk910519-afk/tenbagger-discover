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
    sharesBasis: 'reported',
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

/**
 * 분기 성장률이 두 구간으로 나뉘는 TTM 계열(최근순). recentGrowth는 최근 recentCount개
 * 간격에, olderGrowth는 그 이전 간격에 적용한다.
 *
 * 왜 두 구간인가: 성장률이 한 값으로 일정하면 TTM YoY와 3Y CAGR이 정확히 같아져서
 * `blend`의 두 가중치를 서로 바꿔도 결과가 변하지 않는다 — 즉 그 규칙이 관측 불가능해진다
 * (테스트 리뷰 F1). 두 구간으로 나누면 두 지표가 실제로 달라진다.
 */
function phasedTtmSeries(
  n: number, latestRevenue: number, recentCount: number,
  recentGrowth: number, olderGrowth: number,
  shape: (revenue: number) => Partial<FinancialPeriod>,
): FinancialPeriod[] {
  const revenues = [latestRevenue]
  for (let i = 1; i < n; i++) {
    const g = i <= recentCount ? recentGrowth : olderGrowth
    revenues.push(revenues[i - 1]! / (1 + g))
  }
  return revenues.map((rev, i) =>
    period(`2025-${String(40 - i).padStart(2, '0')}`, 'TTM', { revenue: rev, ...shape(rev) }),
  )
}

/** eligibleForFairValue의 재무 구조 — 게이트 픽스처들이 공유한다. */
function eligibleShape(rev: number): Partial<FinancialPeriod> {
  return {
    grossProfit: rev * 0.7, operatingIncome: rev * 0.3, fcf: rev * 0.25,
    cash: 500_000_000, totalDebt: 100_000_000, sharesDiluted: 100_000_000,
    equity: 800_000_000,
  }
}

/**
 * 게이트를 모두 통과 — OK가 나와야 하는 기준 픽스처. 모든 중간값이 결정적이다:
 *   TTM YoY  = 1.05^4 − 1                        = 0.21550625
 *   3Y CAGR  = (1.05^4 · 1.02^8)^(1/3) − 1       = 0.12508722
 *   초기성장률 = 0.6·YoY + 0.4·CAGR               = 0.17933864  (가중치를 바꾸면 0.16125483)
 *   초기 FCF마진 = 0.25 (성숙마진 0.15와 달라 마진 페이드가 관측된다)
 *   순현금 = 5e8 − 1e8 = 4e8, 희석주식수 1e8
 */
export function eligibleForFairValue(): CompanySnapshot {
  return base({
    ticker: 'GOOD', price: 20,
    ttm: phasedTtmSeries(13, 1_000_000_000, 4, 0.05, 0.02, eligibleShape),
  })
}

/**
 * 암시 매출배수가 valuation.max_implied_revenue_multiple을 크게 넘는 기업 — CRMD 실사례의 모양
 * (TTM 매출 $400M, 1년 전 $82.6M → TTM YoY 약 +380%, FCF마진 48.7%). 이런 입력에서
 * 수정 전 엔진은 주당 $545.63(시총의 73배)을 "98.6% 저평가"로 냈다.
 */
export function hyperGrowthCompany(): CompanySnapshot {
  return base({
    ticker: 'HYPER', price: 7.44,
    ttm: phasedTtmSeries(13, 400_054_000, 4, 0.48, 0.05, (rev) => ({
      grossProfit: rev * 0.8, operatingIncome: rev * 0.4, fcf: rev * 0.4867,
      cash: 178_087_000, totalDebt: 144_626, sharesDiluted: 92_985_000,
      equity: 300_000_000,
    })),
  })
}

/**
 * FCF는 적자지만 영업이익이 흑자라 게이트를 통과하는 자본지출 집약 성장기업 —
 * 초기 마진이 nopat_proxy(영업이익률 × (1 − 세율))로 잡히는 유일한 분기.
 */
export function capexHeavyCompany(): CompanySnapshot {
  return base({
    ticker: 'CAPEX', price: 20,
    ttm: phasedTtmSeries(13, 1_000_000_000, 4, 0.05, 0.02, (rev) => ({
      grossProfit: rev * 0.7, operatingIncome: rev * 0.3, fcf: -rev * 0.05,
      cash: 500_000_000, totalDebt: 100_000_000, sharesDiluted: 100_000_000,
      equity: 800_000_000,
    })),
  })
}

/** TTM 5개 구간뿐 — 3Y CAGR은 못 구하고 TTM YoY만 산출된다(ttm_yoy_only). */
export function ttmYoyOnlyCompany(): CompanySnapshot {
  return base({
    ticker: 'YOYONLY', price: 20,
    ttm: phasedTtmSeries(5, 1_000_000_000, 4, 0.05, 0.02, eligibleShape),
  })
}

/** 13개 구간이지만 1년 전 구간의 매출만 결측 — TTM YoY는 못 구하고 3Y CAGR만 남는다. */
export function cagr3yOnlyCompany(): CompanySnapshot {
  const ttm = phasedTtmSeries(13, 1_000_000_000, 4, 0.05, 0.02, eligibleShape)
  ttm[4] = { ...ttm[4]!, revenue: null }
  return base({ ticker: 'CAGRONLY', price: 20, ttm })
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

/** 연간 8개 기간 중 6개(75%)에서 ROIC가 WACC(9%)를 상회 — PERSISTENT */
export function wideMoatCompany(): CompanySnapshot {
  return base({
    ticker: 'PERSIST',
    annual: [
      annualPeriod(2025, 15), annualPeriod(2024, 16), annualPeriod(2023, 14),
      annualPeriod(2022, 15), annualPeriod(2021, 13), annualPeriod(2020, 14),
      annualPeriod(2019, 1), annualPeriod(2018, 1),
    ],
  })
}

/** 연간 8개 기간 중 4개(50%)에서만 상회 — INTERMITTENT */
export function narrowMoatCompany(): CompanySnapshot {
  return base({
    ticker: 'INTERMIT',
    annual: [
      annualPeriod(2025, 15), annualPeriod(2024, 16), annualPeriod(2023, 1),
      annualPeriod(2022, 15), annualPeriod(2021, 13), annualPeriod(2020, 1),
      annualPeriod(2019, 1), annualPeriod(2018, 1),
    ],
  })
}

/** 6개 기간 중 딱 1개만 강했던 해 — "한 해 반짝"으로는 PERSISTENT(는커녕 INTERMITTENT도) 얻지 못한다 */
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

/** 연간 기간 자체가 3개뿐(최소 4개 필요) — 신규 상장 등, 데이터 품질과 무관하게 채울 수 없음 → TOO_FEW_PERIODS */
export function insufficientMoatHistoryCompany(): CompanySnapshot {
  return base({
    ticker: 'THINHX',
    annual: [annualPeriod(2025, 15), annualPeriod(2024, 15), annualPeriod(2023, 15)],
  })
}

/**
 * 연간 기간은 5개로 충분하지만 그 중 2개(cash 결측, totalDebt 결측)에서 ROIC 계산에
 * 필요한 재무 항목이 없어 유효 기간이 3개뿐(최소 4개 필요) → MISSING_FINANCIALS.
 */
export function missingFinancialsMoatCompany(): CompanySnapshot {
  return base({
    ticker: 'MISSFIN',
    annual: [
      annualPeriod(2025, 15),
      annualPeriod(2024, 15),
      period('2023-12-31', 'A', { revenue: 45, operatingIncome: 15, totalDebt: 60, equity: 50, cash: null }),
      period('2022-12-31', 'A', { revenue: 45, operatingIncome: 15, totalDebt: null, equity: 50, cash: 10 }),
      annualPeriod(2021, 15),
    ],
  })
}

/**
 * 연간 기간 5개 모두 재무 항목은 갖춰져 있지만, 보유 현금이 부채+자본 합계보다 많아
 * 투하자본(=부채+자본−현금)이 매해 0 이하 → 유효 기간 0개, 결측은 하나도 없음 →
 * NOT_APPLICABLE(현금부자 초기 성장 기업의 전형적인 모양 — 라이브 DB의 상위 후보 다수가
 * 이 모양이다).
 */
export function notApplicableMoatCompany(): CompanySnapshot {
  const cashRich = (year: number) =>
    period(`${year}-12-31`, 'A', { revenue: 45, operatingIncome: 15, totalDebt: 10, equity: 20, cash: 100 })
  return base({
    ticker: 'NOTAPP',
    annual: [cashRich(2025), cashRich(2024), cashRich(2023), cashRich(2022), cashRich(2021)],
  })
}

/** 투하자본 0 이하인 해 4개 + 결측 1개. 결측 기간을 낙관적으로 되돌려도(유효 2개) 여전히
 * 최소 4개에 못 미치므로 그 결측은 결론을 바꿀 수 없었다 — 진짜 병목은 투하자본 미달 →
 * NOT_APPLICABLE. 결측이 하나 섞여 있다고 무조건 "모른다"고 말하지 않는다는 규칙을 검증.
 */
function cashRich(year: number): FinancialPeriod {
  return period(`${year}-12-31`, 'A', { revenue: 45, operatingIncome: 15, totalDebt: 10, equity: 20, cash: 100 })
}

export function mixedGapCannotFlipMoatCompany(): CompanySnapshot {
  return base({
    ticker: 'MIXNF',
    annual: [
      annualPeriod(2025, 15), // 유효
      cashRich(2024), cashRich(2023), cashRich(2022), cashRich(2021), // 투하자본 ≤ 0 (4개)
      period('2020-12-31', 'A', { revenue: 45, operatingIncome: 15, totalDebt: 60, equity: 50, cash: null }), // 결측
    ],
  })
}

/** 투하자본 0 이하인 해 2개 + 결측 4개. 결측 기간을 낙관적으로 되돌리면(유효 1+4=5개) 최소
 * 4개를 채우고도 남는다 — 그 결측이 채워졌다면 결론이 달라질 수 있었다는 뜻이므로, 투하자본
 * 미달 기간이 섞여 있어도 MISSING_FINANCIALS를 보고한다(결측이 진짜 병목일 가능성을 배제할
 * 수 없으므로).
 */
export function mixedGapCouldFlipMoatCompany(): CompanySnapshot {
  const missing = (year: number): FinancialPeriod =>
    period(`${year}-12-31`, 'A', { revenue: 45, operatingIncome: 15, totalDebt: 60, equity: 50, cash: null })
  return base({
    ticker: 'MIXCF',
    annual: [
      annualPeriod(2025, 15), // 유효
      missing(2024), missing(2023), missing(2022), missing(2021), // 결측 (4개)
      cashRich(2020), cashRich(2019), // 투하자본 ≤ 0 (2개)
    ],
  })
}

/**
 * 연간 14개 기간: 가장 최근 8개(lookback_periods)는 전부 WACC 미달이고, 그 이전 6개는
 * 전부 크게 상회한다. 최근 8개만 보면 상회 0개 → NONE이지만, 창을 자르지 않고 14개를
 * 다 세면 6/14 = 43%로 intermittent_clear_ratio(0.40)를 넘어 INTERMITTENT가 된다.
 * "10년 전의 좋았던 시절은 더 이상 계산에 들어가지 않는다"는 규칙을 관측하는 유일한
 * 픽스처다(테스트 리뷰 F6).
 */
export function staleGloryMoatCompany(): CompanySnapshot {
  return base({
    ticker: 'STALE',
    annual: [
      annualPeriod(2025, 1), annualPeriod(2024, 1), annualPeriod(2023, 1),
      annualPeriod(2022, 1), annualPeriod(2021, 1), annualPeriod(2020, 1),
      annualPeriod(2019, 1), annualPeriod(2018, 1),
      // 창 밖 — 여기만 보면 WIDE다
      annualPeriod(2017, 30), annualPeriod(2016, 30), annualPeriod(2015, 30),
      annualPeriod(2014, 30), annualPeriod(2013, 30), annualPeriod(2012, 30),
    ],
  })
}

/**
 * 투하자본이 양수이긴 하지만 총액 대비 무시할 만큼 작은 해로만 이뤄진 기업 — Dropbox
 * 실사례의 모양(자사주 매입으로 자본이 음수, 투하자본은 상쇄 잔차). 수정 전에는 모든
 * 기간이 유효 판정을 받아 PERSISTENT(평균 스프레드 +119.6%p)가 나왔다.
 */
export function buybackNegativeEquityCompany(): CompanySnapshot {
  const year = (y: number): FinancialPeriod =>
    period(`${y}-12-31`, 'A', {
      revenue: 2_500_000_000, operatingIncome: 689_100_000,
      totalDebt: 2_834_000_000, equity: -1_797_200_000, cash: 891_300_000,
    })
  return base({
    ticker: 'BUYBK',
    annual: [year(2025), year(2024), year(2023), year(2022), year(2021)],
  })
}

export { base as valuationBase, period as valuationPeriod, ttmSeries as valuationTtmSeries }
