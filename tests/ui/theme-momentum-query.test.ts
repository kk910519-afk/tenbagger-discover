import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { getRawDb, runMigrations } from '@/db/client'
import { loadConfig } from '@/config'
import { getThemeMomentum } from '@/app/_queries/theme-momentum'

const MIN_COMPLETENESS = loadConfig().scoring.min_completeness

let raw: Database.Database
let momentum: ReturnType<typeof getThemeMomentum>

function seed(
  db: Database.Database, cik: number, ticker: string, theme: string, industry: string,
  tenbagger: number, category: string, growth: number, accel: number, completeness = 1.0,
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
  const insF = db.prepare(
    `INSERT INTO score_factors (cik, as_of, engine, factor_key, raw, points, weight, status, detail)
     VALUES (?, '2026-08-09', 'tenbagger', ?, ?, 1, 10, 'SCORED', '')`,
  )
  insF.run(cik, 'revenue_growth', growth)
  insF.run(cik, 'revenue_acceleration', accel)
}

beforeAll(() => {
  raw = getRawDb(join(mkdtempSync(join(tmpdir(), 'tb-theme-momentum-')), 'm.db'))
  runMigrations(raw)
  raw.prepare(
    `INSERT INTO themes (slug, name, display_order)
     VALUES ('ai-software-semi', 'AI / Software / Semiconductor', 1),
            ('energy-next', 'Energy / Next Energy', 5)`,
  ).run()
  raw.prepare(
    `INSERT INTO industries (slug, theme_slug, name)
     VALUES ('semiconductors', 'ai-software-semi', 'Semiconductors'),
            ('software-application', 'ai-software-semi', 'Software Application')`,
  ).run()

  // ai-software-semi 테마: LEADER 하나(BIG, 최고점이지만 후보 아님), CHALLENGER(MID),
  // EMERGING(SML, CRITICAL 플래그 무관하게 후보), completeness 기준 미달(FAKE, 점수만
  // 보면 최고점).
  seed(raw, 1, 'BIG', 'ai-software-semi', 'semiconductors', 99, 'LEADER', 0.10, 0.01)
  seed(raw, 2, 'MID', 'ai-software-semi', 'semiconductors', 60, 'CHALLENGER', 0.20, 0.04)
  seed(raw, 3, 'SML', 'ai-software-semi', 'software-application', 80, 'EMERGING', 0.40, 0.08)
  seed(raw, 4, 'FAKE', 'ai-software-semi', 'semiconductors', 95, 'EMERGING', 0.90, 0.50, MIN_COMPLETENESS - 0.01)

  // energy-next 테마: industries 테이블에 산업이 하나도 등록돼 있지 않다(회사도 없다)
  // — "적격 후보 0명인 테마"를 자연스럽게 재현한다.

  momentum = getThemeMomentum(raw, MIN_COMPLETENESS)
})

describe('getThemeMomentum', () => {
  it('display_order 순으로 테마 6개(이 테스트에서는 등록된 2개)를 모두 반환한다', () => {
    expect(momentum.map((t) => t.slug)).toEqual(['ai-software-semi', 'energy-next'])
  })

  it('LEADER는 점수가 가장 높아도 테마의 Top Pick이 되지 않는다', () => {
    const ai = momentum.find((t) => t.slug === 'ai-software-semi')!
    expect(ai.topCandidate).not.toBeNull()
    expect(ai.topCandidate!.ticker).not.toBe('BIG')
  })

  it('completeness가 기준 미달인 회사는 점수가 더 높아도 Top Pick이 되지 않고 후보 수·중앙값에서도 빠진다', () => {
    const ai = momentum.find((t) => t.slug === 'ai-software-semi')!
    // 적격 후보는 MID(60), SML(80) 둘뿐이다 — BIG(LEADER)과 FAKE(기준 미달)는 제외.
    expect(ai.candidateCount).toBe(2)
    expect(ai.topCandidate).toEqual({ ticker: 'SML', name: 'SML Inc', tenbagger: 80 })
    // FAKE의 growth(0.90)·accel(0.50)이 섞였다면 중앙값이 크게 왜곡됐을 것 —
    // MID(0.20)/SML(0.40) 중앙값(0.30)과 MID(0.04)/SML(0.08) 중앙값(0.06)만 나와야 한다.
    expect(ai.medianRevenueGrowth).toBeCloseTo(0.30)
    expect(ai.medianRevenueAcceleration).toBeCloseTo(0.06)
  })

  it('적격 후보가 하나도 없는 테마도 렌더링 가능한 형태로 반환하고, 숫자는 전부 null/0이다', () => {
    const energy = momentum.find((t) => t.slug === 'energy-next')!
    expect(energy.candidateCount).toBe(0)
    expect(energy.medianRevenueGrowth).toBeNull()
    expect(energy.medianRevenueAcceleration).toBeNull()
    expect(energy.topCandidate).toBeNull()
  })
})
