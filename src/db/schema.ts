import { sqliteTable, text, integer, real, primaryKey } from 'drizzle-orm/sqlite-core'

export const companies = sqliteTable('companies', {
  cik: integer('cik').primaryKey(),
  ticker: text('ticker').notNull(),
  name: text('name').notNull(),
  sic: text('sic'),
  sicDescription: text('sic_description'),
  exchange: text('exchange'),
  entityType: text('entity_type'),
  fiscalYearEnd: text('fiscal_year_end'),
  filerCategory: text('filer_category'),
  isActive: integer('is_active').notNull().default(1),
  firstSeen: text('first_seen').notNull(),
  lastUpdated: text('last_updated').notNull(),
})

export const listings = sqliteTable('listings', {
  ticker: text('ticker').primaryKey(),
  exchange: text('exchange').notNull(),
  securityName: text('security_name').notNull(),
  isEtf: integer('is_etf').notNull(),
  isTestIssue: integer('is_test_issue').notNull(),
  financialStatus: text('financial_status'),
  roundLot: integer('round_lot'),
  lastUpdated: text('last_updated').notNull(),
})

export const financialFacts = sqliteTable('financial_facts', {
  cik: integer('cik').notNull(),
  tag: text('tag').notNull(),
  unit: text('unit').notNull(),
  periodStart: text('period_start'),
  periodEnd: text('period_end').notNull(),
  qtrs: integer('qtrs').notNull(),
  value: real('value').notNull(),
  form: text('form').notNull(),
  filedDate: text('filed_date').notNull(),
  accession: text('accession').notNull(),
  source: text('source').notNull(),
})

export const marketData = sqliteTable(
  'market_data',
  {
    cik: integer('cik').notNull(),
    date: text('date').notNull(),
    price: real('price'),
    sharesOutstanding: real('shares_outstanding'),
    marketCap: real('market_cap'),
    volume: real('volume'),
  },
  (t) => ({ pk: primaryKey({ columns: [t.cik, t.date] }) }),
)

export const financials = sqliteTable(
  'financials',
  {
    cik: integer('cik').notNull(),
    periodEnd: text('period_end').notNull(),
    periodType: text('period_type').notNull(),
    revenue: real('revenue'),
    grossProfit: real('gross_profit'),
    operatingIncome: real('operating_income'),
    netIncome: real('net_income'),
    ocf: real('ocf'),
    capex: real('capex'),
    fcf: real('fcf'),
    cash: real('cash'),
    totalDebt: real('total_debt'),
    equity: real('equity'),
    sharesDiluted: real('shares_diluted'),
    sharesOutstanding: real('shares_outstanding'),
    sbc: real('sbc'),
    rdExpense: real('rd_expense'),
    sourceTags: text('source_tags'),
    computedAt: text('computed_at').notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.cik, t.periodEnd, t.periodType] }) }),
)

export const companyIndustry = sqliteTable(
  'company_industry',
  {
    cik: integer('cik').notNull(),
    industrySlug: text('industry_slug').notNull(),
    themeSlug: text('theme_slug').notNull(),
    isPrimary: integer('is_primary').notNull().default(1),
    source: text('source').notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.cik, t.industrySlug] }) }),
)

export const scores = sqliteTable(
  'scores',
  {
    cik: integer('cik').notNull(),
    asOf: text('as_of').notNull(),
    tenbagger: real('tenbagger'),
    completeness: real('completeness').notNull(),
    category: text('category'),
    engineVersion: text('engine_version').notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.cik, t.asOf] }) }),
)

export const scoreFactors = sqliteTable(
  'score_factors',
  {
    cik: integer('cik').notNull(),
    asOf: text('as_of').notNull(),
    engine: text('engine').notNull(),
    factorKey: text('factor_key').notNull(),
    raw: real('raw'),
    points: real('points'),
    weight: real('weight').notNull(),
    status: text('status').notNull(),
    percentile: real('percentile'),
    detail: text('detail').notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.cik, t.asOf, t.engine, t.factorKey] }) }),
)

export const redFlags = sqliteTable(
  'red_flags',
  {
    cik: integer('cik').notNull(),
    asOf: text('as_of').notNull(),
    code: text('code').notNull(),
    severity: text('severity').notNull(),
    message: text('message').notNull(),
    evidence: text('evidence'),
  },
  (t) => ({ pk: primaryKey({ columns: [t.cik, t.asOf, t.code] }) }),
)

export const themes = sqliteTable('themes', {
  slug: text('slug').primaryKey(),
  name: text('name').notNull(),
  displayOrder: integer('display_order').notNull(),
})

export const industries = sqliteTable('industries', {
  slug: text('slug').primaryKey(),
  themeSlug: text('theme_slug').notNull(),
  name: text('name').notNull(),
  tamUsd: real('tam_usd'),
  tamCagr: real('tam_cagr'),
  tamSource: text('tam_source'),
  tamAsOf: text('tam_as_of'),
})

export const jobRuns = sqliteTable('job_runs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  job: text('job').notNull(),
  startedAt: text('started_at').notNull(),
  finishedAt: text('finished_at'),
  status: text('status').notNull(),
  stats: text('stats'),
  error: text('error'),
})
