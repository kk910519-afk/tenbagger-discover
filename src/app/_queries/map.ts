import type Database from 'better-sqlite3'
import { median } from '@/domain/stats'

export type IndustryRow = {
  slug: string
  name: string
  themeSlug: string
  candidateCount: number
  medianRevenueGrowth: number | null
  medianMarketCap: number | null
  avgTenbagger: number | null
  topCandidate: { ticker: string; tenbagger: number } | null
  momentum: number | null
  riskRatio: number
}

export type ThemeBlock = {
  slug: string
  name: string
  displayOrder: number
  industries: IndustryRow[]
}

type CompanyRow = {
  cik: number
  ticker: string
  industrySlug: string
  tenbagger: number | null
  category: string | null
  marketCap: number | null
  revenueGrowth: number | null
  acceleration: number | null
  criticalCount: number
}

/**
 * 산업별 집계는 SQL 한 방보다 회사 단위로 뽑아 JS에서 접는 편이 읽기 쉽고
 * median 구현을 domain/stats와 공유할 수 있다. 유니버스가 수천 건 규모라 성능도 문제없다.
 */
function loadCompanies(raw: Database.Database): CompanyRow[] {
  return raw
    .prepare(
      `SELECT c.cik, c.ticker, ci.industry_slug AS industrySlug,
              s.tenbagger, s.category,
              (SELECT m.market_cap FROM market_data m
                WHERE m.cik = c.cik ORDER BY m.date DESC LIMIT 1) AS marketCap,
              (SELECT f.raw FROM score_factors f
                WHERE f.cik = c.cik AND f.as_of = s.as_of
                  AND f.factor_key = 'revenue_growth') AS revenueGrowth,
              (SELECT f.raw FROM score_factors f
                WHERE f.cik = c.cik AND f.as_of = s.as_of
                  AND f.factor_key = 'revenue_acceleration') AS acceleration,
              (SELECT COUNT(*) FROM red_flags r
                WHERE r.cik = c.cik AND r.as_of = s.as_of
                  AND r.severity = 'CRITICAL') AS criticalCount
       FROM companies c
       JOIN company_industry ci ON ci.cik = c.cik
       JOIN latest_scores s ON s.cik = c.cik
       WHERE c.is_active = 1`,
    )
    .all() as CompanyRow[]
}

export function getOpportunityMap(raw: Database.Database): ThemeBlock[] {
  const themes = raw
    .prepare('SELECT slug, name, display_order AS displayOrder FROM themes ORDER BY display_order')
    .all() as { slug: string; name: string; displayOrder: number }[]

  const industries = raw
    .prepare('SELECT slug, theme_slug AS themeSlug, name FROM industries')
    .all() as { slug: string; themeSlug: string; name: string }[]

  const byIndustry = new Map<string, CompanyRow[]>()
  for (const c of loadCompanies(raw)) {
    const list = byIndustry.get(c.industrySlug)
    if (list) list.push(c)
    else byIndustry.set(c.industrySlug, [c])
  }

  const rows: IndustryRow[] = []
  for (const ind of industries) {
    const members = byIndustry.get(ind.slug)
    if (!members || members.length === 0) continue

    const nums = (pick: (c: CompanyRow) => number | null) =>
      members.map(pick).filter((v): v is number => v !== null && Number.isFinite(v))

    const scores = nums((c) => c.tenbagger)
    // Leader는 Industry Benchmark이지 Tenbagger 후보가 아니다
    const candidates = members
      .filter((c) => c.category !== 'LEADER' && c.tenbagger !== null)
      .sort((a, b) => b.tenbagger! - a.tenbagger!)

    rows.push({
      slug: ind.slug,
      name: ind.name,
      themeSlug: ind.themeSlug,
      candidateCount: members.length,
      medianRevenueGrowth: median(nums((c) => c.revenueGrowth)),
      medianMarketCap: median(nums((c) => c.marketCap)),
      avgTenbagger: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null,
      topCandidate: candidates[0]
        ? { ticker: candidates[0].ticker, tenbagger: candidates[0].tenbagger! }
        : null,
      momentum: median(nums((c) => c.acceleration)),
      riskRatio: members.filter((c) => c.criticalCount > 0).length / members.length,
    })
  }

  return themes.map((t) => ({
    ...t,
    industries: rows
      .filter((r) => r.themeSlug === t.slug)
      .sort((a, b) => (b.avgTenbagger ?? -1) - (a.avgTenbagger ?? -1)),
  }))
}
