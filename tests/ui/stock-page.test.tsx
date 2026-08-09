// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cleanup, render } from '@testing-library/react'
import { getRawDb, runMigrations } from '@/db/client'
import StockPage from '@/app/stock/[ticker]/page'

afterEach(() => cleanup())

/**
 * FactorBreakdown/StrengthWeakness의 컴포넌트 테스트는 데이터 계층
 * (d.factors.length === 0)까지만 확인했지, 실제로 사용자가 읽는 page.tsx의
 * JSX 분기(`isScored ? ... : ...`)는 한 번도 렌더링되지 않았다. 조건문이
 * 뒤집히거나 문구가 오타 나도 기존 테스트는 전부 통과했을 것이다.
 * 이 파일은 StockPage 서버 컴포넌트를 실제로 호출해서 렌더링한 결과를 검증한다.
 *
 * Next.js 서버 컴포넌트는 async 함수이므로 `await StockPage({ params })`로
 * JSX를 먼저 얻은 뒤 그 결과를 Testing Library에 넘긴다. DB는
 * `DATABASE_PATH` 환경변수로 주입한다(getRawDb()의 기본 인자가 이 값을 읽는다).
 */
beforeAll(() => {
  const dbPath = join(mkdtempSync(join(tmpdir(), 'tb-stock-page-')), 'p.db')
  process.env.DATABASE_PATH = dbPath
  const raw = getRawDb(dbPath)
  runMigrations(raw)

  raw.prepare(
    `INSERT INTO themes (slug, name, display_order) VALUES ('theme1', 'Theme One', 1)`,
  ).run()
  raw.prepare(
    `INSERT INTO industries (slug, theme_slug, name) VALUES ('ind1', 'theme1', 'Industry One')`,
  ).run()

  // 스코어링 완료 + 산업 분류는 수동 교정(override) + Red Flag 없음
  raw.prepare(
    `INSERT INTO companies (cik, ticker, name, sic, exchange, is_active, first_seen, last_updated)
     VALUES (501, 'CLEANCO', 'Clean Co', '7372', 'Q', 1, '2026-08-09', '2026-08-09')`,
  ).run()
  raw.prepare(
    `INSERT INTO company_industry (cik, industry_slug, theme_slug, is_primary, source)
     VALUES (501, 'ind1', 'theme1', 1, 'override')`,
  ).run()
  raw.prepare(
    `INSERT INTO scores (cik, as_of, tenbagger, completeness, category, engine_version)
     VALUES (501, '2026-08-09', 70, 0.9, 'CHALLENGER', 'tenbagger-1.0.0')`,
  ).run()
  raw.prepare(
    `INSERT INTO score_factors
       (cik, as_of, engine, factor_key, raw, points, weight, status, percentile, detail)
     VALUES (501, '2026-08-09', 'tenbagger', 'revenue_growth', 0.3, 15, 20, 'SCORED', 0.7, 'TTM 매출 +30.0%')`,
  ).run()
  // red_flags 행 없음 — 실제로 검사했는데 깨끗한 상태

  // 스코어링 미실행(scores 행 없음) + 산업 분류는 SIC 기본값
  raw.prepare(
    `INSERT INTO companies (cik, ticker, name, sic, exchange, is_active, first_seen, last_updated)
     VALUES (502, 'FRESHCO', 'Fresh Co', '3674', 'Q', 1, '2026-08-09', '2026-08-09')`,
  ).run()
  raw.prepare(
    `INSERT INTO company_industry (cik, industry_slug, theme_slug, is_primary, source)
     VALUES (502, 'ind1', 'theme1', 1, 'sic')`,
  ).run()
  // scores/score_factors/red_flags 행 없음 — pipeline:universe 직후를 재현한다

  raw.close()
})

const paramsFor = (ticker: string) => Promise.resolve({ ticker })

describe('StockPage — Risks 섹션은 "미실행"과 "깨끗함"을 구분해서 보여준다', () => {
  it('스코어링된 회사는 Red Flag가 0개면 "감지된 Red Flag 없음"을 보여주고 "미실행" 문구는 없다', async () => {
    const jsx = await StockPage({ params: paramsFor('CLEANCO') })
    const { container } = render(jsx)
    expect(container.textContent).toContain('감지된 Red Flag 없음')
    expect(container.textContent).not.toContain('스코어링 미실행 — Red Flag 판정 전')
  })

  it('스코어링되지 않은 회사는 "스코어링 미실행 — Red Flag 판정 전"을 보여주고 "감지된 Red Flag 없음"은 없다', async () => {
    const jsx = await StockPage({ params: paramsFor('FRESHCO') })
    const { container } = render(jsx)
    expect(container.textContent).toContain('스코어링 미실행 — Red Flag 판정 전')
    expect(container.textContent).not.toContain('감지된 Red Flag 없음')
  })

  it('스코어링되지 않은 회사는 Tenbagger Analysis 섹션도 "스코어링 미실행" 안내로 대체된다', async () => {
    const jsx = await StockPage({ params: paramsFor('FRESHCO') })
    const { container } = render(jsx)
    expect(container.textContent).toContain('스코어링 미실행 — 파이프라인이 아직 이 종목을 채점하지 않았습니다')
  })
})

describe('StockPage — SIC 기본 분류 안내는 SIC 출처일 때만 뜬다', () => {
  it('SIC로 분류된 회사는 "(SIC 기본 분류 — 수동 교정 없음)" 문구가 뜬다', async () => {
    const jsx = await StockPage({ params: paramsFor('FRESHCO') })
    const { container } = render(jsx)
    expect(container.textContent).toContain('SIC 기본 분류 — 수동 교정 없음')
  })

  it('수동 교정(override)된 회사는 그 문구가 뜨지 않는다', async () => {
    const jsx = await StockPage({ params: paramsFor('CLEANCO') })
    const { container } = render(jsx)
    expect(container.textContent).not.toContain('SIC 기본 분류')
  })
})

describe('StockPage — Overview에 회사 정보(CompanyFacts) 블록이 있다', () => {
  it('Overview 영역에 공식 업종/거래소/회계연도 말/설립 주/EDGAR 링크가 렌더링된다', async () => {
    const jsx = await StockPage({ params: paramsFor('CLEANCO') })
    const { container } = render(jsx)
    expect(container.textContent).toContain('공식 업종')
    expect(container.textContent).toContain('거래소')
    expect(container.textContent).toContain('회계연도 말')
    expect(container.textContent).toContain('설립 주(州)')
    const link = container.querySelector('a[href*="browse-edgar"]') as HTMLAnchorElement
    expect(link).not.toBeNull()
    expect(link.getAttribute('href')).toContain('CIK=0000000501') // cik=501, 10자리 0-padding
    expect(link.getAttribute('target')).toBe('_blank')
  })

  it('설립 주 정보가 없는 회사는 em dash를 보여준다(0이나 빈칸이 아니다)', async () => {
    const jsx = await StockPage({ params: paramsFor('CLEANCO') })
    const { container } = render(jsx)
    const dt = Array.from(container.querySelectorAll('dt')).find(
      (el) => el.textContent === '설립 주(州)',
    )!
    const dd = dt.nextElementSibling as HTMLElement
    expect(dd.textContent).toBe('—')
  })
})
