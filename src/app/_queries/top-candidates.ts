import type Database from 'better-sqlite3'
import type { FactorView } from './stock'
import { factorsByFillRatio } from '../_lib/strengths'

export type TopCandidate = {
  cik: number
  ticker: string
  name: string
  industrySlug: string
  industryName: string
  tenbagger: number
  hasCriticalFlag: boolean
  /** 상위 2~3개 팩터의 detail 문자열을 이어붙인, 한 줄 분량으로 자른 근거 문구 */
  rationale: string
}

type Row = {
  cik: number
  ticker: string
  name: string
  industrySlug: string
  industryName: string
  tenbagger: number | null
  completeness: number | null
  category: string | null
  asOf: string | null
  criticalCount: number
}

/** 근거 문구에 반영할 최상위 팩터 수 — "두세 개"(브리프) */
const RATIONALE_FACTOR_COUNT = 3
/** 한 줄을 벗어나지 않도록 자르는 안전판. 실제 줄바꿈 방지는 CSS truncate가 맡는다. */
const RATIONALE_MAX_LEN = 140

function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return `${s.slice(0, max - 1).trimEnd()}…`
}

/**
 * 테마·산업 경계를 무시하고 전체 유니버스에서 점수가 가장 높은 후보를 뽑는다.
 * 홈 화면 헤드라인용 — map.ts의 산업별 topCandidate와 달리 산업 하나에 갇히지 않는다.
 *
 * 적용 규칙은 map.ts(§산업별 지도)의 topCandidate 선정과 동일하게 맞춘다:
 *  - completeness가 minCompleteness 미만인 회사는 제외 (일부 팩터만으로 채점된 회사는
 *    헤드라인 후보가 아니다).
 *  - category가 LEADER인 회사는 제외 (Leader는 산업 벤치마크이지 후보가 아니다).
 *  - CRITICAL Red Flag가 있어도 제외하지 않는다 — 점수와 리스크는 별개 축이라는 제품
 *    원칙(§Risk는 점수와 독립적이다)을 여기서도 지킨다. 대신 hasCriticalFlag로
 *    화면에 정직하게 노출한다.
 *
 * @param minCompleteness cfg.scoring.min_completeness
 * @param limit 반환할 최대 후보 수 (기본 5)
 */
export function getTopCandidates(
  raw: Database.Database,
  minCompleteness: number,
  limit = 5,
): TopCandidate[] {
  const rows = raw
    .prepare(
      `SELECT c.cik, c.ticker, c.name,
              ci.industry_slug AS industrySlug, i.name AS industryName,
              s.tenbagger, s.completeness, s.category, s.as_of AS asOf,
              (SELECT COUNT(*) FROM red_flags r
                WHERE r.cik = c.cik AND r.as_of = s.as_of
                  AND r.severity = 'CRITICAL') AS criticalCount
       FROM companies c
       JOIN company_industry ci ON ci.cik = c.cik
       JOIN industries i ON i.slug = ci.industry_slug
       LEFT JOIN latest_scores s ON s.cik = c.cik
       WHERE c.is_active = 1`,
    )
    .all() as Row[]

  // completeness가 null인 행은 스코어링 자체가 안 된 회사다 — tenbagger도 null이라
  // 아래 필터에서 자연히 걸러진다. 기준 미달(completeness < minCompleteness)인
  // 행만 명시적으로 뺀다 (map.ts와 동일한 패턴).
  const sufficient = (r: Row) => r.completeness === null || r.completeness >= minCompleteness

  const top = rows
    .filter((r) => r.category !== 'LEADER' && r.tenbagger !== null && sufficient(r))
    .sort((a, b) => b.tenbagger! - a.tenbagger!)
    .slice(0, limit)

  const factorStmt = raw.prepare(
    `SELECT factor_key AS key, weight, points, raw, status, percentile, detail
     FROM score_factors WHERE cik = ? AND as_of = ?`,
  )

  return top.map((r) => {
    const factors = factorStmt.all(r.cik, r.asOf) as FactorView[]
    const strongest = factorsByFillRatio(factors).slice(0, RATIONALE_FACTOR_COUNT)
    const rationale = truncate(
      strongest.map((f) => f.detail).join(' · '),
      RATIONALE_MAX_LEN,
    )
    return {
      cik: r.cik,
      ticker: r.ticker,
      name: r.name,
      industrySlug: r.industrySlug,
      industryName: r.industryName,
      tenbagger: r.tenbagger!,
      hasCriticalFlag: r.criticalCount > 0,
      rationale,
    }
  })
}
