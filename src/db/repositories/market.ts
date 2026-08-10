import type Database from 'better-sqlite3'
import type { SharesBasis } from '@/domain/types'

export type MarketRow = {
  cik: number
  date: string
  price: number | null
  sharesOutstanding: number | null
  marketCap: number | null
  volume: number | null
  /** 시가총액에 쓴 발행주식수의 출처 — sharesOutstanding이 null이면 이것도 null이다. */
  sharesBasis: SharesBasis | null
}

export function upsertMarketData(raw: Database.Database, row: MarketRow): void {
  raw
    .prepare(
      `INSERT INTO market_data (cik, date, price, shares_outstanding, market_cap, volume, shares_basis)
       VALUES (@cik, @date, @price, @sharesOutstanding, @marketCap, @volume, @sharesBasis)
       ON CONFLICT(cik, date) DO UPDATE SET
         price = excluded.price,
         shares_outstanding = excluded.shares_outstanding,
         market_cap = excluded.market_cap,
         volume = excluded.volume,
         shares_basis = excluded.shares_basis`,
    )
    .run(row)
}

export function getLatestMarketData(
  raw: Database.Database,
  cik: number,
): MarketRow | null {
  const r = raw
    .prepare(
      `SELECT cik, date, price, shares_outstanding AS sharesOutstanding,
              market_cap AS marketCap, volume, shares_basis AS sharesBasis
       FROM market_data WHERE cik = ? ORDER BY date DESC LIMIT 1`,
    )
    .get(cik) as MarketRow | undefined
  return r ?? null
}
