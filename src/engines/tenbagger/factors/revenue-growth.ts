import { interpolate } from '@/domain/curve'
import { ttmRevenueGrowth, revenueCagr3y } from '@/domain/metrics'
import {
  scored, noData, pct, growthPhrase, revenueScaleDamping, usdCompact,
  type FactorFn,
} from '../factor-utils.js'

const KEY = 'revenue_growth'
const QUARTERS_PER_YEAR = 4
/** 3년 CAGR의 분모가 되는 TTM 구간 — domain/metrics.revenueCagr3y와 같은 인덱스 */
const CAGR_BASE_INDEX = 12

export const revenueGrowthFactor: FactorFn = ({ snapshot, cfg }) => {
  const f = cfg.scoring.factors.revenue_growth
  const ttmYoy = ttmRevenueGrowth(snapshot.ttm)
  const cagr3y = revenueCagr3y(snapshot.ttm)

  if (ttmYoy === null && cagr3y === null) {
    return noData(KEY, f.weight, 'TTM 매출 이력 부족')
  }

  const current = snapshot.ttm[0]?.revenue ?? null
  const yoyBase = snapshot.ttm[QUARTERS_PER_YEAR]?.revenue ?? null
  const cagrBase = snapshot.ttm[CAGR_BASE_INDEX]?.revenue ?? null
  const limit = cfg.scoring.extreme_display.growth_ratio

  const yoyText = ttmYoy === null
    ? 'TTM YoY 없음'
    : growthPhrase('TTM 매출', ttmYoy, yoyBase, current, limit)

  // CAGR은 연율이라 (1 + 값)을 배수로 쓸 수 없다 — 한계를 넘으면 3년 누적 배수를 적는다.
  const cagrExtreme =
    cagr3y !== null && Math.abs(cagr3y) >= limit && cagrBase !== null && current !== null
  const cagrText = cagr3y === null
    ? '3Y CAGR 없음'
    : cagrExtreme
      ? `3Y CAGR ${usdCompact(cagrBase)} → ${usdCompact(current)} (3년 ${(current! / cagrBase!).toFixed(0)}배)`
      : `3Y CAGR ${pct(cagr3y)}`

  // 감쇠는 **각 성장률을 그 성장률 자신의 분모로** 건다. 두 성장률의 분모가 다르기
  // 때문이다(TTM YoY는 1년 전 TTM, 3Y CAGR은 3년 전 TTM). 둘 중 작은 쪽 하나로 팩터
  // 전체를 깎으면, 3년 전에 작았지만 작년 기준이 이미 $50M을 넘긴 회사 — 이 제품이
  // 찾으려는 바로 그 궤적 — 의 TTM YoY까지 함께 깎인다(실측: 감쇠가 걸린 304개 중 102개가
  // 3년 전 기저에 지배됐고, 그중에는 "TTM 매출 +5.6% · 3Y CAGR +14.1%"처럼 두 비율 모두
  // 멀쩡한 회사가 있었다). 각 성분에 그 성분의 기저를 걸면 그 오염이 사라진다.
  //
  // 각 성분의 기저는 현재 매출과 함께 넘긴다 — 비율은 두 수에 대한 진술이므로 어느
  // 한쪽이라도 잡음 구간이면 정보를 잃는다.
  const dYoy = revenueScaleDamping(
    [{ label: '기저 TTM 매출', revenue: yoyBase }, { label: '현재 TTM 매출', revenue: current }],
    cfg,
  )
  const dCagr = revenueScaleDamping(
    [{ label: '3년 전 TTM 매출', revenue: cagrBase }, { label: '현재 TTM 매출', revenue: current }],
    cfg,
  )

  // 한쪽만 있으면 그 값 단독으로 채점한다. 없는 쪽을 0으로 치지 않는다.
  let normalized: number
  let detail: string
  const notes: string[] = []
  if (ttmYoy !== null && cagr3y !== null) {
    normalized =
      f.blend.ttm_yoy * interpolate(f.curve, ttmYoy) * dYoy.multiplier +
      f.blend.cagr_3y * interpolate(f.curve, cagr3y) * dCagr.multiplier
    detail = `${yoyText} · ${cagrText}`
    notes.push(dYoy.note)
    // 두 성분의 기저가 같은 구간이면 같은 문장이 두 번 나온다 — 한 번만 적는다.
    if (dCagr.note !== dYoy.note) notes.push(dCagr.note)
  } else if (ttmYoy !== null) {
    normalized = interpolate(f.curve, ttmYoy) * dYoy.multiplier
    detail = `${yoyText} · 3Y CAGR 없음`
    notes.push(dYoy.note)
  } else {
    normalized = interpolate(f.curve, cagr3y!) * dCagr.multiplier
    detail = `${cagrText} · TTM YoY 없음`
    notes.push(dCagr.note)
  }

  // raw는 원시 지표(TTM YoY)를 그대로 유지해야 산업 백분위(§8.6)가 감쇠된 값이 아니라
  // 실제 성장률 기준으로 계산된다.
  return scored(
    KEY, f.weight, ttmYoy ?? cagr3y,
    normalized,
    `${detail}${notes.join('')}`,
  )
}
