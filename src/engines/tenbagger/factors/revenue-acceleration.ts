import { interpolate } from '@/domain/curve'
import { revenueAcceleration } from '@/domain/metrics'
import { scored, noData, pct, type FactorFn } from '../factor-utils.js'

const KEY = 'revenue_acceleration'

export const revenueAccelerationFactor: FactorFn = ({ snapshot, cfg }) => {
  const f = cfg.scoring.factors.revenue_acceleration
  const accel = revenueAcceleration(snapshot.quarterly)
  if (accel === null) return noData(KEY, f.weight, '분기 매출 8개 분기가 필요함')

  return scored(
    KEY, f.weight, accel, interpolate(f.curve, accel),
    `최근 2개 분기 성장률이 직전 2개 분기 대비 ${pct(accel)}p`,
  )
}
