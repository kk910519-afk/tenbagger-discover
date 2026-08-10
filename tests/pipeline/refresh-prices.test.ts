import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { getRawDb, runMigrations } from '@/db/client'
import { refreshPrices } from '@/pipeline/jobs/refresh-prices'
import { getLatestMarketData } from '@/db/repositories/market'
import type { PriceProvider } from '@/providers/types'

const prices: PriceProvider = {
  name: 'test',
  fetchQuote: async (t) => (t === 'NOQUOTE' ? null : { price: 200, date: '2026-08-08' }),
}

let raw: Database.Database
let stats: Record<string, unknown>

beforeAll(async () => {
  raw = getRawDb(join(mkdtempSync(join(tmpdir(), 'tb-px-')), 'p.db'))
  runMigrations(raw)
  const addCompany = (cik: number, ticker: string) => {
    raw.prepare(
      `INSERT INTO companies (cik, ticker, name, is_active, first_seen, last_updated)
       VALUES (?, ?, ?, 1, '2026-08-09', '2026-08-09')`,
    ).run(cik, ticker, ticker)
    raw.prepare(
      `INSERT INTO company_industry (cik, industry_slug, theme_slug, is_primary, source)
       VALUES (?, 'semiconductors', 'ai-software-semi', 1, 'sic')`,
    ).run(cik)
  }
  addCompany(1, 'NVDA')
  addCompany(2, 'NOSHARES')
  addCompany(3, 'NOQUOTE')
  addCompany(4, 'TIEBREAK')
  addCompany(5, 'DILUTEDONLY')
  addCompany(6, 'BOTHSHARES')
  addCompany(7, 'DILTIEBREAK')

  raw.prepare(
    `INSERT INTO financials (cik, period_end, period_type, shares_outstanding, computed_at)
     VALUES (1, '2025-03-31', 'TTM', 1000, '2026-08-09')`,
  ).run()
  raw.prepare(
    `INSERT INTO financials (cik, period_end, period_type, computed_at)
     VALUES (2, '2025-03-31', 'TTM', '2026-08-09')`,
  ).run()

  // 표지 발행주식수(shares_outstanding)가 아예 없고 희석평균주식수(shares_diluted)만
  // 있는 회사 — 폴백이 실제로 쓰이는지 검증한다.
  raw.prepare(
    `INSERT INTO financials (cik, period_end, period_type, shares_diluted, computed_at)
     VALUES (5, '2025-03-31', 'TTM', 2000, '2026-08-09')`,
  ).run()

  // 둘 다 있는 회사 — 표지값이 항상 우선이어야 한다(폴백은 최후의 수단).
  raw.prepare(
    `INSERT INTO financials (cik, period_end, period_type, shares_outstanding, shares_diluted, computed_at)
     VALUES (6, '2025-03-31', 'TTM', 3000, 3500, '2026-08-09')`,
  ).run()

  // 희석주식수 폴백도 period_end 동률을 period_type 우선순위(Q > TTM > A)로 결정론적으로
  // 깨야 한다 — refresh-prices.ts의 서브쿼리가 표지값과 같은 규칙을 쓰는지 확인한다.
  raw.prepare(
    `INSERT INTO financials (cik, period_end, period_type, shares_diluted, computed_at)
     VALUES (7, '2025-12-31', 'A', 9500, '2026-08-09')`,
  ).run()
  raw.prepare(
    `INSERT INTO financials (cik, period_end, period_type, shares_diluted, computed_at)
     VALUES (7, '2025-12-31', 'TTM', 8500, '2026-08-09')`,
  ).run()
  raw.prepare(
    `INSERT INTO financials (cik, period_end, period_type, shares_diluted, computed_at)
     VALUES (7, '2025-12-31', 'Q', 7500, '2026-08-09')`,
  ).run()
  // 역년 회계연도 회사는 Annual/Q4/TTM이 같은 period_end를 공유해 동률이 난다. 세 값을
  // 일부러 다르게 넣어 정렬 우선순위(Q > TTM > A)가 실제로 선택을 결정함을 증명한다 —
  // 값이 같으면 어느 행이 이겼는지 테스트로 알 수 없다.
  raw.prepare(
    `INSERT INTO financials (cik, period_end, period_type, shares_outstanding, computed_at)
     VALUES (4, '2025-12-31', 'A', 9000, '2026-08-09')`,
  ).run()
  raw.prepare(
    `INSERT INTO financials (cik, period_end, period_type, shares_outstanding, computed_at)
     VALUES (4, '2025-12-31', 'TTM', 8000, '2026-08-09')`,
  ).run()
  raw.prepare(
    `INSERT INTO financials (cik, period_end, period_type, shares_outstanding, computed_at)
     VALUES (4, '2025-12-31', 'Q', 7000, '2026-08-09')`,
  ).run()

  stats = await refreshPrices({ raw, prices })
})

