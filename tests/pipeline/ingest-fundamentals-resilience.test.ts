import { describe, it, expect, beforeAll, vi } from 'vitest'
import { readFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { getRawDb, runMigrations } from '@/db/client'
import { parseConfig } from '@/config'
import { ingestFundamentals } from '@/pipeline/jobs/ingest-fundamentals'
import { getFinancialsFor } from '@/db/repositories/financials'
import type { BulkFundamentalProvider, CompanyFactsProvider, RawFact } from '@/providers/types'

const cfg = parseConfig(readFileSync('config.yaml', 'utf8'))

// 이 회사의 사실이 normalizeFacts에 들어가면 던지도록 아래 mock에서 가로챈다.
// WRITE_FAIL_CIK는 normalizeFacts는 성공하지만 replaceFinancials(저장 단계)에서
// 던진다 — Finding 1은 두 호출을 모두 같은 try로 감싸는 것이었으므로, 두
// throw 지점을 각각 별도로 검증해야 회귀를 잡을 수 있다.
// 정상 회사(GOOD_CIK)의 사실은 실제 로직으로 그대로 흘려보낸다.
// vi.mock은 파일 최상단으로 호이스팅되므로 아래 static import보다 먼저 적용된다.
const POISON_CIK = 4000000
const WRITE_FAIL_CIK = 4500000
const GOOD_CIK = 1045810

vi.mock('@/providers/fundamental/normalizer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/providers/fundamental/normalizer')>()
  return {
    ...actual,
    normalizeFacts: (facts: RawFact[]) => {
      if (facts.some((f) => f.cik === POISON_CIK)) {
        throw new Error('malformed facts for poison cik')
      }
      return actual.normalizeFacts(facts)
    },
  }
})

vi.mock('@/db/repositories/financials', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/db/repositories/financials')>()
  return {
    ...actual,
    replaceFinancials: (
      raw: Database.Database,
      cik: number,
      r: Parameters<typeof actual.replaceFinancials>[2],
    ) => {
      if (cik === WRITE_FAIL_CIK) {
        throw new Error('simulated db write failure for write-fail cik')
      }
      return actual.replaceFinancials(raw, cik, r)
    },
  }
})

function f(cik: number, tag: string, qtrs: number, periodEnd: string, value: number): RawFact {
  return {
    cik, tag, unit: 'USD', periodStart: null, periodEnd, qtrs, value,
    form: qtrs === 4 ? '10-K' : '10-Q', filedDate: '2025-06-01',
    accession: `a-${cik}-${periodEnd}-${qtrs}`, source: 'bulk',
  }
}

