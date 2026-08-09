import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getRawDb, runMigrations } from '@/db/client'
import { loadConfig } from '@/config'
import { getIndustryView } from '@/app/_queries/industry'

const MIN_COMPLETENESS = loadConfig().scoring.min_completeness

/**
 * industry-query.test.ts는 task-25-brief.md의 시나리오를 그대로 검증한다.
 * 그 시나리오에서는 모든 회사가 scores/financials/market_data를 다 갖고 있어서
 * "스코어링 파이프라인이 아직 이 회사를 처리하지 않은 경우"가 한 번도 실행되지 않는다.
 * map-query-edge-cases.test.ts에서 이미 한 번 걸렸던 것과 같은 모양의 버그
 * (scores를 INNER JOIN해서 미스코어링 회사가 통째로 사라지는 문제)가
 * 이 화면에도 반복되지 않는지 별도 DB로 검증한다.
 */
describe('getIndustryView 스코어링 파이프라인 실행 전', () => {
  it('scores 행이 아예 없는 회사도 사라지지 않고 별도 그룹(category: null)에 나타난다', () => {
    const db = getRawDb(join(mkdtempSync(join(tmpdir(), 'tb-ind-edge-')), 'i.db'))
    runMigrations(db)
    db.prepare(
      `INSERT INTO themes (slug, name, display_order) VALUES ('ai-software-semi', 'AI', 1)`,
    ).run()
    db.prepare(
      `INSERT INTO industries (slug, theme_slug, name)
       VALUES ('sensors', 'ai-software-semi', 'Sensors')`,
    ).run()
    db.prepare(
      `INSERT INTO companies (cik, ticker, name, is_active, first_seen, last_updated)
       VALUES (301, 'FRESH', 'FRESH Inc', 1, '2026-08-09', '2026-08-09')`,
    ).run()
    db.prepare(
      `INSERT INTO company_industry (cik, industry_slug, theme_slug, is_primary, source)
       VALUES (301, 'sensors', 'ai-software-semi', 1, 'sic')`,
    ).run()
    // scores/financials/market_data 행 없음 — pipeline:universe 직후를 재현한다.

    const view = getIndustryView(db, 'sensors', MIN_COMPLETENESS)
    db.close()

    expect(view).not.toBeNull()
    const known = view!.groups.map((g) => g.category)
    expect(known).toEqual(['LEADER', 'CHALLENGER', 'EMERGING', null])

    const unscored = view!.groups.find((g) => g.category === null)!
    expect(unscored.rows).toHaveLength(1)
    const r = unscored.rows[0]!
    expect(r.ticker).toBe('FRESH')
    expect(r.category).toBeNull()
    expect(r.tenbagger).toBeNull()
    expect(r.completeness).toBeNull()
    expect(r.marketCap).toBeNull()
    expect(r.revenueGrowth).toBeNull()
    expect(r.grossMargin).toBeNull()
    expect(r.fcfMargin).toBeNull()
    expect(r.totalDebt).toBeNull()
    // 스코어링이 아예 안 됐으니 레드플래그도 계산된 적이 없다 — 0이지 null이 아니다.
    expect(r.criticalCount).toBe(0)
    expect(r.warningCount).toBe(0)
  })

  it('모두 스코어링된 산업에는 category: null 그룹이 생기지 않는다', () => {
    const db = getRawDb(join(mkdtempSync(join(tmpdir(), 'tb-ind-edge2-')), 'i.db'))
    runMigrations(db)
    db.prepare(
      `INSERT INTO themes (slug, name, display_order) VALUES ('ai-software-semi', 'AI', 1)`,
    ).run()
    db.prepare(
      `INSERT INTO industries (slug, theme_slug, name)
       VALUES ('optics', 'ai-software-semi', 'Optics')`,
    ).run()
    db.prepare(
      `INSERT INTO companies (cik, ticker, name, is_active, first_seen, last_updated)
       VALUES (302, 'OPTX', 'OPTX Inc', 1, '2026-08-09', '2026-08-09')`,
    ).run()
    db.prepare(
      `INSERT INTO company_industry (cik, industry_slug, theme_slug, is_primary, source)
       VALUES (302, 'optics', 'ai-software-semi', 1, 'sic')`,
    ).run()
    db.prepare(
      `INSERT INTO scores (cik, as_of, tenbagger, completeness, category, engine_version)
       VALUES (302, '2026-08-09', 55, 1.0, 'CHALLENGER', 'v1')`,
    ).run()

    const view = getIndustryView(db, 'optics', MIN_COMPLETENESS)
    db.close()

    expect(view!.groups.map((g) => g.category)).toEqual(['LEADER', 'CHALLENGER', 'EMERGING'])
  })

  it('회사가 전혀 없는 산업은 세 그룹 모두 빈 배열이다', () => {
    const db = getRawDb(join(mkdtempSync(join(tmpdir(), 'tb-ind-edge3-')), 'i.db'))
    runMigrations(db)
    db.prepare(
      `INSERT INTO themes (slug, name, display_order) VALUES ('ai-software-semi', 'AI', 1)`,
    ).run()
    db.prepare(
      `INSERT INTO industries (slug, theme_slug, name)
       VALUES ('empty-industry', 'ai-software-semi', 'Empty Industry')`,
    ).run()

    const view = getIndustryView(db, 'empty-industry', MIN_COMPLETENESS)
    db.close()

    expect(view!.groups).toEqual([
      { category: 'LEADER', rows: [] },
      { category: 'CHALLENGER', rows: [] },
      { category: 'EMERGING', rows: [] },
    ])
  })
})
