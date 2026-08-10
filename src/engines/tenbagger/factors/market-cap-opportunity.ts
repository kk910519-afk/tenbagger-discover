import { ttmRevenueGrowth } from '@/domain/metrics'
import { hasWarning } from '@/engines/quality'
import { noData, pct, type FactorFn } from '../factor-utils.js'
import type { CompanySnapshot, FactorResult, FinancialPeriod } from '@/domain/types'

const KEY = 'market_cap_opportunity'

type RevenueObservation = { revenue: number; source: 'ttm' | 'ttm_prior' | 'annual'; periodEnd: string }

/**
 * 게이트의 규모 조건이 묻는 것은 "이 회사의 매출 규모"이지 "최신 TTM 구간의 값"이 아니다.
 * 최신 TTM만 보고 없으면 NO_DATA로 돌리면 **매출을 보고하지 않은 회사**와 **우리가 TTM
 * 매출을 유도하지 못한 회사**가 같은 취급을 받는다. 후자는 274개 NO_DATA 중 최소 89개다
 * (31개는 최근 4개 TTM 구간 중 하나에 매출이 있고 — VICR은 2025-09-30에 $738.9M을 보고한
 * 뒤 두 구간이 null이다 —, 58개는 최신 연간 기간에 매출이 있다 — XEL은 연 $11.686B인데
 * TTM 매출이 전 구간 null이다).
 *
 * 그래서 최신 TTM → 최근 TTM 구간 → 최근 연간 기간 순으로 훑는다. 어느 것을 썼는지는
 * 반환값에 담아 detail에 남긴다 — 대체값을 썼다는 사실이 화면에서 사라지면 안 된다.
 * 근본 원인(TTM 유도)은 ingest 쪽이며, 이 폴백은 그것을 고치는 것이 아니라 **확보하고
 * 있는 사실을 버리지 않는** 것이다.
 */
function observeRevenue(snapshot: CompanySnapshot, fallbackPeriods: number): RevenueObservation | null {
  const latest = snapshot.ttm[0]?.revenue ?? null
  if (latest !== null) {
    return { revenue: latest, source: 'ttm', periodEnd: snapshot.ttm[0]!.periodEnd }
  }
  const scan = (periods: FinancialPeriod[], source: 'ttm_prior' | 'annual'): RevenueObservation | null => {
    for (const p of periods.slice(0, fallbackPeriods)) {
      if (p.revenue !== null) return { revenue: p.revenue, source, periodEnd: p.periodEnd }
    }
    return null
  }
  return scan(snapshot.ttm, 'ttm_prior') ?? scan(snapshot.annual, 'annual')
}

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

  // 게이트 두 조건이 모두 매출을 근거로 하므로, 매출을 **어디에서도** 모르면 게이트를
  // 평가할 수 없다. 이때 게이트를 통과시키면(= null을 "조건 미해당"으로 읽으면) 매출을
  // 한 푼도 보고하지 않은 회사가 만점 15/15을 받고, 매출 $9M을 정직하게 보고한 회사는
  // 0점이 된다 — 이 팩터는 데이터가 빈약한 초소형주가 유일하게 얻을 수 있는 15점이라
  // 그 역전이 총점 100.0을 만든다(DUKR·AIRJ·FACT). 없는 값을 0으로도 무한대로도 읽지
  // 않고 "채점하지 않았다"고 말한다 — NO_DATA는 completeness를 낮춰 그 사실을 남긴다.
  const observed = observeRevenue(snapshot, f.gate.revenue_fallback_periods)
  if (observed === null) {
    return noData(
      KEY, f.weight,
      'TTM·연간 어느 기간에도 매출 데이터 없음 — 매출 기준 게이트를 평가할 수 없어 시가총액 구간 점수를 주지 않음',
    )
  }
  const revenue = observed.revenue

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
  // 대체 관측치를 썼으면 어느 기간에서 가져왔는지 밝힌다 — 화면에 노출되는 유일한 경로다.
  const revenueNote =
    observed.source === 'ttm'
      ? ''
      : observed.source === 'ttm_prior'
        ? `, 매출은 직전 TTM 구간(${observed.periodEnd}) 기준`
        : `, 매출은 최근 연간 기간(${observed.periodEnd}) 기준`
  const detail = gateReason
    ? `시가총액 $${billions}B${basisNote} → ${base}점, ${gateReason}${revenueNote}`
    : `시가총액 $${billions}B${basisNote} → ${base}점${revenueNote}`

  const result: FactorResult = {
    key: KEY, weight: f.weight, points: base * gate, raw: marketCap,
    status: 'SCORED', detail,
  }
  return result
}
