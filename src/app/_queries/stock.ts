import type Database from 'better-sqlite3'
import { DERIVED_SOURCE_TAG, type Category, type FactorStatus, type FinancialPeriod, type SharesBasis } from '@/domain/types'
import { grossMargin, operatingMargin, fcfMargin } from '@/domain/metrics'
import { yoy } from '@/domain/growth'
import { loadConfig } from '@/config'
import type {
  FairValueReason,
  MoatInsufficientReason,
  MoatSignal,
  UncertaintyDriverKey,
  UncertaintyLevel,
  ValuationStatus,
} from '@/engines/valuation'

export type FactorView = {
  key: string
  weight: number
  points: number | null
  raw: number | null
  status: FactorStatus
  percentile: number | null
  detail: string
}

export type FlagView = {
  code: string
  severity: 'CRITICAL' | 'WARNING'
  message: string
  evidence: Record<string, unknown>
}

export type FreshnessItem = { label: string; date: string | null; thresholdDays: number }

export type ClassificationSource = 'sic' | 'override'

export type UncertaintyDriverView = {
  key: UncertaintyDriverKey
  status: 'MEASURED' | 'UNAVAILABLE'
  risk: number | null
  detail: string
}

/**
 * valuations 행 전체를 하나로 묶는다 — (cik, as_of) 행 자체가 없으면(스코어링과 마찬가지로
 * compute-scores가 아직 이 회사를 처리하지 않은 경우) 네 지표 모두 함께 없는 것이지
 * 일부만 있을 수 없다. fair_value가 INSUFFICIENT_DATA면 price_to_fair_value와
 * margin_of_safety도 연쇄적으로 없다 — 그 상태는 필드 단위가 아니라 status로 표현한다.
 */
export type ValuationView = {
  asOf: string
  engineVersion: string
  moatSignal: MoatSignal
  moatPeriodsEvaluated: number
  moatPeriodsClearing: number
  moatInsufficientReason: MoatInsufficientReason | null
  moatEvidence: string[]
  fairValueStatus: 'OK' | 'INSUFFICIENT_DATA'
  fairValueReason: FairValueReason | null
  fairValuePerShare: number | null
  fairValueDetail: string
  priceToFairValueStatus: 'OK' | 'UNAVAILABLE'
  priceToFairValueRatio: number | null
  marginOfSafety: number | null
  valuationStatus: ValuationStatus | null
  uncertaintyLevel: UncertaintyLevel
  uncertaintyScore: number
  uncertaintyDrivers: UncertaintyDriverView[]
}

export type StockDetail = {
  cik: number
  ticker: string
  name: string
  sic: string | null
  sicDescription: string | null
  exchange: string | null
  fiscalYearEnd: string | null
  stateOfIncorporation: string | null
  stateOfIncorporationDescription: string | null
  industrySlug: string
  industryName: string
  themeName: string
  classificationSource: ClassificationSource
  category: Category | null
  marketCap: number | null
  /** marketCap이 null이면 이것도 null이다 — 어느 발행주식수를 썼는지는 시가총액이 있을 때만 의미가 있다. */
  marketCapBasis: SharesBasis | null
  price: number | null
  priceDate: string | null
  tenbagger: number | null
  /**
   * scores 행이 없으면(스코어링 파이프라인이 아직 이 회사를 처리하지 않음)
   * completeness 자체가 없다 — number로 강제하면 미스코어링 회사에서
   * 런타임에 null이 들어와 있는데도 타입은 거짓말을 하게 된다.
   */
  completeness: number | null
  asOf: string
  /** 마찬가지로 스코어링 전이면 엔진 버전도 없다 */
  engineVersion: string | null
  growth: {
    revenueGrowth: number | null
    /** revenueGrowth가 실제로 비교한 두 TTM 시점(최근·1년 전 또는 최근·3년 전) 중
     * 어느 한쪽이라도 revenue가 누적 기간 차분으로 유도됐으면 true. */
    revenueGrowthDerived: boolean
    revenueAcceleration: number | null
    /** 최근 8개 분기(quarterly[0..7]) revenue 중 하나라도 유도됐으면 true. */
    revenueAccelerationDerived: boolean
  }
  quality: {
    grossMargin: number | null
    /** grossMargin 계산에 쓰인 revenue/grossProfit 중 하나라도 신고된 분기값이 아니라
     * 누적 기간 차분으로 유도됐으면 true. 값이 null이면 애초에 계산이 안 됐으므로 false다. */
    grossMarginDerived: boolean
    operatingMargin: number | null
    operatingMarginDerived: boolean
    fcfMargin: number | null
    fcfMarginDerived: boolean
    cash: number | null
    cashDerived: boolean
    totalDebt: number | null
    totalDebtDerived: boolean
    revenue: number | null
    revenueDerived: boolean
  }
  factors: FactorView[]
  flags: FlagView[]
  freshness: FreshnessItem[]
  /** compute-scores가 아직 이 회사의 밸류에이션을 계산하지 않았으면 null이다. */
  valuation: ValuationView | null
}

