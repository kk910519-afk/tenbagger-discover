import type Database from 'better-sqlite3'
import type { FinancialPeriod } from '@/domain/types'
import type { RawFact } from '@/providers/types'
import type { NormalizeResult } from '@/providers/fundamental/normalizer'

export function insertFacts(raw: Database.Database, facts: RawFact[]): number {
  const stmt = raw.prepare(
    `INSERT INTO financial_facts
       (cik, tag, unit, period_start, period_end, qtrs, value, form, filed_date, accession, source)
     VALUES (@cik, @tag, @unit, @periodStart, @periodEnd, @qtrs, @value, @form, @filedDate, @accession, @source)
     ON CONFLICT(cik, tag, period_end, qtrs, form) DO UPDATE SET
       value = excluded.value,
       filed_date = excluded.filed_date,
       accession = excluded.accession,
       unit = excluded.unit,
       period_start = excluded.period_start,
       source = excluded.source
     WHERE excluded.filed_date > financial_facts.filed_date`,
  )
  let n = 0
  raw.transaction(() => {
    for (const f of facts) n += stmt.run(f).changes
  })()
  return n
}

export function getFacts(raw: Database.Database, cik: number): RawFact[] {
  return raw
    .prepare(
      `SELECT cik, tag, unit, period_start AS periodStart, period_end AS periodEnd,
              qtrs, value, form, filed_date AS filedDate, accession, source
       FROM financial_facts WHERE cik = ?`,
    )
    .all(cik) as RawFact[]
}

const FIN_COLUMNS = `cik, period_end, period_type, revenue, gross_profit, operating_income,
  net_income, ocf, capex, fcf, cash, total_debt, equity, shares_diluted,
  shares_outstanding, sbc, rd_expense, source_tags, computed_at`

export function replaceFinancials(
  raw: Database.Database,
  cik: number,
  r: NormalizeResult,
): void {
  const now = new Date().toISOString()
  const stmt = raw.prepare(
    `INSERT OR REPLACE INTO financials (${FIN_COLUMNS})
     VALUES (@cik, @periodEnd, @periodType, @revenue, @grossProfit, @operatingIncome,
             @netIncome, @ocf, @capex, @fcf, @cash, @totalDebt, @equity, @sharesDiluted,
             @sharesOutstanding, @sbc, @rdExpense, @sourceTags, @computedAt)`,
  )
  raw.transaction(() => {
    raw.prepare('DELETE FROM financials WHERE cik = ?').run(cik)
    for (const p of [...r.quarterly, ...r.annual, ...r.ttm]) {
      stmt.run({
        ...p,
        cik,
        sourceTags: JSON.stringify(r.sourceTags[`${p.periodType}:${p.periodEnd}`] ?? {}),
        computedAt: now,
      })
    }
  })()
}

export function getFinancialsFor(
  raw: Database.Database,
  cik: number,
): { quarterly: FinancialPeriod[]; annual: FinancialPeriod[]; ttm: FinancialPeriod[] } {
  const rows = raw
    .prepare(
      `SELECT period_end AS periodEnd, period_type AS periodType, revenue,
              gross_profit AS grossProfit, operating_income AS operatingIncome,
              net_income AS netIncome, ocf, capex, fcf, cash,
              total_debt AS totalDebt, equity, shares_diluted AS sharesDiluted,
              shares_outstanding AS sharesOutstanding, sbc, rd_expense AS rdExpense
       FROM financials WHERE cik = ? ORDER BY period_end DESC`,
    )
    .all(cik) as FinancialPeriod[]

  return {
    quarterly: rows.filter((r) => r.periodType === 'Q'),
    annual: rows.filter((r) => r.periodType === 'A'),
    ttm: rows.filter((r) => r.periodType === 'TTM'),
  }
}

// 왜 period_end가 아니라 filed_date인가: period_end는 회계기간 "종료일"일 뿐,
// 그 값이 실제로 언제 신고됐는지와 무관하다 — 회계 마감부터 신고서 제출까지
// 통상 1~4개월이 걸리므로(fiscal lag), 오늘 날짜와 period_end를 직접 비교하는
// 것 자체가 잘못된 검사다. 게다가 SEC bulk는 회사가 실제로 신고를 멈춘 뒤에도
// (혹은 디멘션 오염된 값이라도) period_end만은 계속 최신처럼 채워 넣는 경우가
// 있어 — Alphabet 실사례: OperatingIncomeLoss가 매 분기 최신 period_end로
// 들어오지만 값 자체가 틀렸는데도 "최근 period_end가 있다"는 이유만으로
// 이 회사가 한 번도 stale로 판정된 적이 없어 API 재확인이 전혀 일어나지
// 않았다(ingest-hardening 과제 결함 1). filed_date는 신고자가 실제로 SEC에
// 제출한 날짜이므로 "이 회사 데이터가 실제로 언제 갱신됐는가"를 정직하게
// 측정한다.
export function selectStaleCiks(
  raw: Database.Database,
  asOf: string,
  days: number,
): number[] {
  const cutoff = new Date(Date.parse(asOf) - days * 86_400_000)
    .toISOString()
    .slice(0, 10)
  const rows = raw
    .prepare(
      `SELECT c.cik FROM companies c
       JOIN company_industry ci ON ci.cik = c.cik
       LEFT JOIN (SELECT cik, MAX(filed_date) AS latest FROM financial_facts GROUP BY cik) f
         ON f.cik = c.cik
       WHERE f.latest IS NULL OR f.latest < ?
       ORDER BY c.cik`,
    )
    .all(cutoff) as { cik: number }[]
  return rows.map((r) => r.cik)
}
