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
