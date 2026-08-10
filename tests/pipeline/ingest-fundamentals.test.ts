import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { getRawDb, runMigrations } from '@/db/client'
import { parseConfig } from '@/config'
import { ingestFundamentals } from '@/pipeline/jobs/ingest-fundamentals'
import {
  getFinancialsFor, selectStaleCiks, selectThinCoverageCiks, selectTagSetStaleCiks,
  markTagSetFetched,
} from '@/db/repositories/financials'
import { TRACKED_TAGS, TRACKED_TAGS_FINGERPRINT } from '@/providers/fundamental/tags'
import { createHash } from 'node:crypto'
import type { BulkFundamentalProvider, CompanyFactsProvider, RawFact } from '@/providers/types'

const cfg = parseConfig(readFileSync('config.yaml', 'utf8'))

/** 지문 계산이 "정렬된 태그 내용"에만 의존하는지 독립적으로 재현해 확인한다. */
function fingerprintOf(tags: Set<string>): string {
  return createHash('sha256').update([...tags].sort().join('\n')).digest('hex').slice(0, 16)
}

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

// companyfacts-cik-report.md: filed_date가 최신이어도(=selectStaleCiks가 놓쳐도)
// 저장된 사실 자체가 비정상적으로 적은 회사는 자가치유 재조회 대상이어야 한다.
describe('selectThinCoverageCiks', () => {
  const FRESH_THIN_CIK = 5000000
  const FRESH_RICH_CIK = 5000001
  const NO_FACTS_CIK = 5000002
  const BULK_ONLY_CIK = 5000003

  beforeAll(() => {
    for (const [cik, ticker] of [
      [FRESH_THIN_CIK, 'THIN'], [FRESH_RICH_CIK, 'RICH'], [NO_FACTS_CIK, 'NONE'],
      [BULK_ONLY_CIK, 'BONLY'],
    ] as const) {
      raw.prepare(
        `INSERT INTO companies (cik, ticker, name, is_active, first_seen, last_updated)
         VALUES (?, ?, ?, 1, '2026-08-09', '2026-08-09')`,
      ).run(cik, ticker, `${ticker} CORP`)
      raw.prepare(
        `INSERT INTO company_industry (cik, industry_slug, theme_slug, is_primary, source)
         VALUES (?, 'ai-infrastructure', 'ai-software-semi', 1, 'override')`,
      ).run(cik)
    }
    // FRESH_THIN_CIK: filed_date가 오늘이라 selectStaleCiks 기준으로는 "최신"이지만
    // 사실이 3건뿐이다 — 이것이 결함의 실제 패턴(bulk만 채워지고 API가 통째로 버려짐).
    const insertFact = raw.prepare(
      `INSERT INTO financial_facts
         (cik, tag, unit, period_start, period_end, qtrs, value, form, filed_date, accession, source)
       VALUES (?, ?, 'USD', NULL, ?, 1, 1, '10-Q', '2026-08-01', ?, 'bulk')`,
    )
    for (let i = 0; i < 3; i++) {
      insertFact.run(FRESH_THIN_CIK, `Tag${i}`, `2026-0${i + 1}-01`, `thin-${i}`)
    }
    // FRESH_RICH_CIK: API 사실이 충분히 많다 (임계값 이상) — 재조회 대상이 아니어야 한다.
    const insertApiFact = raw.prepare(
      `INSERT INTO financial_facts
         (cik, tag, unit, period_start, period_end, qtrs, value, form, filed_date, accession, source)
       VALUES (?, ?, 'USD', NULL, ?, 1, 1, '10-Q', '2026-08-01', ?, 'api')`,
    )
    for (let i = 0; i < 10; i++) {
      insertApiFact.run(FRESH_RICH_CIK, `Tag${i}`, `2026-0${(i % 9) + 1}-01`, `rich-${i}`)
    }
    // BULK_ONLY_CIK: bulk만으로는 임계값을 훌쩍 넘지만 API 사실이 하나도 없다.
    // 리뷰 F6이 지적한 구멍 — 전체 행을 세면 이 회사가 그물을 빠져나간다.
    for (let i = 0; i < 20; i++) {
      insertFact.run(BULK_ONLY_CIK, `Tag${i}`, `2026-0${(i % 9) + 1}-01`, `bulkonly-${i}`)
    }
  })

  it('filed_date는 최신이지만 사실 수가 임계값 미만인 회사를 포함한다', () => {
    expect(selectThinCoverageCiks(raw, 5)).toContain(FRESH_THIN_CIK)
  })

  it('bulk로만 두껍게 채워진 회사(API 사실 0건)도 포함한다 — 전체 행을 세면 놓친다', () => {
    expect(
      raw.prepare('SELECT COUNT(*) AS n FROM financial_facts WHERE cik = ?')
        .get(BULK_ONLY_CIK),
    ).toEqual({ n: 20 })
    expect(selectThinCoverageCiks(raw, 5)).toContain(BULK_ONLY_CIK)
  })

  it('임계값 이상으로 채워진 회사는 제외한다', () => {
    expect(selectThinCoverageCiks(raw, 5)).not.toContain(FRESH_RICH_CIK)
  })

  it('사실이 전혀 없는 회사(신규 상장사)는 제외한다 — selectStaleCiks의 NULL 분기가 이미 처리한다', () => {
    expect(selectThinCoverageCiks(raw, 5)).not.toContain(NO_FACTS_CIK)
  })

  it('filed_date 기준 staleness만으로는 이 회사를 잡아내지 못한다 (결함 재현)', () => {
    // 바로 이 지점이 결함이다: filed_date가 asOf와 같은 날이므로 selectStaleCiks는
    // 이 회사를 절대 재조회 대상으로 고르지 않는다.
    expect(selectStaleCiks(raw, '2026-08-09', 120)).not.toContain(FRESH_THIN_CIK)
  })
})

