import { describe, it, expect } from 'vitest'
import { indexFacts, resolveFlow, resolveStock } from '@/providers/fundamental/resolve'
import type { RawFact } from '@/providers/types'

function fact(p: Partial<RawFact>): RawFact {
  return {
    cik: 1, tag: 'Revenues', unit: 'USD', periodStart: null,
    periodEnd: '2025-03-31', qtrs: 1, value: 100, form: '10-Q',
    filedDate: '2025-05-01', accession: 'a', source: 'bulk', ...p,
  }
}

describe('indexFacts', () => {
  it('qtrs와 periodEnd로 계층 인덱스를 만든다', () => {
    const idx = indexFacts([
      fact({ tag: 'Revenues', qtrs: 1, periodEnd: '2025-03-31', value: 10 }),
      fact({ tag: 'Revenues', qtrs: 4, periodEnd: '2025-03-31', value: 40 }),
      fact({ tag: 'StockholdersEquity', qtrs: 0, periodEnd: '2025-03-31', value: 500 }),
    ])
    expect(idx.duration.get(1)!.get('2025-03-31')!.get('Revenues')).toBe(10)
    expect(idx.duration.get(4)!.get('2025-03-31')!.get('Revenues')).toBe(40)
    expect(idx.instant.get('2025-03-31')!.get('StockholdersEquity')).toBe(500)
  })

  it('같은 키에 값이 여럿이면 늦게 신고된 값을 쓴다 — 정정 공시 반영', () => {
    const idx = indexFacts([
      fact({ value: 100, filedDate: '2025-05-01' }),
      fact({ value: 111, filedDate: '2025-08-01', form: '10-K' }),
      fact({ value: 99, filedDate: '2025-04-01' }),
    ])
    expect(idx.duration.get(1)!.get('2025-03-31')!.get('Revenues')).toBe(111)
  })

  it('같은 filedDate일 때 먼저 만난 값을 쓴다', () => {
    const idx = indexFacts([
      fact({ value: 100, filedDate: '2025-05-01' }),
      fact({ value: 222, filedDate: '2025-05-01' }),
    ])
    expect(idx.duration.get(1)!.get('2025-03-31')!.get('Revenues')).toBe(100)
  })
})