type HeadRow = {
  cik: number
  ticker: string
  name: string
  sic: string | null
  sicDescription: string | null
  exchange: string | null
  fiscalYearEnd: string | null
  stateOfIncorporation: string | null
  stateOfIncorporationDescription: string | null
  industrySlug: string
  classificationSource: ClassificationSource
  industryName: string
  themeName: string
  tenbagger: number | null
  completeness: number | null
  category: Category | null
  asOf: string | null
  engineVersion: string | null
  valAsOf: string | null
  valEngineVersion: string | null
  valMoatSignal: MoatSignal | null
  valMoatPeriodsEvaluated: number | null
  valMoatPeriodsClearing: number | null
  valMoatInsufficientReason: MoatInsufficientReason | null
  valMoatEvidence: string | null
  valFairValueStatus: 'OK' | 'INSUFFICIENT_DATA' | null
  valFairValueReason: FairValueReason | null
  valFairValuePerShare: number | null
  valFairValueDetail: string | null
  valPriceToFairValueStatus: 'OK' | 'UNAVAILABLE' | null
  valPriceToFairValueRatio: number | null
  valMarginOfSafety: number | null
  valValuationStatus: ValuationStatus | null
  valUncertaintyLevel: UncertaintyLevel | null
  valUncertaintyScore: number | null
  valUncertaintyDrivers: string | null
}

