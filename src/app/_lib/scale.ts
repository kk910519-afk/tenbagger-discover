/**
 * Opportunity Map 산점도 전용 최소 스케일 유틸리티. 차팅 라이브러리를 새로 들이지
 * 않기 위해(브리프) 축 눈금과 반지름 스케일을 직접 계산한다.
 */

/** Paul Heckbert의 "nice numbers" — 1/2/5 × 10^n 중 가장 가까운 값으로 반올림한다. */
function niceNum(range: number, round: boolean): number {
  if (range <= 0) return 1
  const exponent = Math.floor(Math.log10(range))
  const fraction = range / 10 ** exponent
  let niceFraction: number
  if (round) {
    if (fraction < 1.5) niceFraction = 1
    else if (fraction < 3) niceFraction = 2
    else if (fraction < 7) niceFraction = 5
    else niceFraction = 10
  } else {
    if (fraction <= 1) niceFraction = 1
    else if (fraction <= 2) niceFraction = 2
    else if (fraction <= 5) niceFraction = 5
    else niceFraction = 10
  }
  return niceFraction * 10 ** exponent
}

/**
 * [min, max] 실데이터 범위를 담는 "깔끔한" 눈금 배열을 만든다. 반환값의 처음/마지막이
 * 곧 축 도메인이다 — 데이터 최솟값·최댓값에 딱 맞추면 마크가 축 경계에 들러붙어
 * 잘려 보이므로, 이 함수가 만드는 여유(다음 nice step까지 올림/내림)가 자연스러운
 * 여백 역할도 겸한다.
 *
 * min === max(데이터가 한 점뿐)이면 임의로 ±1 폭을 줘 0으로 나누기를 피한다.
 */
export function niceTicks(min: number, max: number, tickCount = 5): number[] {
  const lo = min === max ? min - 1 : min
  const hi = min === max ? max + 1 : max
  const range = niceNum(hi - lo, false)
  const step = niceNum(range / Math.max(1, tickCount - 1), true)
  const niceMin = Math.floor(lo / step) * step
  const niceMax = Math.ceil(hi / step) * step

  const out: number[] = []
  const n = Math.round((niceMax - niceMin) / step)
  for (let i = 0; i <= n; i++) out.push(Math.round((niceMin + i * step) / step) * step)
  return out
}

/**
 * 면적이 값에 비례하도록 하는 반지름 스케일(sqrt scale) — 버블차트의 표준 관례.
 * 도메인은 항상 0에서 시작한다(시가총액처럼 의미 있는 0이 있는 값이라 min-max
 * 정규화 대신 0 기준을 쓴다: $4B는 $170M의 "약 23배"가 실제로 맞아야 한다).
 * value가 0 이하이거나 domainMax가 0 이하면 minRadius를 반환한다.
 */
export function sqrtRadius(value: number, domainMax: number, minRadius: number, maxRadius: number): number {
  if (domainMax <= 0 || value <= 0) return minRadius
  const t = Math.max(0, Math.min(1, value / domainMax))
  return minRadius + Math.sqrt(t) * (maxRadius - minRadius)
}

/** 선형 보간: value를 [domainMin, domainMax] → [rangeMin, rangeMax]로 매핑한다. */
export function linear(
  value: number,
  domainMin: number,
  domainMax: number,
  rangeMin: number,
  rangeMax: number,
): number {
  if (domainMax === domainMin) return (rangeMin + rangeMax) / 2
  const t = (value - domainMin) / (domainMax - domainMin)
  return rangeMin + t * (rangeMax - rangeMin)
}
