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
  'companies', 'listings', 'financial_facts', 'ingest_tag_state', 'market_data',
  'financials', 'company_industry', 'scores', 'score_factors',
  'red_flags', 'valuations', 'themes', 'industries', 'job_runs',
]

describe('마이그레이션', () => {
  it('테이블 14개를 생성한다', () => {
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
       ) VALUES (?, ?, 'INSUFFICIENT_DATA', 'd', 'UNAVAILABLE', 'INSUFFICIENT_DATA', 0, 0, '[]', 'ELEVATED', 0.6, '[]', 'v1')`,
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

/**
 * 등급 개명(WIDE/NARROW/NONE → PERSISTENT/INTERMITTENT/ABSENT,
 * LOW/MEDIUM/HIGH/VERY_HIGH → MINIMAL/MODERATE/ELEVATED/SEVERE) 마이그레이션.
 *
 * 개명은 **아무도 옮기지 않아야 한다** — 매핑이 1:1인지, INSUFFICIENT_DATA와 그 세 사유가
 * 그대로인지, 나머지 컬럼이 한 글자도 변하지 않는지를 옛 모양의 DB를 실제로 만들어
 * 확인한다. 라이브 DB는 파이프라인 재실행으로 곧 덮이므로 이 경로를 검증하는 곳은 여기다.
 */
describe('마이그레이션 — 등급 개명', () => {
  const OLD_VALUATIONS_DDL = `
    CREATE TABLE valuations (
      cik INTEGER NOT NULL,
      as_of TEXT NOT NULL,
      fair_value_status TEXT NOT NULL CHECK (fair_value_status IN ('OK','INSUFFICIENT_DATA')),
      fair_value_reason TEXT,
      fair_value_per_share REAL,
      fair_value_assumptions TEXT,
      fair_value_detail TEXT NOT NULL,
      price_to_fair_value_status TEXT NOT NULL CHECK (price_to_fair_value_status IN ('OK','UNAVAILABLE')),
      price_to_fair_value_ratio REAL,
      margin_of_safety REAL,
      valuation_status TEXT CHECK (valuation_status IN ('UNDERVALUED','FAIRLY_VALUED','OVERVALUED')),
      moat_signal TEXT NOT NULL CHECK (moat_signal IN ('WIDE','NARROW','NONE','INSUFFICIENT_DATA')),
      moat_periods_evaluated INTEGER NOT NULL,
      moat_periods_clearing INTEGER NOT NULL,
      moat_insufficient_reason TEXT CHECK (moat_insufficient_reason IN ('TOO_FEW_PERIODS','MISSING_FINANCIALS','NOT_APPLICABLE')),
      moat_evidence TEXT NOT NULL,
      uncertainty_level TEXT NOT NULL CHECK (uncertainty_level IN ('LOW','MEDIUM','HIGH','VERY_HIGH')),
      uncertainty_score REAL NOT NULL,
      uncertainty_drivers TEXT NOT NULL,
      engine_version TEXT NOT NULL,
      PRIMARY KEY (cik, as_of)
    );
    CREATE VIEW latest_valuations AS
    SELECT v.* FROM valuations v
    JOIN (SELECT cik, MAX(as_of) AS as_of FROM valuations GROUP BY cik) m
      ON v.cik = m.cik AND v.as_of = m.as_of;`

  // 옛 이름 → 새 이름. 이 표가 곧 "아무도 움직이지 않는다"의 정의다.
  const MOAT_MAP: [string, string][] = [
    ['WIDE', 'PERSISTENT'],
    ['NARROW', 'INTERMITTENT'],
    ['NONE', 'ABSENT'],
    ['INSUFFICIENT_DATA', 'INSUFFICIENT_DATA'],
  ]
  const UNCERTAINTY_MAP: [string, string][] = [
    ['LOW', 'MINIMAL'],
    ['MEDIUM', 'MODERATE'],
    ['HIGH', 'ELEVATED'],
    ['VERY_HIGH', 'SEVERE'],
  ]

  function makeLegacyValuationsDb(): Database.Database {
    const dbPath = join(mkdtempSync(join(tmpdir(), 'tb-legacy-val-')), 'legacy.db')
    const db = getRawDb(dbPath)
    db.exec(OLD_VALUATIONS_DDL)
    const ins = db.prepare(
      `INSERT INTO valuations (
         cik, as_of, fair_value_status, fair_value_reason, fair_value_per_share,
         fair_value_assumptions, fair_value_detail,
         price_to_fair_value_status, price_to_fair_value_ratio, margin_of_safety, valuation_status,
         moat_signal, moat_periods_evaluated, moat_periods_clearing, moat_insufficient_reason, moat_evidence,
         uncertainty_level, uncertainty_score, uncertainty_drivers, engine_version
       ) VALUES (?, '2026-08-01', 'OK', NULL, 42.5, '{"a":1}', 'detail',
                 'OK', 0.8, 0.2, 'UNDERVALUED',
                 ?, 8, 7, NULL, '["e"]',
                 ?, 0.33, '[]', 'valuation-1.3.0+deadbeef')`,
    )
    // 4 x 4 = 16개 조합을 전부 넣는다 — 어느 한 칸이라도 잘못 옮겨지면 걸린다.
    let cik = 1
    for (const [oldMoat] of MOAT_MAP) {
      for (const [oldLevel] of UNCERTAINTY_MAP) {
        ins.run(cik++, oldMoat, oldLevel)
      }
    }
    // INSUFFICIENT_DATA의 세 사유는 별도 행으로 둔다 — 개명이 이 구분을 뭉개면 안 된다.
    const insReason = db.prepare(
      `INSERT INTO valuations (
         cik, as_of, fair_value_status, fair_value_detail, price_to_fair_value_status,
         moat_signal, moat_periods_evaluated, moat_periods_clearing, moat_insufficient_reason,
         moat_evidence, uncertainty_level, uncertainty_score, uncertainty_drivers, engine_version
       ) VALUES (?, '2026-08-01', 'INSUFFICIENT_DATA', 'd', 'UNAVAILABLE',
                 'INSUFFICIENT_DATA', 0, 0, ?, '[]', 'VERY_HIGH', 1.0, '[]', 'v')`,
    )
    for (const reason of ['TOO_FEW_PERIODS', 'MISSING_FINANCIALS', 'NOT_APPLICABLE']) {
      insReason.run(cik++, reason)
    }
    return db
  }

  it('옛 등급 이름을 1:1로 옮긴다 — 어떤 행의 소속도 바뀌지 않는다', () => {
    const legacy = makeLegacyValuationsDb()
    const before = legacy
      .prepare('SELECT cik, moat_signal, uncertainty_level FROM valuations ORDER BY cik')
      .all() as { cik: number; moat_signal: string; uncertainty_level: string }[]

    runMigrations(legacy)

    const after = legacy
      .prepare('SELECT cik, moat_signal, uncertainty_level FROM valuations ORDER BY cik')
      .all() as { cik: number; moat_signal: string; uncertainty_level: string }[]

    const moat = new Map(MOAT_MAP)
    const level = new Map(UNCERTAINTY_MAP)
    expect(before).toHaveLength(19)
    expect(after).toHaveLength(before.length)
    for (let i = 0; i < before.length; i++) {
      expect(after[i]!.cik).toBe(before[i]!.cik)
      expect(after[i]!.moat_signal).toBe(moat.get(before[i]!.moat_signal))
      expect(after[i]!.uncertainty_level).toBe(level.get(before[i]!.uncertainty_level))
    }
    // 새 어휘만 남고 옛 어휘는 한 행도 남지 않는다
    const vocab = legacy
      .prepare('SELECT DISTINCT moat_signal m, uncertainty_level u FROM valuations')
      .all() as { m: string; u: string }[]
    for (const v of vocab) {
      expect(['PERSISTENT', 'INTERMITTENT', 'ABSENT', 'INSUFFICIENT_DATA']).toContain(v.m)
      expect(['MINIMAL', 'MODERATE', 'ELEVATED', 'SEVERE']).toContain(v.u)
    }
  })

  it('ABSENT는 INSUFFICIENT_DATA로 흡수되지 않는다 — 세 사유도 그대로 남는다', () => {
    const legacy = makeLegacyValuationsDb()
    runMigrations(legacy)
    const absent = legacy
      .prepare(`SELECT COUNT(*) c FROM valuations WHERE moat_signal = 'ABSENT'`)
      .get() as { c: number }
    expect(absent.c).toBe(4) // NONE x 불확실성 4단계
    const insufficient = legacy
      .prepare(`SELECT COUNT(*) c FROM valuations WHERE moat_signal = 'INSUFFICIENT_DATA'`)
      .get() as { c: number }
    expect(insufficient.c).toBe(7) // 원래 4 + 사유별 3
    const reasons = legacy
      .prepare(
        `SELECT moat_insufficient_reason r FROM valuations
         WHERE moat_insufficient_reason IS NOT NULL ORDER BY r`,
      )
      .all() as { r: string }[]
    expect(reasons.map((x) => x.r)).toEqual([
      'MISSING_FINANCIALS',
      'NOT_APPLICABLE',
      'TOO_FEW_PERIODS',
    ])
    // ABSENT 행에는 사유가 붙지 않는다 — 판정이 난 등급이기 때문이다
    const absentReason = legacy
      .prepare(
        `SELECT COUNT(*) c FROM valuations
         WHERE moat_signal = 'ABSENT' AND moat_insufficient_reason IS NOT NULL`,
      )
      .get() as { c: number }
    expect(absentReason.c).toBe(0)
  })

  it('등급 외의 컬럼은 한 글자도 바뀌지 않는다', () => {
    const legacy = makeLegacyValuationsDb()
    const cols = `cik, as_of, fair_value_status, fair_value_reason, fair_value_per_share,
       fair_value_assumptions, fair_value_detail, price_to_fair_value_status,
       price_to_fair_value_ratio, margin_of_safety, valuation_status,
       moat_periods_evaluated, moat_periods_clearing, moat_insufficient_reason,
       moat_evidence, uncertainty_score, uncertainty_drivers, engine_version`
    const before = legacy.prepare(`SELECT ${cols} FROM valuations ORDER BY cik`).all()
    runMigrations(legacy)
    const after = legacy.prepare(`SELECT ${cols} FROM valuations ORDER BY cik`).all()
    expect(after).toEqual(before)
  })

  it('멱등이다 — 두 번 실행해도 값이 다시 움직이지 않는다', () => {
    const legacy = makeLegacyValuationsDb()
    runMigrations(legacy)
    const once = legacy.prepare('SELECT * FROM valuations ORDER BY cik').all()
    expect(() => runMigrations(legacy)).not.toThrow()
    expect(legacy.prepare('SELECT * FROM valuations ORDER BY cik').all()).toEqual(once)
  })

  it('CHECK 제약과 latest_valuations 뷰가 새 어휘로 다시 만들어진다', () => {
    const legacy = makeLegacyValuationsDb()
    runMigrations(legacy)
    const ddl = legacy
      .prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='valuations'`)
      .get() as { sql: string }
    expect(ddl.sql).toContain(`'PERSISTENT'`)
    expect(ddl.sql).toContain(`'SEVERE'`)
    expect(ddl.sql).not.toContain(`'WIDE'`)
    expect(ddl.sql).not.toContain(`'VERY_HIGH'`)
    // 옛 어휘는 이제 저장 자체가 거부된다
    expect(() =>
      legacy.exec(
        `INSERT INTO valuations (cik, as_of, fair_value_status, fair_value_detail,
           price_to_fair_value_status, moat_signal, moat_periods_evaluated, moat_periods_clearing,
           moat_evidence, uncertainty_level, uncertainty_score, uncertainty_drivers, engine_version)
         VALUES (9001, '2026-08-02', 'INSUFFICIENT_DATA', 'd', 'UNAVAILABLE', 'WIDE', 0, 0, '[]', 'LOW', 0.1, '[]', 'v')`,
      ),
    ).toThrow()
    // 임시 테이블은 남지 않고 뷰는 살아 있다
    const left = legacy
      .prepare(`SELECT COUNT(*) c FROM sqlite_master WHERE name LIKE '%pre_tier_rename%'`)
      .get() as { c: number }
    expect(left.c).toBe(0)
    const view = legacy
      .prepare(`SELECT COUNT(*) c FROM sqlite_master WHERE type='view' AND name='latest_valuations'`)
      .get() as { c: number }
    expect(view.c).toBe(1)
  })
})
