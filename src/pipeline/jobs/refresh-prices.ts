import type Database from 'better-sqlite3'
import type { PriceProvider } from '@/providers/types'
import { upsertMarketData } from '@/db/repositories/market'
import { runJob, type JobStats } from '@/pipeline/runner'

export type PriceDeps = { raw: Database.Database; prices: PriceProvider }

type Target = { cik: number; ticker: string; sharesOutstanding: number | null }

export async function refreshPrices(deps: PriceDeps): Promise<JobStats> {
  const { raw, prices } = deps

  return runJob(raw, 'prices', async () => {
    // 발행주식수는 가장 최근 기간의 값을 쓴다. TTM이 없으면 분기·연간 어느 쪽이든 최신을 택한다.
    const targets = raw
      .prepare(
        `SELECT c.cik, c.ticker,
                (SELECT f.shares_outstanding FROM financials f
                  WHERE f.cik = c.cik AND f.shares_outstanding IS NOT NULL
                  ORDER BY f.period_end DESC LIMIT 1) AS sharesOutstanding
         FROM companies c
         JOIN company_industry ci ON ci.cik = c.cik
         WHERE c.is_active = 1
         ORDER BY c.cik`,
      )
      .all() as Target[]

    let quoted = 0
    let noQuote = 0
    let missingShares = 0

    for (const t of targets) {
      const q = await prices.fetchQuote(t.ticker)
      if (!q) { noQuote++; continue }
      if (t.sharesOutstanding === null) missingShares++
      upsertMarketData(raw, {
        cik: t.cik,
        date: q.date,
        price: q.price,
        sharesOutstanding: t.sharesOutstanding,
        marketCap: t.sharesOutstanding === null ? null : q.price * t.sharesOutstanding,
        volume: null, // Finnhub 무료 티어 /quote는 거래량을 제공하지 않는다 (설계문서 §5.3)
      })
      quoted++
    }

    return { targets: targets.length, quoted, noQuote, missingShares, provider: prices.name }
  })
}
