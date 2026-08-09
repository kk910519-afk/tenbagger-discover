import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { getRawDb, runMigrations } from '@/db/client'
import { parseConfig } from '@/config'
import { loadTaxonomy } from '@/taxonomy'
import { computeScores, configHash, valuationConfigHash } from '@/pipeline/jobs/compute-scores'

const cfg = parseConfig(readFileSync('config.yaml', 'utf8'))
const taxonomy = loadTaxonomy()

let raw: Database.Database
let stats: Record<string, unknown>

function seed(db: Database.Database, cik: number, ticker: string, marketCap: number,
              revenueNow: number, revenuePrior: number, gm: number) {
  db.prepare(
    `INSERT INTO companies (cik, ticker, name, sic, is_active, first_seen, last_updated)
     VALUES (?, ?, ?, '3674', 1, '2026-08-09', '2026-08-09')`,
  ).run(cik, ticker, ticker)
  db.prepare(
    `INSERT INTO company_industry (cik, industry_slug, theme_slug, is_primary, source)
     VALUES (?, 'semiconductors', 'ai-software-semi', 1, 'sic')`,
  ).run(cik)
  const ins = db.prepare(
    `INSERT INTO financials (cik, period_end, period_type, revenue, gross_profit, computed_at)
     VALUES (?, ?, 'TTM', ?, ?, '2026-08-09')`,
  )
  const ends = ['2025-03-31', '2024-12-31', '2024-09-30', '2024-06-30', '2024-03-31']
  ends.forEach((e, i) => {
    const rev = i === 4 ? revenuePrior : revenueNow
    ins.run(cik, e, rev, rev * gm)
  })
  db.prepare(
    `INSERT INTO market_data (cik, date, price, shares_outstanding, market_cap)
     VALUES (?, '2026-08-08', 10, ?, ?)`,
  ).run(cik, marketCap / 10, marketCap)
}

// --- 아래는 브리프에 없는 픽스처. Task 21 브리프의 지시("각 브랜치를 짚어보고 테스트가
// 잘못됨을 잡아낼지 자문하라")에 따라 브리프 테스트가 건드리지 않는 분기를 커버하기 위해
// 추가했다. seed()는 그대로 두고 별도 헬퍼로 분리했다. ---

/** seed()와 동일하지만 산업을 지정할 수 있다 — 후보 3개 미만 산업의 백분위 게이트 테스트용. */
function seedInIndustry(
  db: Database.Database, cik: number, ticker: string, industrySlug: string,
  marketCap: number, revenueNow: number, revenuePrior: number, gm: number,
) {
  db.prepare(
    `INSERT INTO companies (cik, ticker, name, sic, is_active, first_seen, last_updated)
     VALUES (?, ?, ?, '3674', 1, '2026-08-09', '2026-08-09')`,
  ).run(cik, ticker, ticker)
  db.prepare(
    `INSERT INTO company_industry (cik, industry_slug, theme_slug, is_primary, source)
     VALUES (?, ?, 'ai-software-semi', 1, 'sic')`,
  ).run(cik, industrySlug)
  const ins = db.prepare(
    `INSERT INTO financials (cik, period_end, period_type, revenue, gross_profit, computed_at)
     VALUES (?, ?, 'TTM', ?, ?, '2026-08-09')`,
  )
  const ends = ['2025-03-31', '2024-12-31', '2024-09-30', '2024-06-30', '2024-03-31']
  ends.forEach((e, i) => {
    const rev = i === 4 ? revenuePrior : revenueNow
    ins.run(cik, e, rev, rev * gm)
  })
  db.prepare(
    `INSERT INTO market_data (cik, date, price, shares_outstanding, market_cap)
     VALUES (?, '2026-08-08', 10, ?, ?)`,
  ).run(cik, marketCap / 10, marketCap)
}

/** 재무·시세 데이터가 하나도 없는 기업 — 모든 팩터가 NO_DATA/NOT_IMPLEMENTED가 되어
 *  tenbagger가 null이 될 수밖에 없는 케이스를 만든다. */
