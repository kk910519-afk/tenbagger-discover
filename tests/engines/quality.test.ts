import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseConfig } from '@/config'
import { evaluateQuality, hasCritical, hasWarning } from '@/engines/quality'
import type { CompanySnapshot, FinancialPeriod } from '@/domain/types'

const cfg = parseConfig(readFileSync('config.yaml', 'utf8'))

function fp(over: Partial<FinancialPeriod>): FinancialPeriod {
  return {
    periodEnd: '2025-03-31', periodType: 'TTM',
    revenue: 1000, grossProfit: 700, operatingIncome: 200, netIncome: 150,
    ocf: 250, capex: 50, fcf: 200, cash: 5000, totalDebt: 100, equity: 8000,
    sharesDiluted: 1000, sharesOutstanding: 1000, sbc: 50, rdExpense: 200, ...over,
  }
}

function snap(over: Partial<CompanySnapshot>): CompanySnapshot {
  return {
    cik: 1, ticker: 'TEST', name: 'Test Inc',
    themeSlug: 'ai-software-semi', industrySlug: 'semiconductors',
    industry: {
      slug: 'semiconductors', name: 'Semiconductors', themeSlug: 'ai-software-semi',
      tamUsd: null, tamCagr: null, tamSource: null, tamAsOf: null,
    },
    classificationSource: 'sic',
    marketCap: 5_000_000_000, price: 10, priceDate: '2026-08-08', sharesOutstanding: 1000,
    sharesBasis: 'reported',
    ttm: [fp({}), fp({ periodEnd: '2024-12-31' }), fp({ periodEnd: '2024-09-30' }),
          fp({ periodEnd: '2024-06-30' }), fp({ periodEnd: '2024-03-31' })],
    annual: [], quarterly: [],
    industryStats: {
      candidateCount: 5, medianGrossMargin: 0.6, medianRevenueGrowth: 0.2, distributions: {},
    },
    asOf: '2026-08-09', ...over,
  }
}

const codes = (s: CompanySnapshot) => evaluateQuality(s, cfg).map((f) => f.code).sort()

describe('evaluateQuality — 정상 기업', () => {
  it('건전한 기업은 Red Flag가 없다', () => {
    expect(evaluateQuality(snap({}), cfg)).toEqual([])
  })
})

describe('CRITICAL', () => {
  it('2년 연속 매출 감소', () => {
    const annual = [
      fp({ periodType: 'A', periodEnd: '2024-12-31', revenue: 800 }),
      fp({ periodType: 'A', periodEnd: '2023-12-31', revenue: 900 }),
      fp({ periodType: 'A', periodEnd: '2022-12-31', revenue: 1000 }),
    ]
    expect(codes(snap({ annual }))).toContain('REVENUE_DECLINE_2Y')
  })

  it('한 해만 감소하면 발동하지 않는다', () => {
    const annual = [
      fp({ periodType: 'A', periodEnd: '2024-12-31', revenue: 800 }),
      fp({ periodType: 'A', periodEnd: '2023-12-31', revenue: 900 }),
      fp({ periodType: 'A', periodEnd: '2022-12-31', revenue: 850 }),
    ]
    expect(codes(snap({ annual }))).not.toContain('REVENUE_DECLINE_2Y')
  })

  it('자본잠식 + 음의 FCF', () => {
    const ttm = [fp({ equity: -500, fcf: -100 }), fp({ periodEnd: '2024-12-31' })]
    expect(codes(snap({ ttm }))).toContain('NEGATIVE_EQUITY_BURN')
  })

  it('자본잠식이어도 FCF가 양수면 발동하지 않는다', () => {
    const ttm = [fp({ equity: -500, fcf: 100 })]
    expect(codes(snap({ ttm }))).not.toContain('NEGATIVE_EQUITY_BURN')
  })

  it('현금 런웨이 2분기 미만', () => {
    // 현금 100, TTM FCF -400 → 분기 소모 100 → 런웨이 1분기
    const ttm = [fp({ cash: 100, fcf: -400 })]
    const c = codes(snap({ ttm }))
    expect(c).toContain('RUNWAY_CRITICAL')
    expect(c).not.toContain('RUNWAY_LOW')   // 중복 방지
  })

  it('주식수 1년 50% 초과 증가', () => {
    const ttm = [fp({ sharesDiluted: 1600 }), fp({ periodEnd: '2024-12-31' }),
                 fp({ periodEnd: '2024-09-30' }), fp({ periodEnd: '2024-06-30' }),
                 fp({ periodEnd: '2024-03-31', sharesDiluted: 1000 })]
    const c = codes(snap({ ttm }))
    expect(c).toContain('EXTREME_DILUTION')
    expect(c).not.toContain('DILUTION')     // 중복 방지
  })
})

