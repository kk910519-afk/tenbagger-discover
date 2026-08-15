// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
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

/**
 * 정적 사이트로 바뀌면서 판정 기준이 "방문자의 시계"에서 "스냅샷 기준일"로 옮겨졌다.
 * 아래 두 describe가 그 결정을 고정한다.
 */
describe('DataAsOf — 스냅샷 기준일 고지', () => {
  beforeAll(() => {
    const { dbPath, raw } = newDb('tb-asof-snapshot-')
    process.env.DATABASE_PATH = dbPath
    process.env.NEXT_PUBLIC_SNAPSHOT_DATE = '2026-08-15'
    seed(raw, {
      priceDate: '2026-08-14',
      financialsAt: '2026-08-11T10:00:00.000Z',
      scoreAsOf: '2026-08-15',
    })
    raw.close()
  })

  afterAll(() => {
    delete process.env.NEXT_PUBLIC_SNAPSHOT_DATE
  })

  it('이 페이지가 그 날짜에 만들어진 스냅샷이라고 문장으로 말한다', () => {
    const { container } = render(DataAsOf())
    const note = container.querySelector('.site-asof-note')?.textContent ?? ''
    expect(note).toContain('2026-08-15')
    expect(note).toContain('정적 스냅샷')
    // "실시간이 아니다"까지 말해야 지난주 주가를 오늘 주가로 읽는 일이 막힌다.
    expect(note).toContain('실시간 시세가 아니며')
  })

  it('기준일을 기계가 읽을 수 있게 time[dateTime]으로도 적는다', () => {
    const { container } = render(DataAsOf())
    expect(container.querySelector('time')?.getAttribute('dateTime')).toBe('2026-08-15')
  })

  it('세 축의 날짜는 그대로 함께 보여준다 — 갱신 주기가 달라 합칠 수 없다', () => {
    const { container } = render(DataAsOf())
    const axisText = (axis: string) =>
      container.querySelector(`[data-axis="${axis}"]`)?.textContent ?? ''
    expect(axisText('price')).toBe('주가2026-08-14')
    expect(axisText('financials')).toBe('재무2026-08-11')
    expect(axisText('scores')).toBe('스코어2026-08-15')
  })
})

describe('DataAsOf — STALE은 방문자의 시계가 아니라 스냅샷 기준일에 대고 잰다', () => {
  beforeAll(() => {
    const { dbPath, raw } = newDb('tb-asof-frozen-')
    process.env.DATABASE_PATH = dbPath
    // 오래 전에 뜬 스냅샷. 데이터는 그 시점 기준으로는 전부 신선했다.
    process.env.NEXT_PUBLIC_SNAPSHOT_DATE = '2020-01-10'
    seed(raw, {
      priceDate: '2020-01-08',
      financialsAt: '2020-01-05T10:00:00.000Z',
      scoreAsOf: '2020-01-10',
    })
    raw.close()
  })

  afterAll(() => {
    delete process.env.NEXT_PUBLIC_SNAPSHOT_DATE
  })

  /**
   * 이 테스트가 막는 것이 "늑대가 나타났다"다. 방문자의 시계로 재면 이 페이지는 몇 해가
   * 지난 지금 세 축이 전부 STALE이 되고, 배지는 진짜로 수집이 밀린 축을 더는 구별해 주지
   * 못한다. 스냅샷 기준일에 대고 재면 배지는 "이 스냅샷을 뜰 때 수집이 밀려 있었는가"라는
   * 원래 질문에 답하고, 그 답은 시간이 지나도 변하지 않는다.
   */
  it('스냅샷 시점에 신선했던 데이터는 몇 해가 지나도 STALE이 되지 않는다', () => {
    const { container } = render(DataAsOf())
    expect(container.textContent).not.toContain('STALE')
  })

  it('페이지가 얼마나 오래됐는지는 배지가 아니라 기준일이 답한다', () => {
    const { container } = render(DataAsOf())
    expect(container.querySelector('time')?.getAttribute('dateTime')).toBe('2020-01-10')
  })

  it('반대로 스냅샷 시점에 이미 밀려 있던 축은 그 사실을 영구히 남긴다', () => {
    const { dbPath, raw } = newDb('tb-asof-frozen-stale-')
    process.env.DATABASE_PATH = dbPath
    // 주가만 스냅샷보다 30일 밀려 있었다(임계 5일).
    seed(raw, {
      priceDate: '2019-12-11',
      financialsAt: '2020-01-05T10:00:00.000Z',
      scoreAsOf: '2020-01-10',
    })
    raw.close()
    const { container } = render(DataAsOf())
    const badges = [...container.querySelectorAll('span')].filter((el) => el.textContent === 'STALE')
    expect(badges).toHaveLength(1)
    expect(badges[0]!.closest('[data-axis]')?.getAttribute('data-axis')).toBe('price')
  })
})
