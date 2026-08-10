export function median(values: number[]): number | null {
  if (values.length === 0) return null
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 === 0 ? (s[mid - 1]! + s[mid]!) / 2 : s[mid]!
}

/**
 * 중앙값절대편차 median(|xᵢ − median(x)|). 표준편차와 달리 한 해의 대규모 일회성
 * 항목에 끌려가지 않으므로, "이 수열이 하나의 수준인가 아니면 흩어짐인가"를 묻는 데
 * 쓴다. 중앙값을 추정치로 쓰는 곳에서는 그 추정치와 같은 통계로 산포를 재야 한다.
 */
export function medianAbsoluteDeviation(values: number[]): number | null {
  const m = median(values)
  if (m === null) return null
  return median(values.map((v) => Math.abs(v - m)))
}

/** value보다 작은 값의 비율. 입력 배열 순서와 무관하게 올바른 백분위를 반환한다. */
export function percentileOf(values: number[], value: number): number | null {
  if (values.length === 0) return null
  let below = 0
  for (const v of values) {
    if (v < value) below++
  }
  return below / values.length
}

/** 등간격 시계열(x = 0,1,2,...)의 최소자승 기울기 */
export function olsSlope(values: number[]): number | null {
  const n = values.length
  if (n < 2) return null
  const meanX = (n - 1) / 2
  const meanY = values.reduce((a, b) => a + b, 0) / n
  let num = 0
  let den = 0
  for (let i = 0; i < n; i++) {
    num += (i - meanX) * (values[i]! - meanY)
    den += (i - meanX) ** 2
  }
  return den === 0 ? null : num / den
}

/** 표본표준편차 (n-1) */
export function stdev(values: number[]): number | null {
  const n = values.length
  if (n < 2) return null
  const mean = values.reduce((a, b) => a + b, 0) / n
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1)
  return Math.sqrt(variance)
}