function seedEmpty(db: Database.Database, cik: number, ticker: string, industrySlug: string) {
  db.prepare(
    `INSERT INTO companies (cik, ticker, name, sic, is_active, first_seen, last_updated)
     VALUES (?, ?, ?, '3674', 1, '2026-08-09', '2026-08-09')`,
  ).run(cik, ticker, ticker)
  db.prepare(
    `INSERT INTO company_industry (cik, industry_slug, theme_slug, is_primary, source)
     VALUES (?, ?, 'ai-software-semi', 1, 'sic')`,
  ).run(cik, industrySlug)
}

/** 현금 런웨이가 위험 수준이라 CRITICAL Red Flag가 뜨는 기업 — 이후 데이터를 고쳐
 *  같은 as_of에 재실행했을 때 이전 Red Flag가 남아있지 않은지 확인하는 데 쓴다. */
function seedRunwayCritical(db: Database.Database, cik: number, ticker: string, industrySlug: string) {
  db.prepare(
    `INSERT INTO companies (cik, ticker, name, sic, is_active, first_seen, last_updated)
     VALUES (?, ?, ?, '3674', 1, '2026-08-09', '2026-08-09')`,
  ).run(cik, ticker, ticker)
  db.prepare(
    `INSERT INTO company_industry (cik, industry_slug, theme_slug, is_primary, source)
     VALUES (?, ?, 'ai-software-semi', 1, 'sic')`,
  ).run(cik, industrySlug)
  db.prepare(
    `INSERT INTO financials (cik, period_end, period_type, revenue, gross_profit, fcf, cash, computed_at)
     VALUES (?, '2025-03-31', 'TTM', ?, ?, ?, ?, '2026-08-09')`,
  ).run(cik, 100e6, 70e6, -40e6, 10e6) // runway = 10e6 / (40e6/4) = 1분기 → CRITICAL(<2)
}

/** 희석 WARNING(연 30% 증가 — dilution_warning 0.15 초과, extreme_dilution 0.50 이하)만
 *  뜨는 기업. market_cap_opportunity의 게이트가 CRITICAL이 아닌 WARNING만으로도
 *  warning_multiplier를 적용하는지, 그리고 Quality Gate가 Tenbagger 엔진보다 먼저
 *  실행되는지를 검증하는 데 쓴다 (리뷰 Finding 1). */
function seedDilutionWarning(db: Database.Database, cik: number, ticker: string, industrySlug: string) {
  db.prepare(
    `INSERT INTO companies (cik, ticker, name, sic, is_active, first_seen, last_updated)
     VALUES (?, ?, ?, '3674', 1, '2026-08-09', '2026-08-09')`,
  ).run(cik, ticker, ticker)
  db.prepare(
    `INSERT INTO company_industry (cik, industry_slug, theme_slug, is_primary, source)
     VALUES (?, ?, 'ai-software-semi', 1, 'sic')`,
  ).run(cik, industrySlug)
  const ins = db.prepare(
    `INSERT INTO financials
       (cik, period_end, period_type, revenue, gross_profit, shares_diluted, computed_at)
     VALUES (?, ?, 'TTM', ?, ?, ?, '2026-08-09')`,
  )
  // 매출·매출총이익률은 5개 TTM 구간 모두 동일하게 둬서 GM_COLLAPSE 등 다른 플래그가
  // 섞여 들어오지 않게 한다. 매출 성장은 양수로 둬서 market_cap_opportunity 게이트가
  // 매출 조건으로 0이 되는 경로를 피한다 (revenueNow > revenuePrior).
  const ends = ['2025-03-31', '2024-12-31', '2024-09-30', '2024-06-30', '2024-03-31']
  const revenueNow = 1e9
  const revenuePrior = 0.9e9
  const gm = 0.6
  const dilutedNow = 130e6
  const dilutedPrior = 100e6 // (130/100 - 1) = 0.30 → dilution_warning(0.15) 초과, extreme(0.50) 이하
  ends.forEach((e, i) => {
    const rev = i === 4 ? revenuePrior : revenueNow
    const diluted = i === 4 ? dilutedPrior : dilutedNow
    ins.run(cik, e, rev, rev * gm, diluted)
  })
  db.prepare(
    `INSERT INTO market_data (cik, date, price, shares_outstanding, market_cap)
     VALUES (?, '2026-08-08', 10, ?, ?)`,
    // 시총 $2B → bands의 두 번째 구간(<$3B, 14점)에 들어간다
  ).run(cik, 2e9 / 10, 2e9)
}

