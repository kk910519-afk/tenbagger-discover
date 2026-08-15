import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { getRawDb, runMigrations } from '@/db/client'
import { parseConfig } from '@/config'
import { loadTaxonomy } from '@/taxonomy'
import { parseNasdaqTraded } from '@/providers/listing/nasdaq-trader'
import { ingestUniverse, seedTaxonomy } from '@/pipeline/jobs/ingest-universe'
import { runJob } from '@/pipeline/runner'
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
    stateOfIncorporation: 'DE', stateOfIncorporationDescription: 'DE',
  },
  1535527: {
    cik: 1535527, name: 'CrowdStrike Holdings, Inc.', sic: '7372',
    sicDescription: 'Prepackaged Software', exchanges: ['Nasdaq'],
    entityType: 'operating', fiscalYearEnd: '0131', filerCategory: 'Large accelerated filer',
    stateOfIncorporation: 'DE', stateOfIncorporationDescription: 'DE',
  },
  99: {
    cik: 99, name: 'Deficient Corp', sic: '6022',
    sicDescription: 'Banks', exchanges: ['Nasdaq'],
    entityType: 'operating', fiscalYearEnd: '1231', filerCategory: null,
    stateOfIncorporation: null, stateOfIncorporationDescription: null,
  },
  100: {
    cik: 100, name: 'Shell Trust', sic: '3674',
    sicDescription: 'Semiconductors', exchanges: ['Nasdaq'],
    entityType: 'investment-company', fiscalYearEnd: '1231', filerCategory: null,
    stateOfIncorporation: null, stateOfIncorporationDescription: null,
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

  it('스킵/실패 사유별 카운터를 분리해서 낸다', () => {
    // 이 픽스처에서는 설정상 제외(exclude_sic)에 걸리는 후보도, classify()가 실패하는
    // 후보도, fetchCompany가 예외를 던지거나 null을 반환하는 후보도 없다 — 두 쌍의
    // 카운터가 서로 다른 통계 키로 존재한다는 것만 확인한다.
    expect(stats.skippedExcludedSic).toBe(0)
    expect(stats.skippedUnclassifiable).toBe(0)
    expect(stats.failedLookupErrors).toBe(0)
    expect(stats.failedLookupNotFound).toBe(0)
  })

  it('job_runs에 성공 기록을 남긴다', () => {
    const r = raw
      .prepare("SELECT job, status FROM job_runs WHERE job='universe' ORDER BY id DESC")
      .get() as { job: string; status: string } | undefined
    expect(r?.status).toBe('succeeded')
  })

  it('두 번 실행해도 companies에 중복 행이 생기지 않는다', async () => {
    await ingestUniverse({ raw, cfg, taxonomy, listings, reference })
    const n = raw.prepare('SELECT COUNT(*) c FROM companies').get() as { c: number }
    expect(n.c).toBe(2)
  })

  it('두 번 실행해도 company_industry에 중복 행이 생기지 않고 분류가 유지된다', async () => {
    await ingestUniverse({ raw, cfg, taxonomy, listings, reference })
    const n = raw.prepare('SELECT COUNT(*) c FROM company_industry').get() as { c: number }
    expect(n.c).toBe(2)
    const r = raw
      .prepare('SELECT industry_slug, source FROM company_industry WHERE cik = 1535527')
      .get() as { industry_slug: string; source: string }
    expect(r.industry_slug).toBe('cybersecurity')
    expect(r.source).toBe('override')
  })
})

