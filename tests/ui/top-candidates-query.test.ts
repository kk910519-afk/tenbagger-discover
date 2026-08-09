import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { getRawDb, runMigrations } from '@/db/client'
import { loadConfig } from '@/config'
import { getTopCandidates } from '@/app/_queries/top-candidates'

const MIN_COMPLETENESS = loadConfig().scoring.min_completeness

let raw: Database.Database

function seedCompany(
  db: Database.Database, cik: number, ticker: string, industry: string,
) {
  db.prepare(
    `INSERT INTO companies (cik, ticker, name, is_active, first_seen, last_updated)
     VALUES (?, ?, ?, 1, '2026-08-09', '2026-08-09')`,
  ).run(cik, ticker, `${ticker} Inc`)
  db.prepare(
    `INSERT INTO company_industry (cik, industry_slug, theme_slug, is_primary, source)
     VALUES (?, ?, 'theme1', 1, 'sic')`,
  ).run(cik, industry)
}

function seedScore(
  db: Database.Database, cik: number, tenbagger: number, category: string, completeness = 1.0,
) {
  db.prepare(
    `INSERT INTO scores (cik, as_of, tenbagger, completeness, category, engine_version)
     VALUES (?, '2026-08-09', ?, ?, ?, 'v1')`,
  ).run(cik, tenbagger, completeness, category)
}

function seedFactor(
  db: Database.Database, cik: number, key: string, weight: number, points: number, detail: string,
) {
  db.prepare(
    `INSERT INTO score_factors (cik, as_of, engine, factor_key, raw, points, weight, status, detail)
     VALUES (?, '2026-08-09', 'tenbagger', ?, ?, ?, ?, 'SCORED', ?)`,
  ).run(cik, key, points, points, weight, detail)
}

function seedCriticalFlag(db: Database.Database, cik: number, code: string) {
  db.prepare(
    `INSERT INTO red_flags (cik, as_of, code, severity, message) VALUES (?, '2026-08-09', ?, 'CRITICAL', 'x')`,
  ).run(cik, code)
}

beforeAll(() => {
  raw = getRawDb(join(mkdtempSync(join(tmpdir(), 'tb-top5-')), 't.db'))
  runMigrations(raw)
  raw.prepare(`INSERT INTO themes (slug, name, display_order) VALUES ('theme1', 'Theme One', 1)`).run()
  raw.prepare(
    `INSERT INTO industries (slug, theme_slug, name)
     VALUES ('semiconductors', 'theme1', 'Semiconductors'),
            ('biotech', 'theme1', 'Biotech')`,
  ).run()

  // HIGH: 최고점, 완전성 충분 — 나타나야 한다
  seedCompany(raw, 1, 'HIGH', 'semiconductors')
  seedScore(raw, 1, 95, 'EMERGING')
  seedFactor(raw, 1, 'revenue_growth', 20, 12, 'TTM 매출 +40.0%') // fill 0.60
  seedFactor(raw, 1, 'balance_sheet', 5, 5, '현금 런웨이 24개월') // fill 1.00

  // WEAK: 완전성 기준 미달 — 점수가 HIGH보다 높아도 나타나면 안 된다
  seedCompany(raw, 2, 'WEAK', 'semiconductors')
  seedScore(raw, 2, 99, 'EMERGING', MIN_COMPLETENESS - 0.01)

  // TOPDOG: LEADER — 산업 벤치마크이지 후보가 아니므로 나타나면 안 된다
  seedCompany(raw, 3, 'TOPDOG', 'semiconductors')
  seedScore(raw, 3, 90, 'LEADER')

  // FLAGGED: CRITICAL Red Flag가 있어도 점수가 높으면 나타나야 하고, 플래그도 노출돼야 한다
  seedCompany(raw, 4, 'FLAGGED', 'biotech')
  seedScore(raw, 4, 88, 'EMERGING')
  seedFactor(raw, 4, 'revenue_growth', 20, 10, 'TTM 매출 +10.0%')
  seedCriticalFlag(raw, 4, 'EXTREME_DILUTION')
  seedCriticalFlag(raw, 4, 'REVENUE_DECLINE_2Y')

  // MID: 중간 점수 — 순위 확인용
  seedCompany(raw, 5, 'MID', 'biotech')
  seedScore(raw, 5, 70, 'CHALLENGER')
})

