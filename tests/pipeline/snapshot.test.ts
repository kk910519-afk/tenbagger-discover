import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { getRawDb, runMigrations } from '@/db/client'
import { parseConfig } from '@/config'
import { loadTaxonomy } from '@/taxonomy'
import { buildSnapshots } from '@/pipeline/snapshot'
import type { CompanySnapshot } from '@/domain/types'

const cfg = parseConfig(readFileSync('config.yaml', 'utf8'))
const taxonomy = loadTaxonomy()

let raw: Database.Database
let snaps: CompanySnapshot[]

function seedCompany(
  db: Database.Database,
  cik: number, ticker: string, industry: string,
  revenue: number, grossProfit: number, marketCap: number | null,
  sharesBasis: 'reported' | 'diluted_fallback' | null = 'reported',
) {
  db.prepare(
    `INSERT INTO companies (cik, ticker, name, sic, is_active, first_seen, last_updated)
     VALUES (?, ?, ?, '3674', 1, '2026-08-09', '2026-08-09')`,
  ).run(cik, ticker, `${ticker} Inc`)
  db.prepare(
    `INSERT INTO company_industry (cik, industry_slug, theme_slug, is_primary, source)
     VALUES (?, ?, 'ai-software-semi', 1, 'sic')`,
  ).run(cik, industry)
  // TTM 5개: 현재와 4분기 전이 있어야 성장률이 계산된다
  const ins = db.prepare(
    `INSERT INTO financials (cik, period_end, period_type, revenue, gross_profit, computed_at)
     VALUES (?, ?, 'TTM', ?, ?, '2026-08-09')`,
  )
  const ends = ['2025-03-31', '2024-12-31', '2024-09-30', '2024-06-30', '2024-03-31']
  ends.forEach((e, i) => ins.run(cik, e, i === 0 ? revenue : revenue / 1.25, grossProfit))
  if (marketCap !== null) {
    db.prepare(
      `INSERT INTO market_data (cik, date, price, shares_outstanding, market_cap, shares_basis)
       VALUES (?, '2026-08-08', 10, ?, ?, ?)`,
    ).run(cik, marketCap / 10, marketCap, sharesBasis)
  }
}

beforeAll(() => {
  raw = getRawDb(join(mkdtempSync(join(tmpdir(), 'tb-snap-')), 's.db'))
  runMigrations(raw)
  seedCompany(raw, 1, 'AAA', 'semiconductors', 1000, 700, 5_000_000_000)
  seedCompany(raw, 2, 'BBB', 'semiconductors', 2000, 1000, 20_000_000_000)
  seedCompany(raw, 3, 'CCC', 'semiconductors', 500, 200, 400_000_000)
  seedCompany(raw, 4, 'DDD', 'cybersecurity', 800, 600, null) // 시가총액 없음
  seedCompany(raw, 5, 'EEE', 'cloud-computing', 900, 500, 3_000_000_000, 'diluted_fallback')
  snaps = buildSnapshots({ raw, taxonomy, cfg, asOf: '2026-08-09' })
})

describe('buildSnapshots', () => {
  it('유니버스 기업마다 스냅샷을 만든다', () => {
    expect(snaps.map((s) => s.ticker).sort()).toEqual(['AAA', 'BBB', 'CCC', 'DDD', 'EEE'])
  })

  it('산업 메타데이터를 붙인다', () => {
    const a = snaps.find((s) => s.ticker === 'AAA')!
    expect(a.industrySlug).toBe('semiconductors')
    expect(a.themeSlug).toBe('ai-software-semi')
    expect(a.industry.name).toBe('Semiconductors')
  })

  it('시가총액과 주가를 붙인다', () => {
    const a = snaps.find((s) => s.ticker === 'AAA')!
    expect(a.marketCap).toBe(5_000_000_000)
    expect(a.price).toBe(10)
    expect(a.priceDate).toBe('2026-08-08')
  })

  it('시가총액이 없어도 스냅샷을 만들고 null로 둔다', () => {
    const d = snaps.find((s) => s.ticker === 'DDD')!
    expect(d.marketCap).toBeNull()
    expect(d.sharesBasis).toBeNull()
  })

  it('shares_basis를 스냅샷에 그대로 전파한다', () => {
    const a = snaps.find((s) => s.ticker === 'AAA')!
    expect(a.sharesBasis).toBe('reported')
    const e = snaps.find((s) => s.ticker === 'EEE')!
    expect(e.sharesBasis).toBe('diluted_fallback')
    expect(e.marketCap).toBe(3_000_000_000)
  })

  it('TTM 계열을 최근순으로 붙인다', () => {
    const a = snaps.find((s) => s.ticker === 'AAA')!
    expect(a.ttm[0]!.periodEnd).toBe('2025-03-31')
    expect(a.ttm[0]!.revenue).toBe(1000)
    expect(a.ttm).toHaveLength(5)
  })

  it('산업별 후보 수를 센다', () => {
    const a = snaps.find((s) => s.ticker === 'AAA')!
    expect(a.industryStats.candidateCount).toBe(3)
    const d = snaps.find((s) => s.ticker === 'DDD')!
    expect(d.industryStats.candidateCount).toBe(1)
  })

  it('산업 GM 중앙값을 계산한다', () => {
    // semiconductors GM: 0.70, 0.50, 0.40 → 중앙값 0.50
    const a = snaps.find((s) => s.ticker === 'AAA')!
    expect(a.industryStats.medianGrossMargin).toBeCloseTo(0.5)
  })

  it('산업 매출성장률 중앙값을 계산한다', () => {
    // 세 기업 모두 1.25배 성장 → 0.25
    const a = snaps.find((s) => s.ticker === 'AAA')!
    expect(a.industryStats.medianRevenueGrowth).toBeCloseTo(0.25)
  })

  it('백분위 계산용 분포를 오름차순으로 담는다', () => {
    const a = snaps.find((s) => s.ticker === 'AAA')!
    const gm = a.industryStats.distributions.gross_margin!
    expect(gm).toEqual([...gm].sort((x, y) => x - y))
    expect(gm).toHaveLength(3)
  })

  it('asOf를 전파한다', () => {
    expect(snaps[0]!.asOf).toBe('2026-08-09')
  })

  it('taxonomy에 없는 industry_slug를 만나면 에러를 던진다', () => {
    const db = getRawDb(join(mkdtempSync(join(tmpdir(), 'tb-snap-bad-')), 's.db'))
    runMigrations(db)
    db.prepare(
      `INSERT INTO companies (cik, ticker, name, sic, is_active, first_seen, last_updated)
       VALUES (99, 'ZZZ', 'ZZZ Inc', '3674', 1, '2026-08-09', '2026-08-09')`,
    ).run()
    db.prepare(
      `INSERT INTO company_industry (cik, industry_slug, theme_slug, is_primary, source)
       VALUES (99, 'nonexistent-slug', 'ai-software-semi', 1, 'sic')`,
    ).run()

    expect(() => buildSnapshots({ raw: db, taxonomy, cfg, asOf: '2026-08-09' })).toThrow(
      /ZZZ.*nonexistent-slug/,
    )
  })
})