describe('Finding 1 — 정규화 실패가 다른 회사의 recompute를 막지 않는다', () => {
  const GOOD_FACTS = [
    f(GOOD_CIK, 'Revenues', 1, '2024-06-30', 100),
    f(GOOD_CIK, 'Revenues', 1, '2024-09-30', 110),
    f(GOOD_CIK, 'Revenues', 1, '2024-12-31', 130),
    f(GOOD_CIK, 'Revenues', 1, '2025-03-31', 160),
  ]
  // POISON_CIK도 실제 사실을 갖고 있다 (그래야 noData가 아니라 normalizeFacts 자체가
  // 던지는 경로를 검증한다) — mock이 이 cik의 facts만 골라 throw한다.
  const POISON_FACTS = [f(POISON_CIK, 'Revenues', 1, '2025-03-31', 999)]
  // WRITE_FAIL_CIK는 정상적으로 normalizeFacts를 통과해야 replaceFinancials
  // 단계에서 던지는 경로를 검증할 수 있다 — 4개 분기를 모두 채워둔다.
  const WRITE_FAIL_FACTS = [
    f(WRITE_FAIL_CIK, 'Revenues', 1, '2024-06-30', 200),
    f(WRITE_FAIL_CIK, 'Revenues', 1, '2024-09-30', 210),
    f(WRITE_FAIL_CIK, 'Revenues', 1, '2024-12-31', 220),
    f(WRITE_FAIL_CIK, 'Revenues', 1, '2025-03-31', 230),
  ]

  const bulk: BulkFundamentalProvider = {
    fetchQuarter: async (_y, q) => (q === 2 ? [...GOOD_FACTS, ...POISON_FACTS, ...WRITE_FAIL_FACTS] : []),
  }
  const companyFacts: CompanyFactsProvider = { fetchCompany: async () => [] }

  let raw: Database.Database
  let stats: Record<string, unknown>

  beforeAll(async () => {
    raw = getRawDb(join(mkdtempSync(join(tmpdir(), 'tb-fund-resil-')), 'f.db'))
    runMigrations(raw)
    const companies = [
      [GOOD_CIK, 'NVDA'],
      [POISON_CIK, 'BADCO'],
      [WRITE_FAIL_CIK, 'WRITEBAD'],
    ] as const
    for (const [cik, ticker] of companies) {
      raw.prepare(
        `INSERT INTO companies (cik, ticker, name, is_active, first_seen, last_updated)
         VALUES (?, ?, ?, 1, '2026-08-09', '2026-08-09')`,
      ).run(cik, ticker, `${ticker} CORP`)
      raw.prepare(
        `INSERT INTO company_industry (cik, industry_slug, theme_slug, is_primary, source)
         VALUES (?, 'ai-infrastructure', 'ai-software-semi', 1, 'override')`,
      ).run(cik)
    }
    stats = await ingestFundamentals({ raw, cfg, bulk, companyFacts, asOf: '2026-08-09' })
  })

  it('잡 전체는 성공으로 기록된다 (두 회사의 실패가 잡을 무너뜨리지 않는다)', () => {
    const r = raw
      .prepare("SELECT status FROM job_runs WHERE job='fundamentals' ORDER BY id DESC")
      .get() as { status: string }
    expect(r.status).toBe('succeeded')
  })

  it('normalizeFacts에서 던진 회사와 replaceFinancials에서 던진 회사 둘 다 normalizeFailed에 기록된다', () => {
    expect(stats.normalizeFailed).toBe(2)
    expect(stats.normalizeFailedCiks).toEqual(
      [POISON_CIK, WRITE_FAIL_CIK].map(String).sort(),
    )
  })

  it('정상 회사는 두 실패 회사와 무관하게 recompute된다', () => {
    expect(stats.normalized).toBe(1)
    const fin = getFinancialsFor(raw, GOOD_CIK)
    expect(fin.quarterly).toHaveLength(4)
  })

  it('normalizeFacts에서 실패한 회사는 financials에 아무 것도 쓰지 않는다', () => {
    const fin = getFinancialsFor(raw, POISON_CIK)
    expect(fin.quarterly).toHaveLength(0)
    expect(fin.annual).toHaveLength(0)
    expect(fin.ttm).toHaveLength(0)
  })

  it('replaceFinancials에서 실패한 회사도 financials에 아무 것도 쓰지 않는다 (부분 쓰기 없음)', () => {
    const fin = getFinancialsFor(raw, WRITE_FAIL_CIK)
    expect(fin.quarterly).toHaveLength(0)
    expect(fin.annual).toHaveLength(0)
    expect(fin.ttm).toHaveLength(0)
  })
})

describe('Finding 5 — 아직 공개되지 않은 분기의 404가 잡 전체를 중단시키지 않는다', () => {
  // recentQuarters('2026-08-09', n)의 첫 항목은 항상 {year:2026, quarter:2}다
  // (quarters.test.ts에서 이미 검증됨). 이 최신 분기가 아직 공개되지 않은
  // 상황(=404)을 흉내낸다.
  const FAILING_QUARTER = { year: 2026, quarter: 2 }

  const bulk: BulkFundamentalProvider = {
    fetchQuarter: async (year, quarter) => {
      if (year === FAILING_QUARTER.year && quarter === FAILING_QUARTER.quarter) {
        throw new Error('404 Not Found')
      }
      return []
    },
  }
  const companyFacts: CompanyFactsProvider = { fetchCompany: async () => [] }

  let raw: Database.Database
  let stats: Record<string, unknown>

  beforeAll(async () => {
    raw = getRawDb(join(mkdtempSync(join(tmpdir(), 'tb-fund-404-')), 'f.db'))
    runMigrations(raw)
    raw.prepare(
      `INSERT INTO companies (cik, ticker, name, is_active, first_seen, last_updated)
       VALUES (${GOOD_CIK}, 'NVDA', 'NVIDIA CORP', 1, '2026-08-09', '2026-08-09')`,
    ).run()
    raw.prepare(
      `INSERT INTO company_industry (cik, industry_slug, theme_slug, is_primary, source)
       VALUES (${GOOD_CIK}, 'ai-infrastructure', 'ai-software-semi', 1, 'override')`,
    ).run()
    stats = await ingestFundamentals({ raw, cfg, bulk, companyFacts, asOf: '2026-08-09' })
  })

  it('잡은 성공으로 끝난다', () => {
    const r = raw
      .prepare("SELECT status FROM job_runs WHERE job='fundamentals' ORDER BY id DESC")
      .get() as { status: string }
    expect(r.status).toBe('succeeded')
  })

  it('quartersLoaded는 성공한 아카이브 수만 반영한다', () => {
    expect(stats.quartersRequested).toBe(cfg.ingest.bulk_quarters)
    expect(stats.quartersLoaded).toBe(cfg.ingest.bulk_quarters - 1)
  })

  it('quarterErrors에 실패한 분기가 이름으로 남는다', () => {
    const errors = stats.quarterErrors as string[]
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('2026Q2')
  })
})
