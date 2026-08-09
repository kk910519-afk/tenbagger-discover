import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { getRawDb, runMigrations } from '@/db/client'
import { getOpportunityMap } from '@/app/_queries/map'

let raw: Database.Database
let map: ReturnType<typeof getOpportunityMap>

function seed(
  db: Database.Database, cik: number, ticker: string, industry: string,
  tenbagger: number, category: string, marketCap: number,
  growth: number, accel: number, critical = false,
) {
  db.prepare(
    `INSERT INTO companies (cik, ticker, name, is_active, first_seen, last_updated)
     VALUES (?, ?, ?, 1, '2026-08-09', '2026-08-09')`,
  ).run(cik, ticker, `${ticker} Inc`)
  db.prepare(
    `INSERT INTO company_industry (cik, industry_slug, theme_slug, is_primary, source)
     VALUES (?, ?, 'ai-software-semi', 1, 'sic')`,
  ).run(cik, industry)
  db.prepare(
    `INSERT INTO scores (cik, as_of, tenbagger, completeness, category, engine_version)
     VALUES (?, '2026-08-09', ?, 1.0, ?, 'v1')`,
  ).run(cik, tenbagger, category)
  db.prepare(
    `INSERT INTO market_data (cik, date, price, market_cap) VALUES (?, '2026-08-08', 10, ?)`,
  ).run(cik, marketCap)
  const insF = db.prepare(
    `INSERT INTO score_factors (cik, as_of, engine, factor_key, raw, points, weight, status, detail)
     VALUES (?, '2026-08-09', 'tenbagger', ?, ?, 1, 10, 'SCORED', '')`,
  )
  insF.run(cik, 'revenue_growth', growth)
  insF.run(cik, 'revenue_acceleration', accel)
  if (critical) {
    db.prepare(
      `INSERT INTO red_flags (cik, as_of, code, severity, message)
       VALUES (?, '2026-08-09', 'RUNWAY_CRITICAL', 'CRITICAL', 'x')`,
    ).run(cik)
  }
}

beforeAll(() => {
  raw = getRawDb(join(mkdtempSync(join(tmpdir(), 'tb-map-')), 'm.db'))
  runMigrations(raw)
  raw.prepare(
    `INSERT INTO themes (slug, name, display_order)
     VALUES ('ai-software-semi', 'AI / Software / Semiconductor', 1),
            ('energy-next', 'Energy / Next Energy', 5)`,
  ).run()
  raw.prepare(
    `INSERT INTO industries (slug, theme_slug, name)
     VALUES ('semiconductors', 'ai-software-semi', 'Semiconductors'),
            ('cybersecurity', 'ai-software-semi', 'Cybersecurity'),
            ('nuclear', 'energy-next', 'Nuclear')`,
  ).run()

  seed(raw, 1, 'BIG', 'semiconductors', 40, 'LEADER', 300e9, 0.10, 0.01)
  seed(raw, 2, 'MID', 'semiconductors', 72, 'CHALLENGER', 8e9, 0.28, 0.05)
  seed(raw, 3, 'SML', 'semiconductors', 85, 'EMERGING', 900e6, 0.45, 0.12, true)
  seed(raw, 4, 'CYB', 'cybersecurity', 66, 'CHALLENGER', 5e9, 0.30, 0.02)

  map = getOpportunityMap(raw)
})

describe('getOpportunityMap', () => {
  it('Theme을 display_order 순으로 반환한다', () => {
    expect(map.map((t) => t.slug)).toEqual(['ai-software-semi', 'energy-next'])
  })

  it('후보가 없는 Industry는 제외한다', () => {
    const energy = map.find((t) => t.slug === 'energy-next')!
    expect(energy.industries).toHaveLength(0)
  })

  it('Industry를 평균 Tenbagger 내림차순으로 정렬한다', () => {
    const ai = map.find((t) => t.slug === 'ai-software-semi')!
    expect(ai.industries.map((i) => i.slug)).toEqual(['cybersecurity', 'semiconductors'])
    // semiconductors 평균 = (40+72+85)/3 = 65.7, cybersecurity = 66
  })

  it('후보 수를 센다', () => {
    const semi = map[0]!.industries.find((i) => i.slug === 'semiconductors')!
    expect(semi.candidateCount).toBe(3)
  })

  it('매출성장률과 시가총액의 중앙값을 낸다', () => {
    const semi = map[0]!.industries.find((i) => i.slug === 'semiconductors')!
    expect(semi.medianRevenueGrowth).toBeCloseTo(0.28)
    expect(semi.medianMarketCap).toBe(8e9)
  })

  it('Momentum은 매출 가속도 중앙값이다', () => {
    const semi = map[0]!.industries.find((i) => i.slug === 'semiconductors')!
    expect(semi.momentum).toBeCloseTo(0.05)
  })

  it('Top Candidate는 LEADER를 제외한 최고 점수다', () => {
    const semi = map[0]!.industries.find((i) => i.slug === 'semiconductors')!
    expect(semi.topCandidate).toEqual({ ticker: 'SML', tenbagger: 85 })
  })

  it('Risk는 CRITICAL 보유 비율이다', () => {
    const semi = map[0]!.industries.find((i) => i.slug === 'semiconductors')!
    expect(semi.riskRatio).toBeCloseTo(1 / 3)
    const cyb = map[0]!.industries.find((i) => i.slug === 'cybersecurity')!
    expect(cyb.riskRatio).toBe(0)
  })
})