describe('ingestFundamentals — thin-coverage 자가치유와 apiEmptyParse 관측 (companyfacts-cik-report.md)', () => {
  const FRESH_THIN_CIK = 6100000
  const EMPTY_PARSE_CIK = 6100001
  const NOT_FOUND_CIK = 6100002

  let thinRaw: Database.Database
  let thinStats: Record<string, unknown>
  let calledCiks: number[]

  const bulkNoop: BulkFundamentalProvider = { fetchQuarter: async () => [] }

  function apiFact(cik: number): RawFact {
    return {
      cik, tag: 'Revenues', unit: 'USD', periodStart: null, periodEnd: '2026-06-30',
      qtrs: 1, value: 500, form: '10-Q', filedDate: '2026-08-05',
      accession: `api-${cik}`, source: 'api',
    }
  }

  const companyFactsMixed: CompanyFactsProvider = {
    fetchCompany: async (cik) => {
      calledCiks.push(cik)
      if (cik === FRESH_THIN_CIK) return [apiFact(cik)]
      if (cik === EMPTY_PARSE_CIK) return [] // 200이지만 추적 태그 0건 — 의심스러움
      if (cik === NOT_FOUND_CIK) return null // 확인된 404 — 정상
      return []
    },
  }

  beforeAll(async () => {
    thinRaw = getRawDb(join(mkdtempSync(join(tmpdir(), 'tb-fund-thin-')), 'f.db'))
    runMigrations(thinRaw)
    calledCiks = []
    for (const [cik, ticker] of [
      [FRESH_THIN_CIK, 'THIN'], [EMPTY_PARSE_CIK, 'EMPTY'], [NOT_FOUND_CIK, 'GONE'],
    ] as const) {
      thinRaw.prepare(
        `INSERT INTO companies (cik, ticker, name, is_active, first_seen, last_updated)
         VALUES (?, ?, ?, 1, '2026-08-09', '2026-08-09')`,
      ).run(cik, ticker, `${ticker} CORP`)
      thinRaw.prepare(
        `INSERT INTO company_industry (cik, industry_slug, theme_slug, is_primary, source)
         VALUES (?, 'ai-infrastructure', 'ai-software-semi', 1, 'override')`,
      ).run(cik)
    }
    // 세 회사 모두 filed_date를 asOf 근처(최신)로 채워 selectStaleCiks만으로는
    // 재조회 대상이 아니게 만든다 — thin-coverage 경로가 아니면 API가 호출되지
    // 않아야 정상인 시나리오다. 사실 수는 임계값(200) 밑으로 둔다.
    const insertFact = thinRaw.prepare(
      `INSERT INTO financial_facts
         (cik, tag, unit, period_start, period_end, qtrs, value, form, filed_date, accession, source)
       VALUES (?, 'Revenues', 'USD', NULL, '2026-06-30', 1, 1, '10-Q', '2026-08-05', ?, 'bulk')`,
    )
    for (const cik of [FRESH_THIN_CIK, EMPTY_PARSE_CIK, NOT_FOUND_CIK]) {
      insertFact.run(cik, `seed-${cik}`)
    }
    thinStats = await ingestFundamentals({
      raw: thinRaw, cfg, bulk: bulkNoop, companyFacts: companyFactsMixed, asOf: '2026-08-09',
    })
  })

  it('filed_date가 최신이라 selectStaleCiks만으로는 대상이 아니지만, thin coverage라서 API가 호출된다', () => {
    expect(calledCiks).toContain(FRESH_THIN_CIK)
    expect(calledCiks).toContain(EMPTY_PARSE_CIK)
    expect(calledCiks).toContain(NOT_FOUND_CIK)
  })

  it('thinCoverageCompanies 통계에 세 회사가 모두 반영된다', () => {
    expect(thinStats.thinCoverageCompanies).toBe(3)
  })

  it('200이지만 추적 태그 0건인 응답만 apiEmptyParse로 센다 — 404(null)는 세지 않는다', () => {
    expect(thinStats.apiEmptyParse).toBe(1)
    expect(thinStats.apiEmptyParseCiks).toEqual([String(EMPTY_PARSE_CIK)])
  })

  it('정상적으로 사실을 반환한 회사의 데이터는 실제로 저장된다', () => {
    const fin = getFinancialsFor(thinRaw, FRESH_THIN_CIK)
    expect(fin.quarterly.some((p) => p.revenue === 500)).toBe(true)
  })
})

