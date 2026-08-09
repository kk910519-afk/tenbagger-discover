import type Database from 'better-sqlite3'
import { median } from '@/domain/stats'
import { loadCompanies, qualifyingCandidates, type CompanyRow } from './companies'

export type ThemeMomentum = {
  slug: string
  name: string
  displayOrder: number
  /** 완전성 기준을 통과하고 LEADER가 아닌 회사 수 (= qualifyingCandidates 길이) */
  candidateCount: number
  /** 위 후보들의 매출성장(revenue_growth 팩터 raw) 중앙값 */
  medianRevenueGrowth: number | null
  /** 위 후보들의 매출가속(revenue_acceleration 팩터 raw) 중앙값 — Phase 1의 모멘텀 대체
   *  지표. 가격 히스토리가 없어(파이프라인이 시세 스냅샷 1개만 저장) 3개월 상대 성과나
   *  스파크라인은 만들 수 없다. */
  medianRevenueAcceleration: number | null
  topCandidate: { ticker: string; name: string; tenbagger: number } | null
}

/**
 * 테마 모멘텀 스트립 — 홈 화면 상단에 테마 6개를 한 줄로 보여주는 카드용 집계.
 *
 * 게이트는 map.ts(산업 지도)·top-candidates.ts(Top 5)와 완전히 동일한 정의를 쓴다
 * (./companies의 sufficient + qualifyingCandidates 공유) — 화면마다 "적격 후보"를
 * 다른 기준으로 세면 숫자가 어긋난다. 네 숫자(후보 수·매출성장 중앙값·매출가속 중앙값·
 * 최고 점수 후보)는 전부 같은 qualifyingCandidates 집합에서 나온다 — 후보가 0명이면
 * 넷 다 동시에 "없음"이 된다.
 *
 * @param minCompleteness cfg.scoring.min_completeness
 */
export function getThemeMomentum(raw: Database.Database, minCompleteness: number): ThemeMomentum[] {
  const themes = raw
    .prepare('SELECT slug, name, display_order AS displayOrder FROM themes ORDER BY display_order')
    .all() as { slug: string; name: string; displayOrder: number }[]

  const byTheme = new Map<string, CompanyRow[]>()
  for (const c of loadCompanies(raw)) {
    const list = byTheme.get(c.themeSlug)
    if (list) list.push(c)
    else byTheme.set(c.themeSlug, [c])
  }

  const nums = (candidates: CompanyRow[], pick: (c: CompanyRow) => number | null) =>
    candidates.map(pick).filter((v): v is number => v !== null && Number.isFinite(v))

  return themes.map((t) => {
    const members = byTheme.get(t.slug) ?? []
    const candidates = qualifyingCandidates(members, minCompleteness)

    return {
      ...t,
      candidateCount: candidates.length,
      medianRevenueGrowth: median(nums(candidates, (c) => c.revenueGrowth)),
      medianRevenueAcceleration: median(nums(candidates, (c) => c.acceleration)),
      topCandidate: candidates[0]
        ? { ticker: candidates[0].ticker, name: candidates[0].name, tenbagger: candidates[0].tenbagger! }
        : null,
    }
  })
}
