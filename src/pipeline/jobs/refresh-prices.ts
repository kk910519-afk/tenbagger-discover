import type Database from 'better-sqlite3'
import type { PriceProvider } from '@/providers/types'
import type { SharesBasis } from '@/domain/types'
import { upsertMarketData } from '@/db/repositories/market'
import { runJob, type JobStats } from '@/pipeline/runner'

export type PriceDeps = { raw: Database.Database; prices: PriceProvider }

type Target = {
  cik: number
  ticker: string
  sharesReported: number | null
  sharesDiluted: number | null
}

// 표지 발행주식수(EntityCommonStockSharesOutstanding)가 없는 회사는 희석가중평균주식수
// (WeightedAverageNumberOfDilutedSharesOutstanding)로 대체한다 — 둘 다 회사가 보고한
// 숫자이지만 표지값은 항상 최우선이다(시점값 vs 기간평균값, 설계문서 §시가총액 근사치 참고).
function pickShares(t: Target): { sharesOutstanding: number | null; sharesBasis: SharesBasis | null } {
  if (t.sharesReported !== null) return { sharesOutstanding: t.sharesReported, sharesBasis: 'reported' }
  if (t.sharesDiluted !== null) return { sharesOutstanding: t.sharesDiluted, sharesBasis: 'diluted_fallback' }
  return { sharesOutstanding: null, sharesBasis: null }
}

export async function refreshPrices(deps: PriceDeps): Promise<JobStats> {
  const { raw, prices } = deps

  return runJob(raw, 'prices', async () => {
    // 발행주식수는 가장 최근 기간의 값을 쓴다. TTM이 없으면 분기·연간 어느 쪽이든 최신을 택한다.
    // 회계연도가 역년과 일치하는 회사(대다수)는 Annual/Q4/TTM이 같은 period_end를 공유해
    // financials PK (cik, period_end, period_type) 상 세 행이 동률이 된다. shares_outstanding은
    // 세 period_type 모두 같은 시점의 pickInstant에서 나오므로 값은 일치해야 하지만, 그 "일치"를
    // 강제하는 코드는 없다 — 그래서 동률을 결정론적으로 깨기 위해 period_type 우선순위
    // (Q > TTM > A)를 명시한다. 더 나은 값을 고르려는 것이 아니라 재실행 시 항상 같은 행을
    // 고르게 하려는 것뿐이다. shares_diluted 폴백도 같은 이유로 같은 우선순위를 쓴다 — 두
    // 서브쿼리가 서로 다른 규칙으로 "최신"을 고르면 재실행 시 어느 값이 살아남을지 예측할 수 없다.
    const targets = raw
      .prepare(
        `SELECT c.cik, c.ticker,
                (SELECT f.shares_outstanding FROM financials f
                  WHERE f.cik = c.cik AND f.shares_outstanding IS NOT NULL
                  ORDER BY f.period_end DESC,
                           CASE f.period_type WHEN 'Q' THEN 0 WHEN 'TTM' THEN 1 WHEN 'A' THEN 2 ELSE 3 END
                  LIMIT 1) AS sharesReported,
                (SELECT f.shares_diluted FROM financials f
                  WHERE f.cik = c.cik AND f.shares_diluted IS NOT NULL
                  ORDER BY f.period_end DESC,
                           CASE f.period_type WHEN 'Q' THEN 0 WHEN 'TTM' THEN 1 WHEN 'A' THEN 2 ELSE 3 END
                  LIMIT 1) AS sharesDiluted
         FROM companies c
         JOIN company_industry ci ON ci.cik = c.cik
         WHERE c.is_active = 1
         ORDER BY c.cik`,
      )
      .all() as Target[]

    let quoted = 0
    let noQuote = 0
    let missingShares = 0
    let fallbackShares = 0

    for (const t of targets) {
      const q = await prices.fetchQuote(t.ticker)
      if (!q) { noQuote++; continue }
      const { sharesOutstanding, sharesBasis } = pickShares(t)
      if (sharesOutstanding === null) missingShares++
      else if (sharesBasis === 'diluted_fallback') fallbackShares++
      upsertMarketData(raw, {
        cik: t.cik,
        date: q.date,
        price: q.price,
        sharesOutstanding,
        marketCap: sharesOutstanding === null ? null : q.price * sharesOutstanding,
        sharesBasis,
        volume: null, // Finnhub 무료 티어 /quote는 거래량을 제공하지 않는다 (설계문서 §5.3)
      })
      quoted++
    }

    return {
      targets: targets.length, quoted, noQuote, missingShares, fallbackShares,
      provider: prices.name,
    }
  })
}
