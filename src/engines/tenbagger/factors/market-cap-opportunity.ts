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

  const base = bandPoints(marketCap, f.bands)
  const revenue = snapshot.ttm[0]?.revenue ?? null
  const growth = ttmRevenueGrowth(snapshot.ttm)

  // 게이트: 작을수록 고득점인 구조가 부실 소형주를 밀어올리지 않게 한다
  let gate = 1
  let gateReason = ''
  if (growth !== null && growth < f.gate.zero_if_revenue_growth_below) {
    gate = 0
    gateReason = `게이트 0 — 매출 감소 ${pct(growth)}`
  } else if (revenue !== null && revenue < f.gate.zero_if_revenue_below) {
    gate = 0
    gateReason = `게이트 0 — 매출 규모 $${(revenue / 1e6).toFixed(1)}M`
  } else if (hasWarning(flags)) {
    gate = f.gate.warning_multiplier
    gateReason = `게이트 ${f.gate.warning_multiplier} — WARNING Red Flag 보유`
  }

  const billions = (marketCap / 1e9).toFixed(2)
  const detail = gateReason
    ? `시가총액 $${billions}B → ${base}점, ${gateReason}`
    : `시가총액 $${billions}B → ${base}점`

  const result: FactorResult = {
    key: KEY, weight: f.weight, points: base * gate, raw: marketCap,
    status: 'SCORED', detail,
  }
  return result
}
