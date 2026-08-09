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
`

export function runMigrations(raw: Database.Database): void {
  raw.exec(DDL)
}
