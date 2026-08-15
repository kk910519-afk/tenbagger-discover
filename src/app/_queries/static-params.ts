import type Database from 'better-sqlite3'

/**
 * 정적 내보내기가 미리 만들어야 할 페이지의 목록.
 *
 * 대상은 **분류된 모든 회사**다 — 데이터 완전성 게이트(`scoring.min_completeness`)를
 * 통과한 회사만이 아니다. 산업 표는 INSUFFICIENT 그룹과 미평가 그룹까지 전부 링크를
 * 걸고, 404가 나는 링크는 "이 회사는 데이터가 부족하다"고 말해 주는 페이지보다 나쁘다.
 * 정적 사이트에서는 목록에 없는 경로가 곧 404이므로, 이 두 함수가 링크의 도달 가능성을
 * 결정한다.
 *
 * 조인은 `getIndustryView`/`getStockDetail`의 조인과 **글자 그대로 같아야 한다**.
 * 여기서 더 넓게 뽑으면 페이지를 만들다 `notFound()`가 나 빌드가 깨지고, 더 좁게 뽑으면
 * 표에는 있는데 열리지 않는 링크가 생긴다.
 */

/**
 * 마이그레이션 전 DB(빈 파일)인지 확인한다.
 *
 * `getRawDb()`는 파일이 없으면 만들어 주므로, 파이프라인을 한 번도 돌리지 않은 사람이
 * `npm run build`를 실행하면 테이블이 하나도 없는 DB를 열게 된다. 여기서 SQL 에러가
 * 그대로 터지면 빌드가 "no such table: industries"로 죽어, 원인이 데이터 부재라는 사실이
 * 드러나지 않는다. 빈 목록을 돌려주면 홈 하나만 생성되고 그 홈이 이미 갖고 있는
 * "npm run db:migrate / pipeline:all을 실행하세요" 안내가 사람을 맞는다.
 *
 * 테이블 존재 여부만 본다 — 존재하는데 쿼리가 실패하는 상황은 진짜 버그이므로 덮지 않는다.
 */
function hasTables(raw: Database.Database, tables: string[]): boolean {
  const found = raw
    .prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${tables.map(() => '?').join(',')})`,
    )
    .all(...tables) as { name: string }[]
  return found.length === tables.length
}

/** 산업 페이지의 slug 전체. themes 조인은 `getIndustryView`의 메타 조회와 같다. */
export function getAllIndustrySlugs(raw: Database.Database): string[] {
  if (!hasTables(raw, ['industries', 'themes'])) return []
  const rows = raw
    .prepare(
      `SELECT i.slug AS slug
       FROM industries i JOIN themes t ON t.slug = i.theme_slug
       ORDER BY i.slug`,
    )
    .all() as { slug: string }[]
  return rows.map((r) => r.slug)
}

/**
 * 종목 페이지의 ticker 전체.
 *
 * `is_active`로 거르지 않는다 — `getStockDetail`도 거르지 않기 때문이다. 회사 하나가
 * 여러 산업에 걸릴 수 있어(company_industry는 (cik, industry_slug) 복합키) DISTINCT로 접는다.
 */
export function getAllStockTickers(raw: Database.Database): string[] {
  if (!hasTables(raw, ['companies', 'company_industry', 'industries', 'themes'])) return []
  const rows = raw
    .prepare(
      `SELECT DISTINCT c.ticker AS ticker
       FROM companies c
       JOIN company_industry ci ON ci.cik = c.cik
       JOIN industries i ON i.slug = ci.industry_slug
       JOIN themes t ON t.slug = i.theme_slug
       ORDER BY c.ticker`,
    )
    .all() as { ticker: string }[]
  return rows.map((r) => r.ticker)
}
