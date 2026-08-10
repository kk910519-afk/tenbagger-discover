import type Database from 'better-sqlite3'
import type { Category, FactorStatus, FinancialPeriod, SharesBasis } from '@/domain/types'
import { grossMargin, operatingMargin, fcfMargin } from '@/domain/metrics'
import { loadConfig } from '@/config'
import type {
  FairValueReason,
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
  growth: { revenueGrowth: number | null; revenueAcceleration: number | null }
  quality: {
    grossMargin: number | null
    operatingMargin: number | null
    fcfMargin: number | null
    cash: number | null
    totalDebt: number | null
    revenue: number | null
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
              computed_at AS computedAt
       FROM financials WHERE cik = ? AND period_type = 'TTM'
       ORDER BY period_end DESC LIMIT 1`,
    )
    .get(head.cik) as (FinancialPeriod & { computedAt: string }) | undefined

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
      revenueGrowth: factorRaw('revenue_growth'),
      revenueAcceleration: factorRaw('revenue_acceleration'),
    },
    quality: {
      grossMargin: grossMargin(fin),
      operatingMargin: operatingMargin(fin),
      fcfMargin: fcfMargin(fin),
      cash: fin?.cash ?? null,
      totalDebt: fin?.totalDebt ?? null,
      revenue: fin?.revenue ?? null,
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
