import { describe, it, expect } from 'vitest'
import { normalizeFacts } from '@/providers/fundamental/normalizer'
import type { RawFact } from '@/providers/types'

function f(
  tag: string, qtrs: number, periodEnd: string, value: number, form = '10-Q',
): RawFact {
  return {
    cik: 1, tag, unit: tag.includes('Shares') ? 'shares' : 'USD',
    periodStart: null, periodEnd, qtrs, value, form,
    filedDate: '2025-06-01', accession: `a-${periodEnd}-${qtrs}`, source: 'bulk',
  }
}

const Q_ENDS = ['2024-06-30', '2024-09-30', '2024-12-31', '2025-03-31']

function fourQuarters(tag: string, values: number[]): RawFact[] {
  return Q_ENDS.map((e, i) => f(tag, 1, e, values[i]!))
}

describe('normalizeFacts — TTM', () => {
  const facts = [
    ...fourQuarters('Revenues', [100, 110, 130, 160]),
    ...fourQuarters('OperatingIncomeLoss', [10, 12, 18, 25]),
    ...fourQuarters('NetCashProvidedByUsedInOperatingActivities', [20, 22, 30, 40]),
    ...fourQuarters('PaymentsToAcquirePropertyPlantAndEquipment', [5, 5, 6, 8]),
    ...fourQuarters('WeightedAverageNumberOfDilutedSharesOutstanding', [900, 910, 920, 930]),
    f('StockholdersEquity', 0, '2025-03-31', 5000),
    f('CashAndCashEquivalentsAtCarryingValue', 0, '2025-03-31', 1200),
    f('LongTermDebtNoncurrent', 0, '2025-03-31', 800),
  ]
  const r = normalizeFacts(facts)

  it('4개 분기가 모두 있으면 TTM을 만든다', () => {
    expect(r.ttm[0]!.periodEnd).toBe('2025-03-31')
    expect(r.ttm[0]!.revenue).toBe(500)
    expect(r.ttm[0]!.operatingIncome).toBe(65)
  })

  it('FCF는 영업현금흐름 - 자본지출', () => {
    expect(r.ttm[0]!.ocf).toBe(112)
    expect(r.ttm[0]!.capex).toBe(24)
    expect(r.ttm[0]!.fcf).toBe(88)
  })

  it('희석주식수는 합산하지 않고 최근 분기 값을 쓴다', () => {
    expect(r.ttm[0]!.sharesDiluted).toBe(930)
  })

  it('시점 항목은 종료일의 재무상태표 값을 쓴다', () => {
    expect(r.ttm[0]!.cash).toBe(1200)
    expect(r.ttm[0]!.totalDebt).toBe(800)
    expect(r.ttm[0]!.equity).toBe(5000)
  })

  it('분기가 4개 미만이면 TTM을 만들지 않는다', () => {
    const partial = normalizeFacts(
      Q_ENDS.slice(0, 3).map((e, i) => f('Revenues', 1, e, [100, 110, 130][i]!)),
    )
    expect(partial.ttm).toHaveLength(0)
  })

  it('분기가 5개면 TTM이 2개 생기고 최근순으로 정렬된다', () => {
    const five = normalizeFacts([
      f('Revenues', 1, '2024-03-31', 90),
      ...fourQuarters('Revenues', [100, 110, 130, 160]),
    ])
    expect(five.ttm.map((t) => t.periodEnd)).toEqual(['2025-03-31', '2024-12-31'])
    expect(five.ttm[1]!.revenue).toBe(430)
  })
})

describe('normalizeFacts — Q4 재구성', () => {
  const facts = [
    f('Revenues', 4, '2024-12-31', 500, '10-K'),
    f('Revenues', 1, '2024-03-31', 100),
    f('Revenues', 1, '2024-06-30', 110),
    f('Revenues', 1, '2024-09-30', 130),
  ]
  const r = normalizeFacts(facts)

  it('연간 - 3개 분기로 Q4를 유도한다', () => {
    const q4 = r.quarterly.find((q) => q.periodEnd === '2024-12-31')!
    expect(q4.revenue).toBe(160)
  })

  it('유도 사실을 sourceTags에 남긴다', () => {
    expect(r.sourceTags['Q:2024-12-31']!.derived).toBe('Q4_from_annual')
  })

  it('Q4가 이미 신고되어 있으면 유도하지 않는다', () => {
    const withQ4 = normalizeFacts([...facts, f('Revenues', 1, '2024-12-31', 155)])
    const q4 = withQ4.quarterly.find((q) => q.periodEnd === '2024-12-31')!
    expect(q4.revenue).toBe(155)
    expect(withQ4.sourceTags['Q:2024-12-31']!.derived).toBeUndefined()
  })

  it('분기가 3개가 아니면 유도하지 않는다', () => {
    const twoQ = normalizeFacts([
      f('Revenues', 4, '2024-12-31', 500, '10-K'),
      f('Revenues', 1, '2024-03-31', 100),
      f('Revenues', 1, '2024-06-30', 110),
    ])
    expect(twoQ.quarterly.find((q) => q.periodEnd === '2024-12-31')).toBeUndefined()
  })

  it('유도된 Q4의 희석주식수는 null이다 (연간 평균을 대체값으로 쓰지 않는다)', () => {
    const withShares = normalizeFacts([
      ...facts,
      f('WeightedAverageNumberOfDilutedSharesOutstanding', 4, '2024-12-31', 400, '10-K'),
      f('WeightedAverageNumberOfDilutedSharesOutstanding', 1, '2024-03-31', 100),
      f('WeightedAverageNumberOfDilutedSharesOutstanding', 1, '2024-06-30', 100),
      f('WeightedAverageNumberOfDilutedSharesOutstanding', 1, '2024-09-30', 100),
    ])
    const q4 = withShares.quarterly.find((q) => q.periodEnd === '2024-12-31')!
    expect(q4.sharesDiluted).toBeNull()
  })
})

