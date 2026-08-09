import type Database from 'better-sqlite3'

export type CompanyRow = {
  cik: number
  ticker: string
  name: string
  industrySlug: string
  themeSlug: string
  tenbagger: number | null
  completeness: number | null
  category: string | null
  marketCap: number | null
  revenueGrowth: number | null
  acceleration: number | null
  criticalCount: number
}

/**
 * 회사 단위 원자료 로더 — map.ts(산업 지도)와 theme-momentum.ts(테마 모멘텀 스트립),
 * opportunity-scatter.ts(산업 산점도)가 모두 이 함수 하나를 공유한다. 완전성 게이트
 * (sufficient)와 "후보" 정의(qualifyingCandidates)도 여기 한 곳에만 있다 — 화면마다
 * 따로 구현하면 "완전성 기준 미달 회사 제외"라는 같은 규칙이 서서히 어긋날 수 있다.
 *
 * company_industry는 (cik, industry_slug)가 PK라 회사 하나가 여러 산업에 속하면
 * 행이 여러 개 나올 수 있다(map.ts의 기존 동작을 그대로 유지 — is_primary로 거르지
 * 않는다).
 */
export function loadCompanies(raw: Database.Database): CompanyRow[] {
  return raw
    .prepare(
      `SELECT c.cik, c.ticker, c.name,
              ci.industry_slug AS industrySlug, ci.theme_slug AS themeSlug,
              s.tenbagger, s.completeness, s.category,
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
       LEFT JOIN latest_scores s ON s.cik = c.cik
       WHERE c.is_active = 1`,
    )
    .all() as CompanyRow[]
}

/**
 * completeness가 minCompleteness 미만인 회사는 랭킹/집계에서 제외한다. completeness가
 * null인 행(스코어링 미실행)은 예외다 — tenbagger 자체가 null이라 이 값을 쓰는 필터에서
 * 자연히 걸러진다.
 */
export function sufficient(c: { completeness: number | null }, minCompleteness: number): boolean {
  return c.completeness === null || c.completeness >= minCompleteness
}

/**
 * "후보"의 단일 정의: LEADER가 아니고, 점수가 있고(tenbagger !== null), 완전성 기준을
 * 통과한 행. tenbagger 내림차순으로 정렬해 반환한다 — 그대로 top picks로 쓸 수 있다.
 * Leader는 산업 벤치마크이지 Tenbagger 후보가 아니다.
 */
export function qualifyingCandidates<T extends CompanyRow>(members: T[], minCompleteness: number): T[] {
  return members
    .filter((c) => c.category !== 'LEADER' && c.tenbagger !== null && sufficient(c, minCompleteness))
    .sort((a, b) => b.tenbagger! - a.tenbagger!)
}
