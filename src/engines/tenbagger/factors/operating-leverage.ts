import { interpolate } from '@/domain/curve'
import { operatingMargin, opexGrowth, ttmRevenueGrowth } from '@/domain/metrics'
import { scored, noData, pct, type FactorFn } from '../factor-utils.js'

const KEY = 'operating_leverage'
const QUARTERS_PER_YEAR = 4

export const operatingLeverageFactor: FactorFn = ({ snapshot, cfg }) => {
  const f = cfg.scoring.factors.operating_leverage
  const now = operatingMargin(snapshot.ttm[0])
  const prior = operatingMargin(snapshot.ttm[QUARTERS_PER_YEAR])
  const revGrowth = ttmRevenueGrowth(snapshot.ttm)
  const opex = opexGrowth(snapshot.ttm)

  const marginDeltaPp = now !== null && prior !== null ? (now - prior) * 100 : null
  const growthGap = revGrowth !== null && opex !== null ? revGrowth - opex : null

  if (marginDeltaPp === null && growthGap === null) {
    return noData(KEY, f.weight, '1년 전 TTM 손익 데이터 없음')
  }

  // 한쪽만 있으면 그 값 단독으로 채점한다
  let normalized: number
  const parts: string[] = []
  if (marginDeltaPp !== null && growthGap !== null) {
    normalized =
      f.blend.margin_delta * interpolate(f.margin_delta_curve, marginDeltaPp) +
      f.blend.growth_gap * interpolate(f.growth_gap_curve, growthGap)
    parts.push(`영업이익률 ${marginDeltaPp > 0 ? '+' : ''}${marginDeltaPp.toFixed(1)}%p`)
    parts.push(`매출-비용 증가율 격차 ${pct(growthGap)}p`)
  } else if (marginDeltaPp !== null) {
    normalized = interpolate(f.margin_delta_curve, marginDeltaPp)
    parts.push(`영업이익률 ${marginDeltaPp > 0 ? '+' : ''}${marginDeltaPp.toFixed(1)}%p`)
    parts.push('비용 증가율 산출 불가')
  } else {
    normalized = interpolate(f.growth_gap_curve, growthGap!)
    parts.push(`매출-비용 증가율 격차 ${pct(growthGap)}p`)
    parts.push('영업이익률 변화 산출 불가')
  }

  return scored(KEY, f.weight, marginDeltaPp, normalized, parts.join(' · '))
}
