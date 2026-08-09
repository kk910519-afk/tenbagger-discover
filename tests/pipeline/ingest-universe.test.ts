import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { getRawDb, runMigrations } from '@/db/client'
import { parseConfig } from '@/config'
import { loadTaxonomy } from '@/taxonomy'
import { parseNasdaqTraded } from '@/providers/listing/nasdaq-trader'
import { ingestUniverse, seedTaxonomy } from '@/pipeline/jobs/ingest-universe'
import type { CompanyReference, ListingProvider, ReferenceProvider } from '@/providers/types'

const cfg = parseConfig(readFileSync('config.yaml', 'utf8'))
const taxonomy = loadTaxonomy()
const listingRows = parseNasdaqTraded(readFileSync('tests/fixtures/nasdaqtraded.txt', 'utf8'))

const listings: ListingProvider = { fetchListings: async () => listingRows }

const REFS: Record<number, CompanyReference> = {
  1045810: {
    cik: 1045810, name: 'NVIDIA CORP', sic: '3674',
    sicDescription: 'Semiconductors', exchanges: ['Nasdaq'],
    entityType: 'operating', fiscalYearEnd: '0131', filerCategory: 'Large accelerated filer',
  },
  1535527: {
    cik: 1535527, name: 'CrowdStrike Holdings, Inc.', sic: '7372',
    sicDescription: 'Prepackaged Software', exchanges: ['Nasdaq'],
    entityType: 'operating', fiscalYearEnd: '0131', filerCategory: 'Large accelerated filer',
  },
  99: {
    cik: 99, name: 'Deficient Corp', sic: '6022',
    sicDescription: 'Banks', exchanges: ['Nasdaq'],
    entityType: 'operating', fiscalYearEnd: '1231', filerCategory: null,
  },
  100: {
    cik: 100, name: 'Shell Trust', sic: '3674',
    sicDescription: 'Semiconductors', exchanges: ['Nasdaq'],
    entityType: 'investment-company', fiscalYearEnd: '1231', filerCategory: null,
  },
}

const reference: ReferenceProvider = {
  fetchTickerMap: async () => [
    { cik: 1045810, ticker: 'NVDA', title: 'NVIDIA CORP' },
    { cik: 1535527, ticker: 'CRWD', title: 'CrowdStrike Holdings, Inc.' },
    { cik: 99, ticker: 'BADCO', title: 'Deficient Corp' },
    { cik: 100, ticker: 'SPY', title: 'Shell Trust' },
  ],
  fetchCompany: async (cik) => REFS[cik] ?? null,
}

let raw: Database.Database
let stats: Record<string, unknown>

beforeAll(async () => {
  raw = getRawDb(join(mkdtempSync(join(tmpdir(), 'tb-uni-')), 'u.db'))
  runMigrations(raw)
  seedTaxonomy(raw, taxonomy)
  stats = await ingestUniverse({ raw, cfg, taxonomy, listings, reference })
})

describe('seedTaxonomy', () => {
  it('themes와 industries 테이블을 채운다', () => {
    const t = raw.prepare('SELECT COUNT(*) c FROM themes').get() as { c: number }
    const i = raw.prepare('SELECT COUNT(*) c FROM industries').get() as { c: number }
    expect(t.c).toBe(6)
    expect(i.c).toBe(49)
  })
})

describe('ingestUniverse', () => {
  it('상장 필터를 통과한 보통주만 남긴다', () => {
    // 픽스처 7개 중 NVDA, CRWD, BADCO가 보통주 형태.
    // BADCO는 financial_status=D로 상장 필터에서 제외된다.
    expect(stats.afterListingFilter).toBe(2)
  })

  it('분류에 성공한 기업만 companies에 저장한다', () => {
    const rows = raw.prepare('SELECT ticker FROM companies ORDER BY ticker').all() as
      { ticker: string }[]
    expect(rows.map((r) => r.ticker)).toEqual(['CRWD', 'NVDA'])
  })

  it('오버라이드 분류를 company_industry에 기록한다', () => {
    const r = raw
      .prepare('SELECT industry_slug, theme_slug, source FROM company_industry WHERE cik = 1535527')
      .get() as { industry_slug: string; theme_slug: string; source: string }
    expect(r.industry_slug).toBe('cybersecurity')
    expect(r.theme_slug).toBe('ai-software-semi')
    expect(r.source).toBe('override')
  })

  it('listings 원본을 그대로 보존한다', () => {
    const n = raw.prepare('SELECT COUNT(*) c FROM listings').get() as { c: number }
    expect(n.c).toBe(listingRows.length)
  })

  it('분류 출처별 개수를 통계로 낸다', () => {
    expect(stats.overrideCount).toBe(2) // NVDA→ai-infrastructure, CRWD→cybersecurity
    expect(stats.sicBucketCount).toBe(0)
  })

  it('job_runs에 성공 기록을 남긴다', () => {
    const r = raw
      .prepare("SELECT job, status FROM job_runs WHERE job='universe' ORDER BY id DESC")
      .get() as { job: string; status: string } | undefined
    expect(r?.status).toBe('succeeded')
  })

  it('두 번 실행해도 중복 행이 생기지 않는다', async () => {
    await ingestUniverse({ raw, cfg, taxonomy, listings, reference })
    const n = raw.prepare('SELECT COUNT(*) c FROM companies').get() as { c: number }
    expect(n.c).toBe(2)
  })
})
