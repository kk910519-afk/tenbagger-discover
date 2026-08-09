import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { getRawDb, runMigrations } from '@/db/client'
import { loadConfig } from '@/config'
import { getIndustryView } from '@/app/_queries/industry'

const MIN_COMPLETENESS = loadConfig().scoring.min_completeness

let raw: Database.Database

function seed(
  db: Database.Database, cik: number, ticker: string,
  category: string, tenbagger: number, warning = false, completeness = 0.95,
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
     VALUES (?, '2026-08-09', ?, ?, ?, 'v1')`,
  ).run(cik, tenbagger, completeness, category)
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
  // completeness가 기준 미달인 회사 — 소수 팩터만으로 99점을 받아 다른 CHALLENGER보다
  // 높지만, 랭킹 그룹이 아니라 INSUFFICIENT 그룹에 들어가야 한다.
  seed(raw, 6, 'CHAL3', 'CHALLENGER', 99, false, 0.1)
})

describe('getIndustryView', () => {
  const view = () => getIndustryView(raw, 'semiconductors', MIN_COMPLETENESS)!

  it('없는 산업은 null', () => {
    expect(getIndustryView(raw, 'nope', MIN_COMPLETENESS)).toBeNull()
  })

  it('Theme 이름을 함께 준다', () => {
    expect(view().themeName).toBe('AI / Software / Semiconductor')
  })

  it('그룹을 Leader → Challenger → Emerging → Insufficient 순으로 준다', () => {
    expect(view().groups.map((g) => g.category)).toEqual(
      ['LEADER', 'CHALLENGER', 'EMERGING', 'INSUFFICIENT'],
    )
  })

  it('그룹 내에서 Tenbagger Score 내림차순으로 정렬한다', () => {
    const chal = view().groups.find((g) => g.category === 'CHALLENGER')!
    expect(chal.rows.map((r) => r.ticker)).toEqual(['CHAL2', 'CHAL1'])
  })

  it('completeness가 기준 미달인 회사는 점수가 더 높아도 랭킹 그룹(CHALLENGER)에서 빠진다', () => {
    const chal = view().groups.find((g) => g.category === 'CHALLENGER')!
    expect(chal.rows.map((r) => r.ticker)).not.toContain('CHAL3')
  })

  it('completeness가 기준 미달인 회사는 별도 INSUFFICIENT 그룹으로 여전히 조회 가능하다', () => {
    const insufficient = view().groups.find((g) => g.category === 'INSUFFICIENT')!
    expect(insufficient.rows.map((r) => r.ticker)).toEqual(['CHAL3'])
    expect(insufficient.rows[0]!.completeness).toBeCloseTo(0.1)
    expect(insufficient.rows[0]!.tenbagger).toBe(99)
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