describe('runJob 실패 처리', () => {
  it('fn이 던진 예외를 job_runs에 failed로 기록하고 그대로 다시 던진다', async () => {
    const failRaw = getRawDb(join(mkdtempSync(join(tmpdir(), 'tb-runjob-fail-')), 'f.db'))
    runMigrations(failRaw)
    const boom = new Error('의도적 실패')

    await expect(
      runJob(failRaw, 'test-fail', async () => {
        throw boom
      }),
    ).rejects.toBe(boom)

    const row = failRaw
      .prepare("SELECT status, error FROM job_runs WHERE job = 'test-fail'")
      .get() as { status: string; error: string | null }
    expect(row.status).toBe('failed')
    expect(row.error).toContain('의도적 실패')
  })

  it('실패 기록(finishJob) 자체가 예외를 던져도 원래 예외가 가려지지 않는다', async () => {
    const original = new Error('원래 실패 원인')
    let updateAttempts = 0
    // Database.Database를 흉내내는 최소 더블 — startJob의 INSERT는 정상 처리하고,
    // finishJob의 UPDATE에서만 의도적으로 실패시켜 "기록 자체가 실패하는" 상황을 재현한다.
    const fakeRaw = {
      prepare: (sql: string) => {
        const s = sql.trim()
        if (s.startsWith('INSERT INTO job_runs')) {
          return { run: () => ({ lastInsertRowid: 1 }) }
        }
        if (s.startsWith('UPDATE job_runs')) {
          updateAttempts++
          return {
            run: () => {
              throw new Error('SQLITE_BUSY: database is locked')
            },
          }
        }
        throw new Error(`예상치 못한 SQL: ${sql}`)
      },
    } as unknown as Database.Database

    await expect(
      runJob(fakeRaw, 'test-mask', async () => {
        throw original
      }),
    ).rejects.toBe(original)
    expect(updateAttempts).toBe(1)
  })

  it('ingestUniverse가 던진 예외도 가려지지 않고 job_runs에 실패로 남는다', async () => {
    const failRaw = getRawDb(join(mkdtempSync(join(tmpdir(), 'tb-uni-fail-')), 'u.db'))
    runMigrations(failRaw)
    seedTaxonomy(failRaw, taxonomy)
    const boom = new Error('SEC ticker map 조회 실패')
    const brokenReference: ReferenceProvider = {
      fetchTickerMap: async () => {
        throw boom
      },
      fetchCompany: async () => null,
    }

    await expect(
      ingestUniverse({ raw: failRaw, cfg, taxonomy, listings, reference: brokenReference }),
    ).rejects.toBe(boom)

    const row = failRaw
      .prepare("SELECT status, error FROM job_runs WHERE job = 'universe'")
      .get() as { status: string; error: string | null }
    expect(row.status).toBe('failed')
    expect(row.error).toContain('SEC ticker map 조회 실패')
  })
})

describe('unmappedSicsSeen', () => {
  const sicListingText = [
    'Nasdaq Traded|Symbol|Security Name|Listing Exchange|Market Category|ETF|Round Lot Size|Test Issue|Financial Status|CQS Symbol|NASDAQ Symbol|NextShares',
    'Y|UNKCO|Unknown Sic Corp - Common Stock|Q|Q|N|100|N|N|UNKCO|UNKCO|N',
    'Y|BANKCO|Bank Holding Corp - Common Stock|Q|Q|N|100|N|N|BANKCO|BANKCO|N',
    'File Creation Time: 0809202606:00|||||||||||',
  ].join('\n')
  const sicListingRows = parseNasdaqTraded(sicListingText)
  const sicListings: ListingProvider = { fetchListings: async () => sicListingRows }

  const sicRefs: Record<number, CompanyReference> = {
    9001: {
      // map에도 unmapped에도 없는 SIC — 신규 성장 섹터일 수 있으므로 리포팅되어야 한다.
      cik: 9001, name: 'Unknown Sic Corp', sic: '9999',
      sicDescription: 'Nonexistent SIC', exchanges: ['Nasdaq'],
      entityType: 'operating', fiscalYearEnd: '1231', filerCategory: null,
      stateOfIncorporation: null, stateOfIncorporationDescription: null,
    },
    9002: {
      // sic-map.yaml의 unmapped 목록에 있는 SIC(은행) — 의도적 제외이므로 리포팅되면 안 된다.
      cik: 9002, name: 'Bank Holding Corp', sic: '6022',
      sicDescription: 'State Commercial Banks', exchanges: ['Nasdaq'],
      entityType: 'operating', fiscalYearEnd: '1231', filerCategory: null,
      stateOfIncorporation: null, stateOfIncorporationDescription: null,
    },
  }
  const sicReference: ReferenceProvider = {
    fetchTickerMap: async () => [
      { cik: 9001, ticker: 'UNKCO', title: 'Unknown Sic Corp' },
      { cik: 9002, ticker: 'BANKCO', title: 'Bank Holding Corp' },
    ],
    fetchCompany: async (cik) => sicRefs[cik] ?? null,
  }

  it('map에도 unmapped에도 없는 SIC는 리포팅되고, 의도적으로 제외된 SIC는 리포팅되지 않는다', async () => {
    const sicRaw = getRawDb(join(mkdtempSync(join(tmpdir(), 'tb-sic-')), 's.db'))
    runMigrations(sicRaw)
    seedTaxonomy(sicRaw, taxonomy)

    const sicStats = await ingestUniverse({
      raw: sicRaw,
      cfg,
      taxonomy,
      listings: sicListings,
      reference: sicReference,
    })

    expect(sicStats.unmappedSicsSeen).toContain('9999')
    expect(sicStats.unmappedSicsSeen).not.toContain('6022')
    // 둘 다 classify() 실패로 스킵되지만, 스킵된 이유(unclassifiable)는 같다 —
    // 리포팅 여부만 unmappedSics 선언 목록으로 갈린다.
    expect(sicStats.skippedUnclassifiable).toBe(2)
  })
})

