import { interpolate } from '@/domain/curve'
import { revenueAcceleration } from '@/domain/metrics'
import {
  scored, noData, pct, revenueScaleDamping, usdCompact, type FactorFn,
} from '../factor-utils.js'
import type { FinancialPeriod } from '@/domain/types'

const KEY = 'revenue_acceleration'
const QUARTERS_PER_YEAR = 4

/**
 * 분기 매출 합계. 하나라도 결측이면 null — 부분 합계는 "합계"가 아니다.
 * revenueAcceleration이 값을 내는 조건(분기 0~7 매출이 모두 존재)에서는 항상 값이 있다.
 */
function sumRevenue(quarterly: FinancialPeriod[], from: number, count: number): number | null {
  let total = 0
  for (let i = from; i < from + count; i++) {
    const revenue = quarterly[i]?.revenue
    if (revenue === null || revenue === undefined) return null
    total += revenue
  }
  return total
}

export const revenueAccelerationFactor: FactorFn = ({ snapshot, cfg }) => {
  const f = cfg.scoring.factors.revenue_acceleration
  const accel = revenueAcceleration(snapshot.quarterly)
  if (accel === null) return noData(KEY, f.weight, '분기 매출 8개 분기가 필요함')

  // revenue_growth와 같은 이유로 감쇠한다 — 매출 기반이 극히 작으면 "가속"도
  // 사업 모멘텀이 아니라 일회성 수령액의 타이밍을 반영한다. raw는 원시 지표 유지.
  //
  // 분모가 되는 기간은 **1년 전 4개 분기**다: 이 지표는 분기 0~3의 YoY 네 개를 비교하는데
  // 그 네 개의 분모가 정확히 분기 4~7이고, 그 합계는 1년 전 TTM 매출과 같다. 최신 TTM을
  // 보면 매출이 $726K → $98.88M이 된 회사가 감쇠를 빠져나가지만 +5,498%p를 만든 분모는
  // $726K다.
  const baseSum = sumRevenue(snapshot.quarterly, QUARTERS_PER_YEAR, QUARTERS_PER_YEAR)
  const recentSum = sumRevenue(snapshot.quarterly, 0, QUARTERS_PER_YEAR)
  const damping = revenueScaleDamping(
    [
      { label: '1년 전 분기 매출 합계', revenue: baseSum },
      { label: '최근 분기 매출 합계', revenue: recentSum },
    ],
    cfg,
  )

  // 표기 한계를 넘으면 %p 대신 그 %p를 만든 기저를 적는다 — "+5498.6%p"에서 읽을 수
  // 있는 것은 "크다"뿐이지만, 1년 전 분기 매출 합계가 $726K였다는 사실은 읽는 사람이
  // 스스로 판단할 근거가 된다.
  const detail =
    Math.abs(accel) < cfg.scoring.extreme_display.growth_ratio || baseSum === null
      ? `최근 2개 분기 성장률이 직전 2개 분기 대비 ${pct(accel)}p`
      : `최근 2개 분기 성장률 급${accel > 0 ? '가속' : '감속'} — 1년 전 기저 매출 ${usdCompact(baseSum)}`

  return scored(
    KEY, f.weight, accel,
    interpolate(f.curve, accel) * damping.multiplier,
    `${detail}${damping.note}`,
  )
}
