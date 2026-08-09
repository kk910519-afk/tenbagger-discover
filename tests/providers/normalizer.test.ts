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

describe('normalizeFacts — 시점 태그별 독립 해석 (NVIDIA 발행주식수 버그 재현)', () => {
  // NVIDIA 실사례: 재무상태표(현금/부채/자본)는 회계기간 종료일에 찍히지만,
  // 표지(cover page) 발행주식수는 그 신고서의 제출일 근처 별도 날짜에 찍힌다.
  // 분기 종료일과 정확히 같은 날짜에 발행주식수가 없으면(거의 항상 그렇다)
  // "하나의 날짜를 골라 그 날짜의 맵을 통째로 쓰는" 방식은 발행주식수를 잃는다.
  const facts = [
    ...fourQuarters('Revenues', [100, 110, 130, 160]),
    f('CashAndCashEquivalentsAtCarryingValue', 0, '2025-03-31', 1200),
    f('StockholdersEquity', 0, '2025-03-31', 5000),
    // 발행주식수는 분기 종료일(2025-03-31)이 아니라 그 이전 표지 제출일에 찍힌다.
    f('EntityCommonStockSharesOutstanding', 0, '2024-11-14', 900),
    f('EntityCommonStockSharesOutstanding', 0, '2025-02-20', 950),
    // 미래 시점 값 — asOf(2025-03-31)보다 나중이므로 과거로 새어 들어오면 안 된다.
    f('EntityCommonStockSharesOutstanding', 0, '2025-05-15', 980),
  ]
  const r = normalizeFacts(facts)

  it('재무상태표 값(현금/자본)은 종료일 그대로 해석된다', () => {
    const q = r.quarterly.find((q) => q.periodEnd === '2025-03-31')!
    expect(q.cash).toBe(1200)
    expect(q.equity).toBe(5000)
  })

  it('발행주식수는 같은 날짜가 아니어도 그 태그의 최근값을 독립적으로 찾는다', () => {
    const q = r.quarterly.find((q) => q.periodEnd === '2025-03-31')!
    expect(q.sharesOutstanding).toBe(950)
  })

  it('종료일 이후의 발행주식수 값은 과거로 새어 들어오지 않는다', () => {
    const q = r.quarterly.find((q) => q.periodEnd === '2025-03-31')!
    expect(q.sharesOutstanding).not.toBe(980)
  })

  it('TTM 행도 anchor 분기에서 복사되어 발행주식수를 채운다', () => {
    expect(r.ttm[0]!.periodEnd).toBe('2025-03-31')
    expect(r.ttm[0]!.sharesOutstanding).toBe(950)
  })
})

describe('normalizeFacts — 시점 값 조회 기간 제한 (staleness bound)', () => {
  it('제한(400일)보다 오래된 값은 쓰지 않고 null로 남긴다', () => {
    const facts = [
      ...fourQuarters('Revenues', [100, 110, 130, 160]),
      f('CashAndCashEquivalentsAtCarryingValue', 0, '2025-03-31', 1200),
      // 마지막 발행주식수 신고가 목표일보다 500일 이상 전 — 너무 오래돼서 쓰지 않는다.
      f('EntityCommonStockSharesOutstanding', 0, '2023-11-01', 700),
    ]
    const r = normalizeFacts(facts)
    const q = r.quarterly.find((q) => q.periodEnd === '2025-03-31')!
    expect(q.cash).toBe(1200)
    expect(q.sharesOutstanding).toBeNull()
  })
})

