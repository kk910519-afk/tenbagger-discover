import { describe, it, expect } from 'vitest'
import { yoy, cagr, sumTTM } from '@/domain/growth'

describe('yoy', () => {
  it('증가율을 계산한다', () => {
    expect(yoy(138, 100)).toBeCloseTo(0.38)
  })
  it('결측이면 null', () => {
    expect(yoy(null, 100)).toBeNull()
    expect(yoy(100, null)).toBeNull()
  })
  it('기준값이 0 이하면 null (비율이 무의미)', () => {
    expect(yoy(100, 0)).toBeNull()
    expect(yoy(100, -50)).toBeNull()
  })
})

describe('cagr', () => {
  it('3년 CAGR을 계산한다', () => {
    expect(cagr(200, 100, 3)).toBeCloseTo(0.2599, 3)
  })
  it('기준값이 0 이하면 null', () => {
    expect(cagr(200, 0, 3)).toBeNull()
  })
  it('결측이면 null', () => {
    expect(cagr(null, 100, 3)).toBeNull()
  })
})

describe('sumTTM', () => {
  it('4개 값을 합산한다', () => {
    expect(sumTTM([1, 2, 3, 4])).toBe(10)
  })
  it('하나라도 null이면 null — 0으로 채우지 않는다', () => {
    expect(sumTTM([1, null, 3, 4])).toBeNull()
  })
  it('4개가 아니면 null', () => {
    expect(sumTTM([1, 2, 3])).toBeNull()
  })
})
