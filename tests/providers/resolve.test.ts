import { describe, it, expect } from 'vitest'
import {
  indexFacts, resolveFlow, resolveStock, resolveTotalDebt,
} from '@/providers/fundamental/resolve'
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

  // 매출 = 매출총이익 + 매출원가는 회계 항등식이므로, 매출 태그만 오염된 기간에서
  // 회사가 신고한 다른 두 숫자로 진짜 총계를 되살릴 수 있다.
  it('매출 태그가 오염됐어도 GrossProfit+CostOfRevenue로 복원한다 (Astera Labs 2025 Q1 실사례)', () => {
    const r = resolveFlow(new Map([
      [EXCL, 44_638_000],
      ['GrossProfit', 119_411_000],
      ['CostOfGoodsAndServicesSold', 40_031_000],
    ]))
    expect(r.fields.revenue).toBe(159_442_000)
    expect(r.used.revenue).toBe('GrossProfit+CostOfGoodsAndServicesSold')
    expect(r.fields.grossProfit).toBe(119_411_000)
  })

  it('매출 태그가 정상이면 항등식 후보가 이기지 못한다', () => {
    const r = resolveFlow(new Map([
      ['Revenues', 1_000_000],
      ['GrossProfit', 600_000],
      ['CostOfRevenue', 400_000],
    ]))
    expect(r.fields.revenue).toBe(1_000_000)
    expect(r.used.revenue).toBe('Revenues')
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

// 부채 태그 확장(debt-coverage 과제). 티어 1·2는 확장 전 규칙 그대로이고 티어 3·4가
// 신설됐다 — 아래 첫 describe가 "확장이 순수하게 가산적"임을(기존에 값이 나오던
// 조합은 하나도 변하지 않음) 명시적으로 못 박는다.
describe('resolveTotalDebt — 기존 조합은 값이 변하지 않는다 (가산적 확장 회귀)', () => {
  it('장·단기 합산 총계 태그가 있으면 그것이 총부채다 (구성요소 조립과 값이 같다)', () => {
    const r = resolveTotalDebt(new Map([
      ['LongTermDebtNoncurrent', 800], ['LongTermDebtCurrent', 200],
      // 상품별/롤업 태그는 티어 1 결과를 건드리면 안 된다.
      ['LongTermDebt', 1000], ['LineOfCredit', 900],
      ['DebtLongtermAndShorttermCombinedAmount', 1400],
      // 단기차입금은 정의상 장기차입금에 포함될 수 없으므로 더해진다(F2).
      // 유동 부분은 총계 `DebtCurrent`(250)와 구성요소 합(200+400=600) 중 큰 쪽.
      ['ShortTermBorrowings', 400], ['DebtCurrent', 250],
    ]))
    // 회사 자신의 장·단기 합산 총계(1400)가 구성요소 조립(800+200+400)과 정확히
    // 일치한다 — 두 관행 중 어느 쪽에서도 옳은 것은 합산 총계 쪽이므로 그것을 쓴다.
    expect(r).toEqual({ value: 1400, tag: 'DebtLongtermAndShorttermCombinedAmount' })
  })

  it('비유동만 있어도 그것만 쓴다', () => {
    expect(resolveTotalDebt(new Map([['LongTermDebtNoncurrent', 800], ['NotesPayable', 5000]])))
      .toEqual({ value: 800, tag: 'LongTermDebtNoncurrent' })
  })

  it('DebtCurrent가 있어도 LongTermDebt 롤업에 닿는다 (F2 심층 회귀)', () => {
    // 옛 동작은 `DebtCurrent`에서 조기 반환해 300만 냈다. 실측(TSLA 2026-06-30):
    // `DebtCurrent` 1,340,000,000 / `LongTermDebt` 7,721,000,000이고 신고서
    // 대차대조표는 유동 1,418 / 비유동 7,924(리스 포함)로 둘을 따로 적는다.
    expect(resolveTotalDebt(new Map([['DebtCurrent', 300], ['LongTermDebt', 7000]])))
      .toEqual({ value: 7300, tag: 'LongTermDebt+DebtCurrent' })
  })

  it('부채 개념이 하나도 없으면 null — 0으로 가정하지 않는다', () => {
    expect(resolveTotalDebt(new Map([['StockholdersEquity', 100]]))).toBeNull()
  })

  it('리스부채만 있으면 null — 리스는 차입금 정의에 넣지 않는다', () => {
    expect(resolveTotalDebt(new Map([
      ['OperatingLeaseLiability', 5000], ['OperatingLeaseLiabilityNoncurrent', 4000],
      ['FinanceLeaseLiability', 900], ['FinanceLeaseLiabilityCurrent', 100],
    ]))).toBeNull()
  })
})

describe('resolveTotalDebt — 상품별 이름으로만 태깅한 발행사 (티어 3·4)', () => {
  it('장·단기 합산 총계 태그를 그대로 쓴다', () => {
    expect(resolveTotalDebt(new Map([['DebtLongtermAndShorttermCombinedAmount', 4200]])))
      .toEqual({ value: 4200, tag: 'DebtLongtermAndShorttermCombinedAmount' })
  })

  it('LongTermDebt만 있으면 그것이 총 장기차입금이다 (유동 만기분 포함)', () => {
    expect(resolveTotalDebt(new Map([['LongTermDebt', 2065]])))
      .toEqual({ value: 2065, tag: 'LongTermDebt' })
  })

  it('TLS 실사례 — 롤업(LongTermDebt)과 상품합은 더하지 않고 큰 쪽을 쓴다 (이중계상 방지)', () => {
    // TLS 2012-12-31: LongTermDebt와 신용한도 계열이 정확히 같은 부채를 가리켰다.
    const r = resolveTotalDebt(new Map([
      ['LongTermDebt', 18_934_000],
      ['LinesOfCreditCurrent', 12_934_000], ['LongTermLineOfCredit', 6_000_000],
    ]))
    expect(r!.value).toBe(18_934_000)
  })

  it('SND 실사례 — 서로 다른 상품 계열은 합산하고, 오염된 롤업보다 그 합이 크면 그쪽을 쓴다', () => {
    // SND 2016-12-31: LongTermDebt=570,000(슬라이스) vs 어음+신용한도=56,052,000.
    const r = resolveTotalDebt(new Map([
      ['LongTermDebt', 570_000],
      ['NotesPayableCurrent', 6_052_000], ['LongTermLineOfCredit', 50_000_000],
    ]))
    expect(r!.value).toBe(56_052_000)
  })

  it('XEL 실사례 — 단기차입금은 장기차입금에 포함될 수 없으므로 더한다', () => {
    const r = resolveTotalDebt(new Map([
      ['LongTermDebt', 16_209_000_000], ['ShortTermBorrowings', 1_038_000_000],
    ]))
    expect(r).toEqual({ value: 17_247_000_000, tag: 'LongTermDebt+ShortTermBorrowings' })
  })

  it('한 계열 안에서 총계와 (비유동+유동) 중 큰 쪽을 쓴다', () => {
    // 총계 태그가 오염돼 작을 때 구성요소 합이 이긴다.
    expect(resolveTotalDebt(new Map([
      ['LineOfCredit', 100], ['LongTermLineOfCredit', 700], ['LinesOfCreditCurrent', 300],
    ]))!.value).toBe(1000)
    // 반대로 구성요소가 일부만 태깅됐으면 총계 태그가 이긴다.
    expect(resolveTotalDebt(new Map([
      ['LineOfCredit', 1000], ['LinesOfCreditCurrent', 300],
    ]))!.value).toBe(1000)
  })

  it('전환사채는 이름 변형(ConvertibleDebt*/ConvertibleNotesPayable*)을 같은 계열로 본다', () => {
    // 같은 계열의 이름 변형 둘이 함께 있어도 처음 하나만 쓴다 — 더하면 이중계상.
    expect(resolveTotalDebt(new Map([
      ['ConvertibleDebtCurrent', 500], ['ConvertibleNotesPayableCurrent', 500],
    ]))!.value).toBe(500)
  })

  it('단기차입금만 있어도 값을 낸다', () => {
    expect(resolveTotalDebt(new Map([['ShortTermBorrowings', 42]])))
      .toEqual({ value: 42, tag: 'ShortTermBorrowings' })
  })

  it('CDNS 실사례 — 티어 4가 0이면 null이다 (상품 잔액 0은 무차입의 증거가 아니다)', () => {
    // 리볼버 미인출(LinesOfCreditCurrent=0)만 잡히고 선순위채는 추적 태그에 없던 경우.
    expect(resolveTotalDebt(new Map([['LinesOfCreditCurrent', 0]]))).toBeNull()
    expect(resolveTotalDebt(new Map([
      ['ConvertibleDebtNoncurrent', 0], ['ConvertibleDebtCurrent', 0],
    ]))).toBeNull()
  })

  it('총부채 0은 어느 티어에서도 null이다 (MTCH 2026-06-30 회귀)', () => {
    expect(resolveTotalDebt(new Map([['LongTermDebtNoncurrent', 0]]))).toBeNull()
    expect(resolveTotalDebt(new Map([['DebtCurrent', 0]]))).toBeNull()
    expect(resolveTotalDebt(new Map([['DebtLongtermAndShorttermCombinedAmount', 0]])))
      .toBeNull()
  })
})
