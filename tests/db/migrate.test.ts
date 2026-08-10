import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { getRawDb, runMigrations } from '@/db/client'

let raw: Database.Database

beforeAll(() => {
  const dbPath = join(mkdtempSync(join(tmpdir(), 'tb-')), 'test.db')
  raw = getRawDb(dbPath)
  runMigrations(raw)
})

const EXPECTED_TABLES = [
  'companies', 'listings', 'financial_facts', 'market_data',
  'financials', 'company_industry', 'scores', 'score_factors',
  'red_flags', 'valuations', 'themes', 'industries', 'job_runs',
]

describe('마이그레이션', () => {
  it('테이블 13개를 생성한다', () => {
    const rows = raw
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as { name: string }[]
    const names = rows.map((r) => r.name)
    for (const t of EXPECTED_TABLES) expect(names).toContain(t)
  })

  it('latest_scores 뷰를 생성한다', () => {
    const rows = raw
      .prepare("SELECT name FROM sqlite_master WHERE type='view'")
      .all() as { name: string }[]
    expect(rows.map((r) => r.name)).toContain('latest_scores')
  })

  it('latest_valuations 뷰를 생성한다', () => {
    const rows = raw
      .prepare("SELECT name FROM sqlite_master WHERE type='view'")
      .all() as { name: string }[]
    expect(rows.map((r) => r.name)).toContain('latest_valuations')
  })

  it('두 번 실행해도 실패하지 않는다', () => {
    expect(() => runMigrations(raw)).not.toThrow()
  })

  it('scores는 (cik, as_of) 복합키로 이력을 누적한다', () => {
    const ins = raw.prepare(
      `INSERT INTO scores (cik, as_of, tenbagger, completeness, category, engine_version)
       VALUES (?, ?, ?, 0.95, 'EMERGING', 'v1')`,
    )
    ins.run(1, '2026-08-01', 70)
    ins.run(1, '2026-08-08', 78)
    const n = raw
      .prepare('SELECT COUNT(*) c FROM scores WHERE cik = 1')
      .get() as { c: number }
    expect(n.c).toBe(2)
  })

  it('latest_scores는 CIK당 최신 1건만 반환한다', () => {
    const rows = raw
      .prepare('SELECT * FROM latest_scores WHERE cik = 1')
      .all() as { as_of: string; tenbagger: number }[]
    expect(rows).toHaveLength(1)
    expect(rows[0]!.as_of).toBe('2026-08-08')
    expect(rows[0]!.tenbagger).toBe(78)
  })

  it('valuations는 (cik, as_of) 복합키로 이력을 누적한다', () => {
    const ins = raw.prepare(
      `INSERT INTO valuations (
         cik, as_of,
         fair_value_status, fair_value_detail,
         price_to_fair_value_status,
         moat_signal, moat_periods_evaluated, moat_periods_clearing, moat_evidence,
         uncertainty_level, uncertainty_score, uncertainty_drivers,
         engine_version
       ) VALUES (?, ?, 'INSUFFICIENT_DATA', 'd', 'UNAVAILABLE', 'INSUFFICIENT_DATA', 0, 0, '[]', 'HIGH', 0.6, '[]', 'v1')`,
    )
    ins.run(2, '2026-08-01')
    ins.run(2, '2026-08-08')
    const n = raw
      .prepare('SELECT COUNT(*) c FROM valuations WHERE cik = 2')
      .get() as { c: number }
    expect(n.c).toBe(2)
  })

  it('latest_valuations는 CIK당 최신 1건만 반환한다', () => {
    const rows = raw
      .prepare('SELECT * FROM latest_valuations WHERE cik = 2')
      .all() as { as_of: string }[]
    expect(rows).toHaveLength(1)
    expect(rows[0]!.as_of).toBe('2026-08-08')
  })

  it('financial_facts는 중복 사실을 거부한다', () => {
    const ins = () =>
      raw
        .prepare(
          `INSERT INTO financial_facts
             (cik, tag, unit, period_start, period_end, qtrs, value, form, filed_date, accession, source)
           VALUES (1,'Revenues','USD','2025-01-01','2025-03-31',1,100,'10-Q','2025-05-01','a-1','api')`,
        )
        .run()
    ins()
    expect(ins).toThrow(/UNIQUE/i)
  })

  it('period_type과 source는 CHECK 제약으로 오타를 거부한다', () => {
    expect(() =>
      raw
        .prepare(
          `INSERT INTO financials (cik, period_end, period_type, computed_at)
           VALUES (1, '2025-03-31', 'YEARLY', '2026-08-09')`,
        )
        .run(),
    ).toThrow(/CHECK/i)
  })
})

describe('마이그레이션 — market_data.shares_basis', () => {
  it('CHECK 제약으로 reported/diluted_fallback 외의 값을 거부한다', () => {
    raw.prepare(
      `INSERT INTO companies (cik, ticker, name, is_active, first_seen, last_updated)
       VALUES (777, 'CHK', 'Check Inc', 1, '2026-08-09', '2026-08-09')`,
    ).run()
    expect(() =>
      raw
        .prepare(
          `INSERT INTO market_data (cik, date, shares_basis) VALUES (777, '2026-08-08', 'guess')`,
        )
        .run(),
    ).toThrow(/CHECK/i)
  })

  it('reported/diluted_fallback/NULL은 허용한다', () => {
    raw.prepare(
      `INSERT INTO companies (cik, ticker, name, is_active, first_seen, last_updated)
       VALUES (778, 'CHK2', 'Check2 Inc', 1, '2026-08-09', '2026-08-09')`,
    ).run()
    expect(() =>
      raw
        .prepare(
          `INSERT INTO market_data (cik, date, shares_basis) VALUES (778, '2026-08-08', 'diluted_fallback')`,
        )
        .run(),
    ).not.toThrow()
  })
})

