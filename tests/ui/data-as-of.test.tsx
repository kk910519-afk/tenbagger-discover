// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cleanup, render } from '@testing-library/react'
import type Database from 'better-sqlite3'
import { getRawDb, runMigrations } from '@/db/client'
import { DataAsOf } from '@/app/_components/DataAsOf'

afterEach(() => cleanup())

const DAY_MS = 86_400_000

/** 오늘로부터 n일 전의 YYYY-MM-DD. 설정된 staleness 임계에 맞춰 결정적으로 테스트한다. */
function daysAgo(n: number): string {
  return new Date(Date.now() - n * DAY_MS).toISOString().slice(0, 10)
}

function newDb(prefix: string): { dbPath: string; raw: Database.Database } {
  const dbPath = join(mkdtempSync(join(tmpdir(), prefix)), 'd.db')
  const raw = getRawDb(dbPath)
  runMigrations(raw)
  return { dbPath, raw }
}

function seed(
  raw: Database.Database,
  { priceDate, financialsAt, scoreAsOf }: { priceDate: string; financialsAt: string; scoreAsOf: string },
) {
  raw.prepare(
    `INSERT INTO market_data (cik, date, price, market_cap) VALUES (1, ?, 10, 1e9)`,
  ).run(priceDate)
  raw.prepare(
    `INSERT INTO financials (cik, period_end, period_type, computed_at)
     VALUES (1, '2026-06-30', 'TTM', ?)`,
  ).run(financialsAt)
  raw.prepare(
    `INSERT INTO scores (cik, as_of, tenbagger, completeness, category, engine_version)
     VALUES (1, ?, 70, 0.9, 'CHALLENGER', 'v1')`,
  ).run(scoreAsOf)
}

describe('DataAsOf — 세 축이 모두 임계 안에 있는 경우', () => {
  beforeAll(() => {
    const { dbPath, raw } = newDb('tb-asof-fresh-')
    process.env.DATABASE_PATH = dbPath
    // price_days: 5, financials_days: 120, scores_days: 14 — 전부 임계 안
    seed(raw, {
      priceDate: daysAgo(2),
      financialsAt: `${daysAgo(4)}T10:00:00.000Z`,
      scoreAsOf: daysAgo(1),
    })
    raw.close()
  })

  it('주가·재무·스코어 세 축의 날짜를 각각 보여준다', () => {
    const { container } = render(DataAsOf())
    // 축 사이 여백은 CSS(gap)가 만든다 — 한 문자열로 잇지 않고 축 단위로 확인한다.
    const axisText = (axis: string) =>
      container.querySelector(`[data-axis="${axis}"]`)?.textContent ?? ''
    expect(axisText('price')).toBe(`주가${daysAgo(2)}`)
    expect(axisText('financials')).toBe(`재무${daysAgo(4)}`)
    expect(axisText('scores')).toBe(`스코어${daysAgo(1)}`)
  })

  it('신선한 축에는 STALE을 붙이지 않는다', () => {
    const { container } = render(DataAsOf())
    expect(container.textContent).not.toContain('STALE')
  })
})

describe('DataAsOf — 주가만 임계를 넘긴 경우', () => {
  beforeAll(() => {
    const { dbPath, raw } = newDb('tb-asof-stale-price-')
    process.env.DATABASE_PATH = dbPath
    // 주가만 12일 전(임계 5일 초과), 재무·스코어는 임계 안
    seed(raw, {
      priceDate: daysAgo(12),
      financialsAt: `${daysAgo(12)}T10:00:00.000Z`,
      scoreAsOf: daysAgo(0),
    })
    raw.close()
  })

  it('임계를 넘긴 주가에만 STALE을 한 번 붙인다', () => {
    const { container } = render(DataAsOf())
    const badges = [...container.querySelectorAll('span')].filter((el) => el.textContent === 'STALE')
    expect(badges).toHaveLength(1)
    // STALE 배지는 주가 항목 안에 있어야 한다 — 재무(120일 임계) 쪽이 아니라.
    const priceItem = badges[0]!.closest('[data-axis]')
    expect(priceItem?.getAttribute('data-axis')).toBe('price')
  })
})

describe('DataAsOf — 데이터가 하나도 없는 경우', () => {
  beforeAll(() => {
    const { dbPath, raw } = newDb('tb-asof-empty-')
    process.env.DATABASE_PATH = dbPath
    raw.close()
  })

  it('아무것도 렌더링하지 않는다 — 파이프라인 미실행 안내는 홈이 맡는다', () => {
    const { container } = render(DataAsOf())
    expect(container.textContent).toBe('')
  })
})
