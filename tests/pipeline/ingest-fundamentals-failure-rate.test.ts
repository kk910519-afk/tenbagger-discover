import { describe, it, expect, beforeAll, vi } from 'vitest'
import { readFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { getRawDb, runMigrations } from '@/db/client'
import { parseConfig } from '@/config'
import { ingestFundamentals } from '@/pipeline/jobs/ingest-fundamentals'
import { insertFacts } from '@/db/repositories/financials'
import type { BulkFundamentalProvider, CompanyFactsProvider, RawFact } from '@/providers/types'

const cfg = parseConfig(readFileSync('config.yaml', 'utf8'))

// 어느 CIK가 정규화 실패로 취급될지는 테스트별로 채워 넣는다. normalizeFacts는
// 실제 로직을 그대로 쓰되, facts 안에 이 집합의 cik가 하나라도 있으면 던진다 —
// Finding 1의 리졸루션 테스트와 같은 기법. vi.mock은 파일 최상단으로
// 호이스팅되므로 아래 static import보다 먼저 적용된다.
const poisonCiks = new Set<number>()

vi.mock('@/providers/fundamental/normalizer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/providers/fundamental/normalizer')>()
  return {
    ...actual,
    normalizeFacts: (facts: RawFact[]) => {
      if (facts.some((f) => poisonCiks.has(f.cik))) {
        throw new Error('malformed facts (simulated normalizer failure)')
      }
      return actual.normalizeFacts(facts)
    },
  }
})

// 실제 프로덕션 min_sample(20)로는 이 테스트 규모(회사 4개)로 가드 자체가
// 발동하지 않는다. 임계값(비율) 자체는 실제 config.yaml 값을 그대로 쓰고
// min_sample만 테스트 규모에 맞게 낮춘다.
const MIN_SAMPLE_OVERRIDE = 3
const testCfg = {
  ...cfg,
  ingest: { ...cfg.ingest, normalize_failure_min_sample: MIN_SAMPLE_OVERRIDE },
}

function poisonFact(cik: number): RawFact {
  return {
    cik, tag: 'Revenues', unit: 'USD', periodStart: null, periodEnd: '2025-03-31',
    qtrs: 1, value: 1, form: '10-Q', filedDate: '2025-06-01',
    accession: `poison-${cik}`, source: 'bulk',
  }
}

const bulk: BulkFundamentalProvider = { fetchQuarter: async () => [] }
const companyFacts: CompanyFactsProvider = { fetchCompany: async () => [] }

function seedCompanies(raw: Database.Database, ciks: number[]): void {
  for (const cik of ciks) {
    raw.prepare(
      `INSERT INTO companies (cik, ticker, name, is_active, first_seen, last_updated)
       VALUES (?, ?, ?, 1, '2026-08-09', '2026-08-09')`,
    ).run(cik, `T${cik}`, `COMPANY ${cik}`)
    raw.prepare(
      `INSERT INTO company_industry (cik, industry_slug, theme_slug, is_primary, source)
       VALUES (?, 'ai-infrastructure', 'ai-software-semi', 1, 'override')`,
    ).run(cik)
  }
}

describe('Finding 6 — 소수 실패는 잡을 성공시킨다 (노이즈 허용)', () => {
  // 4개 중 1개(25%)만 실패 — 기본 임계치(0.5)보다 낮다.
  const CIKS = [6000001, 6000002, 6000003, 6000004]
  const POISONED = [6000001]

  let raw: Database.Database
  let stats: Record<string, unknown>

  beforeAll(async () => {
    raw = getRawDb(join(mkdtempSync(join(tmpdir(), 'tb-fund-rate-minor-')), 'f.db'))
    runMigrations(raw)
    seedCompanies(raw, CIKS)
    poisonCiks.clear()
    for (const cik of POISONED) {
      poisonCiks.add(cik)
      insertFacts(raw, [poisonFact(cik)])
    }
    stats = await ingestFundamentals({ raw, cfg: testCfg, bulk, companyFacts, asOf: '2026-08-09' })
  })

  it('잡은 성공으로 기록된다', () => {
    const r = raw
      .prepare("SELECT status FROM job_runs WHERE job='fundamentals' ORDER BY id DESC")
      .get() as { status: string }
    expect(r.status).toBe('succeeded')
  })

  it('실패한 회사만 normalizeFailed에 반영된다', () => {
    expect(stats.normalizeFailed).toBe(1)
    expect(stats.normalizeFailedCiks).toEqual(POISONED.map(String))
  })
})

describe('Finding 6 — 다수 실패는 잡을 failed로 기록하고 실패 CIK를 남긴다', () => {
  // 4개 중 3개(75%)가 실패 — 기본 임계치(0.5)를 넘는다.
  const CIKS = [7000001, 7000002, 7000003, 7000004]
  const POISONED = [7000001, 7000002, 7000003]

  let raw: Database.Database
  let thrown: unknown

  beforeAll(async () => {
    raw = getRawDb(join(mkdtempSync(join(tmpdir(), 'tb-fund-rate-major-')), 'f.db'))
    runMigrations(raw)
    seedCompanies(raw, CIKS)
    poisonCiks.clear()
    for (const cik of POISONED) {
      poisonCiks.add(cik)
      insertFacts(raw, [poisonFact(cik)])
    }
    try {
      await ingestFundamentals({ raw, cfg: testCfg, bulk, companyFacts, asOf: '2026-08-09' })
    } catch (e) {
      thrown = e
    }
  })

  it('ingestFundamentals가 던진다 (runJob이 삼키지 않는다)', () => {
    expect(thrown).toBeInstanceOf(Error)
    expect((thrown as Error).message).toContain('정규화 실패율이 임계치를 초과했습니다')
  })

  it('job_runs에 failed로 기록되고 에러 메시지에 실패율과 CIK 샘플이 남는다', () => {
    const r = raw
      .prepare("SELECT status, error FROM job_runs WHERE job='fundamentals' ORDER BY id DESC")
      .get() as { status: string; error: string }
    expect(r.status).toBe('failed')
    expect(r.error).toContain('75.0%')
    for (const cik of POISONED) expect(r.error).toContain(String(cik))
  })

  it('stats는 job_runs.stats에 남지 않는다 (실패 시 null)', () => {
    const r = raw
      .prepare("SELECT stats FROM job_runs WHERE job='fundamentals' ORDER BY id DESC")
      .get() as { stats: string | null }
    expect(r.stats).toBeNull()
  })
})
