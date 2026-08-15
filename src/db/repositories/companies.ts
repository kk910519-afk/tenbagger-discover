import type Database from 'better-sqlite3'
import type { Listing } from '@/providers/types'

export type CompanyRow = {
  cik: number
  ticker: string
  name: string
  sic: string | null
  sicDescription: string | null
  exchange: string | null
  entityType: string | null
  fiscalYearEnd: string | null
  filerCategory: string | null
  stateOfIncorporation: string | null
  stateOfIncorporationDescription: string | null
}

export function upsertCompany(raw: Database.Database, c: CompanyRow, now: string): void {
  raw
    .prepare(
      `INSERT INTO companies
         (cik, ticker, name, sic, sic_description, exchange, entity_type,
          fiscal_year_end, filer_category, state_of_incorporation,
          state_of_incorporation_description, is_active, first_seen, last_updated)
       VALUES (@cik, @ticker, @name, @sic, @sicDescription, @exchange, @entityType,
               @fiscalYearEnd, @filerCategory, @stateOfIncorporation,
               @stateOfIncorporationDescription, 1, @now, @now)
       ON CONFLICT(cik) DO UPDATE SET
         ticker = excluded.ticker, name = excluded.name, sic = excluded.sic,
         sic_description = excluded.sic_description, exchange = excluded.exchange,
         entity_type = excluded.entity_type, fiscal_year_end = excluded.fiscal_year_end,
         filer_category = excluded.filer_category,
         state_of_incorporation = excluded.state_of_incorporation,
         state_of_incorporation_description = excluded.state_of_incorporation_description,
         is_active = 1,
         last_updated = excluded.last_updated`,
    )
    .run({ ...c, now })
}

export function upsertListing(raw: Database.Database, l: Listing, now: string): void {
  raw
    .prepare(
      `INSERT INTO listings
         (ticker, exchange, security_name, is_etf, is_test_issue,
          financial_status, round_lot, last_updated)
       VALUES (@ticker, @exchange, @securityName, @isEtf, @isTestIssue,
               @financialStatus, @roundLot, @now)
       ON CONFLICT(ticker) DO UPDATE SET
         exchange = excluded.exchange, security_name = excluded.security_name,
         is_etf = excluded.is_etf, is_test_issue = excluded.is_test_issue,
         financial_status = excluded.financial_status, round_lot = excluded.round_lot,
         last_updated = excluded.last_updated`,
    )
    .run({
      ...l,
      isEtf: l.isEtf ? 1 : 0,
      isTestIssue: l.isTestIssue ? 1 : 0,
      now,
    })
}

export function setCompanyIndustry(
  raw: Database.Database,
  cik: number,
  industrySlug: string,
  themeSlug: string,
  source: 'sic' | 'override',
): void {
  raw.prepare('DELETE FROM company_industry WHERE cik = ?').run(cik)
  raw
    .prepare(
      `INSERT INTO company_industry (cik, industry_slug, theme_slug, is_primary, source)
       VALUES (?, ?, ?, 1, ?)`,
    )
    .run(cik, industrySlug, themeSlug, source)
}

/**
 * 유니버스에서 회사를 내린다 — 분류를 지우고 비활성으로 표시한다.
 *
 * taxonomy가 바뀌어 더 이상 분류되지 않는 회사는 `setCompanyIndustry`가 호출되지
 * 않으므로 예전 industry_slug를 그대로 달고 남는다. 그러면 매핑을 고쳐도 그 회사는
 * 계속 산업 중앙값에 들어간다 — 즉 taxonomy 수정이 DB에 반영되지 않는다.
 *
 * 이미 비활성이거나 애초에 없던 CIK면 null을 반환한다(리포팅용으로 티커를 돌려준다).
 */
export function retireCompany(
  raw: Database.Database,
  cik: number,
  now: string,
): string | null {
  const row = raw
    .prepare('SELECT ticker FROM companies WHERE cik = ? AND is_active = 1')
    .get(cik) as { ticker: string } | undefined
  if (!row) return null
  raw.prepare('DELETE FROM company_industry WHERE cik = ?').run(cik)
  raw.prepare('UPDATE companies SET is_active = 0, last_updated = ? WHERE cik = ?').run(now, cik)
  return row.ticker
}

export function listUniverseCiks(raw: Database.Database): number[] {
  const rows = raw
    .prepare(
      `SELECT c.cik FROM companies c
       JOIN company_industry ci ON ci.cik = c.cik
       WHERE c.is_active = 1 ORDER BY c.cik`,
    )
    .all() as { cik: number }[]
  return rows.map((r) => r.cik)
}
