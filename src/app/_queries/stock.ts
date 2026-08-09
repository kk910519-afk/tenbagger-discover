import type Database from 'better-sqlite3'
import type { Category, FactorStatus, FinancialPeriod } from '@/domain/types'
import { grossMargin, operatingMargin, fcfMargin } from '@/domain/metrics'
import { loadConfig } from '@/config'

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

export type StockDetail = {
  cik: number
  ticker: string
  name: string
  sic: string | null
  sicDescription: string | null
  exchange: string | null
  industrySlug: string
  industryName: string
  themeName: string
  classificationSource: ClassificationSource
  category: Category | null
  marketCap: number | null
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
}

type HeadRow = {
  cik: number
  ticker: string
  name: string
  sic: string | null
  sicDescription: string | null
  exchange: string | null
  industrySlug: string
  classificationSource: ClassificationSource
  industryName: string
  themeName: string
  tenbagger: number | null
  completeness: number | null
  category: Category | null
  asOf: string | null
  engineVersion: string | null
}

export function getStockDetail(
  raw: Database.Database,
  ticker: string,
  asOf: string,
): StockDetail | null {
  const cfg = loadConfig()

  // company_industry/industries/themes는 회사가 존재하면 항상 있다(분류 파이프라인이
  // 스코어링보다 먼저 돈다). scores는 LEFT JOIN한다 — INNER JOIN하면 파이프라인이
  // 아직 채점하지 않은 회사가 통째로 404가 된다. industry.ts/map.ts에서 이미
  // 한 번씩 걸렸던 문제와 같은 모양이다.
  const head = raw
    .prepare(
      `SELECT c.cik, c.ticker, c.name, c.sic, c.sic_description AS sicDescription,
              c.exchange, ci.industry_slug AS industrySlug, ci.source AS classificationSource,
              i.name AS industryName, t.name AS themeName,
              s.tenbagger, s.completeness, s.category, s.as_of AS asOf,
              s.engine_version AS engineVersion
       FROM companies c
       JOIN company_industry ci ON ci.cik = c.cik
       JOIN industries i ON i.slug = ci.industry_slug
       JOIN themes t ON t.slug = i.theme_slug
       LEFT JOIN latest_scores s ON s.cik = c.cik
       WHERE UPPER(c.ticker) = UPPER(?)`,
    )
    .get(ticker) as HeadRow | undefined
  if (!head) return null

  const market = raw
    .prepare(
      `SELECT date, price, market_cap AS marketCap FROM market_data
       WHERE cik = ? ORDER BY date DESC LIMIT 1`,
    )
    .get(head.cik) as { date: string; price: number | null; marketCap: number | null } | undefined

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

  return {
    cik: head.cik,
    ticker: head.ticker,
    name: head.name,
    sic: head.sic,
    sicDescription: head.sicDescription,
    exchange: head.exchange,
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
  }
}
