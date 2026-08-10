import { interpolate } from '@/domain/curve'
import { ttmRevenueGrowth, revenueCagr3y } from '@/domain/metrics'
import { scored, noData, pct, revenueScaleDamping, type FactorFn } from '../factor-utils.js'

const KEY = 'revenue_growth'

export const revenueGrowthFactor: FactorFn = ({ snapshot, cfg }) => {
  const f = cfg.scoring.factors.revenue_growth
  const ttmYoy = ttmRevenueGrowth(snapshot.ttm)
  const cagr3y = revenueCagr3y(snapshot.ttm)

  if (ttmYoy === null && cagr3y === null) {
    return noData(KEY, f.weight, 'TTM 매출 이력 부족')
  }

  // 한쪽만 있으면 그 값 단독으로 채점한다. 없는 쪽을 0으로 치지 않는다.
  let normalized: number
  let detail: string
  if (ttmYoy !== null && cagr3y !== null) {
    normalized =
      f.blend.ttm_yoy * interpolate(f.curve, ttmYoy) +
      f.blend.cagr_3y * interpolate(f.curve, cagr3y)
    detail = `TTM 매출 ${pct(ttmYoy)} · 3Y CAGR ${pct(cagr3y)}`
  } else if (ttmYoy !== null) {
    normalized = interpolate(f.curve, ttmYoy)
    detail = `TTM 매출 ${pct(ttmYoy)} · 3Y CAGR 없음`
  } else {
    normalized = interpolate(f.curve, cagr3y!)
    detail = `3Y CAGR ${pct(cagr3y)} · TTM YoY 없음`
  }

  // 매출 규모 감쇠는 마지막에 곱한다. raw는 원시 지표(TTM YoY)를 그대로 유지해야
  // 산업 백분위(§8.6)가 감쇠된 값이 아니라 실제 성장률 기준으로 계산된다.
  const damping = revenueScaleDamping(snapshot.ttm[0]?.revenue ?? null, cfg)

  return scored(
    KEY, f.weight, ttmYoy ?? cagr3y,
    normalized * damping.multiplier,
    `${detail}${damping.note}`,
  )
}
