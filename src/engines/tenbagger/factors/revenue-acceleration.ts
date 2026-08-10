import { interpolate } from '@/domain/curve'
import { revenueAcceleration } from '@/domain/metrics'
import { scored, noData, pct, revenueScaleDamping, type FactorFn } from '../factor-utils.js'

const KEY = 'revenue_acceleration'

export const revenueAccelerationFactor: FactorFn = ({ snapshot, cfg }) => {
  const f = cfg.scoring.factors.revenue_acceleration
  const accel = revenueAcceleration(snapshot.quarterly)
  if (accel === null) return noData(KEY, f.weight, '분기 매출 8개 분기가 필요함')

  // revenue_growth와 같은 이유로 감쇠한다 — 매출 기반이 극히 작으면 "가속"도
  // 사업 모멘텀이 아니라 일회성 수령액의 타이밍을 반영한다. raw는 원시 지표 유지.
  const damping = revenueScaleDamping(snapshot.ttm[0]?.revenue ?? null, cfg)

  return scored(
    KEY, f.weight, accel,
    interpolate(f.curve, accel) * damping.multiplier,
    `최근 2개 분기 성장률이 직전 2개 분기 대비 ${pct(accel)}p${damping.note}`,
  )
}
