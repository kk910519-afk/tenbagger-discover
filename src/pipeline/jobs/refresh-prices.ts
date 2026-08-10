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

// 주식수를 얼마나 과거까지 소급해 쓸 수 있는지의 상한(일). 회사의 **가장 최근 회계기간**
// 을 기준으로 재며, 값은 normalizer의 INSTANT_LOOKBACK_DAYS와 같은 400일이다 —
// 한 번의 누락된 분기 신고까지는 메워주되 그보다 오래된 주식수는 쓰지 않는다.
//
// 왜 필요한가: 이 쿼리는 `shares_outstanding IS NOT NULL`인 **모든** 기간에서 최신을
// 골랐다. 그래서 표지 발행주식수가 최근 기간에서 사라지거나(종류주 커버리지 가드가
// null로 남긴 경우) 회사가 그 개념을 더 이상 태깅하지 않으면, 수년 전 값이 조용히
// 승격됐다. 실측(신고서 원문 확인):
//   AUR  2022-09-30 표지 642,869,548주로 시가총액 $4.54B — Q2-2026 10-Q 표지는
//        Class A 1,708,146,085 + Class B 296,009,183 = 2,004,155,268주(실제 ≈ $14.15B, 3.1배)
//   ACMR 2020-03-31 표지 14,176,690주로 $1.19B — Q2-2026 10-Q 표지는
//        Class A 64,657,388 + Class B 4,991,808 = 69,649,196주(실제 ≈ $5.84B, 4.9배)
// 두 회사 모두 낡은 값이 걸러지면 같은 기간의 희석주식수(1,976,000,000 / 71,838,908)로
// 폴백해 자릿수가 맞는다. 결측을 낡은 값으로 채우지 않는다는 원칙의 주식수 판이다.
const SHARES_STALENESS_LIMIT_DAYS = 400

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
        `WITH latest AS (
           SELECT cik, MAX(period_end) AS period_end FROM financials GROUP BY cik
         )
         SELECT c.cik, c.ticker,
                (SELECT f.shares_outstanding FROM financials f
                  WHERE f.cik = c.cik AND f.shares_outstanding IS NOT NULL
                    AND f.period_end >= DATE(l.period_end, ?)
                  ORDER BY f.period_end DESC,
                           CASE f.period_type WHEN 'Q' THEN 0 WHEN 'TTM' THEN 1 WHEN 'A' THEN 2 ELSE 3 END
                  LIMIT 1) AS sharesReported,
                (SELECT f.shares_diluted FROM financials f
                  WHERE f.cik = c.cik AND f.shares_diluted IS NOT NULL
                    AND f.period_end >= DATE(l.period_end, ?)
                  ORDER BY f.period_end DESC,
                           CASE f.period_type WHEN 'Q' THEN 0 WHEN 'TTM' THEN 1 WHEN 'A' THEN 2 ELSE 3 END
                  LIMIT 1) AS sharesDiluted
         FROM companies c
         JOIN company_industry ci ON ci.cik = c.cik
         LEFT JOIN latest l ON l.cik = c.cik
         WHERE c.is_active = 1
         ORDER BY c.cik`,
      )
      .all(`-${SHARES_STALENESS_LIMIT_DAYS} days`, `-${SHARES_STALENESS_LIMIT_DAYS} days`) as Target[]

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