beforeAll(async () => {
  raw = getRawDb(join(mkdtempSync(join(tmpdir(), 'tb-score-')), 'sc.db'))
  runMigrations(raw)
  seed(raw, 1, 'BIG', 300e9, 100e9, 90e9, 0.70)
  seed(raw, 2, 'MID', 8e9, 2e9, 1.5e9, 0.65)
  seed(raw, 3, 'SMALL', 900e6, 200e6, 130e6, 0.80)

  // 산업 후보 2개뿐 — min_industry_candidates(3) 미만이라 백분위를 저장하면 안 된다.
  seedInIndustry(raw, 10, 'ALPHA', 'software-infrastructure', 5e9, 1e9, 0.8e9, 0.60)
  seedInIndustry(raw, 11, 'BETA', 'software-infrastructure', 4e9, 0.9e9, 0.7e9, 0.55)

  // 재무·시세 데이터가 전혀 없음 — tenbagger가 null이어도 행은 남아야 한다.
  seedEmpty(raw, 20, 'EMPTY', 'semiconductor-equipment')

  // 재실행 시 Red Flag가 해소되는 시나리오용.
  seedRunwayCritical(raw, 30, 'FLAGGED', 'software-application')

  // WARNING 등급 희석 플래그 + 채점 구간에 들어가는 시총 — Quality Gate → Tenbagger
  // 엔진 순서를 검증하는 데 쓴다.
  seedDilutionWarning(raw, 40, 'DILUTED', 'cloud-computing')

  stats = await computeScores({ raw, cfg, taxonomy, asOf: '2026-08-09' })
})

