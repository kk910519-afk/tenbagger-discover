import type Database from 'better-sqlite3'
import type { Category } from '@/domain/types'

export type CandidateRow = {
  cik: number
  ticker: string
  name: string
  category: Category | null
  marketCap: number | null
  revenueGrowth: number | null
  grossMargin: number | null
  fcfMargin: number | null
  totalDebt: number | null
  tenbagger: number | null
  /** scores 행이 없으면(스코어링 미실행) completeness 자체가 없다 */
  completeness: number | null
  criticalCount: number
  warningCount: number
}

/**
 * category별 그룹. Leader/Challenger/Emerging은 항상 고정 순서로 나온다.
 * category가 null인 행(=아직 스코어링되지 않은 회사)은 별도 그룹으로 묶이며,
 * 그런 회사가 하나도 없으면 이 그룹 자체가 생략된다.
 */
export type CandidateGroup = { category: Category | null; rows: CandidateRow[] }

export type IndustryView = {
  slug: string
  name: string
  themeSlug: string
  themeName: string
  groups: CandidateGroup[]
} | null

const GROUP_ORDER: Category[] = ['LEADER', 'CHALLENGER', 'EMERGING']

export function getIndustryView(raw: Database.Database, slug: string): IndustryView {
  const meta = raw
    .prepare(
      `SELECT i.slug, i.name, i.theme_slug AS themeSlug, t.name AS themeName
       FROM industries i JOIN themes t ON t.slug = i.theme_slug
       WHERE i.slug = ?`,
    )
    .get(slug) as
    | { slug: string; name: string; themeSlug: string; themeName: string }
    | undefined
  if (!meta) return null

  // company_industry로 이 산업에 속한 모든 회사를 먼저 잡고, 점수/재무/시세는 전부
  // LEFT JOIN한다. scores를 INNER JOIN하면 아직 스코어링 파이프라인이 돌지 않은
  // 회사가 결과에서 통째로 사라진다 — 홈 화면(map.ts)에서 이미 한 번 걸렸던 문제.
  const rows = raw
    .prepare(
      `SELECT c.cik, c.ticker, c.name, s.category, s.tenbagger, s.completeness,
              (SELECT m.market_cap FROM market_data m
                WHERE m.cik = c.cik ORDER BY m.date DESC LIMIT 1) AS marketCap,
              f.revenue, f.gross_profit AS grossProfit, f.fcf, f.total_debt AS totalDebt,
              (SELECT sf.raw FROM score_factors sf
                WHERE sf.cik = c.cik AND sf.as_of = s.as_of
                  AND sf.factor_key = 'revenue_growth') AS revenueGrowth,
              (SELECT COUNT(*) FROM red_flags r
                WHERE r.cik = c.cik AND r.as_of = s.as_of AND r.severity = 'CRITICAL')
                AS criticalCount,
              (SELECT COUNT(*) FROM red_flags r
                WHERE r.cik = c.cik AND r.as_of = s.as_of AND r.severity = 'WARNING')
                AS warningCount
       FROM companies c
       JOIN company_industry ci ON ci.cik = c.cik
       LEFT JOIN latest_scores s ON s.cik = c.cik
       LEFT JOIN financials f
         ON f.cik = c.cik AND f.period_type = 'TTM'
        AND f.period_end = (SELECT MAX(period_end) FROM financials
                             WHERE cik = c.cik AND period_type = 'TTM')
       WHERE ci.industry_slug = ? AND c.is_active = 1`,
    )
    .all(slug) as (Omit<CandidateRow, 'grossMargin' | 'fcfMargin' | 'criticalCount' | 'warningCount'> & {
      revenue: number | null
      grossProfit: number | null
      fcf: number | null
      criticalCount: number
      warningCount: number
    })[]

  const ratio = (n: number | null, d: number | null) =>
    n === null || d === null || d <= 0 ? null : n / d

  const candidates: CandidateRow[] = rows.map((r) => ({
    cik: r.cik, ticker: r.ticker, name: r.name, category: r.category,
    marketCap: r.marketCap, revenueGrowth: r.revenueGrowth,
    grossMargin: ratio(r.grossProfit, r.revenue),
    fcfMargin: ratio(r.fcf, r.revenue),
    totalDebt: r.totalDebt,
    tenbagger: r.tenbagger, completeness: r.completeness,
    criticalCount: r.criticalCount, warningCount: r.warningCount,
  }))

  const groups: CandidateGroup[] = GROUP_ORDER.map((category) => ({
    category,
    rows: candidates
      .filter((c) => c.category === category)
      .sort((a, b) => (b.tenbagger ?? -1) - (a.tenbagger ?? -1)),
  }))

  const unscored = candidates
    .filter((c) => c.category === null)
    .sort((a, b) => (b.marketCap ?? -1) - (a.marketCap ?? -1))
  if (unscored.length > 0) {
    groups.push({ category: null, rows: unscored })
  }

  return { ...meta, groups }
}
