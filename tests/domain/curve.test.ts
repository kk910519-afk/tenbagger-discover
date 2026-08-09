import { describe, it, expect } from 'vitest'
import { interpolate } from '@/domain/curve'

const c: [number, number][] = [[0, 0], [10, 1]]

describe('interpolate', () => {
  it('구간 사이를 선형보간한다', () => {
    expect(interpolate(c, 5)).toBeCloseTo(0.5)
    expect(interpolate(c, 2.5)).toBeCloseTo(0.25)
  })

  it('구간 밖은 끝값으로 고정한다', () => {
    expect(interpolate(c, -100)).toBe(0)
    expect(interpolate(c, 999)).toBe(1)
  })

  it('정점에서는 그 값을 반환한다', () => {
    expect(interpolate(c, 0)).toBe(0)
    expect(interpolate(c, 10)).toBe(1)
  })

  it('y가 감소하는 곡선도 처리한다 (침투율 곡선)', () => {
    const dec: [number, number][] = [[0, 1], [1, 0]]
    expect(interpolate(dec, 0.25)).toBeCloseTo(0.75)
  })

  it('여러 구간을 가진 곡선을 처리한다', () => {
    const multi: [number, number][] = [[0, 0], [1, 0.5], [3, 0.6]]
    expect(interpolate(multi, 0.5)).toBeCloseTo(0.25)
    expect(interpolate(multi, 2)).toBeCloseTo(0.55)
  })
})