describe('computeScores', () => {
  it('모든 유니버스 기업의 점수를 쓴다', () => {
    const n = raw.prepare('SELECT COUNT(*) c FROM scores').get() as { c: number }
    expect(n.c).toBe(8)
    expect(stats.scored).toBe(8)
  })

  it('팩터 9개를 score_factors에 남긴다', () => {
    const n = raw
      .prepare('SELECT COUNT(*) c FROM score_factors WHERE cik = 3')
      .get() as { c: number }
    expect(n.c).toBe(9)
  })

  it('분류 결과를 저장한다', () => {
    const rows = raw
      .prepare('SELECT cik, category FROM scores ORDER BY cik')
      .all() as { cik: number; category: string }[]
    expect(rows.find((r) => r.cik === 1)!.category).toBe('LEADER')
    expect(rows.find((r) => r.cik === 3)!.category).toBe('EMERGING')
  })

  it('소형 고성장주가 메가캡보다 높은 점수를 받는다', () => {
    const rows = raw
      .prepare('SELECT cik, tenbagger FROM scores')
      .all() as { cik: number; tenbagger: number }[]
    const big = rows.find((r) => r.cik === 1)!.tenbagger
    const small = rows.find((r) => r.cik === 3)!.tenbagger
    expect(small).toBeGreaterThan(big)
  })

  it('백분위를 저장한다', () => {
    const r = raw
      .prepare(
        "SELECT percentile FROM score_factors WHERE cik = 3 AND factor_key = 'gross_margin'",
      )
      .get() as { percentile: number | null }
    expect(r.percentile).toBeCloseTo(2 / 3)   // 0.80은 3개 중 2개보다 크다
  })

  it('engine_version에 config 해시를 포함한다', () => {
    const r = raw
      .prepare('SELECT engine_version FROM scores WHERE cik = 1')
      .get() as { engine_version: string }
    expect(r.engine_version).toMatch(/^tenbagger-1\.0\.0\+[0-9a-f]{8}$/)
  })

  it('분포 매핑이 없는 팩터는 백분위를 저장하지 않는다', () => {
    // tam_industry_growth는 SCORED 상태고 raw도 채워지지만 PERCENTILE_SOURCE에
    // 매핑이 없다 — 백분위는 항상 null이어야 한다.
    const r = raw
      .prepare(
        "SELECT raw, status, percentile FROM score_factors WHERE cik = 1 AND factor_key = 'tam_industry_growth'",
      )
      .get() as { raw: number | null; status: string; percentile: number | null }
    expect(r.status).toBe('SCORED')
    expect(r.raw).not.toBeNull()
    expect(r.percentile).toBeNull()
  })

  it('산업 후보가 min_industry_candidates 미만이면 백분위를 저장하지 않는다', () => {
    // software-infrastructure 산업은 후보가 2개뿐(cfg.scoring.min_industry_candidates=3
    // 미만)이라 revenue_growth가 SCORED여도 백분위는 저장되지 않아야 한다.
    const r = raw
      .prepare(
        "SELECT raw, status, percentile FROM score_factors WHERE cik = 10 AND factor_key = 'revenue_growth'",
      )
      .get() as { raw: number | null; status: string; percentile: number | null }
    expect(r.status).toBe('SCORED')
    expect(r.raw).not.toBeNull()
    expect(r.percentile).toBeNull()
  })

  it('점수를 낼 수 없는 기업도 tenbagger null로 행을 남긴다', () => {
    const r = raw
      .prepare('SELECT tenbagger, completeness FROM scores WHERE cik = 20')
      .get() as { tenbagger: number | null; completeness: number } | undefined
    expect(r).toBeDefined()
    expect(r!.tenbagger).toBeNull()
    expect(r!.completeness).toBe(0)
  })

  it('동일 as_of 재실행은 점수를 중복 없이 교체한다', async () => {
    const before = raw
      .prepare('SELECT COUNT(*) c FROM scores WHERE cik = 1 AND as_of = ?')
      .get('2026-08-09') as { c: number }
    expect(before.c).toBe(1)

    await computeScores({ raw, cfg, taxonomy, asOf: '2026-08-09' })

    const after = raw
      .prepare('SELECT COUNT(*) c FROM scores WHERE cik = 1 AND as_of = ?')
      .get('2026-08-09') as { c: number }
    expect(after.c).toBe(1)

    const totalRows = raw.prepare('SELECT COUNT(*) c FROM scores').get() as { c: number }
    expect(totalRows.c).toBe(8)
  })

  it('WARNING Red Flag가 market_cap_opportunity 게이트에 반영된다 (Quality Gate → Tenbagger 순서)', () => {
    // cik=40: 시총 $2B → bands[1](<$3B, 14점). 매출·매출성장 조건은 게이트를 0으로
    // 만들지 않는다. 유일한 Red Flag는 WARNING(30% 희석)이므로 게이트 배수는
    // warning_multiplier(0.5) — 손계산: 14 × 0.5 = 7.
    const flags = raw
      .prepare("SELECT code, severity FROM red_flags WHERE cik = 40 AND as_of = '2026-08-09'")
      .all() as { code: string; severity: string }[]
    expect(flags).toHaveLength(1)
    expect(flags[0]!.code).toBe('DILUTION')
    expect(flags[0]!.severity).toBe('WARNING')

    const factor = raw
      .prepare(
        "SELECT points FROM score_factors WHERE cik = 40 AND factor_key = 'market_cap_opportunity'",
      )
      .get() as { points: number }
    expect(factor.points).toBeCloseTo(7) // 14 × 0.5
  })

  it('같은 as_of 재실행 시 해소된 Red Flag는 남지 않는다', async () => {
    const before = raw
      .prepare("SELECT code FROM red_flags WHERE cik = 30 AND as_of = '2026-08-09'")
      .all() as { code: string }[]
    expect(before.some((f) => f.code === 'RUNWAY_CRITICAL')).toBe(true)

    // 현금을 크게 늘려 런웨이 문제를 해소한다.
    raw
      .prepare("UPDATE financials SET cash = 1e9 WHERE cik = 30 AND period_type = 'TTM'")
      .run()

    await computeScores({ raw, cfg, taxonomy, asOf: '2026-08-09' })

    const after = raw
      .prepare("SELECT code FROM red_flags WHERE cik = 30 AND as_of = '2026-08-09'")
      .all() as { code: string }[]
    expect(after.some((f) => f.code === 'RUNWAY_CRITICAL')).toBe(false)
  })

  it('as_of가 다르면 이력이 쌓이고 latest_scores는 1건만 준다', async () => {
    await computeScores({ raw, cfg, taxonomy, asOf: '2026-08-16' })
    const all = raw
      .prepare('SELECT COUNT(*) c FROM scores WHERE cik = 1')
      .get() as { c: number }
    const latest = raw
      .prepare('SELECT COUNT(*) c FROM latest_scores WHERE cik = 1')
      .get() as { c: number }
    expect(all.c).toBe(2)
    expect(latest.c).toBe(1)
  })

  it('job_runs에 성공 기록을 남긴다', () => {
    const r = raw
      .prepare("SELECT status FROM job_runs WHERE job='scores' ORDER BY id DESC")
      .get() as { status: string }
    expect(r.status).toBe('succeeded')
  })
})

