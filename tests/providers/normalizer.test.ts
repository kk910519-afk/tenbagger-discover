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