describe('normalizeFacts — API/bulk 중복 기간 정합 (Apple 실사례 회귀)', () => {
  // 실측 재현: 같은 분기가 API(정확한 날짜, 올바른 연결 총계)와 bulk(달력월
  // 말일로 반올림한 날짜, 세그먼트 오염으로 추정되는 엉뚱한 값)에서 각각
  // 따로 들어온다. 정합 전에는 quarterly에 분기당 2개 기간이 생겨 TTM 창이
  // 진짜 분기와 중복 분기를 섞어 합산했다.
  function apiFact(tag: string, periodEnd: string, value: number): RawFact {
    return {
      cik: 320193, tag, unit: 'USD', periodStart: null, periodEnd, qtrs: 1, value,
      form: '10-Q', filedDate: '2026-01-30', accession: `api-${periodEnd}`, source: 'api',
    }
  }
  function bulkFact(tag: string, periodEnd: string, value: number): RawFact {
    return {
      cik: 320193, tag, unit: 'USD', periodStart: null, periodEnd, qtrs: 1, value,
      form: '10-Q', filedDate: '2026-01-30', accession: `bulk-${periodEnd}`, source: 'bulk',
    }
  }

  const REV = 'RevenueFromContractWithCustomerExcludingAssessedTax'
  // [apiEnd, bulkEnd(month-end 반올림), apiRevenue, bulkRevenue(오염된 값)]
  const QUARTERS: [string, string, number, number][] = [
    ['2024-12-28', '2024-12-31', 124_300_000_000, 124_300_000_000], // 값은 일치하는 케이스도 섞는다
    ['2025-03-29', '2025-03-31', 95_359_000_000, 24_454_000_000],
    ['2025-06-27', '2025-06-30', 94_036_000_000, 7_404_000_000],
    ['2025-09-28', '2025-09-30', 102_466_000_000, 21_000_000_000],
    ['2025-12-27', '2025-12-31', 143_756_000_000, 9_413_000_000], // 실측 Apple 값
  ]

  const facts: RawFact[] = QUARTERS.flatMap(([apiEnd, bulkEnd, apiRev, bulkRev]) => [
    apiFact(REV, apiEnd, apiRev),
    bulkFact(REV, bulkEnd, bulkRev),
    apiFact('OperatingIncomeLoss', apiEnd, Math.round(apiRev * 0.3)),
    bulkFact('OperatingIncomeLoss', bulkEnd, Math.round(bulkRev * 0.3)),
  ])
  const r = normalizeFacts(facts)

  it('분기마다 API/bulk가 하나의 기간으로 합쳐진다 — 분기 수가 두 배가 되지 않는다', () => {
    expect(r.quarterly).toHaveLength(QUARTERS.length)
    expect(r.quarterly.map((q) => q.periodEnd)).toEqual(
      [...QUARTERS.map(([apiEnd]) => apiEnd)].sort().reverse(),
    )
  })

  it('canonical 기간은 API의 정확한 날짜를 쓰고 값도 API 값이다 (bulk의 오염된 값이 아니다)', () => {
    const latest = r.quarterly.find((q) => q.periodEnd === '2025-12-27')!
    expect(latest.revenue).toBe(143_756_000_000)
    expect(latest.periodEnd).not.toBe('2025-12-31')
  })

  it('TTM은 진짜 4개 분기만 합산한다 — 중복 기간이 창에 끼어들지 않는다', () => {
    const ttm = r.ttm.find((t) => t.periodEnd === '2025-12-27')!
    const expectedRevenue = QUARTERS.slice(1).reduce((s, [, , apiRev]) => s + apiRev, 0)
    expect(ttm.revenue).toBe(expectedRevenue)
    // 오염된 bulk 매출(24.4B + 7.4B + 21B + 9.4B 등)의 합이 아님을 확인한다.
    const bulkSum = QUARTERS.slice(1).reduce((s, [, , , bulkRev]) => s + bulkRev, 0)
    expect(ttm.revenue).not.toBe(bulkSum)
  })
})

