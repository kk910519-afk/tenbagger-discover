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
