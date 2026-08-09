import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { getRawDb, runMigrations } from '@/db/client'
import { parseConfig } from '@/config'
import { ingestFundamentals } from '@/pipeline/jobs/ingest-fundamentals'
import { getFinancialsFor, selectStaleCiks } from '@/db/repositories/financials'
import type { BulkFundamentalProvider, CompanyFactsProvider, RawFact } from '@/providers/types'

const cfg = parseConfig(readFileSync('config.yaml', 'utf8'))

function f(tag: string, qtrs: number, periodEnd: string, value: number): RawFact {
  return {
    cik: 1045810, tag, unit: 'USD', periodStart: null, periodEnd, qtrs, value,
    form: qtrs === 4 ? '10-K' : '10-Q', filedDate: '2025-06-01',
    accession: `a-${periodEnd}-${qtrs}`, source: 'bulk',
  }
}

const BULK_FACTS = [
  f('Revenues', 1, '2024-06-30', 100),
  f('Revenues', 1, '2024-09-30', 110),
  f('Revenues', 1, '2024-12-31', 130),
  f('Revenues', 1, '2025-03-31', 160),
  { ...f('StockholdersEquity', 0, '2025-03-31', 5000) },
  { ...f('EntityCommonStockSharesOutstanding', 0, '2025-03-31', 24000), unit: 'shares' },
]

const bulk: BulkFundamentalProvider = {
  fetchQuarter: async (_y, q) => (q === 2 ? BULK_FACTS : []),
}

let apiCalls: number[] = []
const companyFacts: CompanyFactsProvider = {
  fetchCompany: async (cik) => { apiCalls.push(cik); return [] },
}

let raw: Database.Database
let stats: Record<string, unknown>

beforeAll(async () => {
  raw = getRawDb(join(mkdtempSync(join(tmpdir(), 'tb-fund-')), 'f.db'))
  runMigrations(raw)
  raw.prepare(
    `INSERT INTO companies (cik, ticker, name, is_active, first_seen, last_updated)
     VALUES (1045810, 'NVDA', 'NVIDIA CORP', 1, '2026-08-09', '2026-08-09')`,
  ).run()
  raw.prepare(
    `INSERT INTO company_industry (cik, industry_slug, theme_slug, is_primary, source)
     VALUES (1045810, 'ai-infrastructure', 'ai-software-semi', 1, 'override')`,
  ).run()
  stats = await ingestFundamentals({ raw, cfg, bulk, companyFacts, asOf: '2026-08-09' })
})

describe('ingestFundamentals', () => {
  it('벌크 사실을 financial_facts에 적재한다', () => {
    const n = raw.prepare('SELECT COUNT(*) c FROM financial_facts').get() as { c: number }
    expect(n.c).toBe(BULK_FACTS.length)
  })

  it('설정된 분기 수만큼 벌크를 조회한다', () => {
    expect(stats.quartersRequested).toBe(cfg.ingest.bulk_quarters)
  })

  it('정규화 결과를 financials에 저장한다', () => {
    const fin = getFinancialsFor(raw, 1045810)
    expect(fin.quarterly).toHaveLength(4)
    expect(fin.ttm).toHaveLength(1)
    expect(fin.ttm[0]!.revenue).toBe(500)
    expect(fin.ttm[0]!.sharesOutstanding).toBe(24000)
  })

  it('source_tags를 JSON으로 보존한다', () => {
    const row = raw
      .prepare(
        "SELECT source_tags FROM financials WHERE cik=1045810 AND period_type='TTM'",
      )
      .get() as { source_tags: string }
    expect(JSON.parse(row.source_tags).revenue).toBe('Revenues')
  })

  it('최신 사실이 있는 기업에는 companyfacts API를 호출하지 않는다', () => {
    // 최신 period_end가 2025-03-31이고 asOf가 2026-08-09이라 120일을 넘으므로 호출된다
    expect(apiCalls).toContain(1045810)
  })

  it('job_runs에 성공 기록을 남긴다', () => {
    const r = raw
      .prepare("SELECT status FROM job_runs WHERE job='fundamentals' ORDER BY id DESC")
      .get() as { status: string }
    expect(r.status).toBe('succeeded')
  })

  it('재실행해도 financials 행이 중복되지 않는다', async () => {
    await ingestFundamentals({ raw, cfg, bulk, companyFacts, asOf: '2026-08-09' })
    const n = raw
      .prepare('SELECT COUNT(*) c FROM financials WHERE cik = 1045810')
      .get() as { c: number }
    expect(n.c).toBe(5) // 분기 4 + TTM 1
  })
})

