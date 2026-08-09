// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cleanup, render } from '@testing-library/react'
import { getRawDb, runMigrations } from '@/db/client'
import Home from '@/app/page'

afterEach(() => cleanup())

function newDb(prefix: string) {
  const dbPath = join(mkdtempSync(join(tmpdir(), prefix)), 'h.db')
  const raw = getRawDb(dbPath)
  runMigrations(raw)
  return { dbPath, raw }
}

describe('Home — 완전히 빈 데이터베이스는 설치 안내만 보여준다', () => {
  beforeAll(() => {
    const { dbPath, raw } = newDb('tb-home-empty-')
    process.env.DATABASE_PATH = dbPath
    raw.close()
  })

  it('설치 안내 문구를 보여주고, Top 5 블록이나 빈 표 껍데기는 렌더링하지 않는다', () => {
    const { container } = render(Home())
    expect(container.textContent).toContain('아직 수집된 데이터가 없습니다')
    expect(container.textContent).not.toContain('Top 5')
    expect(container.querySelector('table')).toBeNull()
  })
})

describe('Home — 후보는 있지만 완전성 기준을 통과한 회사가 하나도 없는 경우', () => {
  beforeAll(() => {
    const { dbPath, raw } = newDb('tb-home-zero-qualifying-')
    process.env.DATABASE_PATH = dbPath

    raw.prepare(`INSERT INTO themes (slug, name, display_order) VALUES ('theme1', 'Theme One', 1)`).run()
    raw.prepare(
      `INSERT INTO industries (slug, theme_slug, name) VALUES ('semiconductors', 'theme1', 'Semiconductors')`,
    ).run()
    raw.prepare(
      `INSERT INTO companies (cik, ticker, name, is_active, first_seen, last_updated)
       VALUES (1, 'LOWDATA', 'LowData Inc', 1, '2026-08-09', '2026-08-09')`,
    ).run()
    raw.prepare(
      `INSERT INTO company_industry (cik, industry_slug, theme_slug, is_primary, source)
       VALUES (1, 'semiconductors', 'theme1', 1, 'sic')`,
    ).run()
    // completeness 0.1 — 실제 min_completeness(설정값)보다 확실히 낮다
    raw.prepare(
      `INSERT INTO scores (cik, as_of, tenbagger, completeness, category, engine_version)
       VALUES (1, '2026-08-09', 90, 0.1, 'EMERGING', 'v1')`,
    ).run()

    raw.close()
  })

  it('빈 데이터베이스 문구와는 다른, "기준 통과 후보 없음" 문구를 보여준다', () => {
    const { container } = render(Home())
    expect(container.textContent).not.toContain('아직 수집된 데이터가 없습니다')
    expect(container.textContent).toContain('통과한 후보가 아직 없습니다')
  })

  it('그 아래 Theme 지도는 정상적으로 렌더링된다', () => {
    const { container } = render(Home())
    expect(container.textContent).toContain('Growth Opportunity Map')
    expect(container.textContent).toContain('Semiconductors')
  })
})

describe('Home — Top 5 헤드라인 블록', () => {
  beforeAll(() => {
    const { dbPath, raw } = newDb('tb-home-top5-')
    process.env.DATABASE_PATH = dbPath

    raw.prepare(`INSERT INTO themes (slug, name, display_order) VALUES ('theme1', 'Theme One', 1)`).run()
    raw.prepare(
      `INSERT INTO industries (slug, theme_slug, name) VALUES ('semiconductors', 'theme1', 'Semiconductors')`,
    ).run()

    raw.prepare(
      `INSERT INTO companies (cik, ticker, name, is_active, first_seen, last_updated)
       VALUES (1, 'ACME', 'Acme Corp', 1, '2026-08-09', '2026-08-09')`,
    ).run()
    raw.prepare(
      `INSERT INTO company_industry (cik, industry_slug, theme_slug, is_primary, source)
       VALUES (1, 'semiconductors', 'theme1', 1, 'sic')`,
    ).run()
    raw.prepare(
      `INSERT INTO scores (cik, as_of, tenbagger, completeness, category, engine_version)
       VALUES (1, '2026-08-09', 91, 1.0, 'EMERGING', 'v1')`,
    ).run()
    raw.prepare(
      `INSERT INTO score_factors (cik, as_of, engine, factor_key, raw, points, weight, status, detail)
       VALUES (1, '2026-08-09', 'tenbagger', 'revenue_growth', 0.4, 20, 20, 'SCORED', 'TTM 매출 +40.0%')`,
    ).run()
    raw.prepare(
      `INSERT INTO red_flags (cik, as_of, code, severity, message)
       VALUES (1, '2026-08-09', 'EXTREME_DILUTION', 'CRITICAL', '희석주식수 급증')`,
    ).run()

    raw.close()
  })

  it('랭크·티커·회사명·산업 링크·점수·근거를 한 행에 보여준다', () => {
    const { container } = render(Home())
    expect(container.textContent).toContain('ACME')
    expect(container.textContent).toContain('Acme Corp')
    expect(container.textContent).toContain('91')
    expect(container.textContent).toContain('TTM 매출 +40.0%')
    const industryLink = container.querySelector('a[href="/industry/semiconductors"]')
    expect(industryLink).not.toBeNull()
  })

  it('종목 상세 페이지로 링크된다', () => {
    const { container } = render(Home())
    const link = container.querySelector('a[href="/stock/ACME"]')
    expect(link).not.toBeNull()
  })

  it('CRITICAL Red Flag를 가진 후보는 RED FLAG 배지를 함께 보여준다', () => {
    const { container } = render(Home())
    expect(container.textContent).toContain('RED FLAG')
  })
})
