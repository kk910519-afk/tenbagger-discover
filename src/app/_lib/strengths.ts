import type { FactorView } from '../_queries/stock'

export type ScoredFactor = FactorView & { fill: number }

/**
 * 배점(절대 점수)이 아니라 배점 대비 획득 비율(fill ratio = points/weight)로 정렬한다.
 * 5점 만점에 5점을 받은 팩터가 20점 만점에 12점을 받은 팩터보다 더 큰 강점이다.
 * 계산되지 않은 팩터(NO_DATA/NOT_IMPLEMENTED)와 weight<=0인 팩터는 나눗셈 대상이
 * 아니므로 제외한다.
 *
 * 종목 상세 페이지의 Strength/Weakness(FactorBreakdown.tsx)와 홈 화면의 Top 5
 * 헤드라인(top-candidates.ts)이 이 함수를 공유한다 — "무엇이 강점인가"에 대한
 * 정의가 화면마다 따로 구현되어 갈라지는 것을 막기 위해서다.
 */
export function factorsByFillRatio(factors: FactorView[]): ScoredFactor[] {
  return factors
    .filter((f) => f.status === 'SCORED' && f.points !== null && f.weight > 0)
    .map((f) => ({ ...f, fill: f.points! / f.weight }))
    .sort((a, b) => b.fill - a.fill)
}

/**
 * Strength/Weakness 패널을 채울 상위/하위 팩터를 고른다. 상위 3개와 하위 3개를 그냥
 * 슬라이스하면 채점된 팩터가 6개 미만인 회사(NO_DATA가 많은 대부분의 신생 성장주)에서
 * 두 목록이 겹친다 — 같은 팩터가 같은 퍼센트로 Strength와 Weakness에 동시에 뜨는 버그였다.
 *
 * 겹치지 않는 한 칸당 최대 개수는 floor(n/2)다: 두 칸이 서로소이려면 상위 k개와
 * 하위 k개를 합쳐 n개를 넘지 않아야 하므로 k <= n/2. n이 홀수면 정가운데 팩터 하나는
 * 어느 쪽에도 넣지 않는다 — 나머지 팩터들보다 낫지도 못하지도 않은 자리이므로, 억지로
 * 한쪽에 밀어넣으면 그 팩터의 성격을 왜곡하게 된다. n이 0이나 1이면(비교할 상대가 없음)
 * k=0이 되어 두 칸 모두 비운다 — 이 경우 패널 자체를 렌더링하지 않는 것은 호출부의 몫이다.
 */
export function splitStrengthWeakness(scored: ScoredFactor[]): {
  top: ScoredFactor[]
  bottom: ScoredFactor[]
} {
  const k = Math.min(3, Math.floor(scored.length / 2))
  if (k === 0) return { top: [], bottom: [] }
  return {
    top: scored.slice(0, k),
    bottom: scored.slice(scored.length - k).reverse(),
  }
}
