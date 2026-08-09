import { describe, it, expect } from 'vitest'
import { median, percentileOf, olsSlope, stdev } from '@/domain/stats'

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