describe('ingestFundamentals — 불가능한 값 거부를 잡 통계로 노출한다 (결함 3)', () => {
  const REJECT_CIK = 4000000

  function badFact(tag: string, qtrs: number, periodEnd: string, value: number): RawFact {
    return {
      cik: REJECT_CIK, tag, unit: 'USD', periodStart: null, periodEnd, qtrs, value,
      form: qtrs === 4 ? '10-K' : '10-Q', filedDate: '2026-08-01',
      accession: `r-${periodEnd}-${qtrs}`, source: 'bulk',
    }
  }

  const badBulk: BulkFundamentalProvider = {
    fetchQuarter: async (_y, q) => (q === 2 ? [badFact('Revenues', 1, '2025-03-31', -999)] : []),
  }
  const noApiCalls: CompanyFactsProvider = { fetchCompany: async () => [] }

  let rejectRaw: Database.Database
  let rejectStats: Record<string, unknown>

  beforeAll(async () => {
    rejectRaw = getRawDb(join(mkdtempSync(join(tmpdir(), 'tb-fund-reject-')), 'f.db'))
    runMigrations(rejectRaw)
    rejectRaw.prepare(
      `INSERT INTO companies (cik, ticker, name, is_active, first_seen, last_updated)
       VALUES (${REJECT_CIK}, 'BADCO', 'BAD DATA CORP', 1, '2026-08-09', '2026-08-09')`,
    ).run()
    rejectRaw.prepare(
      `INSERT INTO company_industry (cik, industry_slug, theme_slug, is_primary, source)
       VALUES (${REJECT_CIK}, 'ai-infrastructure', 'ai-software-semi', 1, 'override')`,
    ).run()
    rejectStats = await ingestFundamentals({
      raw: rejectRaw, cfg, bulk: badBulk, companyFacts: noApiCalls, asOf: '2026-08-09',
    })
  })

  it('거부된 필드 개수가 통계에 나타난다', () => {
    expect(rejectStats.validationRejected).toBe(1)
  })

  it('거부 표본에 회사/기간/필드/사유가 담긴다', () => {
    expect(rejectStats.validationRejectedSample).toEqual([
      `${REJECT_CIK}:Q:2025-03-31:revenue:revenue_negative`,
    ])
  })

  it('거부된 값은 financials에 null로 저장된다 — -999가 아니다', () => {
    const fin = getFinancialsFor(rejectRaw, REJECT_CIK)
    expect(fin.quarterly[0]!.revenue).toBeNull()
  })
})

describe('selectStaleCiks', () => {
  it('최신 사실이 기준일보다 오래되면 지연으로 판정한다', () => {
    expect(selectStaleCiks(raw, '2026-08-09', 120)).toContain(1045810)
  })

  it('충분히 최신이면 제외한다', () => {
    expect(selectStaleCiks(raw, '2025-04-15', 120)).not.toContain(1045810)
  })

  describe('period_end 대신 filed_date로 판정한다 (결함 1 회귀)', () => {
    // 실측 패턴(예: OTTR CIK 1466593)을 재현: bulk가 채운 period_end는
    // asOf 근처로 "최신"처럼 보이지만, 실제 마지막 신고(filed_date)는 몇 달
    // 전이다. period_end 기준이면 이 회사는 절대 stale로 잡히지 않는다 —
    // 이것이 결함 1이다. filed_date 기준이면 정확히 잡혀야 한다.
    const OLD_FILER_CIK = 3000000

    beforeAll(() => {
      raw.prepare(
        `INSERT INTO companies (cik, ticker, name, is_active, first_seen, last_updated)
         VALUES (${OLD_FILER_CIK}, 'OLDF', 'OLD FILER CORP', 1, '2026-08-09', '2026-08-09')`,
      ).run()
      raw.prepare(
        `INSERT INTO company_industry (cik, industry_slug, theme_slug, is_primary, source)
         VALUES (${OLD_FILER_CIK}, 'ai-infrastructure', 'ai-software-semi', 1, 'override')`,
      ).run()
      raw.prepare(
        `INSERT INTO financial_facts
           (cik, tag, unit, period_start, period_end, qtrs, value, form, filed_date, accession, source)
         VALUES (${OLD_FILER_CIK}, 'Revenues', 'USD', NULL, '2026-06-30', 1, 100, '10-Q',
                 '2026-02-20', 'a-old-filer', 'bulk')`,
      ).run()
    })

    it('period_end(2026-06-30)는 asOf(2026-08-09)와 가깝지만 filed_date(2026-02-20)는 120일 넘게 오래됐다 — stale로 판정한다', () => {
      expect(selectStaleCiks(raw, '2026-08-09', 120)).toContain(OLD_FILER_CIK)
    })
  })

  describe('financial_facts가 전혀 없는 기업 (신규 상장사)', () => {
    const NEW_LISTING_CIK = 2000000

    beforeAll(() => {
      raw.prepare(
        `INSERT INTO companies (cik, ticker, name, is_active, first_seen, last_updated)
         VALUES (${NEW_LISTING_CIK}, 'NEWCO', 'NEW LISTING CORP', 1, '2026-08-09', '2026-08-09')`,
      ).run()
      raw.prepare(
        `INSERT INTO company_industry (cik, industry_slug, theme_slug, is_primary, source)
         VALUES (${NEW_LISTING_CIK}, 'ai-infrastructure', 'ai-software-semi', 1, 'override')`,
      ).run()
    })

    it('LEFT JOIN이 INNER JOIN으로 퇴행하면 실패한다 — 사실이 0건이어도 지연으로 잡혀야 한다', () => {
      // financial_facts에 이 CIK 행이 전혀 없으므로 f.latest IS NULL 분기를 탄다.
      // asOf를 오늘로 줘도(cutoff와 무관하게) 항상 포함되어야 한다.
      expect(selectStaleCiks(raw, '2026-08-09', 120)).toContain(NEW_LISTING_CIK)
    })
  })
})
