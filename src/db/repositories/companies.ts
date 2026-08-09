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
}

export function upsertCompany(raw: Database.Database, c: CompanyRow, now: string): void {
  raw
    .prepare(
      `INSERT INTO companies
         (cik, ticker, name, sic, sic_description, exchange, entity_type,
          fiscal_year_end, filer_category, is_active, first_seen, last_updated)
       VALUES (@cik, @ticker, @name, @sic, @sicDescription, @exchange, @entityType,
               @fiscalYearEnd, @filerCategory, 1, @now, @now)
       ON CONFLICT(cik) DO UPDATE SET
         ticker = excluded.ticker, name = excluded.name, sic = excluded.sic,
         sic_description = excluded.sic_description, exchange = excluded.exchange,
         entity_type = excluded.entity_type, fiscal_year_end = excluded.fiscal_year_end,
         filer_category = excluded.filer_category, is_active = 1,
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
