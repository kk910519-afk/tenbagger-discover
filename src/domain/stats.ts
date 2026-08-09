export function median(values: number[]): number | null {
  if (values.length === 0) return null
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 === 0 ? (s[mid - 1]! + s[mid]!) / 2 : s[mid]!
}

/** 오름차순 정렬된 배열에서 value보다 작은 값의 비율 */
export function percentileOf(sorted: number[], value: number): number | null {
  if (sorted.length === 0) return null
  let below = 0
  for (const v of sorted) {
    if (v < value) below++
    else break
  }
  return below / sorted.length
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
