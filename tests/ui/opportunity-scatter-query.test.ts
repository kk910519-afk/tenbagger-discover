import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { getRawDb, runMigrations } from '@/db/client'
import { loadConfig } from '@/config'
import { getOpportunityScatter } from '@/app/_queries/opportunity-scatter'

const MIN_COMPLETENESS = loadConfig().scoring.min_completeness

let raw: Database.Database

function seed(
  db: Database.Database, cik: number, ticker: string, theme: string, industry: string,
  tenbagger: number, category: string, marketCap: number | null, growth: number,
  completeness = 1.0,
) {
  db.prepare(
    `INSERT INTO companies (cik, ticker, name, is_active, first_seen, last_updated)
     VALUES (?, ?, ?, 1, '2026-08-09', '2026-08-09')`,
  ).run(cik, ticker, `${ticker} Inc`)
  db.prepare(
    `INSERT INTO company_industry (cik, industry_slug, theme_slug, is_primary, source)
     VALUES (?, ?, ?, 1, 'sic')`,
  ).run(cik, industry, theme)
  db.prepare(
    `INSERT INTO scores (cik, as_of, tenbagger, completeness, category, engine_version)
     VALUES (?, '2026-08-09', ?, ?, ?, 'v1')`,
  ).run(cik, tenbagger, completeness, category)
  if (marketCap !== null) {
    db.prepare(
      `INSERT INTO market_data (cik, date, price, market_cap) VALUES (?, '2026-08-08', 10, ?)`,
    ).run(cik, marketCap)
  }
  db.prepare(
    `INSERT INTO score_factors (cik, as_of, engine, factor_key, raw, points, weight, status, detail)
     VALUES (?, '2026-08-09', 'tenbagger', 'revenue_growth', ?, 1, 10, 'SCORED', '')`,
  ).run(cik, growth)
}

beforeAll(() => {
  raw = getRawDb(join(mkdtempSync(join(tmpdir(), 'tb-opp-scatter-')), 'm.db'))
  runMigrations(raw)
  raw.prepare(
    `INSERT INTO themes (slug, name, display_order)
     VALUES ('ai-software-semi', 'AI / Software / Semiconductor', 1),
            ('emerging-tech', 'Emerging Technology', 6)`,
  ).run()
  raw.prepare(
    `INSERT INTO industries (slug, theme_slug, name)
     VALUES ('semiconductors', 'ai-software-semi', 'Semiconductors'),
            ('quantum-computing', 'emerging-tech', 'Quantum Computing'),
            ('tiny-industry-a', 'ai-software-semi', 'Tiny A'),
            ('tiny-industry-b', 'ai-software-semi', 'Tiny B')`,
  ).run()

  // semiconductors: LEADER(BIG, 제외) + 기준 미달(FAKE, 제외) + 적격 후보 2곳(MID, SML)
  seed(raw, 1, 'BIG', 'ai-software-semi', 'semiconductors', 99, 'LEADER', 300e9, 0.10)
  seed(raw, 2, 'FAKE', 'ai-software-semi', 'semiconductors', 95, 'EMERGING', 50e9, 0.99, MIN_COMPLETENESS - 0.01)
  seed(raw, 3, 'MID', 'ai-software-semi', 'semiconductors', 60, 'CHALLENGER', 5e9, 0.20)
  seed(raw, 4, 'SML', 'ai-software-semi', 'semiconductors', 80, 'EMERGING', 900e6, 0.40)

  // quantum-computing: 적격 후보 1곳인데 시가총액 데이터가 아예 없다(market_data 행 없음)
  seed(raw, 5, 'QNT', 'emerging-tech', 'quantum-computing', 70, 'EMERGING', null, 0.15)

  // tiny 산업 두 곳 — top N(=2)으로 자르면 후보 수가 더 많은 semiconductors/quantum에
  // 밀려 빠져야 한다
  seed(raw, 6, 'TINYA', 'ai-software-semi', 'tiny-industry-a', 40, 'CHALLENGER', 1e9, 0.05)
  seed(raw, 7, 'TINYB', 'ai-software-semi', 'tiny-industry-b', 45, 'CHALLENGER', 1e9, 0.06)
})

describe('getOpportunityScatter', () => {
  it('LEADER와 completeness 기준 미달 회사는 마크 집계에서 제외한다', () => {
    const marks = getOpportunityScatter(raw, MIN_COMPLETENESS, 10)
    const semi = marks.find((m) => m.slug === 'semiconductors')!
    // 적격 후보는 MID(0.20)·SML(0.40) 둘뿐 — 후보 수 2, 중앙값도 이 둘만으로 계산돼야 한다.
    expect(semi.candidateCount).toBe(2)
    expect(semi.medianRevenueGrowth).toBeCloseTo(0.30)
    // FAKE(50B)·BIG(300B)이 섞였다면 중앙값이 훨씬 컸을 것 — MID(5B)/SML(0.9B) 중앙값 근처여야 한다.
    expect(semi.medianMarketCap).toBeCloseTo((5e9 + 900e6) / 2)
  })

  it('후보 전원의 시가총액이 결측이면 medianMarketCap은 null이다(0으로 대체하지 않는다)', () => {
    const marks = getOpportunityScatter(raw, MIN_COMPLETENESS, 10)
    const quantum = marks.find((m) => m.slug === 'quantum-computing')!
    expect(quantum.candidateCount).toBe(1)
    expect(quantum.medianMarketCap).toBeNull()
    // growth 자체는 결측이 아니므로 정상적으로 채워진다
    expect(quantum.medianRevenueGrowth).toBeCloseTo(0.15)
  })

  it('적격 후보가 0명인 산업은 마크가 되지 않는다', () => {
    const marks = getOpportunityScatter(raw, MIN_COMPLETENESS, 10)
    expect(marks.some((m) => m.slug === 'quantum-computing' && m.candidateCount === 0)).toBe(false)
    // (참고: quantum-computing 자체는 1명이라 남아 있어야 한다 — 별도로 위에서 검증)
  })

  it('limit으로 후보 수가 많은 산업만 남긴다', () => {
    const marks = getOpportunityScatter(raw, MIN_COMPLETENESS, 2)
    expect(marks).toHaveLength(2)
    expect(marks.map((m) => m.slug).sort()).toEqual(['quantum-computing', 'semiconductors'].sort())
    expect(marks.some((m) => m.slug === 'tiny-industry-a')).toBe(false)
  })
})
