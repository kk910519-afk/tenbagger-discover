import type Database from 'better-sqlite3'
import { median } from '@/domain/stats'
import { loadCompanies, qualifyingCandidates, type CompanyRow } from './companies'

export type OpportunityMark = {
  slug: string
  name: string
  themeSlug: string
  themeName: string
  /** 완전성 기준을 통과하고 LEADER가 아닌, 이 산업의 후보 수 */
  candidateCount: number
  /** x축 — 후보들의 매출성장(revenue_growth 팩터 raw) 중앙값 */
  medianRevenueGrowth: number | null
  /** y축 — 후보들의 Tenbagger 점수 중앙값 */
  medianTenbagger: number | null
  /** 마크 크기 — 후보들의 시가총액 중앙값. 후보 전원의 시총이 결측이면 null —
   *  이 경우 컴포넌트가 "크기를 매길 수 없음"을 점선 마커로 표시한다(0이나 최솟값으로
   *  대체하지 않는다). */
  medianMarketCap: number | null
}

/**
 * Opportunity Map(홈 화면 산점도)의 마크 데이터.
 *
 * 1,200개 회사를 전부 점으로 찍으면 읽을 수 없다(브리프) — 회사 대신 "산업"을 마크로
 * 쓴다: 산업은 이미 이 앱의 1급 개념이고(산업 상세 페이지가 있다), 회사 단위 top-N과
 * 달리 6개 테마 전체의 분포를 자연스럽게 드러낸다(회사 top-N은 실제 데이터에서 상위
 * 점수가 2~3개 테마에 쏠려 나머지 테마가 아예 안 보인다 — report 참고).
 *
 * 게이트는 다른 화면과 동일하게 ./companies를 공유한다: 완전성 기준 미달 회사와
 * LEADER는 산업의 중앙값 계산에 들어가지 않는다(=마크 좌표에 기여하지 않는다). 후보가
 * 0명인 산업은 마크 자체가 없다(median of empty = null이 되어 정렬에서 자연히 밀려나고,
 * candidateCount 0인 산업은 top N 선정 기준상 뽑히지도 않는다).
 *
 * @param minCompleteness cfg.scoring.min_completeness
 * @param limit 반환할 최대 마크 수 (기본 10 — 목업 수준)
 */
export function getOpportunityScatter(
  raw: Database.Database,
  minCompleteness: number,
  limit = 10,
): OpportunityMark[] {
  const industries = raw
    .prepare(
      `SELECT i.slug, i.name, i.theme_slug AS themeSlug, t.name AS themeName
       FROM industries i JOIN themes t ON t.slug = i.theme_slug`,
    )
    .all() as { slug: string; name: string; themeSlug: string; themeName: string }[]

  const byIndustry = new Map<string, CompanyRow[]>()
  for (const c of loadCompanies(raw)) {
    const list = byIndustry.get(c.industrySlug)
    if (list) list.push(c)
    else byIndustry.set(c.industrySlug, [c])
  }

  const nums = (candidates: CompanyRow[], pick: (c: CompanyRow) => number | null) =>
    candidates.map(pick).filter((v): v is number => v !== null && Number.isFinite(v))

  const marks: OpportunityMark[] = []
  for (const ind of industries) {
    const members = byIndustry.get(ind.slug)
    if (!members || members.length === 0) continue
    const candidates = qualifyingCandidates(members, minCompleteness)
    if (candidates.length === 0) continue

    marks.push({
      slug: ind.slug,
      name: ind.name,
      themeSlug: ind.themeSlug,
      themeName: ind.themeName,
      candidateCount: candidates.length,
      medianRevenueGrowth: median(nums(candidates, (c) => c.revenueGrowth)),
      medianTenbagger: median(nums(candidates, (c) => c.tenbagger)),
      medianMarketCap: median(nums(candidates, (c) => c.marketCap)),
    })
  }

  // candidateCount로 내림차순 정렬하되, 동점이면 slug로 타이브레이크한다 — SQLite가
  // ORDER BY 없는 SELECT의 행 순서를 보장하지 않으므로, 타이브레이크가 없으면 동점
  // 산업들 사이의 top-N 컷이 실행마다 달라질 수 있다.
  return marks
    .sort((a, b) => b.candidateCount - a.candidateCount || a.slug.localeCompare(b.slug))
    .slice(0, limit)
}
