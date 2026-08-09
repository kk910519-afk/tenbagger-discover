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