describe('refreshPrices', () => {
  it('주가와 주식수로 시가총액을 계산한다', () => {
    const m = getLatestMarketData(raw, 1)!
    expect(m.price).toBe(200)
    expect(m.sharesOutstanding).toBe(1000)
    expect(m.marketCap).toBe(200_000)
    expect(m.date).toBe('2026-08-08')
    expect(m.sharesBasis).toBe('reported')
  })

  it('주식수가 없으면 시가총액은 null이고 주가는 저장한다', () => {
    const m = getLatestMarketData(raw, 2)!
    expect(m.price).toBe(200)
    expect(m.marketCap).toBeNull()
    expect(m.sharesBasis).toBeNull()
  })

  it('시세를 못 받으면 행을 만들지 않는다', () => {
    expect(getLatestMarketData(raw, 3)).toBeNull()
  })

  it('period_end가 동률이면 period_type 우선순위(Q > TTM > A)로 결정론적으로 고른다', () => {
    const m = getLatestMarketData(raw, 4)!
    expect(m.sharesOutstanding).toBe(7000)
    expect(m.marketCap).toBe(1_400_000)
    expect(m.sharesBasis).toBe('reported')
  })

  it('표지 발행주식수가 없으면 희석평균주식수로 폴백하고 basis를 기록한다', () => {
    const m = getLatestMarketData(raw, 5)!
    expect(m.sharesOutstanding).toBe(2000)
    expect(m.marketCap).toBe(400_000)
    expect(m.sharesBasis).toBe('diluted_fallback')
  })

  it('표지 발행주식수와 희석주식수가 둘 다 있으면 표지값이 항상 이긴다', () => {
    const m = getLatestMarketData(raw, 6)!
    expect(m.sharesOutstanding).toBe(3000)
    expect(m.marketCap).toBe(600_000)
    expect(m.sharesBasis).toBe('reported')
  })

  it('희석주식수 폴백도 period_type 우선순위(Q > TTM > A)로 결정론적으로 고른다', () => {
    const m = getLatestMarketData(raw, 7)!
    expect(m.sharesOutstanding).toBe(7500)
    expect(m.marketCap).toBe(1_500_000)
    expect(m.sharesBasis).toBe('diluted_fallback')
  })

  it('통계를 반환한다', () => {
    expect(stats.quoted).toBe(6)
    expect(stats.noQuote).toBe(1)
    expect(stats.missingShares).toBe(1)
    expect(stats.fallbackShares).toBe(2)
  })

  it('재실행해도 같은 날짜 행이 중복되지 않는다', async () => {
    await refreshPrices({ raw, prices })
    const n = raw
      .prepare('SELECT COUNT(*) c FROM market_data WHERE cik = 1')
      .get() as { c: number }
    expect(n.c).toBe(1)
  })

  it('재실행해도 basis가 바뀌지 않는다(결정론적)', async () => {
    await refreshPrices({ raw, prices })
    const m = getLatestMarketData(raw, 5)!
    expect(m.sharesBasis).toBe('diluted_fallback')
  })
})
