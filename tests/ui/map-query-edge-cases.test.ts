import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { getRawDb, runMigrations } from '@/db/client'
import { getOpportunityMap } from '@/app/_queries/map'

/**
 * map-query.test.ts는 task-24-brief.md의 시나리오를 그대로 검증한다.
 * 그 시나리오에서는 모든 Industry가 LEADER 이외의 후보를 최소 하나 이상 갖고 있어서
 * "topCandidate가 null인 경우"와 "Industry에 회사는 있지만 점수는 없는 경우"가
 * 한 번도 실행되지 않는다. 이 파일은 그 갈라진 분기를 별도 DB로 검증한다
 * (기존 파일의 정확한 배열 비교 단언을 건드리지 않기 위해 파일을 분리했다).
 */

let raw: Database.Database

beforeAll(() => {
  raw = getRawDb(join(mkdtempSync(join(tmpdir(), 'tb-map-edge-')), 'm.db'))
  runMigrations(raw)
  raw.prepare(
    `INSERT INTO themes (slug, name, display_order) VALUES ('ai-software-semi', 'AI', 1)`,
  ).run()
  raw.prepare(
    `INSERT INTO industries (slug, theme_slug, name)
     VALUES ('quantum', 'ai-software-semi', 'Quantum Computing'),
            ('robotics', 'ai-software-semi', 'Robotics'),
            ('sensors', 'ai-software-semi', 'Sensors'),
            ('optics', 'ai-software-semi', 'Optics')`,
  ).run()

  // quantum: LEADER 한 곳뿐 — 후보(candidate)는 없지만 회사(company)는 있으므로 제외되면 안 된다.
  raw.prepare(
    `INSERT INTO companies (cik, ticker, name, is_active, first_seen, last_updated)
     VALUES (101, 'QLDR', 'QLDR Inc', 1, '2026-08-09', '2026-08-09')`,
  ).run()
  raw.prepare(
    `INSERT INTO company_industry (cik, industry_slug, theme_slug, is_primary, source)
     VALUES (101, 'quantum', 'ai-software-semi', 1, 'sic')`,
  ).run()
  raw.prepare(
    `INSERT INTO scores (cik, as_of, tenbagger, completeness, category, engine_version)
     VALUES (101, '2026-08-09', 40, 1.0, 'LEADER', 'v1')`,
  ).run()

  // robotics: 회사는 있고 scores 행도 있지만 tenbagger 값 자체가 NULL이다
  // (엔진이 계산은 했지만 점수를 못 낸 경우 — Finding 1의 "scores 행이 아예 없는" 경우와는 다르다).
  raw.prepare(
    `INSERT INTO companies (cik, ticker, name, is_active, first_seen, last_updated)
     VALUES (102, 'RBOT', 'RBOT Inc', 1, '2026-08-09', '2026-08-09')`,
  ).run()
  raw.prepare(
    `INSERT INTO company_industry (cik, industry_slug, theme_slug, is_primary, source)
     VALUES (102, 'robotics', 'ai-software-semi', 1, 'sic')`,
  ).run()
  raw.prepare(
    `INSERT INTO scores (cik, as_of, tenbagger, completeness, category, engine_version)
     VALUES (102, '2026-08-09', NULL, 0.2, NULL, 'v1')`,
  ).run()

  // sensors: 회사는 있지만 scores 테이블에 행이 아예 없다 — pipeline:universe 직후,
  // pipeline:scores가 아직 이 회사를 처리하지 않은 상태(Finding 1). loadCompanies가
  // INNER JOIN latest_scores를 쓰면 이 회사 자체가 결과에서 통째로 사라진다.
  raw.prepare(
    `INSERT INTO companies (cik, ticker, name, is_active, first_seen, last_updated)
     VALUES (103, 'SENS', 'SENS Inc', 1, '2026-08-09', '2026-08-09')`,
  ).run()
  raw.prepare(
    `INSERT INTO company_industry (cik, industry_slug, theme_slug, is_primary, source)
     VALUES (103, 'sensors', 'ai-software-semi', 1, 'sic')`,
  ).run()
  // scores 행 없음(의도적)

  // optics: 정상적으로 점수가 있는 CHALLENGER 한 곳 + WARNING 레드플래그(CRITICAL 아님).
  raw.prepare(
    `INSERT INTO companies (cik, ticker, name, is_active, first_seen, last_updated)
     VALUES (104, 'OPTX', 'OPTX Inc', 1, '2026-08-09', '2026-08-09')`,
  ).run()
  raw.prepare(
    `INSERT INTO company_industry (cik, industry_slug, theme_slug, is_primary, source)
     VALUES (104, 'optics', 'ai-software-semi', 1, 'sic')`,
  ).run()
  raw.prepare(
    `INSERT INTO scores (cik, as_of, tenbagger, completeness, category, engine_version)
     VALUES (104, '2026-08-09', 55, 1.0, 'CHALLENGER', 'v1')`,
  ).run()
  raw.prepare(
    `INSERT INTO red_flags (cik, as_of, code, severity, message)
     VALUES (104, '2026-08-09', 'DILUTION_WARNING', 'WARNING', 'x')`,
  ).run()
})