describe('indexFacts — API/bulk 기간 정합 (Apple 실사례 회귀)', () => {
  // 실측: Apple CIK 320193, accession 0000320193-26-000006 (FY26 Q1 10-Q).
  // bulk는 회계기간 종료일을 달력월 말일로 반올림해 2025-12-31로 저장하고,
  // 값도 143,756,000,000이 아니라 9,413,000,000(제품 세그먼트 분해값으로
  // 추정)을 담고 있다. API는 신고자의 정확한 날짜(2025-12-27)와 올바른
  // 연결 총계를 담고 있다.
  const TAG = 'RevenueFromContractWithCustomerExcludingAssessedTax'

  it('같은 분기를 가리키는 API/bulk 쌍은 하나의 canonical 기간으로 합쳐지고 API 값이 이긴다', () => {
    const idx = indexFacts([
      fact({
        source: 'api', qtrs: 1, periodEnd: '2025-12-27', value: 143_756_000_000,
        tag: TAG, filedDate: '2026-01-30',
      }),
      fact({
        source: 'bulk', qtrs: 1, periodEnd: '2025-12-31', value: 9_413_000_000,
        tag: TAG, filedDate: '2026-01-30',
      }),
    ])

    const byPeriod = idx.duration.get(1)!
    // 정확히 하나의 canonical 기간만 살아남는다 — bulk의 2025-12-31은 별개의
    // 기간으로 남지 않는다.
    expect([...byPeriod.keys()]).toEqual(['2025-12-27'])
    expect(byPeriod.get('2025-12-27')!.get(TAG)).toBe(143_756_000_000)
  })

  it('같은 분기에서 API/bulk 값이 실제로 일치해도 API 날짜가 canonical이 된다', () => {
    // 같은 accession의 전년 비교기간: bulk 124,300,000,000 / API 124,300,000,000 — 값은 일치.
    const idx = indexFacts([
      fact({
        source: 'api', qtrs: 1, periodEnd: '2024-12-28', value: 124_300_000_000,
        tag: TAG, filedDate: '2026-01-30',
      }),
      fact({
        source: 'bulk', qtrs: 1, periodEnd: '2024-12-31', value: 124_300_000_000,
        tag: TAG, filedDate: '2026-01-30',
      }),
    ])
    const byPeriod = idx.duration.get(1)!
    expect([...byPeriod.keys()]).toEqual(['2024-12-28'])
    expect(byPeriod.get('2024-12-28')!.get(TAG)).toBe(124_300_000_000)
  })

  it('API에 없는 태그는 canonical 기간에 bulk 값으로 채운다 (기간을 버리지 않는다)', () => {
    const idx = indexFacts([
      fact({ source: 'api', qtrs: 1, periodEnd: '2025-12-27', value: 143_756_000_000, tag: TAG }),
      fact({
        source: 'bulk', qtrs: 1, periodEnd: '2025-12-31', value: 3_594_000_000,
        tag: 'ShareBasedCompensation',
      }),
    ])
    const period = idx.duration.get(1)!.get('2025-12-27')!
    expect(period.get(TAG)).toBe(143_756_000_000)
    expect(period.get('ShareBasedCompensation')).toBe(3_594_000_000)
  })

  it('대응하는 API 기간이 없는 bulk 전용 기간은 자기 날짜 그대로 보존된다', () => {
    const idx = indexFacts([
      fact({ source: 'api', qtrs: 1, periodEnd: '2025-12-27', value: 143_756_000_000, tag: TAG }),
      fact({ source: 'bulk', qtrs: 1, periodEnd: '2019-09-30', value: 64_040_000_000, tag: TAG }),
    ])
    const byPeriod = idx.duration.get(1)!
    expect([...byPeriod.keys()].sort()).toEqual(['2019-09-30', '2025-12-27'])
    expect(byPeriod.get('2019-09-30')!.get(TAG)).toBe(64_040_000_000)
  })

  it('허용오차(20일) 이내 bulk는 병합되지만, 그보다 멀면 별개 기간으로 남는다', () => {
    const within = indexFacts([
      fact({ source: 'api', qtrs: 1, periodEnd: '2025-12-27', value: 100, tag: TAG }),
      // 19일 차이 — 실측 최대 드리프트 이내
      fact({ source: 'bulk', qtrs: 1, periodEnd: '2026-01-15', value: 999, tag: 'GrossProfit' }),
    ])
    expect([...within.duration.get(1)!.keys()]).toEqual(['2025-12-27'])

    const beyond = indexFacts([
      fact({ source: 'api', qtrs: 1, periodEnd: '2025-12-27', value: 100, tag: TAG }),
      // 29일 차이 — 실측에서 오탐(서로 다른 분기)이 시작되는 지점
      fact({ source: 'bulk', qtrs: 1, periodEnd: '2026-01-25', value: 999, tag: 'GrossProfit' }),
    ])
    expect([...beyond.duration.get(1)!.keys()].sort()).toEqual(['2025-12-27', '2026-01-25'])
  })

  it('instant(시점) 태그에도 같은 정합 로직이 적용된다 — Apple StockholdersEquity 실사례', () => {
    // 실측: bulk StockholdersEquity 2025-12-31 = -4,854,000,000 (음수 — 세그먼트/구성요소
    // 오염으로 추정), API 2025-12-27 = 88,190,000,000 (정확한 연결 총계).
    const idx = indexFacts([
      fact({
        source: 'api', qtrs: 0, periodEnd: '2025-12-27', value: 88_190_000_000,
        tag: 'StockholdersEquity',
      }),
      fact({
        source: 'bulk', qtrs: 0, periodEnd: '2025-12-31', value: -4_854_000_000,
        tag: 'StockholdersEquity',
      }),
    ])
    expect([...idx.instant.keys()]).toEqual(['2025-12-27'])
    expect(idx.instant.get('2025-12-27')!.get('StockholdersEquity')).toBe(88_190_000_000)
  })
})