describe('WARNING', () => {
  it('GM 500bp 초과 하락', () => {
    const ttm = [fp({ revenue: 1000, grossProfit: 600 }), fp({ periodEnd: '2024-12-31' }),
                 fp({ periodEnd: '2024-09-30' }), fp({ periodEnd: '2024-06-30' }),
                 fp({ periodEnd: '2024-03-31', revenue: 1000, grossProfit: 700 })]
    expect(codes(snap({ ttm }))).toContain('GM_COLLAPSE')
  })

  it('SBC가 매출의 25% 초과', () => {
    expect(codes(snap({ ttm: [fp({ sbc: 300 })] }))).toContain('SBC_EXCESSIVE')
  })

  /**
   * 매출이 미미한 기업은 이 비율도 다섯 자리 퍼센트가 된다(TLPH 실측: "주식보상비용이
   * 매출의 71700%"가 종목 상세 화면 Risks 칸에 그대로 있었다). 판정과 evidence.ratio는
   * 그대로 두고 문장의 표기만 만 단위로 옮긴다 — 근거 수치는 evidence에 온전히 남는다.
   */
  it('비율이 다섯 자리 퍼센트면 만 단위로 적는다 — evidence의 원시값은 그대로다', () => {
    const flags = evaluateQuality(snap({ ttm: [fp({ revenue: 1000, sbc: 717_000 })] }), cfg)
    const sbc = flags.find((f) => f.code === 'SBC_EXCESSIVE')!
    expect(sbc.message).toBe('주식보상비용이 매출의 7.2만%')
    expect(sbc.evidence.ratio).toBeCloseTo(717, 6)
  })

  it('주식수 15% 초과 증가', () => {
    const ttm = [fp({ sharesDiluted: 1200 }), fp({ periodEnd: '2024-12-31' }),
                 fp({ periodEnd: '2024-09-30' }), fp({ periodEnd: '2024-06-30' }),
                 fp({ periodEnd: '2024-03-31', sharesDiluted: 1000 })]
    expect(codes(snap({ ttm }))).toContain('DILUTION')
  })

  it('Debt/EBITDA 5 초과', () => {
    expect(codes(snap({ ttm: [fp({ totalDebt: 2000, operatingIncome: 200 })] })))
      .toContain('LEVERAGE_HIGH')
  })

  it('런웨이 6분기 미만', () => {
    // 현금 400, TTM FCF -400 → 분기 소모 100 → 런웨이 4분기
    expect(codes(snap({ ttm: [fp({ cash: 400, fcf: -400 })] }))).toContain('RUNWAY_LOW')
  })
})

describe('증거 및 헬퍼', () => {
  it('Red Flag에 근거 수치를 담는다', () => {
    const flags = evaluateQuality(snap({ ttm: [fp({ sbc: 300 })] }), cfg)
    const sbc = flags.find((f) => f.code === 'SBC_EXCESSIVE')!
    expect(sbc.evidence.ratio).toBeCloseTo(0.3)
    expect(sbc.severity).toBe('WARNING')
    expect(sbc.message.length).toBeGreaterThan(0)
  })

  it('데이터가 없으면 Red Flag를 만들지 않는다 — 결측은 위험 신호가 아니다', () => {
    const empty = snap({ ttm: [], annual: [], quarterly: [] })
    expect(evaluateQuality(empty, cfg)).toEqual([])
  })

  it('hasCritical / hasWarning', () => {
    const critical = evaluateQuality(snap({ ttm: [fp({ cash: 100, fcf: -400 })] }), cfg)
    expect(hasCritical(critical)).toBe(true)
    const warning = evaluateQuality(snap({ ttm: [fp({ sbc: 300 })] }), cfg)
    expect(hasCritical(warning)).toBe(false)
    expect(hasWarning(warning)).toBe(true)
  })
})
