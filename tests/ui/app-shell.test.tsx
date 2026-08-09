// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cleanup, render } from '@testing-library/react'
import { getRawDb, runMigrations } from '@/db/client'
import { AppShell } from '@/app/_components/AppShell'
import Home from '@/app/page'
import IndustryPage from '@/app/industry/[slug]/page'
import StockPage from '@/app/stock/[ticker]/page'

afterEach(() => cleanup())

/**
 * 세 라우트 모두 실제 RootLayout이 감싸는 AppShell을 그대로 통과시켜서 렌더링한다.
 * 페이지 단위 테스트(home-page.test.tsx, stock-page.test.tsx 등)는 셸 없이
 * 페이지 컴포넌트만 호출하므로, 셸 자체가 세 라우트 위에서 실제로 렌더링되는지는
 * 이 파일에서만 검증된다.
 */
beforeAll(() => {
  const dbPath = join(mkdtempSync(join(tmpdir(), 'tb-shell-')), 's.db')
  process.env.DATABASE_PATH = dbPath
  const raw = getRawDb(dbPath)
  runMigrations(raw)

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

  raw.close()
})

const paramsFor = (v: string) => Promise.resolve({ all: undefined, slug: v, ticker: v })

describe('AppShell — 세 라우트 모두에서 셸이 함께 렌더링된다', () => {
  it('홈: 브랜드 마크·상단 섹션·사이드바가 페이지 콘텐츠와 함께 렌더링된다', () => {
    const { container } = render(<AppShell>{Home()}</AppShell>)
    expect(container.textContent).toContain('TENBAGGER')
    expect(container.textContent).toContain('DISCOVERY')
    expect(container.querySelector('nav[aria-label="주요 섹션"]')).not.toBeNull()
    expect(container.querySelector('nav[aria-label="세부 기능"]')).not.toBeNull()
    expect(container.textContent).toContain('Growth Opportunity Map')
  })

  it('Industry 페이지: 셸과 함께 렌더링되고 후보 그룹이 카드로 나온다', async () => {
    const jsx = await IndustryPage({ params: paramsFor('semiconductors'), searchParams: paramsFor('semiconductors') })
    const { container } = render(<AppShell>{jsx}</AppShell>)
    expect(container.querySelector('nav[aria-label="주요 섹션"]')).not.toBeNull()
    expect(container.textContent).toContain('Semiconductors')
  })

  it('Stock 상세 페이지: 셸과 함께 렌더링되고 종목 헤더가 나온다', async () => {
    const jsx = await StockPage({ params: paramsFor('ACME') })
    const { container } = render(<AppShell>{jsx}</AppShell>)
    expect(container.querySelector('nav[aria-label="주요 섹션"]')).not.toBeNull()
    expect(container.textContent).toContain('ACME')
    expect(container.textContent).toContain('Acme Corp')
  })
})

describe('AppShell — 활성 항목은 링크, 미구현 항목은 비활성 버튼', () => {
  it('Overview/Discovery는 "/"로 가는 <a>다', () => {
    const { container } = render(<AppShell>{Home()}</AppShell>)
    const discoveryLink = Array.from(container.querySelectorAll('nav[aria-label="주요 섹션"] a')).find(
      (el) => el.textContent?.includes('Discovery'),
    )
    expect(discoveryLink).not.toBeUndefined()
    expect(discoveryLink?.getAttribute('href')).toBe('/')

    const overviewLink = Array.from(container.querySelectorAll('nav[aria-label="세부 기능"] a')).find(
      (el) => el.textContent?.includes('Overview'),
    )
    expect(overviewLink).not.toBeUndefined()
    expect(overviewLink?.getAttribute('href')).toBe('/')
  })

  it('미구현 항목(Screener)은 <a>가 아니라 disabled 버튼이고, 스크린리더에 비활성 상태와 phase를 알린다', () => {
    const { container } = render(<AppShell>{Home()}</AppShell>)
    const buttons = Array.from(container.querySelectorAll('button')).filter((el) =>
      el.textContent?.includes('Screener'),
    )
    expect(buttons.length).toBeGreaterThan(0)
    for (const btn of buttons) {
      expect(btn.tagName).toBe('BUTTON')
      expect(btn.hasAttribute('disabled')).toBe(true)
      expect(btn.getAttribute('aria-disabled')).toBe('true')
      expect(btn.getAttribute('aria-label')).toContain('Phase 2')
    }
    // 링크로 위장하지 않는다 — href="/screener" 같은 죽은 링크가 없어야 한다
    expect(container.querySelector('a[href*="screener" i]')).toBeNull()
  })

  it('사이드바의 모든 미구현 항목은 화면에 보이는 "P{n}" phase 배지를 함께 보여준다', () => {
    const { container } = render(<AppShell>{Home()}</AppShell>)
    const sidebar = container.querySelector('nav[aria-label="세부 기능"]')!
    expect(sidebar.textContent).toContain('P2')
    expect(sidebar.textContent).toContain('P3')
    expect(sidebar.textContent).toContain('P4')
  })
})
