export type Curve = [number, number][]

/**
 * 구간 선형보간. x가 곡선 범위를 벗어나면 끝값으로 고정한다.
 * curve의 x 좌표는 오름차순이어야 한다 (config 스키마가 강제).
 */
export function interpolate(curve: Curve, x: number): number {
  const first = curve[0]
  const last = curve[curve.length - 1]
  if (!first || !last) throw new Error('빈 곡선입니다')
  if (x <= first[0]) return first[1]
  if (x >= last[0]) return last[1]

  for (let i = 1; i < curve.length; i++) {
    const prev = curve[i - 1]!
    const cur = curve[i]!
    if (x <= cur[0]) {
      const span = cur[0] - prev[0]
      const t = span === 0 ? 0 : (x - prev[0]) / span
      return prev[1] + t * (cur[1] - prev[1])
    }
  }
  return last[1]
}