export function getStockDetail(
  raw: Database.Database,
  ticker: string,
  asOf: string,
): StockDetail | null {
  const cfg = loadConfig()

  // company_industry/industries/themes는 회사가 존재하면 항상 있다(분류 파이프라인이
  // 스코어링보다 먼저 돈다). scores와 valuations는 둘 다 LEFT JOIN한다 — INNER JOIN하면
  // 파이프라인이 아직 채점/평가하지 않은 회사가 통째로 404가 된다. industry.ts/map.ts에서
  // 이미 한 번씩 걸렸던 문제와 같은 모양이다. valuations는 scores와 별개 파이프라인
  // 스텝의 산출물이라 asOf가 서로 다를 수 있으므로(같은 compute-scores 잡 안에서 함께
  // 쓰이지만 각자 자기 latest_* 뷰로 독립적으로 조회한다) 별도 컬럼 세트로 둔다.
  const head = raw
    .prepare(
      `SELECT c.cik, c.ticker, c.name, c.sic, c.sic_description AS sicDescription,
              c.exchange, c.fiscal_year_end AS fiscalYearEnd,
              c.state_of_incorporation AS stateOfIncorporation,
              c.state_of_incorporation_description AS stateOfIncorporationDescription,
              ci.industry_slug AS industrySlug, ci.source AS classificationSource,
              i.name AS industryName, t.name AS themeName,
              s.tenbagger, s.completeness, s.category, s.as_of AS asOf,
              s.engine_version AS engineVersion,
              v.as_of AS valAsOf, v.engine_version AS valEngineVersion,
              v.moat_signal AS valMoatSignal,
              v.moat_periods_evaluated AS valMoatPeriodsEvaluated,
              v.moat_periods_clearing AS valMoatPeriodsClearing,
              v.moat_insufficient_reason AS valMoatInsufficientReason,
              v.moat_evidence AS valMoatEvidence,
              v.fair_value_status AS valFairValueStatus,
              v.fair_value_reason AS valFairValueReason,
              v.fair_value_per_share AS valFairValuePerShare,
              v.fair_value_detail AS valFairValueDetail,
              v.price_to_fair_value_status AS valPriceToFairValueStatus,
              v.price_to_fair_value_ratio AS valPriceToFairValueRatio,
              v.margin_of_safety AS valMarginOfSafety,
              v.valuation_status AS valValuationStatus,
              v.uncertainty_level AS valUncertaintyLevel,
              v.uncertainty_score AS valUncertaintyScore,
              v.uncertainty_drivers AS valUncertaintyDrivers
       FROM companies c
       JOIN company_industry ci ON ci.cik = c.cik
       JOIN industries i ON i.slug = ci.industry_slug
       JOIN themes t ON t.slug = i.theme_slug
       LEFT JOIN latest_scores s ON s.cik = c.cik
       LEFT JOIN latest_valuations v ON v.cik = c.cik
       WHERE UPPER(c.ticker) = UPPER(?)`,
    )
    .get(ticker) as HeadRow | undefined
  if (!head) return null

  const market = raw
    .prepare(
      `SELECT date, price, market_cap AS marketCap, shares_basis AS sharesBasis FROM market_data
       WHERE cik = ? ORDER BY date DESC LIMIT 1`,
    )
    .get(head.cik) as
    | { date: string; price: number | null; marketCap: number | null; sharesBasis: SharesBasis | null }
    | undefined

  const fin = raw
    .prepare(
      `SELECT period_end AS periodEnd, period_type AS periodType, revenue,
              gross_profit AS grossProfit, operating_income AS operatingIncome,
              net_income AS netIncome, ocf, capex, fcf, cash, total_debt AS totalDebt,
              equity, shares_diluted AS sharesDiluted,
              shares_outstanding AS sharesOutstanding, sbc, rd_expense AS rdExpense,
              computed_at AS computedAt, source_tags AS sourceTags
       FROM financials WHERE cik = ? AND period_type = 'TTM'
       ORDER BY period_end DESC LIMIT 1`,
    )
    .get(head.cik) as
    | (FinancialPeriod & { computedAt: string; sourceTags: string | null })
    | undefined

  // financials.source_tags는 (period_type, period_end) 행 하나에 대해 필드별로 어느 XBRL
  // 태그를 썼는지 기록한다 — 그 필드가 회사가 신고한 분기값이 아니라 누적 기간(YTD/연간)
  // 차분으로 유도됐으면 태그 자리에 DERIVED_SOURCE_TAG가 들어간다(normalizer.ts). TTM 행은
  // 4개 분기의 합이므로, 화면에 보이는 값은 그 4개 필드 중 하나라도 유도됐으면 함께
  // 유도된 것이다 — 필드 단위로 판정해야 "현금만 유도됐는데 매출도 유도된 것처럼" 보이는
  // 일이 없다(리뷰 Finding 1).
  const parseSourceTags = (tagsJson: string | null | undefined): Record<string, string> => {
    if (!tagsJson) return {}
    try {
      return JSON.parse(tagsJson) as Record<string, string>
    } catch {
      return {}
    }
  }
  const finTags = parseSourceTags(fin?.sourceTags)
  const isDerived = (...fields: string[]) => fields.some((f) => finTags[f] === DERIVED_SOURCE_TAG)

  // Growth 팩터(revenue_growth, revenue_acceleration)는 fin(최근 TTM) 한 행이 아니라 여러
  // 시점의 revenue를 비교해 나온 값이다 — TTM YoY는 최근 TTM(index 0)과 1년 전 TTM(index
  // 4)을, 3Y CAGR은 index 0과 3년 전 TTM(index 12)을, Revenue Acceleration은 최근 8개
  // 분기(index 0~7)를 함께 쓴다(domain/metrics.ts ttmRevenueGrowth/revenueCagr3y/
  // revenueAcceleration과 완전히 같은 인덱스). "유도됐다"는 Revenue (TTM) 한 칸만의
  // 이야기가 아니라 그 값을 입력으로 삼는 모든 화면 지표로 전파돼야 한다(리뷰 Finding 1의
  // 지적: growth 칸은 그동안 빠져 있었다) — 채택한 규칙은 "성장률은 두 시점을 비교해
  // 계산되므로, 그중 어느 한쪽이라도 유도된 값이면 성장률도 유도된 것으로 본다."
  const ttmRevRows = raw
    .prepare(
      `SELECT revenue, source_tags AS sourceTags FROM financials
       WHERE cik = ? AND period_type = 'TTM' ORDER BY period_end DESC LIMIT 13`,
    )
    .all(head.cik) as { revenue: number | null; sourceTags: string | null }[]

  const quarterlyRevRows = raw
    .prepare(
      `SELECT revenue, source_tags AS sourceTags FROM financials
       WHERE cik = ? AND period_type = 'Q' ORDER BY period_end DESC LIMIT 8`,
    )
    .all(head.cik) as { revenue: number | null; sourceTags: string | null }[]

  const revenueAt = (rows: { revenue: number | null }[], i: number): number | null => rows[i]?.revenue ?? null
  const revenueDerivedAt = (rows: { sourceTags: string | null }[], i: number): boolean =>
    parseSourceTags(rows[i]?.sourceTags)['revenue'] === DERIVED_SOURCE_TAG

  const scoreAsOf = head.asOf
  const factors = scoreAsOf
    ? (raw
        .prepare(
          `SELECT factor_key AS key, weight, points, raw, status, percentile, detail
           FROM score_factors WHERE cik = ? AND as_of = ?
           ORDER BY weight DESC, factor_key`,
        )
        .all(head.cik, scoreAsOf) as FactorView[])
    : []

  const flagRows = scoreAsOf
    ? (raw
        .prepare(
          `SELECT code, severity, message, evidence FROM red_flags
           WHERE cik = ? AND as_of = ? ORDER BY severity, code`,
        )
        .all(head.cik, scoreAsOf) as
        { code: string; severity: 'CRITICAL' | 'WARNING'; message: string; evidence: string | null }[])
    : []

  const factorRaw = (key: string) => factors.find((f) => f.key === key)?.raw ?? null

  // valuations 행이 없으면(파이프라인이 아직 이 회사를 평가하지 않음) 네 지표 모두
  // 함께 없는 것으로 취급한다 — 일부 필드만 채워진 어중간한 상태를 만들지 않는다.
  const valuation: ValuationView | null =
    head.valAsOf !== null &&
    head.valEngineVersion !== null &&
    head.valMoatSignal !== null &&
    head.valMoatPeriodsEvaluated !== null &&
    head.valMoatPeriodsClearing !== null &&
    head.valMoatEvidence !== null &&
    head.valFairValueStatus !== null &&
    head.valFairValueDetail !== null &&
    head.valPriceToFairValueStatus !== null &&
    head.valUncertaintyLevel !== null &&
    head.valUncertaintyScore !== null &&
    head.valUncertaintyDrivers !== null
      ? {
          asOf: head.valAsOf,
          engineVersion: head.valEngineVersion,
          moatSignal: head.valMoatSignal,
          moatPeriodsEvaluated: head.valMoatPeriodsEvaluated,
          moatPeriodsClearing: head.valMoatPeriodsClearing,
          moatInsufficientReason: head.valMoatInsufficientReason,
          moatEvidence: JSON.parse(head.valMoatEvidence) as string[],
          fairValueStatus: head.valFairValueStatus,
          fairValueReason: head.valFairValueReason,
          fairValuePerShare: head.valFairValuePerShare,
          fairValueDetail: head.valFairValueDetail,
          priceToFairValueStatus: head.valPriceToFairValueStatus,
          priceToFairValueRatio: head.valPriceToFairValueRatio,
          marginOfSafety: head.valMarginOfSafety,
          valuationStatus: head.valValuationStatus,
          uncertaintyLevel: head.valUncertaintyLevel,
          uncertaintyScore: head.valUncertaintyScore,
          uncertaintyDrivers: JSON.parse(head.valUncertaintyDrivers) as UncertaintyDriverView[],
        }
      : null

  const grossMarginValue = grossMargin(fin)
  const operatingMarginValue = operatingMargin(fin)
  const fcfMarginValue = fcfMargin(fin)
  const cashValue = fin?.cash ?? null
  const totalDebtValue = fin?.totalDebt ?? null
  const revenueValue = fin?.revenue ?? null

  const revenueGrowthValue = factorRaw('revenue_growth')
  const revenueAccelerationValue = factorRaw('revenue_acceleration')

  // engines/tenbagger/factors/revenue-growth.ts는 raw로 `ttmYoy ?? cagr3y`를 저장한다 —
  // 즉 1년 전 TTM(index 4)이 계산 가능하면 그 값을 쓰고, 그때만 3년 전 TTM(index 12)은
  // 아예 쓰이지 않는다. 어느 쪽이 실제로 쓰였는지에 맞춰 그 두 번째 시점만 확인해야
  // 한다 — 안 쓰인 시점이 유도됐다고 "계산됨"을 잘못 붙이면 Finding 1이 지킨 "필드 단위
  // 정확성"이 growth 칸에서 깨진다.
  const ttmYoyValue = yoy(revenueAt(ttmRevRows, 0), revenueAt(ttmRevRows, 4))
  const revenueGrowthSecondPeriod = ttmYoyValue !== null ? 4 : 12
  const revenueGrowthDerived =
    revenueGrowthValue !== null &&
    (revenueDerivedAt(ttmRevRows, 0) || revenueDerivedAt(ttmRevRows, revenueGrowthSecondPeriod))

  // revenue-acceleration.ts는 quarterly[0..7] 8개 전부의 revenue가 있어야만 null이
  // 아닌 raw를 낸다 — raw가 있다는 것 자체가 8개 분기 모두 실제로 계산에 쓰였다는
  // 뜻이므로, 조건 분기 없이 8개 전부를 확인한다.
  const revenueAccelerationDerived =
    revenueAccelerationValue !== null &&
    [0, 1, 2, 3, 4, 5, 6, 7].some((i) => revenueDerivedAt(quarterlyRevRows, i))

  return {
    cik: head.cik,
    ticker: head.ticker,
    name: head.name,
    sic: head.sic,
    sicDescription: head.sicDescription,
    exchange: head.exchange,
    fiscalYearEnd: head.fiscalYearEnd,
    stateOfIncorporation: head.stateOfIncorporation,
    stateOfIncorporationDescription: head.stateOfIncorporationDescription,
    industrySlug: head.industrySlug,
    industryName: head.industryName,
    themeName: head.themeName,
    classificationSource: head.classificationSource,
    category: head.category,
    tenbagger: head.tenbagger,
    completeness: head.completeness,
    engineVersion: head.engineVersion,
    asOf: scoreAsOf ?? asOf,
    marketCap: market?.marketCap ?? null,
    marketCapBasis: market?.sharesBasis ?? null,
    price: market?.price ?? null,
    priceDate: market?.date ?? null,
    growth: {
      revenueGrowth: revenueGrowthValue,
      revenueGrowthDerived,
      revenueAcceleration: revenueAccelerationValue,
      revenueAccelerationDerived,
    },
    quality: {
      grossMargin: grossMarginValue,
      grossMarginDerived: grossMarginValue !== null && isDerived('revenue', 'grossProfit'),
      operatingMargin: operatingMarginValue,
      operatingMarginDerived: operatingMarginValue !== null && isDerived('revenue', 'operatingIncome'),
      fcfMargin: fcfMarginValue,
      fcfMarginDerived: fcfMarginValue !== null && isDerived('revenue', 'ocf', 'capex'),
      cash: cashValue,
      cashDerived: cashValue !== null && isDerived('cash'),
      totalDebt: totalDebtValue,
      totalDebtDerived: totalDebtValue !== null && isDerived('totalDebt'),
      revenue: revenueValue,
      revenueDerived: revenueValue !== null && isDerived('revenue'),
    },
    factors,
    flags: flagRows.map((f) => ({
      code: f.code,
      severity: f.severity,
      message: f.message,
      evidence: f.evidence ? (JSON.parse(f.evidence) as Record<string, unknown>) : {},
    })),
    freshness: [
      { label: 'Price', date: market?.date ?? null, thresholdDays: cfg.staleness.price_days },
      { label: 'Financials', date: fin?.computedAt ?? null, thresholdDays: cfg.staleness.financials_days },
      { label: 'Tenbagger Score', date: scoreAsOf, thresholdDays: cfg.staleness.scores_days },
    ],
    valuation,
  }
}
