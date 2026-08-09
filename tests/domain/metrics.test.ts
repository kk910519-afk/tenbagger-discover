import { describe, it, expect } from 'vitest'
import type { FinancialPeriod } from '@/domain/types'
import {
  ttmRevenueGrowth, revenueCagr3y, revenueAcceleration,
  grossMargin, operatingMargin, fcfMargin,
  grossMarginSeries, grossMarginTrendBps,
  roic, cashRunwayQuarters, netCashToMarketCap, debtToEbitda, opexGrowth,
} from '@/domain/metrics'

function p(over: Partial<FinancialPeriod> & { periodEnd: string }): FinancialPeriod {
  return {
    periodType: 'TTM', revenue: null, grossProfit: null, operatingIncome: null,
    netIncome: null, ocf: null, capex: null, fcf: null, cash: null,
    totalDebt: null, equity: null, sharesDiluted: null, sharesOutstanding: null,
    sbc: null, rdExpense: null, ...over,
  }
}

/** 최근순 TTM 계열 — index가 클수록 과거 */
function ttmSeries(revenues: (number | null)[]): FinancialPeriod[] {
  return revenues.map((r, i) =>
    p({ periodEnd: `2025-${String(12 - i).padStart(2, '0')}-31`, revenue: r }),
  )
}

describe('ttmRevenueGrowth', () => {
  it('현재 TTM과 4분기 전 TTM을 비교한다', () => {
    const s = ttmSeries([500, 480, 460, 440, 400])
    expect(ttmRevenueGrowth(s)).toBeCloseTo(0.25)
  })
  it('4분기 전 TTM이 없으면 null', () => {
    expect(ttmRevenueGrowth(ttmSeries([500, 480]))).toBeNull()
  })
})

describe('revenueCagr3y', () => {
  it('12분기 전과 비교해 3년 CAGR을 낸다', () => {
    const s = ttmSeries(Array(13).fill(null).map((_, i) => (i === 0 ? 200 : i === 12 ? 100 : 150)))
    expect(revenueCagr3y(s)).toBeCloseTo(0.2599, 3)
  })
  it('이력이 짧으면 null', () => {
    expect(revenueCagr3y(ttmSeries([200, 190]))).toBeNull()
  })
})

describe('revenueAcceleration', () => {
  it('최근 2개 분기 YoY 평균에서 직전 2개 분기 YoY 평균을 뺀다', () => {
    // 분기 8개, 최근순. q[i] vs q[i+4]가 YoY
    const q = [160, 130, 110, 100, 100, 90, 85, 80].map((r, i) =>
      p({ periodEnd: `2025-${String(8 - i).padStart(2, '0')}-30`, periodType: 'Q', revenue: r }),
    )
    // 최근 2분기 YoY: 160/100-1=0.60, 130/90-1=0.4444 → 평균 0.5222
    // 직전 2분기 YoY: 110/85-1=0.2941, 100/80-1=0.25   → 평균 0.2721
    expect(revenueAcceleration(q)).toBeCloseTo(0.2502, 3)
  })
  it('분기가 8개 미만이면 null', () => {
    expect(revenueAcceleration([])).toBeNull()
  })
})

describe('마진', () => {
  const per = p({ periodEnd: '2025-12-31', revenue: 1000, grossProfit: 700, operatingIncome: 200, fcf: 150 })
  it('매출총이익률', () => expect(grossMargin(per)).toBeCloseTo(0.7))
  it('영업이익률', () => expect(operatingMargin(per)).toBeCloseTo(0.2))
  it('FCF 마진', () => expect(fcfMargin(per)).toBeCloseTo(0.15))
  it('매출이 0 이하면 null', () => {
    expect(grossMargin(p({ periodEnd: 'x', revenue: 0, grossProfit: 5 }))).toBeNull()
  })
  it('기간이 없으면 null', () => expect(grossMargin(undefined)).toBeNull())
})

