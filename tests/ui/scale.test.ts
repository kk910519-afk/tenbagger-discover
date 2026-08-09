import { describe, it, expect } from 'vitest'
import { niceTicks, sqrtRadius, linear } from '@/app/_lib/scale'

describe('niceTicks', () => {
  it('실데이터 범위를 완전히 감싸는 눈금을 만든다', () => {
    const t = niceTicks(-0.5157, 0.2244, 5)
    expect(t[0]!).toBeLessThanOrEqual(-0.5157)
    expect(t[t.length - 1]!).toBeGreaterThanOrEqual(0.2244)
  })

  it('눈금 간격이 일정하다', () => {
    const t = niceTicks(20, 60, 5)
    const step = t[1]! - t[0]!
    for (let i = 1; i < t.length; i++) {
      expect(t[i]! - t[i - 1]!).toBeCloseTo(step)
    }
  })

  it('min === max(데이터 한 점)여도 0으로 나누지 않고 유효한 눈금을 반환한다', () => {
    const t = niceTicks(50, 50, 5)
    expect(t.length).toBeGreaterThan(1)
    expect(Number.isFinite(t[0]!)).toBe(true)
  })
})

describe('sqrtRadius — 면적 비례(버블차트 표준) 반지름 스케일', () => {
  it('값이 클수록 반지름도 크다(단조 증가)', () => {
    const small = sqrtRadius(1e8, 4e9, 6, 26)
    const big = sqrtRadius(4e9, 4e9, 6, 26)
    expect(big).toBeGreaterThan(small)
  })

  it('domainMax와 같은 값은 최대 반지름이다', () => {
    expect(sqrtRadius(4e9, 4e9, 6, 26)).toBeCloseTo(26)
  })

  it('domainMax가 0 이하이면 최소 반지름을 반환한다(0으로 나누지 않는다)', () => {
    expect(sqrtRadius(100, 0, 6, 26)).toBe(6)
  })

  it('면적(반지름 제곱)이 값에 비례한다 — 반지름 자체가 아니라', () => {
    // sqrt 스케일의 핵심: r ∝ sqrt(value) 이므로 value가 4배면 r은 2배(면적은 정확히 4배)
    const r1 = sqrtRadius(1e9, 4e9, 0, 100)
    const r4 = sqrtRadius(4e9, 4e9, 0, 100)
    expect(r4 / r1).toBeCloseTo(2, 1)
  })
})

describe('linear', () => {
  it('도메인 중간값은 레인지 중간값으로 매핑된다', () => {
    expect(linear(50, 0, 100, 0, 200)).toBeCloseTo(100)
  })

  it('도메인 경계는 레인지 경계로 매핑된다', () => {
    expect(linear(0, 0, 100, 10, 20)).toBeCloseTo(10)
    expect(linear(100, 0, 100, 10, 20)).toBeCloseTo(20)
  })

  it('도메인이 붕괴(min===max)해도 레인지 중간값을 반환한다', () => {
    expect(linear(5, 5, 5, 10, 20)).toBe(15)
  })
})
