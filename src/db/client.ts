import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import * as schema from './schema.js'

export function getRawDb(
  path = process.env.DATABASE_PATH ?? './data/tenbagger.db',
): Database.Database {
  mkdirSync(dirname(path), { recursive: true })
  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  return db
}

export function getDb(path?: string) {
  return drizzle(getRawDb(path), { schema })
}

const DDL = `
CREATE TABLE IF NOT EXISTS companies (
  cik INTEGER PRIMARY KEY,
  ticker TEXT NOT NULL,
  name TEXT NOT NULL,
  sic TEXT,
  sic_description TEXT,
  exchange TEXT,
  entity_type TEXT,
  fiscal_year_end TEXT,
  filer_category TEXT,
  state_of_incorporation TEXT,
  state_of_incorporation_description TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  first_seen TEXT NOT NULL,
  last_updated TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_ticker ON companies(ticker);

CREATE TABLE IF NOT EXISTS listings (
  ticker TEXT PRIMARY KEY,
  exchange TEXT NOT NULL,
  security_name TEXT NOT NULL,
  is_etf INTEGER NOT NULL,
  is_test_issue INTEGER NOT NULL,
  financial_status TEXT,
  round_lot INTEGER,
  last_updated TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS financial_facts (
  cik INTEGER NOT NULL,
  tag TEXT NOT NULL,
  unit TEXT NOT NULL,
  period_start TEXT,
  period_end TEXT NOT NULL,
  qtrs INTEGER NOT NULL,
  value REAL NOT NULL,
  form TEXT NOT NULL,
  filed_date TEXT NOT NULL,
  accession TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('bulk','api')),
  UNIQUE (cik, tag, period_end, qtrs, form)
);
CREATE INDEX IF NOT EXISTS idx_facts_cik_tag ON financial_facts(cik, tag, period_end);

CREATE TABLE IF NOT EXISTS market_data (
  cik INTEGER NOT NULL,
  date TEXT NOT NULL,
  price REAL,
  shares_outstanding REAL,
  market_cap REAL,
  volume REAL,
  shares_basis TEXT CHECK (shares_basis IN ('reported','diluted_fallback')),
  PRIMARY KEY (cik, date)
);

CREATE TABLE IF NOT EXISTS financials (
  cik INTEGER NOT NULL,
  period_end TEXT NOT NULL,
  period_type TEXT NOT NULL CHECK (period_type IN ('Q','A','TTM')),
  revenue REAL, gross_profit REAL, operating_income REAL, net_income REAL,
  ocf REAL, capex REAL, fcf REAL,
  cash REAL, total_debt REAL, equity REAL,
  shares_diluted REAL, shares_outstanding REAL, sbc REAL, rd_expense REAL,
  source_tags TEXT,
  computed_at TEXT NOT NULL,
  PRIMARY KEY (cik, period_end, period_type)
);

CREATE TABLE IF NOT EXISTS company_industry (
  cik INTEGER NOT NULL,
  industry_slug TEXT NOT NULL,
  theme_slug TEXT NOT NULL,
  is_primary INTEGER NOT NULL DEFAULT 1,
  source TEXT NOT NULL CHECK (source IN ('sic','override')),
  PRIMARY KEY (cik, industry_slug)
);

CREATE TABLE IF NOT EXISTS scores (
  cik INTEGER NOT NULL,
  as_of TEXT NOT NULL,
  tenbagger REAL,
  completeness REAL NOT NULL,
  category TEXT,
  engine_version TEXT NOT NULL,
  PRIMARY KEY (cik, as_of)
);

CREATE TABLE IF NOT EXISTS score_factors (
  cik INTEGER NOT NULL,
  as_of TEXT NOT NULL,
  engine TEXT NOT NULL,
  factor_key TEXT NOT NULL,
  raw REAL,
  points REAL,
  weight REAL NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('SCORED','NO_DATA','NOT_IMPLEMENTED')),
  percentile REAL,
  detail TEXT NOT NULL,
  PRIMARY KEY (cik, as_of, engine, factor_key)
);

CREATE TABLE IF NOT EXISTS red_flags (
  cik INTEGER NOT NULL,
  as_of TEXT NOT NULL,
  code TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('CRITICAL','WARNING')),
  message TEXT NOT NULL,
  evidence TEXT,
  PRIMARY KEY (cik, as_of, code)
);

CREATE TABLE IF NOT EXISTS valuations (
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
  moat_evidence TEXT NOT NULL,
  uncertainty_level TEXT NOT NULL CHECK (uncertainty_level IN ('LOW','MEDIUM','HIGH','VERY_HIGH')),
  uncertainty_score REAL NOT NULL,
  uncertainty_drivers TEXT NOT NULL,
  engine_version TEXT NOT NULL,
  PRIMARY KEY (cik, as_of)
);

CREATE TABLE IF NOT EXISTS themes (
  slug TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  display_order INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS industries (
  slug TEXT PRIMARY KEY,
  theme_slug TEXT NOT NULL,
  name TEXT NOT NULL,
  tam_usd REAL, tam_cagr REAL, tam_source TEXT, tam_as_of TEXT
);

CREATE TABLE IF NOT EXISTS job_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL,
  stats TEXT,
  error TEXT
);

CREATE VIEW IF NOT EXISTS latest_scores AS
SELECT s.* FROM scores s
JOIN (SELECT cik, MAX(as_of) AS as_of FROM scores GROUP BY cik) m
  ON s.cik = m.cik AND s.as_of = m.as_of;

-- valuations도 scores와 같은 (cik, as_of) append-only 모양이다 — 같은 "최신 1건" 패턴을
-- 그대로 복제한다. UI는 이 뷰를 LEFT JOIN해서 읽어야 한다(INNER JOIN하면 아직 밸류에이션이
-- 없는 회사가 종목 상세에서 통째로 사라진다).
CREATE VIEW IF NOT EXISTS latest_valuations AS
SELECT v.* FROM valuations v
JOIN (SELECT cik, MAX(as_of) AS as_of FROM valuations GROUP BY cik) m
  ON v.cik = m.cik AND v.as_of = m.as_of;
`