describe('grossMarginSeries / grossMarginTrendBps', () => {
  const quarterly = [0.74, 0.72, 0.70, 0.68, 0.66, 0.64, 0.62, 0.60].map((gm, i) =>
    p({
      periodEnd: `2025-${String(8 - i).padStart(2, '0')}-30`, periodType: 'Q',
      revenue: 100, grossProfit: gm * 100,
    }),
  )

  it('오래된 순으로 반환한다', () => {
    const s = grossMarginSeries(quarterly, 8)
    expect(s[0]).toBeCloseTo(0.60)
    expect(s[7]).toBeCloseTo(0.74)
  })

  it('개선 추세는 양수 bps', () => {
    // 분기당 +0.02 → 연간 +0.08 → +800bps
    expect(grossMarginTrendBps(quarterly, 8)).toBeCloseTo(800, 0)
  })

  it('분기가 부족하면 null', () => {
    expect(grossMarginTrendBps(quarterly.slice(0, 2), 8)).toBeNull()
  })
})

describe('roic', () => {
  it('NOPAT을 투하자본으로 나눈다', () => {
    const per = p({
      periodEnd: '2025-12-31', operatingIncome: 1000,
      totalDebt: 2000, equity: 6000, cash: 1000,
    })
    // NOPAT = 1000 * 0.79 = 790, 투하자본 = 2000 + 6000 - 1000 = 7000
    expect(roic(per, 0.21)).toBeCloseTo(0.1129, 4)
  })
  it('투하자본이 0 이하면 null', () => {
    const per = p({ periodEnd: 'x', operatingIncome: 100, totalDebt: 0, equity: 100, cash: 500 })
    expect(roic(per, 0.21)).toBeNull()
  })
})

describe('cashRunwayQuarters', () => {
  it('현금을 분기 평균 소모액으로 나눈다', () => {
    const s = [p({ periodEnd: '2025-12-31', fcf: -400, cash: 1000 })]
    // 분기 평균 소모 = 400/4 = 100 → 런웨이 10분기
    expect(cashRunwayQuarters(s)).toBeCloseTo(10)
  })
  it('FCF가 양수면 null — 런웨이 개념이 없다', () => {
    expect(cashRunwayQuarters([p({ periodEnd: 'x', fcf: 100, cash: 1000 })])).toBeNull()
  })
  it('현금이 없으면 null', () => {
    expect(cashRunwayQuarters([p({ periodEnd: 'x', fcf: -100, cash: null })])).toBeNull()
  })
})

describe('netCashToMarketCap / debtToEbitda / opexGrowth', () => {
  it('순현금 비율', () => {
    const per = p({ periodEnd: 'x', cash: 1500, totalDebt: 500 })
    expect(netCashToMarketCap(per, 10000)).toBeCloseTo(0.1)
  })
  it('시가총액이 없으면 null', () => {
    expect(netCashToMarketCap(p({ periodEnd: 'x', cash: 1, totalDebt: 0 }), null)).toBeNull()
  })
  it('EBITDA 근사는 영업이익을 쓴다', () => {
    expect(debtToEbitda(p({ periodEnd: 'x', totalDebt: 1000, operatingIncome: 250 }))).toBeCloseTo(4)
  })
  it('영업이익이 0 이하면 null', () => {
    expect(debtToEbitda(p({ periodEnd: 'x', totalDebt: 1000, operatingIncome: -10 }))).toBeNull()
  })
  it('opex 증가율은 (매출총이익 - 영업이익) 기준', () => {
    const s = [
      p({ periodEnd: '2025-12-31', grossProfit: 700, operatingIncome: 200 }),
      p({ periodEnd: '2025-09-30' }), p({ periodEnd: '2025-06-30' }), p({ periodEnd: '2025-03-31' }),
      p({ periodEnd: '2024-12-31', grossProfit: 500, operatingIncome: 100 }),
    ]
    // opex: 500 vs 400 → +25%
    expect(opexGrowth(s)).toBeCloseTo(0.25)
  })
})