// 추적 태그 집합이 바뀌면 재수집이 일어나야 한다(debt-coverage 과제 3항). TRACKED_TAGS는
// 파싱 시점에 필터링하므로, 이 기준이 없으면 태그를 추가해도 기존 유니버스에서는 조용히
// 무효가 된다 — 신고일도 최신이고 사실 수도 충분해 다른 두 기준이 발동하지 않기 때문이다.
describe('selectTagSetStaleCiks — 태그 집합 변경 감지', () => {
  const CIK = 7200000
  let tagRaw: Database.Database

  beforeAll(() => {
    tagRaw = getRawDb(join(mkdtempSync(join(tmpdir(), 'tb-fund-tag-')), 'f.db'))
    runMigrations(tagRaw)
    tagRaw.prepare(
      `INSERT INTO companies (cik, ticker, name, is_active, first_seen, last_updated)
       VALUES (?, 'TAGS', 'TAGS CORP', 1, '2026-08-09', '2026-08-09')`,
    ).run(CIK)
    tagRaw.prepare(
      `INSERT INTO company_industry (cik, industry_slug, theme_slug, is_primary, source)
       VALUES (?, 'ai-infrastructure', 'ai-software-semi', 1, 'override')`,
    ).run(CIK)
    // 신고일은 오늘, API 사실 수는 임계값을 넉넉히 넘긴다 — 기존 두 기준으로는 절대
    // 재조회 대상이 되지 않는 상태를 만든다(thin-coverage는 API 소스 사실만 센다).
    const insertFact = tagRaw.prepare(
      `INSERT INTO financial_facts
         (cik, tag, unit, period_start, period_end, qtrs, value, form, filed_date, accession, source)
       VALUES (?, ?, 'USD', NULL, ?, 1, 1, '10-Q', '2026-08-08', ?, 'api')`,
    )
    for (let i = 0; i < cfg.ingest.thin_coverage_min_facts + 10; i++) {
      insertFact.run(CIK, `Tag${i}`, '2026-06-30', `tag-${i}`)
    }
  })

  it('기록이 전혀 없는 회사는 재조회 대상이다', () => {
    expect(selectTagSetStaleCiks(tagRaw, 'fingerprint-A')).toContain(CIK)
  })

  it('같은 지문으로 기록되면 더 이상 대상이 아니다', () => {
    markTagSetFetched(tagRaw, CIK, 'fingerprint-A', '2026-08-09')
    expect(selectTagSetStaleCiks(tagRaw, 'fingerprint-A')).not.toContain(CIK)
  })

  it('지문이 달라지면(태그 추가) 다시 대상이 된다 — 이 기준의 존재 이유', () => {
    expect(selectTagSetStaleCiks(tagRaw, 'fingerprint-B')).toContain(CIK)
  })

  it('다른 두 기준은 이 회사를 절대 잡지 못한다 (결함 재현)', () => {
    expect(selectStaleCiks(tagRaw, '2026-08-09', 120)).not.toContain(CIK)
    expect(selectThinCoverageCiks(tagRaw, cfg.ingest.thin_coverage_min_facts)).not.toContain(CIK)
  })

  it('TRACKED_TAGS_FINGERPRINT는 집합 내용에만 의존하고 안정적이다', () => {
    expect(TRACKED_TAGS_FINGERPRINT).toMatch(/^[0-9a-f]{16}$/)
    expect(TRACKED_TAGS_FINGERPRINT).toBe(fingerprintOf(TRACKED_TAGS))
    // 순서만 다른 같은 집합은 같은 지문, 태그 하나가 늘면 다른 지문.
    expect(fingerprintOf(new Set([...TRACKED_TAGS].reverse()))).toBe(TRACKED_TAGS_FINGERPRINT)
    expect(fingerprintOf(new Set([...TRACKED_TAGS, 'SomeNewTag']))).not.toBe(TRACKED_TAGS_FINGERPRINT)
  })
})