describe('resolveFlow — 매출 태그 공존 시 큰 값 선택 (결함 2, Alphabet 실사례)', () => {
  // 실측: cik=1652044(Alphabet), 같은 period_end·qtrs·source(bulk)에
  // RevenueFromContractWithCustomerExcludingAssessedTax와 Revenues가 둘 다
  // 존재하는데, 어느 쪽이 오염(작은 디멘션 슬라이스)인지가 분기마다 다르다.
  const EXCL = 'RevenueFromContractWithCustomerExcludingAssessedTax'

  it('Revenues가 크면(진짜 총계) Revenues를 쓴다 — 2024-09-30 실사례', () => {
    const r = resolveFlow(new Map([
      [EXCL, 388_000_000],       // 오염된 세그먼트 슬라이스로 추정
      ['Revenues', 88_268_000_000], // 실제 Alphabet Q3 2024 매출과 일치
    ]))
    expect(r.fields.revenue).toBe(88_268_000_000)
    expect(r.used.revenue).toBe('Revenues')
  })

  it('Excl이 크면 Excl을 쓴다 — 2024-06-30 실사례 (오염이 반대쪽 태그에 나타남)', () => {
    const r = resolveFlow(new Map([
      [EXCL, 48_509_000_000],
      ['Revenues', 106_000_000], // 오염된 값
    ]))
    expect(r.fields.revenue).toBe(48_509_000_000)
    expect(r.used.revenue).toBe(EXCL)
  })

  it('둘 다 있고 값이 같으면(오염 없음) 그대로 그 값을 쓴다', () => {
    const r = resolveFlow(new Map([
      [EXCL, 3_913_000_000],
      ['Revenues', 3_913_000_000],
    ]))
    expect(r.fields.revenue).toBe(3_913_000_000)
  })

  it('일반적인 경우 — Excl만 있는 대다수 회사는 영향받지 않는다', () => {
    const r = resolveFlow(new Map([[EXCL, 253_549_000_000]]))
    expect(r.fields.revenue).toBe(253_549_000_000)
    expect(r.used.revenue).toBe(EXCL)
  })
})