describe('normalizeFacts — Q4 재구성 안전장치 (회귀)', () => {
  it('400일 창 안에 후보 분기가 4개면 유도하지 않는다', () => {
    // 4개 후보 모두 연간 종료일 이전이고 400일 이내지만, 개수 자체가 3이 아니므로
    // (예: 53주 회계달력 등으로) 유도하지 않는다.
    const facts = [
      f('Revenues', 4, '2024-12-31', 500, '10-K'),
      f('Revenues', 1, '2024-01-31', 80),
      f('Revenues', 1, '2024-04-30', 100),
      f('Revenues', 1, '2024-07-31', 110),
      f('Revenues', 1, '2024-10-31', 130),
    ]
    const r = normalizeFacts(facts)
    expect(r.quarterly.find((q) => q.periodEnd === '2024-12-31')).toBeUndefined()
  })

  it('3개 후보 중 하나가 전년도 비교기간이면(인접하지 않으면) 유도하지 않는다', () => {
    // 실제 3개 분기가 아니라, 2개의 실제 분기 + 1개의 전년도 말 비교기간 재태깅.
    // 개수는 정확히 3이지만 q2-q3 간격이 182일로 60~120일 범위를 벗어난다.
    const facts = [
      f('Revenues', 4, '2024-12-31', 500, '10-K'),
      f('Revenues', 1, '2023-12-31', 90), // 전년도 비교기간 (인접하지 않음)
      f('Revenues', 1, '2024-06-30', 110),
      f('Revenues', 1, '2024-09-30', 130),
    ]
    const r = normalizeFacts(facts)
    expect(r.quarterly.find((q) => q.periodEnd === '2024-12-31')).toBeUndefined()
  })
})

describe('normalizeFacts — TTM 안전장치 (회귀)', () => {
  it('한 분기의 필드가 null이면 TTM 합계도 null이다 (세 분기 합으로 대체하지 않는다)', () => {
    const facts = [
      ...fourQuarters('OperatingIncomeLoss', [10, 12, 18, 25]),
      f('Revenues', 1, '2024-06-30', 100),
      // 2024-09-30 분기에는 Revenues 태그가 없다 — revenue는 null
      f('Revenues', 1, '2024-12-31', 130),
      f('Revenues', 1, '2025-03-31', 160),
    ]
    const r = normalizeFacts(facts)
    expect(r.ttm[0]!.periodEnd).toBe('2025-03-31')
    expect(r.ttm[0]!.revenue).toBeNull()
    expect(r.ttm[0]!.operatingIncome).toBe(65)
  })

  it('창의 간격이 범위를 벗어나면(분기 누락으로 약 365일) TTM을 만들지 않는다', () => {
    // 2024-12-31 분기가 통째로 빠져서 처음-끝 간격이 약 1년이 된다.
    const facts = [
      f('Revenues', 1, '2024-03-31', 100),
      f('Revenues', 1, '2024-06-30', 110),
      f('Revenues', 1, '2024-09-30', 130),
      f('Revenues', 1, '2025-03-31', 160),
    ]
    const r = normalizeFacts(facts)
    expect(r.ttm).toHaveLength(0)
  })

  it('유도된 Q4가 창 안의 다른(anchor가 아닌) 분기일 때도 TTM sourceTags에 derived가 남는다', () => {
    const facts = [
      // 2023 회계연도: 3개 분기 + 연간 → Q4 유도
      f('Revenues', 4, '2023-12-31', 500, '10-K'),
      f('Revenues', 1, '2023-03-31', 100),
      f('Revenues', 1, '2023-06-30', 110),
      f('Revenues', 1, '2023-09-30', 130),
      // 2024년 실제 분기들 — 이 중 하나를 anchor로 하는 TTM 창에 유도된
      // 2023-12-31 Q4가 anchor가 아닌 위치로 포함된다.
      f('Revenues', 1, '2024-03-31', 140),
      f('Revenues', 1, '2024-06-30', 150),
      f('Revenues', 1, '2024-09-30', 170),
    ]
    const r = normalizeFacts(facts)
    const anchor = r.ttm.find((t) => t.periodEnd === '2024-09-30')!
    expect(anchor).toBeDefined()
    expect(r.sourceTags['TTM:2024-09-30']!.derived).toBe('Q4_from_annual@2023-12-31')
  })
})

describe('normalizeFacts — 연간 및 출처 기록', () => {
  it('연간 기간을 최근순으로 만든다', () => {
    const r = normalizeFacts([
      f('Revenues', 4, '2023-12-31', 300, '10-K'),
      f('Revenues', 4, '2024-12-31', 500, '10-K'),
    ])
    expect(r.annual.map((a) => a.periodEnd)).toEqual(['2024-12-31', '2023-12-31'])
  })

  it('필드가 어떤 태그에서 왔는지 기록한다', () => {
    const r = normalizeFacts([f('SalesRevenueNet', 4, '2024-12-31', 300, '10-K')])
    expect(r.sourceTags['A:2024-12-31']!.revenue).toBe('SalesRevenueNet')
  })

  it('데이터가 없으면 빈 결과를 반환한다', () => {
    const r = normalizeFacts([])
    expect(r).toEqual({ quarterly: [], annual: [], ttm: [], sourceTags: {} })
  })
})