describe('getTopCandidates', () => {
  it('completeness가 기준 미달인 회사는 점수가 더 높아도 제외한다', () => {
    const top = getTopCandidates(raw, MIN_COMPLETENESS, 5)
    expect(top.map((c) => c.ticker)).not.toContain('WEAK')
  })

  it('LEADER 카테고리는 제외한다', () => {
    const top = getTopCandidates(raw, MIN_COMPLETENESS, 5)
    expect(top.map((c) => c.ticker)).not.toContain('TOPDOG')
  })

  it('CRITICAL Red Flag가 있는 회사도 점수만 충분하면 포함하고, hasCriticalFlag로 노출한다', () => {
    const top = getTopCandidates(raw, MIN_COMPLETENESS, 5)
    const flagged = top.find((c) => c.ticker === 'FLAGGED')
    expect(flagged).toBeDefined()
    expect(flagged!.hasCriticalFlag).toBe(true)
  })

  it('플래그 없는 회사는 hasCriticalFlag가 false다', () => {
    const top = getTopCandidates(raw, MIN_COMPLETENESS, 5)
    const high = top.find((c) => c.ticker === 'HIGH')!
    expect(high.hasCriticalFlag).toBe(false)
  })

  it('테마·산업 경계 없이 tenbagger 점수 내림차순으로 정렬한다', () => {
    const top = getTopCandidates(raw, MIN_COMPLETENESS, 5)
    expect(top.map((c) => c.ticker)).toEqual(['HIGH', 'FLAGGED', 'MID'])
  })

  it('limit으로 반환 개수를 제한한다', () => {
    const top = getTopCandidates(raw, MIN_COMPLETENESS, 2)
    expect(top).toHaveLength(2)
  })

  it('근거 문구는 절대 점수가 아니라 배점 대비 획득 비율(fill ratio)로 팩터를 고른다', () => {
    // HIGH: revenue_growth는 20점 만점에 12점(fill 0.60)으로 절대 점수는 더 크지만,
    // balance_sheet는 5점 만점에 5점(fill 1.00)으로 fill ratio가 더 높다.
    // 절대 점수로 골랐다면 revenue_growth의 detail이 먼저 와야 하지만, fill ratio로
    // 고르면 balance_sheet의 detail이 먼저 와야 한다.
    const top = getTopCandidates(raw, MIN_COMPLETENESS, 5)
    const high = top.find((c) => c.ticker === 'HIGH')!
    const idxBalanceSheet = high.rationale.indexOf('현금 런웨이 24개월')
    const idxRevenueGrowth = high.rationale.indexOf('TTM 매출 +40.0%')
    expect(idxBalanceSheet).toBeGreaterThanOrEqual(0)
    expect(idxRevenueGrowth).toBeGreaterThanOrEqual(0)
    expect(idxBalanceSheet).toBeLessThan(idxRevenueGrowth)
  })

  it('engine detail 문자열을 그대로 쓴다 — 새로 문구를 만들지 않는다', () => {
    const top = getTopCandidates(raw, MIN_COMPLETENESS, 5)
    const flagged = top.find((c) => c.ticker === 'FLAGGED')!
    expect(flagged.rationale).toContain('TTM 매출 +10.0%')
  })

  it('산업 정보를 포함한다', () => {
    const top = getTopCandidates(raw, MIN_COMPLETENESS, 5)
    const high = top.find((c) => c.ticker === 'HIGH')!
    expect(high.industrySlug).toBe('semiconductors')
    expect(high.industryName).toBe('Semiconductors')
  })
})