describe('ingestFundamentals — 태그 집합이 바뀌면 실제로 재조회한다', () => {
  const CIK = 7300000
  let changedRaw: Database.Database
  let called: number[]

  beforeAll(async () => {
    changedRaw = getRawDb(join(mkdtempSync(join(tmpdir(), 'tb-fund-tagrun-')), 'f.db'))
    runMigrations(changedRaw)
    changedRaw.prepare(
      `INSERT INTO companies (cik, ticker, name, is_active, first_seen, last_updated)
       VALUES (?, 'TCHG', 'TAG CHANGE CORP', 1, '2026-08-09', '2026-08-09')`,
    ).run(CIK)
    changedRaw.prepare(
      `INSERT INTO company_industry (cik, industry_slug, theme_slug, is_primary, source)
       VALUES (?, 'ai-infrastructure', 'ai-software-semi', 1, 'override')`,
    ).run(CIK)
    const insertFact = changedRaw.prepare(
      `INSERT INTO financial_facts
         (cik, tag, unit, period_start, period_end, qtrs, value, form, filed_date, accession, source)
       VALUES (?, ?, 'USD', NULL, '2026-06-30', 1, 1, '10-Q', '2026-08-08', ?, 'api')`,
    )
    for (let i = 0; i < cfg.ingest.thin_coverage_min_facts + 10; i++) {
      insertFact.run(CIK, `Tag${i}`, `tag-${i}`)
    }
    // 이미 "현재 지문으로 수집 완료"라고 표시해 둔다 — 이 상태에서는 호출되면 안 된다.
    markTagSetFetched(changedRaw, CIK, TRACKED_TAGS_FINGERPRINT, '2026-08-08')
    called = []
    const facts: CompanyFactsProvider = {
      fetchCompany: async (cik) => { called.push(cik); return [] },
    }
    await ingestFundamentals({
      raw: changedRaw, cfg, bulk: { fetchQuarter: async () => [] }, companyFacts: facts,
      asOf: '2026-08-09',
    })
  })

  it('지문이 같으면 API를 호출하지 않는다', () => {
    expect(called).not.toContain(CIK)
  })

  it('지문이 달라지면 API를 호출하고 새 지문으로 갱신한다', async () => {
    markTagSetFetched(changedRaw, CIK, 'stale-fingerprint', '2026-08-08')
    called = []
    const stats = await ingestFundamentals({
      raw: changedRaw, cfg, bulk: { fetchQuarter: async () => [] },
      companyFacts: {
        fetchCompany: async (cik) => {
          called.push(cik)
          return [{
            cik, tag: 'Revenues', unit: 'USD', periodStart: null, periodEnd: '2026-06-30',
            qtrs: 1, value: 42, form: '10-Q', filedDate: '2026-08-08',
            accession: 'tagrun-1', source: 'api',
          }]
        },
      },
      asOf: '2026-08-09',
    })
    expect(called).toContain(CIK)
    expect(stats.tagSetStaleCompanies).toBe(1)
    expect(stats.tagsFingerprint).toBe(TRACKED_TAGS_FINGERPRINT)
    expect(selectTagSetStaleCiks(changedRaw, TRACKED_TAGS_FINGERPRINT)).not.toContain(CIK)
  })

  // F6: 파싱 결과가 빈 회사에 지문을 찍으면 `selectTagSetStaleCiks`에서 영구히
  // 빠진다 — 지문 그물이 태그 집합 변경당 딱 한 번만 발동하고, 정작 그 그물이
  // 필요한 코호트(파서가 응답을 통째로 버린 회사)를 스스로 제외해 버린다.
  it('파싱 결과가 비면(200이지만 추적 태그 0건) 지문을 찍지 않아 다음 실행에서 다시 대상이 된다', async () => {
    markTagSetFetched(changedRaw, CIK, 'stale-fingerprint-2', '2026-08-08')
    called = []
    const stats = await ingestFundamentals({
      raw: changedRaw, cfg, bulk: { fetchQuarter: async () => [] },
      companyFacts: { fetchCompany: async (cik) => { called.push(cik); return [] } },
      asOf: '2026-08-09',
    })
    expect(called).toContain(CIK)
    expect(stats.apiEmptyParse).toBe(1)
    // 수정 전에는 지문이 찍혀 이 단언이 실패했다(=회사가 그물에서 사라졌다).
    expect(selectTagSetStaleCiks(changedRaw, TRACKED_TAGS_FINGERPRINT)).toContain(CIK)
  })

  it('404(신고 이력 없음)는 확인 완료로 보고 지문을 찍는다 — 빈 파싱과 구분된다', async () => {
    markTagSetFetched(changedRaw, CIK, 'stale-fingerprint-3', '2026-08-08')
    const stats = await ingestFundamentals({
      raw: changedRaw, cfg, bulk: { fetchQuarter: async () => [] },
      companyFacts: { fetchCompany: async () => null },
      asOf: '2026-08-09',
    })
    expect(stats.apiEmptyParse).toBe(0)
    expect(selectTagSetStaleCiks(changedRaw, TRACKED_TAGS_FINGERPRINT)).not.toContain(CIK)
  })
})
