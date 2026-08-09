import { describe, it, expect } from 'vitest'
import { recentQuarters } from '@/pipeline/quarters'

describe('recentQuarters', () => {
  it('공시 지연 45일을 반영해 최근 분기부터 역순으로 만든다', () => {
    // 2026-08-09 기준 45일 전은 2026-06-25 → 2026Q2가 최신 가용 데이터셋
    expect(recentQuarters('2026-08-09', 3)).toEqual([
      { year: 2026, quarter: 2 },
      { year: 2026, quarter: 1 },
      { year: 2025, quarter: 4 },
    ])
  })

  it('연도 경계를 넘어간다', () => {
    // 2026-02-20 기준 45일 전은 2026-01-06 → 2026Q1
    expect(recentQuarters('2026-02-20', 2)).toEqual([
      { year: 2026, quarter: 1 },
      { year: 2025, quarter: 4 },
    ])
  })

  it('count가 0이면 빈 배열', () => {
    expect(recentQuarters('2026-08-09', 0)).toEqual([])
  })
})
