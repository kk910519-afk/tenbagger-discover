import { describe, it, expect } from 'vitest'
import { validatePeriod } from '@/domain/validate'
import type { FinancialPeriod } from '@/domain/types'

function period(overrides: Partial<FinancialPeriod>): FinancialPeriod {
  return {
    periodEnd: '2025-12-31', periodType: 'TTM',
    revenue: 1000, grossProfit: 400, operatingIncome: 100, netIncome: 50,
    ocf: 80, capex: 20, fcf: 60,
    cash: 500, totalDebt: 200, equity: 300,
    sharesDiluted: 1000, sharesOutstanding: 1000, sbc: 10, rdExpense: 30,
    ...overrides,
  }
}

describe('validatePeriod', () => {
  it('음수 매출은 null로 거부되고 사유가 기록된다', () => {
    const { period: out, rejections } = validatePeriod(1, period({ revenue: -50 }))
    expect(out.revenue).toBeNull()
    expect(rejections).toHaveLength(1)
    expect(rejections[0]).toMatchObject({
      cik: 1, field: 'revenue', reason: 'revenue_negative', value: -50,
    })
  })

  it('매출총이익이 매출을 초과하면 null로 거부된다', () => {
    const { period: out, rejections } = validatePeriod(
      1, period({ revenue: 100, grossProfit: 150 }),
    )
    expect(out.grossProfit).toBeNull()
    expect(out.revenue).toBe(100) // 매출 자체는 그대로 유지
    expect(rejections).toHaveLength(1)
    expect(rejections[0]).toMatchObject({
      field: 'grossProfit', reason: 'gross_profit_exceeds_revenue', value: 150,
    })
  })

  it('매출총이익이 매출과 같으면(매출원가 0) 거부되지 않는다 — 경계값', () => {
    const { period: out, rejections } = validatePeriod(
      1, period({ revenue: 100, grossProfit: 100 }),
    )
    expect(out.grossProfit).toBe(100)
    expect(rejections).toHaveLength(0)
  })

  it('매출이 음수라 거부된 뒤에는 매출총이익 비교를 하지 않는다 — 그대로 유지', () => {
    const { period: out, rejections } = validatePeriod(
      1, period({ revenue: -50, grossProfit: 999 }),
    )
    expect(out.revenue).toBeNull()
    expect(out.grossProfit).toBe(999)
    expect(rejections).toHaveLength(1)
    expect(rejections[0]!.field).toBe('revenue')
  })

  it('매출이 원래 null이면 매출총이익 비교를 건너뛴다', () => {
    const { period: out, rejections } = validatePeriod(
      1, period({ revenue: null, grossProfit: 500 }),
    )
    expect(out.grossProfit).toBe(500)
    expect(rejections).toHaveLength(0)
  })

  it('정상 값은 아무것도 거부하지 않고 같은 객체 참조를 반환한다', () => {
    const p = period({})
    const { period: out, rejections } = validatePeriod(1, p)
    expect(out).toBe(p)
    expect(rejections).toHaveLength(0)
  })

  it('음수 영업이익은 정상 신호로 그대로 유지된다 — 적자 기업 방어', () => {
    const { period: out, rejections } = validatePeriod(
      1, period({ operatingIncome: -200_000_000 }),
    )
    expect(out.operatingIncome).toBe(-200_000_000)
    expect(rejections).toHaveLength(0)
  })

  it('음수 자본(자본잠식)은 정상 신호로 그대로 유지된다', () => {
    const { period: out, rejections } = validatePeriod(
      1, period({ equity: -1_000_000 }),
    )
    expect(out.equity).toBe(-1_000_000)
    expect(rejections).toHaveLength(0)
  })

  it('음수 FCF는 정상 신호로 그대로 유지된다', () => {
    const { period: out, rejections } = validatePeriod(
      1, period({ fcf: -75_000_000 }),
    )
    expect(out.fcf).toBe(-75_000_000)
    expect(rejections).toHaveLength(0)
  })

  it('매출총이익률이 -50%보다 낮아도(매출원가가 매출을 크게 웃돌아도) 거부하지 않는다 — 부실 신호 보존', () => {
    const { period: out, rejections } = validatePeriod(
      1, period({ revenue: 100, grossProfit: -60 }), // margin = -60%
    )
    expect(out.grossProfit).toBe(-60)
    expect(rejections).toHaveLength(0)
  })
})
