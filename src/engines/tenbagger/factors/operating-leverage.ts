import { interpolate } from '@/domain/curve'
import { operatingMargin, opexGrowth, ttmRevenueGrowth } from '@/domain/metrics'
import {
  scored, noData, pct, revenueScaleDamping, usdCompact, type FactorFn,
} from '../factor-utils.js'

const KEY = 'operating_leverage'
const QUARTERS_PER_YEAR = 4

export const operatingLeverageFactor: FactorFn = ({ snapshot, cfg }) => {
  const f = cfg.scoring.factors.operating_leverage
  const nowPeriod = snapshot.ttm[0]
  const priorPeriod = snapshot.ttm[QUARTERS_PER_YEAR]
  const now = operatingMargin(nowPeriod)
  const prior = operatingMargin(priorPeriod)
  const revGrowth = ttmRevenueGrowth(snapshot.ttm)
  const opex = opexGrowth(snapshot.ttm)

  const marginDeltaPp = now !== null && prior !== null ? (now - prior) * 100 : null
  const growthGap = revGrowth !== null && opex !== null ? revGrowth - opex : null

  if (marginDeltaPp === null && growthGap === null) {
    return noData(KEY, f.weight, '1년 전 TTM 손익 데이터 없음')
  }

  const pointLimit = cfg.scoring.extreme_display.margin_delta_points
  const growthLimit = cfg.scoring.extreme_display.growth_ratio

  /**
   * 영업이익률 변화. 한계를 넘으면 %p 대신 **영업손익 금액과 그 마진의 분모가 된 매출**을
   * 적는다. 마진 변화가 100%p를 넘으려면 어느 한 기간의 영업손실이 그 기간 매출보다
   * 커야 하므로, 한계를 넘었다는 사실 자체가 "분모가 미미했다"는 진술이다. 금액은
   * 기저효과를 타지 않는 실제 관측치이고 두 기간을 직접 비교할 수 있다.
   */
  function marginText(delta: number): string {
    const priorOi = priorPeriod?.operatingIncome ?? null
    const nowOi = nowPeriod?.operatingIncome ?? null
    if (Math.abs(delta) < pointLimit || priorOi === null || nowOi === null) {
      return `영업이익률 ${delta > 0 ? '+' : ''}${delta.toFixed(1)}%p`
    }
    return (
      `영업손익 ${usdCompact(priorOi)} → ${usdCompact(nowOi)} ` +
      `(직전 TTM 매출 ${usdCompact(priorPeriod?.revenue ?? null)})`
    )
  }

  /** 격차도 두 성장률의 차이이므로 같은 기저효과를 탄다 — 한계를 넘으면 양쪽을 따로 적는다. */
  function gapText(gap: number): string {
    if (Math.abs(gap) < growthLimit || revGrowth === null || opex === null) {
      return `매출-비용 증가율 격차 ${pct(gap)}p`
    }
    const asMultiple = (v: number) =>
      Math.abs(v) < growthLimit ? pct(v) : `${(1 + v).toFixed(0)}배`
    return `매출 증가율 ${asMultiple(revGrowth)} vs 비용 증가율 ${asMultiple(opex)}`
  }

  // 한쪽만 있으면 그 값 단독으로 채점한다
  let normalized: number
  const parts: string[] = []
  if (marginDeltaPp !== null && growthGap !== null) {
    normalized =
      f.blend.margin_delta * interpolate(f.margin_delta_curve, marginDeltaPp) +
      f.blend.growth_gap * interpolate(f.growth_gap_curve, growthGap)
    parts.push(marginText(marginDeltaPp))
    parts.push(gapText(growthGap))
  } else if (marginDeltaPp !== null) {
    normalized = interpolate(f.margin_delta_curve, marginDeltaPp)
    parts.push(marginText(marginDeltaPp))
    parts.push('비용 증가율 산출 불가')
  } else {
    normalized = interpolate(f.growth_gap_curve, growthGap!)
    parts.push(gapText(growthGap!))
    parts.push('영업이익률 변화 산출 불가')
  }

  // revenue_growth·revenue_acceleration과 **같은 원리로** 감쇠한다. 이 팩터의 두 신호는
  // 모두 1년 전 TTM 매출을 분모로 갖는다: 기저 영업이익률 = 1년 전 영업이익 ÷ 1년 전 매출,
  // 매출·비용 증가율도 1년 전 값이 분모다. SEPN의 "영업이익률 +14027.0%p"는 그 분모가
  // $726K였기 때문에 존재하는 숫자이지 영업 레버리지의 증거가 아니다. 성장 팩터가 감쇠된
  // 뒤 이 팩터가 바로 그 회사들의 최대 득점원이 되었으므로 같은 가드가 필요하다.
  const damping = revenueScaleDamping(
    [
      { label: '직전 TTM 매출', revenue: priorPeriod?.revenue ?? null },
      { label: '현재 TTM 매출', revenue: nowPeriod?.revenue ?? null },
    ],
    cfg,
  )

  // raw는 실제로 채점에 쓰인 값을 담는다 — 한쪽만 있으면 그 값이 raw다.
  // 둘 중 어느 쪽이었는지는 위 detail 문자열이 알려준다. 감쇠 전 원시 지표를 유지하는
  // 것은 revenue_growth와 같은 이유다(산업 백분위가 감쇠에 오염되면 안 된다).
  return scored(
    KEY, f.weight, marginDeltaPp ?? growthGap,
    normalized * damping.multiplier,
    `${parts.join(' · ')}${damping.note}`,
  )
}
