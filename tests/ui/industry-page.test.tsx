// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cleanup, render } from '@testing-library/react'
import { getRawDb, runMigrations } from '@/db/client'
import IndustryPage from '@/app/industry/[slug]/page'

afterEach(() => cleanup())

/**
 * page.tsx(홈)는 Card로 다시 감쌌을 뿐 기존 문구를 하나도 바꾸지 않았고, 기존
 * home-page.test.tsx가 이미 그 문구들을 검증한다. Industry 페이지는 지금까지
 * 컴포넌트 단위 테스트가 없었으므로(쿼리 테스트만 있었다), 카드로 감싼 뒤에도
 * ColumnLegend·후보 표·View All 링크·그룹 라벨이 그대로 살아있는지 여기서 검증한다.
 */
function seedCompany(
  db: ReturnType<typeof getRawDb>,
  cik: number, ticker: string, category: string, tenbagger: number,
) {
  db.prepare(
    `INSERT INTO companies (cik, ticker, name, is_active, first_seen, last_updated)
     VALUES (?, ?, ?, 1, '2026-08-09', '2026-08-09')`,
  ).run(cik, ticker, `${ticker} Inc`)
  db.prepare(
    `INSERT INTO company_industry (cik, industry_slug, theme_slug, is_primary, source)
     VALUES (?, 'semiconductors', 'theme1', 1, 'sic')`,
  ).run(cik)
  db.prepare(
    `INSERT INTO scores (cik, as_of, tenbagger, completeness, category, engine_version)
     VALUES (?, '2026-08-09', ?, 0.95, ?, 'v1')`,
  ).run(cik, tenbagger, category)
}

beforeAll(() => {
  const dbPath = join(mkdtempSync(join(tmpdir(), 'tb-industry-page-')), 'i.db')
  process.env.DATABASE_PATH = dbPath
  const raw = getRawDb(dbPath)
  runMigrations(raw)

  raw.prepare(`INSERT INTO themes (slug, name, display_order) VALUES ('theme1', 'Theme One', 1)`).run()
  raw.prepare(
    `INSERT INTO industries (slug, theme_slug, name) VALUES ('semiconductors', 'theme1', 'Semiconductors')`,
  ).run()

  // 11개를 넣어 PREVIEW_COUNT(10)을 넘겨 "View All" 링크가 뜨는지도 확인한다
  for (let i = 1; i <= 11; i += 1) {
    seedCompany(raw, i, `CHAL${i}`, 'CHALLENGER', 100 - i)
  }

  raw.close()
})

const paramsFor = (slug: string, all?: string) => ({
  params: Promise.resolve({ slug }),
  searchParams: Promise.resolve({ all }),
})

describe('IndustryPage — 카드로 감싼 뒤에도 기존 동작이 그대로 유지된다', () => {
  it('산업 이름과 Theme 이름을 보여준다', async () => {
    const jsx = await IndustryPage(paramsFor('semiconductors'))
    const { container } = render(jsx)
    expect(container.textContent).toContain('Semiconductors')
    expect(container.textContent).toContain('Theme One')
  })

  it('ColumnLegend가 페이지에 한 번 렌더링된다', async () => {
    const jsx = await IndustryPage(paramsFor('semiconductors'))
    const { container } = render(jsx)
    expect(container.textContent).toContain('Market Cap')
    expect(container.textContent).toContain('Tenbagger')
  })

  it('Challenger 그룹이 카드 제목으로 렌더링되고 후보 표가 그 안에 있다', async () => {
    const jsx = await IndustryPage(paramsFor('semiconductors'))
    const { container } = render(jsx)
    expect(container.textContent).toContain('Challenger')
    expect(container.querySelector('table')).not.toBeNull()
    expect(container.textContent).toContain('CHAL1')
  })

  it('10개를 넘는 후보는 기본으로 잘리고 "View All Candidates" 링크가 뜬다', async () => {
    const jsx = await IndustryPage(paramsFor('semiconductors'))
    const { container } = render(jsx)
    expect(container.textContent).toContain('View All Candidates (11)')
    expect(container.textContent).not.toContain('CHAL11')
  })

  it('all=1이면 전체 11개가 렌더링되고 View All 링크는 사라진다', async () => {
    const jsx = await IndustryPage(paramsFor('semiconductors', '1'))
    const { container } = render(jsx)
    expect(container.textContent).toContain('CHAL11')
    expect(container.textContent).not.toContain('View All Candidates')
  })
})