describe('normalizeFacts — 물리적으로 불가능한 값 거부 (결함 3)', () => {
  it('음수 매출은 null로 거부되고 rejections에 기록된다', () => {
    const r = normalizeFacts([f('Revenues', 1, '2025-03-31', -50)])
    const q = r.quarterly.find((q) => q.periodEnd === '2025-03-31')!
    expect(q.revenue).toBeNull()
    expect(r.rejections).toHaveLength(1)
    expect(r.rejections[0]).toMatchObject({
      cik: 1, field: 'revenue', reason: 'revenue_negative', value: -50,
    })
  })

  it('매출총이익이 매출을 초과하면 null로 거부된다 (GrossProfit 태그가 직접 오염된 경우)', () => {
    const r = normalizeFacts([
      f('Revenues', 1, '2025-03-31', 100),
      f('GrossProfit', 1, '2025-03-31', 150),
    ])
    const q = r.quarterly.find((q) => q.periodEnd === '2025-03-31')!
    expect(q.revenue).toBe(100)
    expect(q.grossProfit).toBeNull()
    expect(r.rejections).toHaveLength(1)
    expect(r.rejections[0]!.reason).toBe('gross_profit_exceeds_revenue')
  })

  it('음수 영업이익·자본·FCF는 거부되지 않고 그대로 통과한다 — 적자/부실 신호 보존', () => {
    const facts = [
      f('Revenues', 1, '2025-03-31', 100),
      f('OperatingIncomeLoss', 1, '2025-03-31', -30),
      f('StockholdersEquity', 0, '2025-03-31', -20),
      f('NetCashProvidedByUsedInOperatingActivities', 1, '2025-03-31', -10),
      f('PaymentsToAcquirePropertyPlantAndEquipment', 1, '2025-03-31', 5),
    ]
    const r = normalizeFacts(facts)
    const q = r.quarterly.find((q) => q.periodEnd === '2025-03-31')!
    expect(q.operatingIncome).toBe(-30)
    expect(q.equity).toBe(-20)
    expect(q.ocf).toBe(-10)
    expect(q.fcf).toBe(-15) // ocf - capex = -10 - 5
    expect(r.rejections).toHaveLength(0)
  })

  it('분기 하나에서 매출이 거부되면 그 분기를 포함하는 TTM 매출도 null이 된다 (0/부분합으로 대체하지 않는다)', () => {
    const facts = [
      f('Revenues', 1, '2024-06-30', 100),
      f('Revenues', 1, '2024-09-30', -10), // 불가능한 값 — 거부됨
      f('Revenues', 1, '2024-12-31', 130),
      f('Revenues', 1, '2025-03-31', 160),
    ]
    const r = normalizeFacts(facts)
    const badQuarter = r.quarterly.find((q) => q.periodEnd === '2024-09-30')!
    expect(badQuarter.revenue).toBeNull()
    expect(r.ttm[0]!.periodEnd).toBe('2025-03-31')
    expect(r.ttm[0]!.revenue).toBeNull()
  })

  it('연간에서 유도된 Q4 자체가 음수 매출이면 그 Q4만 거부된다', () => {
    // 연간 매출(300)이 분기 3개 합(320)보다 작아 차감하면 Q4가 음수가 된다.
    const facts = [
      f('Revenues', 4, '2024-12-31', 300, '10-K'),
      f('Revenues', 1, '2024-03-31', 100),
      f('Revenues', 1, '2024-06-30', 110),
      f('Revenues', 1, '2024-09-30', 110),
    ]
    const r = normalizeFacts(facts)
    const q4 = r.quarterly.find((q) => q.periodEnd === '2024-12-31')!
    expect(q4.revenue).toBeNull()
    expect(r.rejections.some((x) => x.periodType === 'Q' && x.periodEnd === '2024-12-31')).toBe(true)
    // 연간 자체(매출 300, 유효)는 거부되지 않는다.
    const annual = r.annual.find((a) => a.periodEnd === '2024-12-31')!
    expect(annual.revenue).toBe(300)
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
    expect(r).toEqual({ quarterly: [], annual: [], ttm: [], sourceTags: {}, rejections: [] })
  })
})