describe('computeScores — valuations', () => {
  it('점수와 함께 회사당 한 행씩 valuations를 쓴다', () => {
    const n = raw
      .prepare('SELECT COUNT(*) c FROM valuations WHERE as_of = ?')
      .get('2026-08-09') as { c: number }
    expect(n.c).toBe(8)
  })

  it('FCF·영업이익 데이터가 없는 시드 기업은 NOT_CASH_GENERATIVE로 INSUFFICIENT_DATA를 남긴다', () => {
    // seed()는 revenue·gross_profit만 채우고 operating_income·fcf는 비워 둔다 — 현금전환
    // 증거가 전혀 없는 기업이 valuations에서도 조용히 숫자를 얻지 않는지 확인한다.
    const r = raw
      .prepare('SELECT fair_value_status, fair_value_reason FROM valuations WHERE cik = 1 AND as_of = ?')
      .get('2026-08-09') as { fair_value_status: string; fair_value_reason: string | null }
    expect(r.fair_value_status).toBe('INSUFFICIENT_DATA')
    expect(r.fair_value_reason).toBe('NOT_CASH_GENERATIVE')
  })

  it('engine_version에 valuation config 해시를 포함한다', () => {
    const r = raw
      .prepare('SELECT engine_version FROM valuations WHERE cik = 1 AND as_of = ?')
      .get('2026-08-09') as { engine_version: string }
    expect(r.engine_version).toMatch(/^valuation-1\.0\.0\+[0-9a-f]{8}$/)
  })

  it('동일 as_of 재실행은 valuations도 중복 없이 교체한다', async () => {
    await computeScores({ raw, cfg, taxonomy, asOf: '2026-08-09' })
    const n = raw
      .prepare('SELECT COUNT(*) c FROM valuations WHERE as_of = ?')
      .get('2026-08-09') as { c: number }
    expect(n.c).toBe(8)
  })
})

describe('valuationConfigHash', () => {
  it('valuation 섹션과 무관한 설정이 달라도 해시는 같다', () => {
    const a = structuredClone(cfg)
    const b = structuredClone(cfg)
    b.scoring.wacc_assumption = a.scoring.wacc_assumption + 0.01
    expect(valuationConfigHash(b)).toBe(valuationConfigHash(a))
  })

  it('valuation 섹션 값이 다르면 해시도 다르다', () => {
    const a = structuredClone(cfg)
    const b = structuredClone(cfg)
    b.valuation.mature_fcf_margin = a.valuation.mature_fcf_margin + 0.01
    expect(valuationConfigHash(b)).not.toBe(valuationConfigHash(a))
  })
})

describe('configHash', () => {
  // engine_version은 "회사가 바뀌었나"와 "채점 규칙이 바뀌었나"를 구분하는 용도다.
  // scoring/classification 밖의 설정이 바뀌어도 해시가 바뀌면 잘못된 "규칙 변경" 신호를
  // 심게 되므로, 채점과 무관한 섹션은 해시에서 제외돼야 한다 (리뷰 Finding 2).
  it('scoring/classification과 무관한 설정(ingest)이 달라도 해시는 같다', () => {
    const a = structuredClone(cfg)
    const b = structuredClone(cfg)
    b.ingest.sec_rate_limit_per_sec = a.ingest.sec_rate_limit_per_sec + 1
    b.staleness.price_days = a.staleness.price_days + 1
    expect(configHash(b)).toBe(configHash(a))
  })

  it('scoring 곡선 값이 다르면 해시도 다르다', () => {
    const a = structuredClone(cfg)
    const b = structuredClone(cfg)
    const point = b.scoring.factors.revenue_growth.curve[0]!
    point[1] = point[1] + 0.01
    expect(configHash(b)).not.toBe(configHash(a))
  })

  it('classification 임계값이 다르면 해시도 다르다', () => {
    const a = structuredClone(cfg)
    const b = structuredClone(cfg)
    b.classification.leader_ratio_of_max = a.classification.leader_ratio_of_max + 0.01
    expect(configHash(b)).not.toBe(configHash(a))
  })
})
