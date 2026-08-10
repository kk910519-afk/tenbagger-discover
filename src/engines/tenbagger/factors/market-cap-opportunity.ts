import { ttmRevenueGrowth } from '@/domain/metrics'
import { hasWarning } from '@/engines/quality'
import { noData, pct, type FactorFn } from '../factor-utils.js'
import type { FactorResult } from '@/domain/types'

const KEY = 'market_cap_opportunity'

function bandPoints(
  marketCap: number,
  bands: { max: number | null; points: number }[],
): number {
  for (const b of bands) {
    if (b.max === null || marketCap < b.max) return b.points
  }
  return bands[bands.length - 1]?.points ?? 0
}

export const marketCapOpportunityFactor: FactorFn = ({ snapshot, cfg, flags }) => {
  const f = cfg.scoring.factors.market_cap_opportunity
  const marketCap = snapshot.marketCap
  if (marketCap === null || marketCap <= 0) {
    return noData(KEY, f.weight, '시가총액 없음 — 주가 또는 발행주식수 결측')
  }

  const revenue = snapshot.ttm[0]?.revenue ?? null
  // 게이트 두 조건이 모두 매출을 근거로 하므로, 매출을 모르면 게이트를 평가할 수 없다.
  // 이때 게이트를 통과시키면(= null을 "조건 미해당"으로 읽으면) 매출을 한 푼도 보고하지
  // 않은 회사가 만점 15/15을 받고, 매출 $9M을 정직하게 보고한 회사는 0점이 된다 —
  // 이 팩터는 데이터가 빈약한 초소형주가 유일하게 얻을 수 있는 15점이라 그 역전이
  // 총점 100.0을 만든다(DUKR·AIRJ·FACT). 없는 값을 0으로도 무한대로도 읽지 않고
  // "채점하지 않았다"고 말한다 — NO_DATA는 completeness를 낮춰 그 사실을 남긴다.
  if (revenue === null) {
    return noData(
      KEY, f.weight,
      'TTM 매출 데이터 없음 — 매출 기준 게이트를 평가할 수 없어 시가총액 구간 점수를 주지 않음',
    )
  }

  const base = bandPoints(marketCap, f.bands)
  const growth = ttmRevenueGrowth(snapshot.ttm)

  // 게이트: 작을수록 고득점인 구조가 부실 소형주를 밀어올리지 않게 한다
  let gate = 1
  let gateReason = ''
  if (growth !== null && growth < f.gate.zero_if_revenue_growth_below) {
    gate = 0
    gateReason = `게이트 0 — 매출 감소 ${pct(growth)}`
  } else if (revenue < f.gate.zero_if_revenue_below) {
    gate = 0
    gateReason = `게이트 0 — 매출 규모 $${(revenue / 1e6).toFixed(1)}M`
  } else if (hasWarning(flags)) {
    gate = f.gate.warning_multiplier
    gateReason = `게이트 ${f.gate.warning_multiplier} — WARNING Red Flag 보유`
  }

  const billions = (marketCap / 1e9).toFixed(2)
  // 표지 발행주식수가 없어 희석평균주식수로 대체 계산한 시가총액이면(§SharesBasis 정의
  // 참고) 그 사실을 detail에 남긴다 — 화면에 노출되는 유일한 경로이므로 XBRL 태그명 없이
  // 사용자가 이해할 수 있는 문장으로 적는다.
  const basisNote =
    snapshot.sharesBasis === 'diluted_fallback'
      ? ' (근사치 — 표지 발행주식수 미보고, 희석평균주식수로 계산)'
      : ''
  const detail = gateReason
    ? `시가총액 $${billions}B${basisNote} → ${base}점, ${gateReason}`
    : `시가총액 $${billions}B${basisNote} → ${base}점`

  const result: FactorResult = {
    key: KEY, weight: f.weight, points: base * gate, raw: marketCap,
    status: 'SCORED', detail,
  }
  return result
}