describe('잔여(residual) SIC 거부', () => {
  // map에는 있지만 residual_reviewed에는 없는 잔여 SIC를 만들어 두고, SIC 출처 분류는
  // 거부되지만 오버라이드는 그대로 통과하는지 본다. 실제 taxonomy를 쓰지 않고
  // fixture taxonomy를 쓰는 이유: 실 taxonomy에는 그런 코드가 (의도적으로) 없다.
  const residualListingText = [
    'Nasdaq Traded|Symbol|Security Name|Listing Exchange|Market Category|ETF|Round Lot Size|Test Issue|Financial Status|CQS Symbol|NASDAQ Symbol|NextShares',
    'Y|RESID|Residual Bucket Corp - Common Stock|Q|Q|N|100|N|N|RESID|RESID|N',
    'Y|OKAY|Reviewed Residual Corp - Common Stock|Q|Q|N|100|N|N|OKAY|OKAY|N',
    'Y|OVRD|Override Wins Corp - Common Stock|Q|Q|N|100|N|N|OVRD|OVRD|N',
    'File Creation Time: 0815202606:00|||||||||||',
  ].join('\n')
  const residualListings: ListingProvider = {
    fetchListings: async () => parseNasdaqTraded(residualListingText),
  }

  function ref(cik: number, name: string, sic: string, desc: string): CompanyReference {
    return {
      cik, name, sic, sicDescription: desc, exchanges: ['Nasdaq'],
      entityType: 'operating', fiscalYearEnd: '1231', filerCategory: null,
      stateOfIncorporation: null, stateOfIncorporationDescription: null,
    }
  }
  const residualRefs: Record<number, CompanyReference> = {
    9101: ref(9101, 'Residual Bucket Corp', '9001', 'Widget Equipment, NEC'),
    9102: ref(9102, 'Reviewed Residual Corp', '9002', 'Miscellaneous Widgets'),
    9103: ref(9103, 'Override Wins Corp', '9001', 'Widget Equipment, NEC'),
  }
  const residualReference: ReferenceProvider = {
    fetchTickerMap: async () => [
      { cik: 9101, ticker: 'RESID', title: 'Residual Bucket Corp' },
      { cik: 9102, ticker: 'OKAY', title: 'Reviewed Residual Corp' },
      { cik: 9103, ticker: 'OVRD', title: 'Override Wins Corp' },
    ],
    fetchCompany: async (cik) => residualRefs[cik] ?? null,
  }

  function residualTaxonomy(): ReturnType<typeof loadTaxonomy> {
    const dir = mkdtempSync(join(tmpdir(), 'tb-residual-tax-'))
    writeFileSync(join(dir, 'themes.yaml'),
      `- { slug: t1, name: "T1", display_order: 1 }\n`)
    writeFileSync(join(dir, 'industries.yaml'),
      `- { slug: ind-a, theme: t1, name: "Ind A", tam_usd: null, tam_cagr: null, tam_source: null, tam_as_of: null }\n` +
      `- { slug: ind-b, theme: t1, name: "Ind B", tam_usd: null, tam_cagr: null, tam_source: null, tam_as_of: null }\n`)
    writeFileSync(join(dir, 'sic-map.yaml'),
      `map:\n  "9001": { theme: t1, industry: ind-a }\n  "9002": { theme: t1, industry: ind-a }\n` +
      `unmapped: []\nresidual_reviewed: ["9002"]\n`)
    writeFileSync(join(dir, 'company-overrides.yaml'), `OVRD: { industry: ind-b }\n`)
    return loadTaxonomy(dir)
  }

  it('residual_reviewed에 없는 잔여 SIC는 SIC 분류를 거부하고, 근거가 있는 코드는 통과시키며, 오버라이드는 이긴다', async () => {
    const tax = residualTaxonomy()
    const rRaw = getRawDb(join(mkdtempSync(join(tmpdir(), 'tb-residual-')), 'r.db'))
    runMigrations(rRaw)
    seedTaxonomy(rRaw, tax)

    const s = await ingestUniverse({
      raw: rRaw, cfg, taxonomy: tax,
      listings: residualListings, reference: residualReference,
    })

    expect(s.skippedResidualSic).toBe(1)
    expect(s.residualSicsBlocked).toEqual(['9001'])
    // 거부된 회사는 companies에 아예 들어오지 않는다
    const tickers = (rRaw.prepare('SELECT ticker FROM companies ORDER BY ticker').all() as
      { ticker: string }[]).map((r) => r.ticker)
    expect(tickers).toEqual(['OKAY', 'OVRD'])
    // 오버라이드는 잔여 SIC 검사보다 앞선다 — 근거가 있으면 되돌아올 수 있어야 한다
    const ovrd = rRaw
      .prepare('SELECT industry_slug, source FROM company_industry WHERE cik = 9103')
      .get() as { industry_slug: string; source: string }
    expect(ovrd).toEqual({ industry_slug: 'ind-b', source: 'override' })
  })

  it('잔여 SIC 매핑을 제거하면 이미 수집된 회사가 유니버스에서 내려간다', async () => {
    // 1차: 9001이 매핑된 taxonomy로 수집 → RESID가 유니버스에 들어온다
    const permissiveDir = mkdtempSync(join(tmpdir(), 'tb-residual-tax1-'))
    writeFileSync(join(permissiveDir, 'themes.yaml'),
      `- { slug: t1, name: "T1", display_order: 1 }\n`)
    writeFileSync(join(permissiveDir, 'industries.yaml'),
      `- { slug: ind-a, theme: t1, name: "Ind A", tam_usd: null, tam_cagr: null, tam_source: null, tam_as_of: null }\n` +
      `- { slug: ind-b, theme: t1, name: "Ind B", tam_usd: null, tam_cagr: null, tam_source: null, tam_as_of: null }\n`)
    writeFileSync(join(permissiveDir, 'sic-map.yaml'),
      `map:\n  "9001": { theme: t1, industry: ind-a }\n  "9002": { theme: t1, industry: ind-a }\n` +
      `unmapped: []\nresidual_reviewed: ["9001", "9002"]\n`)
    writeFileSync(join(permissiveDir, 'company-overrides.yaml'), `OVRD: { industry: ind-b }\n`)
    const permissive = loadTaxonomy(permissiveDir)

    const rRaw = getRawDb(join(mkdtempSync(join(tmpdir(), 'tb-retire-')), 'r.db'))
    runMigrations(rRaw)
    seedTaxonomy(rRaw, permissive)
    const first = await ingestUniverse({
      raw: rRaw, cfg, taxonomy: permissive,
      listings: residualListings, reference: residualReference,
    })
    expect(first.classified).toBe(3)
    expect(first.retiredFromUniverse).toBe(0)

    // 2차: 9001의 근거를 뺀 taxonomy로 재수집 → RESID는 내려가고 OVRD는 남는다
    const strict = residualTaxonomy()
    const second = await ingestUniverse({
      raw: rRaw, cfg, taxonomy: strict,
      listings: residualListings, reference: residualReference,
    })
    expect(second.retiredTickers).toEqual(['RESID'])

    const resid = rRaw
      .prepare('SELECT is_active FROM companies WHERE cik = 9101')
      .get() as { is_active: number }
    expect(resid.is_active).toBe(0)
    expect(
      rRaw.prepare('SELECT COUNT(*) n FROM company_industry WHERE cik = 9101').get(),
    ).toEqual({ n: 0 })
    // 남아 있어야 할 회사는 그대로다
    expect(
      rRaw.prepare('SELECT COUNT(*) n FROM company_industry').get(),
    ).toEqual({ n: 2 })
  })
})
