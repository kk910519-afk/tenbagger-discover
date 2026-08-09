import type Database from 'better-sqlite3'
import { median } from '@/domain/stats'
import { loadCompanies, qualifyingCandidates, sufficient, type CompanyRow } from './companies'

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

/**
 * @param minCompleteness cfg.scoring.min_completeness. completeness가 이 값 미만인 회사는
 *   topCandidate 선정과 avgTenbagger 평균에서 제외한다 (설계 문서 §8.1) — 그렇지 않으면
 *   소수 팩터만으로 채점된 회사가 산업의 헤드라인 지표를 왜곡한다.
 */
export function getOpportunityMap(raw: Database.Database, minCompleteness: number): ThemeBlock[] {
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

    // completeness가 null인 행(스코어링 미실행)은 배제 대상이 아니다 — tenbagger 자체가
    // null이라 아래 필터에서 자연히 걸러진다. 기준 미달(completeness < minCompleteness)인
    // 행만 명시적으로 뺀다. 게이트 정의는 ./companies에서 공유한다.
    const scores = members
      .filter((c) => sufficient(c, minCompleteness))
      .map((c) => c.tenbagger)
      .filter((v): v is number => v !== null && Number.isFinite(v))
    // Leader는 Industry Benchmark이지 Tenbagger 후보가 아니다 — "후보"의 정의도
    // ./companies에서 공유한다.
    const candidates = qualifyingCandidates(members, minCompleteness)

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
