import { describe, it, expect } from 'vitest'
import { median, medianAbsoluteDeviation, percentileOf, olsSlope, stdev } from '@/domain/stats'

describe('median', () => {
  it('홀수 개수', () => expect(median([3, 1, 2])).toBe(2))
  it('짝수 개수는 평균', () => expect(median([1, 2, 3, 4])).toBe(2.5))
  it('빈 배열은 null', () => expect(median([])).toBeNull())
})

describe('percentileOf', () => {
  it('정렬된 배열에서 백분위를 반환한다', () => {
    const sorted = [10, 20, 30, 40, 50]
    expect(percentileOf(sorted, 30)).toBeCloseTo(0.4)   // 자기보다 작은 값 2/5
    expect(percentileOf(sorted, 10)).toBeCloseTo(0)
    expect(percentileOf(sorted, 50)).toBeCloseTo(0.8)
  })
  it('정렬되지 않은 배열에서도 올바른 백분위를 반환한다', () => {
    const unsorted = [50, 10, 40, 20, 30]
    expect(percentileOf(unsorted, 30)).toBeCloseTo(0.4)   // 자기보다 작은 값: 10, 20 = 2/5
    expect(percentileOf(unsorted, 25)).toBeCloseTo(0.4)   // 자기보다 작은 값: 10, 20 = 2/5
  })
  it('빈 배열은 null', () => expect(percentileOf([], 1)).toBeNull())
})

describe('olsSlope', () => {
  it('완전한 직선의 기울기', () => {
    expect(olsSlope([1, 2, 3, 4])).toBeCloseTo(1)
  })
  it('감소 추세는 음수', () => {
    expect(olsSlope([4, 3, 2, 1])).toBeCloseTo(-1)
  })
  it('2개 미만은 null', () => expect(olsSlope([1])).toBeNull())
})

describe('stdev', () => {
  it('표본표준편차를 계산한다', () => {
    expect(stdev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.138, 2)
  })
  it('2개 미만은 null', () => expect(stdev([1])).toBeNull())
})

/**
 * 성숙마진 앵커의 산포 척도. 표준편차와 달리 한 해의 대규모 일회성 항목에 끌려가지
 * 않는다 — 중앙값을 추정치로 쓰는 곳에서는 산포도 같은 통계로 재야 한다.
 */
describe('medianAbsoluteDeviation', () => {
  it('중앙값에서의 절대편차들의 중앙값이다', () => {
    // 중앙값 0.175, 편차 [0.125,0.015,0.005,0.005,0.005,0.015,0.075,0.155] → 중앙값 0.015
    expect(medianAbsoluteDeviation([0.30, 0.19, 0.18, 0.18, 0.17, 0.16, 0.10, 0.02]))
      .toBeCloseTo(0.015, 12)
  })

  it('한 해의 극단값에 끌려가지 않는다 — 표준편차와 갈리는 지점', () => {
    const calm = [0.20, 0.20, 0.20, 0.20, 0.20]
    const oneOutlier = [0.20, 0.20, 0.20, 0.20, 5.0]
    expect(medianAbsoluteDeviation(calm)).toBeCloseTo(0, 12)
    expect(medianAbsoluteDeviation(oneOutlier)).toBeCloseTo(0, 12)
    // 같은 입력에서 표준편차는 2배 넘게 벌어진다
    expect(stdev(oneOutlier)!).toBeGreaterThan(2)
  })

  it('평균절대편차가 아니다 — 두 통계가 갈리는 입력', () => {
    // 중앙값 3, 편차 [2,1,0,1,10] → MAD = 1. 평균절대편차는 2.8이다.
    expect(medianAbsoluteDeviation([1, 2, 3, 4, 13])).toBeCloseTo(1, 12)
  })

  it('빈 배열은 null', () => expect(medianAbsoluteDeviation([])).toBeNull())
})