describe('resolveFlow', () => {
  it('매출 폴백 체인의 1순위를 먼저 쓴다', () => {
    const r = resolveFlow(new Map([
      ['RevenueFromContractWithCustomerExcludingAssessedTax', 500],
      ['Revenues', 400],
    ]))
    expect(r.fields.revenue).toBe(500)
    expect(r.used.revenue).toBe('RevenueFromContractWithCustomerExcludingAssessedTax')
  })

  it('1순위가 없으면 다음 후보로 내려간다', () => {
    const r = resolveFlow(new Map([['SalesRevenueNet', 300]]))
    expect(r.fields.revenue).toBe(300)
    expect(r.used.revenue).toBe('SalesRevenueNet')
  })

  it('GrossProfit이 없으면 매출 - 매출원가로 유도한다', () => {
    const r = resolveFlow(new Map([['Revenues', 1000], ['CostOfRevenue', 400]]))
    expect(r.fields.grossProfit).toBe(600)
    expect(r.used.grossProfit).toBe('Revenues-CostOfRevenue')
  })

  it('매출원가 태그도 폴백한다', () => {
    const r = resolveFlow(new Map([['Revenues', 1000], ['CostOfGoodsAndServicesSold', 250]]))
    expect(r.fields.grossProfit).toBe(750)
  })

  it('GrossProfit이 있으면 그대로 쓴다', () => {
    const r = resolveFlow(new Map([
      ['Revenues', 1000], ['CostOfRevenue', 400], ['GrossProfit', 620],
    ]))
    expect(r.fields.grossProfit).toBe(620)
    expect(r.used.grossProfit).toBe('GrossProfit')
  })

  it('아무 태그도 없으면 null이며 used에 기록되지 않는다', () => {
    const r = resolveFlow(new Map())
    expect(r.fields.revenue).toBeNull()
    expect(r.fields.grossProfit).toBeNull()
    expect(r.used.revenue).toBeUndefined()
  })

  it('영업활동현금흐름 폴백', () => {
    const r = resolveFlow(new Map([
      ['NetCashProvidedByUsedInOperatingActivitiesContinuingOperations', 77],
    ]))
    expect(r.fields.ocf).toBe(77)
  })

  it('매출 폴백 체인: Revenues > SalesRevenueNet (위치 2 vs 3)', () => {
    const r = resolveFlow(new Map([
      ['Revenues', 400],
      ['SalesRevenueNet', 300],
    ]))
    expect(r.fields.revenue).toBe(400)
    expect(r.used.revenue).toBe('Revenues')
  })

  it('매출 폴백 체인: SalesRevenueNet > RevenueFromContractWithCustomerIncludingAssessedTax (위치 3 vs 4)', () => {
    const r = resolveFlow(new Map([
      ['SalesRevenueNet', 300],
      ['RevenueFromContractWithCustomerIncludingAssessedTax', 250],
    ]))
    expect(r.fields.revenue).toBe(300)
    expect(r.used.revenue).toBe('SalesRevenueNet')
  })

  it('매출원가 폴백: CostOfRevenue > CostOfGoodsAndServicesSold', () => {
    const r = resolveFlow(new Map([
      ['Revenues', 1000],
      ['CostOfRevenue', 400],
      ['CostOfGoodsAndServicesSold', 350],
    ]))
    expect(r.fields.grossProfit).toBe(600)
    expect(r.used.grossProfit).toBe('Revenues-CostOfRevenue')
  })

  it('영업활동현금흐름 폴백: NetCashProvidedByUsedInOperatingActivities 1순위', () => {
    const r = resolveFlow(new Map([
      ['NetCashProvidedByUsedInOperatingActivities', 100],
      ['NetCashProvidedByUsedInOperatingActivitiesContinuingOperations', 77],
    ]))
    expect(r.fields.ocf).toBe(100)
    expect(r.used.ocf).toBe('NetCashProvidedByUsedInOperatingActivities')
  })

  it('자본지출 폴백: PaymentsToAcquirePropertyPlantAndEquipment 1순위', () => {
    const r = resolveFlow(new Map([
      ['PaymentsToAcquirePropertyPlantAndEquipment', 200],
      ['PaymentsToAcquireProductiveAssets', 150],
    ]))
    expect(r.fields.capex).toBe(200)
    expect(r.used.capex).toBe('PaymentsToAcquirePropertyPlantAndEquipment')
  })

  it('자본지출: 첫 번째 태그만 있을 때', () => {
    const r = resolveFlow(new Map([
      ['PaymentsToAcquirePropertyPlantAndEquipment', 200],
    ]))
    expect(r.fields.capex).toBe(200)
    expect(r.used.capex).toBe('PaymentsToAcquirePropertyPlantAndEquipment')
  })

  it('영업이익 태그를 읽는다', () => {
    const r = resolveFlow(new Map([
      ['OperatingIncomeLoss', 500],
    ]))
    expect(r.fields.operatingIncome).toBe(500)
    expect(r.used.operatingIncome).toBe('OperatingIncomeLoss')
  })

  it('순이익 태그를 읽는다', () => {
    const r = resolveFlow(new Map([
      ['NetIncomeLoss', 300],
    ]))
    expect(r.fields.netIncome).toBe(300)
    expect(r.used.netIncome).toBe('NetIncomeLoss')
  })

  it('주식기반보상 태그를 읽는다', () => {
    const r = resolveFlow(new Map([
      ['ShareBasedCompensation', 50],
    ]))
    expect(r.fields.sbc).toBe(50)
    expect(r.used.sbc).toBe('ShareBasedCompensation')
  })

  it('연구개발비 태그를 읽는다', () => {
    const r = resolveFlow(new Map([
      ['ResearchAndDevelopmentExpense', 100],
    ]))
    expect(r.fields.rdExpense).toBe(100)
    expect(r.used.rdExpense).toBe('ResearchAndDevelopmentExpense')
  })

  it('희석주식수 태그를 읽는다', () => {
    const r = resolveFlow(new Map([
      ['WeightedAverageNumberOfDilutedSharesOutstanding', 5000000],
    ]))
    expect(r.fields.sharesDiluted).toBe(5000000)
    expect(r.used.sharesDiluted).toBe('WeightedAverageNumberOfDilutedSharesOutstanding')
  })

  it('영업이익이 없으면 null', () => {
    const r = resolveFlow(new Map())
    expect(r.fields.operatingIncome).toBeNull()
    expect(r.used.operatingIncome).toBeUndefined()
  })

  it('순이익이 없으면 null', () => {
    const r = resolveFlow(new Map())
    expect(r.fields.netIncome).toBeNull()
    expect(r.used.netIncome).toBeUndefined()
  })

  it('자본지출이 없으면 null', () => {
    const r = resolveFlow(new Map())
    expect(r.fields.capex).toBeNull()
    expect(r.used.capex).toBeUndefined()
  })

  it('주식기반보상이 없으면 null', () => {
    const r = resolveFlow(new Map())
    expect(r.fields.sbc).toBeNull()
    expect(r.used.sbc).toBeUndefined()
  })

  it('연구개발비가 없으면 null', () => {
    const r = resolveFlow(new Map())
    expect(r.fields.rdExpense).toBeNull()
    expect(r.used.rdExpense).toBeUndefined()
  })

  it('희석주식수가 없으면 null', () => {
    const r = resolveFlow(new Map())
    expect(r.fields.sharesDiluted).toBeNull()
    expect(r.used.sharesDiluted).toBeUndefined()
  })
})

