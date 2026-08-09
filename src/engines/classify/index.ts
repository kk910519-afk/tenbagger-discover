import type { AppConfig } from '@/config'
import type { Category, CompanySnapshot } from '@/domain/types'

function nonLeaderCategory(s: CompanySnapshot, cfg: AppConfig): Category {
  const c = cfg.classification
  const mc = s.marketCap
  // 규모를 알 수 없는 기업을 Challenger로 올리지 않는다
  if (mc === null) return 'EMERGING'
  if (mc < c.challenger_min_market_cap) return 'EMERGING'

  if (mc < c.emerging_max_market_cap) {
    const ttm = s.ttm[0]
    const unprofitable = ttm?.operatingIncome !== undefined && ttm?.operatingIncome !== null
      ? ttm.operatingIncome <= 0
      : true   // 손익을 모르면 성숙하다고 볼 수 없다
    const small = ttm?.revenue === null || ttm?.revenue === undefined
      ? true
      : ttm.revenue < c.emerging_revenue_threshold
    return unprofitable || small ? 'EMERGING' : 'CHALLENGER'
  }
  return 'CHALLENGER'
}

export function classifyIndustry(
  members: CompanySnapshot[],
  cfg: AppConfig,
): Map<number, Category> {
  const c = cfg.classification
  const out = new Map<number, Category>()

  const ranked = [...members].sort(
    (a, b) => (b.marketCap ?? -1) - (a.marketCap ?? -1),
  )

  const leaders = new Set<number>()
  // 후보가 적은 산업에서 "상위 2개"는 정보가 아니다
  if (ranked.length >= c.leader_min_industry_candidates) {
    const maxCap = ranked[0]?.marketCap ?? null
    if (maxCap !== null && maxCap > 0) {
      const threshold = maxCap * c.leader_ratio_of_max
      for (let i = 0; i < ranked.length && leaders.size < c.leader_max; i++) {
        const s = ranked[i]!
        const qualifies = s.marketCap !== null && s.marketCap >= threshold
        if (qualifies || i < c.leader_min) leaders.add(s.cik)
        else break
      }
    }
  }

  for (const s of members) {
    out.set(s.cik, leaders.has(s.cik) ? 'LEADER' : nonLeaderCategory(s, cfg))
  }
  return out
}

export function classifyAll(
  snapshots: CompanySnapshot[],
  cfg: AppConfig,
): Map<number, Category> {
  const byIndustry = new Map<string, CompanySnapshot[]>()
  for (const s of snapshots) {
    const list = byIndustry.get(s.industrySlug)
    if (list) list.push(s)
    else byIndustry.set(s.industrySlug, [s])
  }

  const out = new Map<number, Category>()
  for (const members of byIndustry.values()) {
    for (const [cik, category] of classifyIndustry(members, cfg)) out.set(cik, category)
  }
  return out
}
