import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { getRawDb, runMigrations } from '@/db/client'
import { getIndustryView } from '@/app/_queries/industry'

let raw: Database.Database

function seed(
  db: Database.Database, cik: number, ticker: string,
  category: string, tenbagger: number, warning = false,
) {
  db.prepare(
    `INSERT INTO companies (cik, ticker, name, is_active, first_seen, last_updated)
     VALUES (?, ?, ?, 1, '2026-08-09', '2026-08-09')`,
  ).run(cik, ticker, `${ticker} Inc`)
  db.prepare(
    `INSERT INTO company_industry (cik, industry_slug, theme_slug, is_primary, source)
     VALUES (?, 'semiconductors', 'ai-software-semi', 1, 'sic')`,
  ).run(cik)
  db.prepare(
    `INSERT INTO scores (cik, as_of, tenbagger, completeness, category, engine_version)
     VALUES (?, '2026-08-09', ?, 0.95, ?, 'v1')`,
  ).run(cik, tenbagger, category)
  db.prepare(
    `INSERT INTO financials
       (cik, period_end, period_type, revenue, gross_profit, fcf, total_debt, computed_at)
     VALUES (?, '2025-03-31', 'TTM', 1000, 700, 150, 200, '2026-08-09')`,
  ).run(cik)
  db.prepare(
    `INSERT INTO market_data (cik, date, price, market_cap) VALUES (?, '2026-08-08', 10, 5e9)`,
  ).run(cik)
  const insF = db.prepare(
    `INSERT INTO score_factors (cik, as_of, engine, factor_key, raw, points, weight, status, detail)
     VALUES (?, '2026-08-09', 'tenbagger', ?, ?, 1, 10, 'SCORED', '')`,
  )
  insF.run(cik, 'revenue_growth', 0.35)
  if (warning) {
    db.prepare(
      `INSERT INTO red_flags (cik, as_of, code, severity, message)
       VALUES (?, '2026-08-09', 'DILUTION', 'WARNING', 'x')`,
    ).run(cik)
  }
}

beforeAll(() => {
  raw = getRawDb(join(mkdtempSync(join(tmpdir(), 'tb-ind-')), 'i.db'))
  runMigrations(raw)
  raw.prepare(
    `INSERT INTO themes (slug, name, display_order)
     VALUES ('ai-software-semi', 'AI / Software / Semiconductor', 1)`,
  ).run()
  raw.prepare(
    `INSERT INTO industries (slug, theme_slug, name)
     VALUES ('semiconductors', 'ai-software-semi', 'Semiconductors')`,
  ).run()
  seed(raw, 1, 'LEAD1', 'LEADER', 45)
  seed(raw, 2, 'LEAD2', 'LEADER', 40)
  seed(raw, 3, 'CHAL1', 'CHALLENGER', 70, true)
  seed(raw, 4, 'CHAL2', 'CHALLENGER', 82)
  seed(raw, 5, 'EMER1', 'EMERGING', 88)
})

describe('getIndustryView', () => {
  const view = () => getIndustryView(raw, 'semiconductors')!

  it('없는 산업은 null', () => {
    expect(getIndustryView(raw, 'nope')).toBeNull()
  })

  it('Theme 이름을 함께 준다', () => {
    expect(view().themeName).toBe('AI / Software / Semiconductor')
  })

  it('그룹을 Leader → Challenger → Emerging 순으로 준다', () => {
    expect(view().groups.map((g) => g.category)).toEqual(
      ['LEADER', 'CHALLENGER', 'EMERGING'],
    )
  })

  it('그룹 내에서 Tenbagger Score 내림차순으로 정렬한다', () => {
    const chal = view().groups.find((g) => g.category === 'CHALLENGER')!
    expect(chal.rows.map((r) => r.ticker)).toEqual(['CHAL2', 'CHAL1'])
  })

  it('재무 지표를 계산해 붙인다', () => {
    const r = view().groups[0]!.rows[0]!
    expect(r.grossMargin).toBeCloseTo(0.7)
    expect(r.fcfMargin).toBeCloseTo(0.15)
    expect(r.revenueGrowth).toBeCloseTo(0.35)
    expect(r.totalDebt).toBe(200)
  })

  it('Red Flag 개수를 심각도별로 센다', () => {
    const chal = view().groups.find((g) => g.category === 'CHALLENGER')!
    expect(chal.rows.find((r) => r.ticker === 'CHAL1')!.warningCount).toBe(1)
    expect(chal.rows.find((r) => r.ticker === 'CHAL2')!.warningCount).toBe(0)
  })
})
