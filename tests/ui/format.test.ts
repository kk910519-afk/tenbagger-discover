import { describe, it, expect } from 'vitest'
import { formatUsd, formatPct, formatScore, formatDate, stalenessOf } from '@/app/_lib/format'

describe('formatUsd', () => {
  it('조·십억·백만 단위로 축약한다', () => {
    expect(formatUsd(2_500_000_000_000)).toBe('$2.50T')
    expect(formatUsd(2_500_000_000)).toBe('$2.50B')
    expect(formatUsd(340_000_000)).toBe('$340M')
    expect(formatUsd(950_000)).toBe('$0.95M')
  })
  it('null은 대시', () => expect(formatUsd(null)).toBe('—'))
  it('음수도 처리한다', () => expect(formatUsd(-1_200_000_000)).toBe('-$1.20B'))
  it('$100M 경계에서 소수 자릿수가 바뀐다', () => {
    expect(formatUsd(100_000_000)).toBe('$100M')
    expect(formatUsd(99_999_999)).toBe('$100.00M')
  })
})

describe('formatPct', () => {
  it('부호를 붙인다', () => {
    expect(formatPct(0.384)).toBe('+38.4%')
    expect(formatPct(-0.052)).toBe('-5.2%')
    expect(formatPct(0)).toBe('0.0%')
  })
  it('자릿수를 조정할 수 있다', () => expect(formatPct(0.384, 0)).toBe('+38%'))
  it('null은 대시', () => expect(formatPct(null)).toBe('—'))

  /**
   * 다섯 자리 퍼센트는 화면에서 정보가 아니라 경보다 — "+176460.1%"에서 읽을 수 있는
   * 것은 "크다"뿐이다. 값을 깎지 않고 한국어에서 표준인 만 단위로 다시 적는다.
   */
  it('만 단위 경계 위는 "N.N만%"로 적는다 — 캡이 아니라 표기 변환이다', () => {
    expect(formatPct(99.99)).toBe('+9999.0%')      // 경계 바로 아래는 그대로
    expect(formatPct(100)).toBe('+1.0만%')
    expect(formatPct(1764.601)).toBe('+17.6만%')   // CLDX R&D 집약도 +176460.1%
    expect(formatPct(-120.327)).toBe('-1.2만%')    // FFAI 매출총이익률 -12032.7%
  })
})

describe('formatScore', () => {
  it('정수로 반올림한다', () => expect(formatScore(78.34)).toBe('78'))
  it('null은 대시', () => expect(formatScore(null)).toBe('—'))
})

describe('formatDate', () => {
  it('ISO 타임스탬프에서 날짜만 남긴다', () => {
    expect(formatDate('2026-08-09T01:23:45.000Z')).toBe('2026-08-09')
    expect(formatDate('2026-08-09')).toBe('2026-08-09')
  })
  it('null은 대시', () => expect(formatDate(null)).toBe('—'))
})

describe('stalenessOf', () => {
  it('임계 이내면 FRESH', () => {
    expect(stalenessOf('2026-08-06', '2026-08-09', 5)).toBe('FRESH')
  })
  it('임계를 넘으면 STALE', () => {
    expect(stalenessOf('2026-07-01', '2026-08-09', 5)).toBe('STALE')
  })
  it('날짜가 없으면 UNKNOWN', () => {
    expect(stalenessOf(null, '2026-08-09', 5)).toBe('UNKNOWN')
  })
  it('정확히 임계값이면 FRESH', () => {
    expect(stalenessOf('2026-08-04', '2026-08-09', 5)).toBe('FRESH')
  })
})
