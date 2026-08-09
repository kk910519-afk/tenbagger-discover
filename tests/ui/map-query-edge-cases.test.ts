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
            ('robotics', 'ai-software-semi', 'Robotics')`,
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

  // robotics: 회사는 있지만 tenbagger 점수가 아직 계산되지 않았다(NULL).
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

  it('점수가 없는 회사만 있는 Industry는 제외되지 않지만 avgTenbagger/topCandidate는 null이다', () => {
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
