import type Database from 'better-sqlite3'

export type MarketRow = {
  cik: number
  date: string
  price: number | null
  sharesOutstanding: number | null
  marketCap: number | null
  volume: number | null
}

export function upsertMarketData(raw: Database.Database, row: MarketRow): void {
  raw
    .prepare(
      `INSERT INTO market_data (cik, date, price, shares_outstanding, market_cap, volume)
       VALUES (@cik, @date, @price, @sharesOutstanding, @marketCap, @volume)
       ON CONFLICT(cik, date) DO UPDATE SET
         price = excluded.price,
         shares_outstanding = excluded.shares_outstanding,
         market_cap = excluded.market_cap,
         volume = excluded.volume`,
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
              market_cap AS marketCap, volume
       FROM market_data WHERE cik = ? ORDER BY date DESC LIMIT 1`,
    )
    .get(cik) as MarketRow | undefined
  return r ?? null
}