describe('resolveStock', () => {
  it('현금은 현금성자산과 단기투자자산을 더한다', () => {
    const r = resolveStock(new Map([
      ['CashAndCashEquivalentsAtCarryingValue', 100],
      ['ShortTermInvestments', 50],
    ]))
    expect(r.fields.cash).toBe(150)
    expect(r.used.cash).toBe('CashAndCashEquivalentsAtCarryingValue+ShortTermInvestments')
  })

  it('단기투자자산이 없으면 현금성자산만 쓴다', () => {
    const r = resolveStock(new Map([['CashAndCashEquivalentsAtCarryingValue', 100]]))
    expect(r.fields.cash).toBe(100)
    expect(r.used.cash).toBe('CashAndCashEquivalentsAtCarryingValue')
  })

  it('총부채는 장기+유동 합산', () => {
    const r = resolveStock(new Map([
      ['LongTermDebtNoncurrent', 800], ['LongTermDebtCurrent', 200],
    ]))
    expect(r.fields.totalDebt).toBe(1000)
  })

  it('장기부채 태그가 없으면 DebtCurrent로 폴백한다', () => {
    const r = resolveStock(new Map([['DebtCurrent', 300]]))
    expect(r.fields.totalDebt).toBe(300)
    expect(r.used.totalDebt).toBe('DebtCurrent')
  })

  it('부채 태그가 전혀 없으면 null — 0으로 가정하지 않는다', () => {
    expect(resolveStock(new Map()).fields.totalDebt).toBeNull()
  })

  it('자본과 발행주식수를 읽는다', () => {
    const r = resolveStock(new Map([
      ['StockholdersEquity', 5000],
      ['EntityCommonStockSharesOutstanding', 24000000],
    ]))
    expect(r.fields.equity).toBe(5000)
    expect(r.fields.sharesOutstanding).toBe(24000000)
  })

  it('단기투자자산만 있고 현금성자산이 없으면 null — 데이터 이상 보호', () => {
    const r = resolveStock(new Map([
      ['ShortTermInvestments', 50],
    ]))
    expect(r.fields.cash).toBeNull()
    expect(r.used.cash).toBeUndefined()
  })

  it('자본이 없으면 null', () => {
    const r = resolveStock(new Map())
    expect(r.fields.equity).toBeNull()
    expect(r.used.equity).toBeUndefined()
  })

  it('발행주식수가 없으면 null', () => {
    const r = resolveStock(new Map())
    expect(r.fields.sharesOutstanding).toBeNull()
    expect(r.used.sharesOutstanding).toBeUndefined()
  })
})