describe('마이그레이션 — state_of_incorporation 컬럼의 사후 추가(ALTER TABLE)', () => {
  /**
   * CREATE TABLE IF NOT EXISTS는 companies 테이블이 이미 존재하는(phase1 이전에
   * 만들어진) DB에서는 아무 것도 하지 않는다 — 이 컬럼을 갖기 전의 DB를 직접
   * 만들어서 runMigrations가 ALTER TABLE로 채워 넣는지, 그리고 두 번 실행해도
   * (컬럼이 이미 있는 상태에서) 실패하지 않는지 확인한다.
   */
  function makeLegacyDb(): Database.Database {
    const dbPath = join(mkdtempSync(join(tmpdir(), 'tb-legacy-')), 'legacy.db')
    const db = getRawDb(dbPath)
    db.exec(`
      CREATE TABLE companies (
        cik INTEGER PRIMARY KEY,
        ticker TEXT NOT NULL,
        name TEXT NOT NULL,
        sic TEXT,
        sic_description TEXT,
        exchange TEXT,
        entity_type TEXT,
        fiscal_year_end TEXT,
        filer_category TEXT,
        is_active INTEGER NOT NULL DEFAULT 1,
        first_seen TEXT NOT NULL,
        last_updated TEXT NOT NULL
      );
    `)
    return db
  }

  it('컬럼이 없는 기존 DB에 ALTER TABLE로 두 컬럼을 추가한다', () => {
    const legacy = makeLegacyDb()
    runMigrations(legacy)
    const cols = (legacy.prepare('PRAGMA table_info(companies)').all() as { name: string }[]).map(
      (c) => c.name,
    )
    expect(cols).toContain('state_of_incorporation')
    expect(cols).toContain('state_of_incorporation_description')
  })

  it('ALTER TABLE은 멱등이다 — 두 번 실행해도 실패하지 않는다', () => {
    const legacy = makeLegacyDb()
    expect(() => runMigrations(legacy)).not.toThrow()
    expect(() => runMigrations(legacy)).not.toThrow()
  })

  it('신규 DB는 CREATE TABLE 시점부터 두 컬럼을 이미 갖고 있다(ALTER가 필요 없다)', () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), 'tb-fresh-')), 'fresh.db')
    const fresh = getRawDb(dbPath)
    runMigrations(fresh)
    const cols = (fresh.prepare('PRAGMA table_info(companies)').all() as { name: string }[]).map(
      (c) => c.name,
    )
    expect(cols).toContain('state_of_incorporation')
    expect(cols).toContain('state_of_incorporation_description')
  })
})

describe('마이그레이션 — market_data.shares_basis 컬럼의 사후 추가(ALTER TABLE)', () => {
  /**
   * 라이브 DB는 이미 market_data 테이블을 갖고 있으므로 CREATE TABLE IF NOT EXISTS로는
   * shares_basis 컬럼이 채워지지 않는다 — state_of_incorporation과 같은 모양의 문제라
   * 같은 검증(ALTER 적용 + 멱등 + 신규 DB는 이미 갖고 있음)을 반복한다.
   */
  function makeLegacyMarketDataDb(): Database.Database {
    const dbPath = join(mkdtempSync(join(tmpdir(), 'tb-legacy-md-')), 'legacy.db')
    const db = getRawDb(dbPath)
    db.exec(`
      CREATE TABLE market_data (
        cik INTEGER NOT NULL,
        date TEXT NOT NULL,
        price REAL,
        shares_outstanding REAL,
        market_cap REAL,
        volume REAL,
        PRIMARY KEY (cik, date)
      );
    `)
    return db
  }

  it('컬럼이 없는 기존 DB에 ALTER TABLE로 shares_basis를 추가한다', () => {
    const legacy = makeLegacyMarketDataDb()
    runMigrations(legacy)
    const cols = (legacy.prepare('PRAGMA table_info(market_data)').all() as { name: string }[]).map(
      (c) => c.name,
    )
    expect(cols).toContain('shares_basis')
  })

  it('ALTER TABLE은 멱등이다 — 두 번 실행해도 실패하지 않는다', () => {
    const legacy = makeLegacyMarketDataDb()
    expect(() => runMigrations(legacy)).not.toThrow()
    expect(() => runMigrations(legacy)).not.toThrow()
  })

  it('신규 DB는 CREATE TABLE 시점부터 shares_basis를 이미 갖고 있다(ALTER가 필요 없다)', () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), 'tb-fresh-md-')), 'fresh.db')
    const fresh = getRawDb(dbPath)
    runMigrations(fresh)
    const cols = (fresh.prepare('PRAGMA table_info(market_data)').all() as { name: string }[]).map(
      (c) => c.name,
    )
    expect(cols).toContain('shares_basis')
  })
})
