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
    // 회계연도가 역년과 일치하는 회사(대다수)는 Annual/Q4/TTM이 같은 period_end를 공유해
    // financials PK (cik, period_end, period_type) 상 세 행이 동률이 된다. shares_outstanding은
    // 세 period_type 모두 같은 시점의 pickInstant에서 나오므로 값은 일치해야 하지만, 그 "일치"를
    // 강제하는 코드는 없다 — 그래서 동률을 결정론적으로 깨기 위해 period_type 우선순위
    // (Q > TTM > A)를 명시한다. 더 나은 값을 고르려는 것이 아니라 재실행 시 항상 같은 행을
    // 고르게 하려는 것뿐이다.
    const targets = raw
      .prepare(
        `SELECT c.cik, c.ticker,
                (SELECT f.shares_outstanding FROM financials f
                  WHERE f.cik = c.cik AND f.shares_outstanding IS NOT NULL
                  ORDER BY f.period_end DESC,
                           CASE f.period_type WHEN 'Q' THEN 0 WHEN 'TTM' THEN 1 WHEN 'A' THEN 2 ELSE 3 END
                  LIMIT 1) AS sharesOutstanding
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
