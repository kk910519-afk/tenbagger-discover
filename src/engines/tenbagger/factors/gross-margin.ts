import { interpolate } from '@/domain/curve'
import { grossMargin, grossMarginTrendBps } from '@/domain/metrics'
import { scored, noData, pct, bpsPerYear, type FactorFn } from '../factor-utils.js'

const KEY = 'gross_margin'
const TREND_QUARTERS = 8

export const grossMarginFactor: FactorFn = ({ snapshot, cfg }) => {
  const f = cfg.scoring.factors.gross_margin
  const level = grossMargin(snapshot.ttm[0])
  if (level === null) return noData(KEY, f.weight, '매출총이익 데이터 없음')

  const levelScore = interpolate(f.level_curve, level)
  const trendBps = grossMarginTrendBps(snapshot.quarterly, TREND_QUARTERS)

  if (trendBps === null) {
    return scored(
      KEY, f.weight, level, levelScore,
      `매출총이익률 ${pct(level)} · 추세 산출 불가 (분기 ${TREND_QUARTERS}개 필요)`,
    )
  }

  const normalized =
    f.blend.level * levelScore + f.blend.trend * interpolate(f.trend_curve, trendBps)

  return scored(
    KEY, f.weight, level, normalized,
    `매출총이익률 ${pct(level)} · 추세 ${bpsPerYear(trendBps)}`,
  )
}
