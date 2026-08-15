import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { getRawDb, runMigrations } from '@/db/client'
import { getDataFreshness } from '@/app/_queries/freshness'

function newDb(prefix: string): Database.Database {
  const raw = getRawDb(join(mkdtempSync(join(tmpdir(), prefix)), 'f.db'))
  runMigrations(raw)
  return raw
}

describe('getDataFreshness — 세 축의 데이터 시점', () => {
  let raw: Database.Database

  beforeAll(() => {
    raw = newDb('tb-fresh-')
    // 축마다 회사별로 시점이 다르다 — 유니버스 전체의 최신 시점이 나와야 한다.
    const price = raw.prepare(
      `INSERT INTO market_data (cik, date, price, market_cap) VALUES (?, ?, 10, 1e9)`,
    )
    price.run(1, '2026-08-06')
    price.run(2, '2026-08-10')

    const fin = raw.prepare(
      `INSERT INTO financials (cik, period_end, period_type, computed_at)
       VALUES (?, ?, 'TTM', ?)`,
    )
    fin.run(1, '2026-06-30', '2026-08-11T10:53:54.403Z')
    fin.run(2, '2026-06-30', '2026-08-09T01:00:00.000Z')

    const score = raw.prepare(
      `INSERT INTO scores (cik, as_of, tenbagger, completeness, category, engine_version)
       VALUES (?, ?, 70, 0.9, 'CHALLENGER', 'v1')`,
    )
    score.run(1, '2026-08-11')
    score.run(1, '2026-08-15')
    score.run(2, '2026-08-11')
  })

  it('주가·재무·스코어의 가장 최근 시점을 각각 돌려준다', () => {
    expect(getDataFreshness(raw)).toEqual({
      priceDate: '2026-08-10',
      financialsAt: '2026-08-11T10:53:54.403Z',
      scoreAsOf: '2026-08-15',
    })
  })
})

describe('getDataFreshness — 빈 데이터베이스', () => {
  it('행이 하나도 없는 축은 null이다', () => {
    const raw = newDb('tb-fresh-empty-')
    expect(getDataFreshness(raw)).toEqual({
      priceDate: null,
      financialsAt: null,
      scoreAsOf: null,
    })
    raw.close()
  })
})