/**
 * companies.state_of_incorporation(_description)은 phase1 이후에 추가된 컬럼이다.
 * 위 DDL의 CREATE TABLE IF NOT EXISTS는 신규 DB에는 반영되지만, 이미 companies
 * 테이블이 존재하는 기존 DB에서는 아무 일도 하지 않는다 — 그런 DB를 위해 컬럼
 * 존재 여부를 확인하고 없을 때만 ALTER TABLE로 추가한다. PRAGMA table_info로
 * 먼저 확인하므로 여러 번 호출해도 안전하다(멱등).
 */
function ensureColumn(
  raw: Database.Database,
  table: string,
  column: string,
  columnDdl: string,
): void {
  const cols = raw.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  if (!cols.some((c) => c.name === column)) {
    raw.exec(`ALTER TABLE ${table} ADD COLUMN ${columnDdl}`)
  }
}

export function runMigrations(raw: Database.Database): void {
  raw.exec(DDL)
  ensureColumn(raw, 'companies', 'state_of_incorporation', 'state_of_incorporation TEXT')
  ensureColumn(
    raw,
    'companies',
    'state_of_incorporation_description',
    'state_of_incorporation_description TEXT',
  )
  // shares_basis도 같은 이유로 사후 추가된 컬럼이다 — 이미 market_data 테이블이 있는
  // 기존(라이브) DB에는 CREATE TABLE IF NOT EXISTS가 아무 일도 하지 않으므로 별도로 채운다.
  ensureColumn(
    raw,
    'market_data',
    'shares_basis',
    `shares_basis TEXT CHECK (shares_basis IN ('reported','diluted_fallback'))`,
  )
}