describe('getOpportunityMap 갈라진 분기', () => {
  it('LEADER만 있는 Industry는 제외되지 않지만 topCandidate는 null이다', () => {
    const map = getOpportunityMap(raw)
    const ai = map.find((t) => t.slug === 'ai-software-semi')!
    const quantum = ai.industries.find((i) => i.slug === 'quantum')
    expect(quantum).toBeDefined()
    expect(quantum!.candidateCount).toBe(1)
    expect(quantum!.topCandidate).toBeNull()
    // Leader 본인의 점수는 avgTenbagger(맥락용 평균)에는 여전히 반영된다
    expect(quantum!.avgTenbagger).toBe(40)
  })

  it('scores 행은 있지만 tenbagger가 NULL인 회사만 있는 Industry는 제외되지 않지만 avgTenbagger/topCandidate는 null이다', () => {
    const map = getOpportunityMap(raw)
    const ai = map.find((t) => t.slug === 'ai-software-semi')!
    const robotics = ai.industries.find((i) => i.slug === 'robotics')
    expect(robotics).toBeDefined()
    expect(robotics!.candidateCount).toBe(1)
    expect(robotics!.avgTenbagger).toBeNull()
    expect(robotics!.topCandidate).toBeNull()
    expect(robotics!.medianRevenueGrowth).toBeNull()
    expect(robotics!.riskRatio).toBe(0)
  })

  it('scores 행이 아예 없는 회사만 있는 Industry도 제외되지 않는다 (Finding 1)', () => {
    const map = getOpportunityMap(raw)
    const ai = map.find((t) => t.slug === 'ai-software-semi')!
    const sensors = ai.industries.find((i) => i.slug === 'sensors')
    expect(sensors).toBeDefined()
    expect(sensors!.candidateCount).toBe(1)
    expect(sensors!.avgTenbagger).toBeNull()
    expect(sensors!.medianRevenueGrowth).toBeNull()
    expect(sensors!.medianMarketCap).toBeNull()
    expect(sensors!.topCandidate).toBeNull()
    expect(sensors!.riskRatio).toBe(0)
  })

  it('WARNING 레드플래그는 riskRatio에 반영되지 않는다 (Finding 3)', () => {
    const map = getOpportunityMap(raw)
    const ai = map.find((t) => t.slug === 'ai-software-semi')!
    const optics = ai.industries.find((i) => i.slug === 'optics')!
    expect(optics.riskRatio).toBe(0)
    expect(optics.candidateCount).toBe(1)
    expect(optics.topCandidate).toEqual({ ticker: 'OPTX', tenbagger: 55 })
  })
})

describe('getOpportunityMap 스코어링 파이프라인 실행 전(pipeline:universe 직후)', () => {
  it('회사·산업은 있지만 아무도 점수가 없어도 후보 수는 0이 아니다', () => {
    const db = getRawDb(join(mkdtempSync(join(tmpdir(), 'tb-map-prescore-')), 'm.db'))
    runMigrations(db)
    db.prepare(
      `INSERT INTO themes (slug, name, display_order) VALUES ('unscored-verse', 'Unscored Verse', 1)`,
    ).run()
    db.prepare(
      `INSERT INTO industries (slug, theme_slug, name) VALUES ('fresh-industry', 'unscored-verse', 'Fresh Industry')`,
    ).run()
    db.prepare(
      `INSERT INTO companies (cik, ticker, name, is_active, first_seen, last_updated)
       VALUES (201, 'NEWC', 'NEWC Inc', 1, '2026-08-09', '2026-08-09')`,
    ).run()
    db.prepare(
      `INSERT INTO company_industry (cik, industry_slug, theme_slug, is_primary, source)
       VALUES (201, 'fresh-industry', 'unscored-verse', 1, 'sic')`,
    ).run()
    // scores 행 없음 — pipeline:scores가 아직 실행되지 않은 첫 실행 시점을 재현한다.

    const map = getOpportunityMap(db)
    db.close()

    const fresh = map.find((t) => t.slug === 'unscored-verse')!.industries.find((i) => i.slug === 'fresh-industry')
    expect(fresh).toBeDefined()
    expect(fresh!.candidateCount).toBe(1)

    // page.tsx가 "아직 수집된 데이터가 없습니다" 안내를 띄우는 기준과 동일한 계산.
    const total = map.reduce((sum, t) => sum + t.industries.reduce((n, i) => n + i.candidateCount, 0), 0)
    expect(total).toBeGreaterThan(0)
  })
})

describe('getOpportunityMap 빈 데이터베이스', () => {
  it('Theme과 Company가 전혀 없으면 빈 배열을 반환한다', () => {
    const empty = getRawDb(join(mkdtempSync(join(tmpdir(), 'tb-map-empty-')), 'm.db'))
    runMigrations(empty)
    expect(getOpportunityMap(empty)).toEqual([])
    empty.close()
  })

  it('Theme은 있지만 Industry/Company가 없으면 industries가 빈 Theme을 반환한다', () => {
    const empty = getRawDb(join(mkdtempSync(join(tmpdir(), 'tb-map-empty2-')), 'm.db'))
    runMigrations(empty)
    empty.prepare(
      `INSERT INTO themes (slug, name, display_order) VALUES ('lonely', 'Lonely', 1)`,
    ).run()
    const map = getOpportunityMap(empty)
    expect(map).toEqual([{ slug: 'lonely', name: 'Lonely', displayOrder: 1, industries: [] }])
    empty.close()
  })
})
