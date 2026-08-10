import { describe, it, expect } from 'vitest'
import type { FinancialPeriod } from '@/domain/types'
import {
  ttmRevenueGrowth, revenueCagr3y, revenueAcceleration,
  grossMargin, operatingMargin, fcfMargin,
  grossMarginSeries, grossMarginTrendBps,
  roic, roicGap, roicVerdict, cashRunwayQuarters, netCashToMarketCap, debtToEbitda, opexGrowth,
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

const MIN_INVESTED = 0.10

/** Dropbox 2025-12-31 실사례 — 자사주 매입으로 자본이 −$1.797B, 투하자본은 상쇄 잔차 $145.5M. */
function dropbox2025() {
  return p({
    periodEnd: '2025-12-31', operatingIncome: 689_100_000,
    totalDebt: 2_834_000_000, equity: -1_797_200_000, cash: 891_300_000,
  })
}

describe('roic', () => {
  it('NOPAT을 투하자본으로 나눈다', () => {
    const per = p({
      periodEnd: '2025-12-31', operatingIncome: 1000,
      totalDebt: 2000, equity: 6000, cash: 1000,
    })
    // NOPAT = 1000 * 0.79 = 790, 투하자본 = 2000 + 6000 - 1000 = 7000
    expect(roic(per, 0.21, MIN_INVESTED)).toBeCloseTo(0.1129, 4)
  })
  it('투하자본이 0 이하면 null', () => {
    const per = p({ periodEnd: 'x', operatingIncome: 100, totalDebt: 0, equity: 100, cash: 500 })
    expect(roic(per, 0.21, MIN_INVESTED)).toBeNull()
  })

  // 리뷰 Finding 2: 부호 검사만으로는 부족하다 — 투하자본이 큰 수들의 상쇄 잔차이면
  // ROIC는 사업의 자본생산성이 아니라 자본구조의 산물이다.
  it('투하자본이 양수여도 총액 대비 무시할 만큼 작으면 null (DBX 실사례)', () => {
    const per = dropbox2025()
    // 투하자본 = 2,834 − 1,797.2 − 891.3 = 145.5M, 총액(절댓값 합) = 5,522.5M → 2.63%
    expect(roic(per, 0.21, MIN_INVESTED)).toBeNull()
  })

  it('하한이 없으면 같은 기간이 ROIC 374%를 낸다 — 하한이 막는 것이 무엇인지 고정한다', () => {
    // 하한을 0으로 두면(=수정 전 동작) 자본구조의 산물이 그대로 지표가 된다.
    expect(roic(dropbox2025(), 0.21, 0)).toBeCloseTo(3.7418, 3)
  })

  it('현금이 부채+자본을 거의 다 상쇄해도 걸린다 (분모가 양수이기만 한 경우)', () => {
    // 부채 100 + 자본 100 − 현금 190 = 10, 총액 390 → 2.6%
    const per = p({ periodEnd: 'x', operatingIncome: 50, totalDebt: 100, equity: 100, cash: 190 })
    expect(roic(per, 0.21, MIN_INVESTED)).toBeNull()
    // 하한을 넘기면(현금 100 → 잔차 100/300 = 33%) 정상적으로 값이 나온다
    const ok = p({ periodEnd: 'x', operatingIncome: 50, totalDebt: 100, equity: 100, cash: 100 })
    expect(roic(ok, 0.21, MIN_INVESTED)).toBeCloseTo(0.395, 4)
  })
})

describe('roicGap — roic()가 null인 이유를 구분한다(roic() 자체의 조건과 정확히 대응해야 함)', () => {
  it('재무 항목이 결측이면 MISSING_FIELDS', () => {
    const per = p({ periodEnd: 'x', operatingIncome: 100, totalDebt: 0, equity: 100, cash: null })
    expect(roic(per, 0.21, MIN_INVESTED)).toBeNull()
    expect(roicGap(per, MIN_INVESTED)).toBe('MISSING_FIELDS')
  })

  it('기간 자체가 없으면(undefined) MISSING_FIELDS', () => {
    expect(roicGap(undefined, MIN_INVESTED)).toBe('MISSING_FIELDS')
  })

  it('항목은 다 있는데 투하자본이 0 이하면 NON_POSITIVE_INVESTED_CAPITAL', () => {
    const per = p({ periodEnd: 'x', operatingIncome: 100, totalDebt: 0, equity: 100, cash: 500 })
    expect(roic(per, 0.21, MIN_INVESTED)).toBeNull()
    expect(roicGap(per, MIN_INVESTED)).toBe('NON_POSITIVE_INVESTED_CAPITAL')
  })

  it('투하자본이 양수지만 규모 하한 미만이면 IMMATERIAL_INVESTED_CAPITAL', () => {
    const per = dropbox2025()
    expect(roic(per, 0.21, MIN_INVESTED)).toBeNull()
    expect(roicGap(per, MIN_INVESTED)).toBe('IMMATERIAL_INVESTED_CAPITAL')
    // 결측이 아니다 — 재무 항목은 넷 다 보고돼 있다
    expect(roicGap(per, 0)).toBeNull()
  })

  /**
   * 규모 하한의 분모는 `|총부채| + |자본| + |현금|`이다. 절댓값이 없으면 그 합은
   * 그냥 `총부채 + 자본 + 현금`이 되어, 자본이 음수인 기업에서 분모가 **작아지고**
   * 비율이 커진다 — 즉 하한을 통과해 버린다. 자사주 매입으로 자본이 음수가 된 기업이
   * 바로 이 가드가 잡으려던 대상이므로, 절댓값이 없으면 장치 전체가 무력해진다.
   *
   * DBX 실사례만으로는 이것이 관측되지 않는다: 절댓값 유무와 무관하게 둘 다 0.10
   * 미만이라 결과가 같다(2.63% vs 7.55%). 문턱을 사이에 두고 갈리는 입력이 필요하다.
   */
  it('규모 하한의 분모는 절댓값 합이다 — 자본이 음수일 때 부호 상쇄로 통과하지 못한다', () => {
    // 투하자본 = 100 + (−50) − 40 = 10
    //   절댓값 합  = 100 + 50 + 40 = 190 → 5.26%  → 하한 10% 미달 → null
    //   부호 합(변이) = 100 − 50 + 40 =  90 → 11.11% → 하한 통과 → 값이 나온다
    const per = p({ periodEnd: 'x', operatingIncome: 100, totalDebt: 100, equity: -50, cash: 40 })
    expect(roic(per, 0.21, 0.10)).toBeNull()
    expect(roicGap(per, 0.10)).toBe('IMMATERIAL_INVESTED_CAPITAL')
    // 하한을 실제 비율(5.26%) 아래로 내리면 값이 나온다 — 막고 있던 것이 이 비율임을 고정
    expect(roic(per, 0.21, 0.05)).toBeCloseTo(7.9, 10) // 79 / 10
    expect(roic(per, 0.21, 0.0527)).toBeNull()
  })

  it('부호가 달라도 같은 규모면 같은 비율이다 — 상쇄의 정도만 본다', () => {
    // |부채|+|자본|+|현금| 이 같은 두 기간: 부호만 다르고 투하자본도 같다
    const negEquity = p({ periodEnd: 'x', operatingIncome: 100, totalDebt: 300, equity: -100, cash: 100 })
    const posEquity = p({ periodEnd: 'x', operatingIncome: 100, totalDebt: 100, equity: 300, cash: 300 })
    // 둘 다 투하자본 100, 절댓값 합 500 → 20% → 같은 판정
    expect(roicGap(negEquity, 0.10)).toBeNull()
    expect(roicGap(posEquity, 0.10)).toBeNull()
    expect(roicGap(negEquity, 0.25)).toBe('IMMATERIAL_INVESTED_CAPITAL')
    expect(roicGap(posEquity, 0.25)).toBe('IMMATERIAL_INVESTED_CAPITAL')
  })

  it('roic()가 값을 낼 수 있으면 null(간극 없음)', () => {
    const per = p({
      periodEnd: '2025-12-31', operatingIncome: 1000, totalDebt: 2000, equity: 6000, cash: 1000,
    })
    expect(roic(per, 0.21, MIN_INVESTED)).not.toBeNull()
    expect(roicGap(per, MIN_INVESTED)).toBeNull()
  })
})

/**
 * 리뷰 Part 2: 규모 하한은 ROIC의 **크기**를 지키는 장치인데, 그것을 **부호** 질문에도
 * 그대로 적용하면 답이 이미 정해진 기간까지 버리게 된다. roicVerdict는 두 질문을 갈라
 * "NOPAT ≤ 0 → 분모와 무관하게 미달(DETERMINATE_MISS)"을 별도 판정으로 낸다.
 */
describe('roicVerdict — 부호 질문과 크기 질문을 가른다', () => {
  const WACC = 0.09

  it('NOPAT > 0이고 분모가 실질적이면 MEASURED — 크기까지 의미가 있다', () => {
    const per = p({
      periodEnd: '2025-12-31', operatingIncome: 1000, totalDebt: 2000, equity: 6000, cash: 1000,
    })
    const v = roicVerdict(per, 0.21, WACC, MIN_INVESTED)
    expect(v.kind).toBe('MEASURED')
    if (v.kind === 'MEASURED') {
      expect(v.roic).toBeCloseTo(0.112857142857, 10)
      expect(v.spread).toBeCloseTo(0.022857142857, 10)
      expect(v.clears).toBe(true)
    }
  })

  it('NOPAT > 0인데 분모가 상쇄 잔차면 UNDEFINED — 여기서는 하한이 그대로 작동한다', () => {
    const v = roicVerdict(dropbox2025(), 0.21, WACC, MIN_INVESTED)
    expect(v.kind).toBe('UNDEFINED')
    if (v.kind === 'UNDEFINED') expect(v.gap).toBe('IMMATERIAL_INVESTED_CAPITAL')
  })

  it('영업적자면 분모가 하한 미만이어도 DETERMINATE_MISS — 버리지 않고 미달로 센다', () => {
    // 투하자본 20 / 총액 780 = 2.6% — roic()라면 null이 되는 잔차 분모다
    const per = p({ periodEnd: 'x', operatingIncome: -60, totalDebt: 300, equity: 100, cash: 380 })
    expect(roic(per, 0.21, MIN_INVESTED)).toBeNull()
    expect(roicVerdict(per, 0.21, WACC, MIN_INVESTED).kind).toBe('DETERMINATE_MISS')
  })

  it('영업이익이 정확히 0이어도 DETERMINATE_MISS (자본비용은 양수다)', () => {
    const per = p({ periodEnd: 'x', operatingIncome: 0, totalDebt: 300, equity: 100, cash: 380 })
    expect(roicVerdict(per, 0.21, WACC, MIN_INVESTED).kind).toBe('DETERMINATE_MISS')
  })

  it('투하자본이 0 이하면 영업적자여도 UNDEFINED — ROIC의 부호 자체가 정해지지 않는다', () => {
    const per = p({ periodEnd: 'x', operatingIncome: -60, totalDebt: 0, equity: 100, cash: 500 })
    const v = roicVerdict(per, 0.21, WACC, MIN_INVESTED)
    expect(v.kind).toBe('UNDEFINED')
    if (v.kind === 'UNDEFINED') expect(v.gap).toBe('NON_POSITIVE_INVESTED_CAPITAL')
  })

  it('재무 항목이 결측이면 UNDEFINED / MISSING_FIELDS', () => {
    const per = p({ periodEnd: 'x', operatingIncome: 100, totalDebt: 0, equity: 100, cash: null })
    const v = roicVerdict(per, 0.21, WACC, MIN_INVESTED)
    expect(v.kind).toBe('UNDEFINED')
    if (v.kind === 'UNDEFINED') expect(v.gap).toBe('MISSING_FIELDS')
    expect(roicVerdict(undefined, 0.21, WACC, MIN_INVESTED).kind).toBe('UNDEFINED')
  })

  it('하한을 올려도 DETERMINATE_MISS는 절대 사라지지 않는다 — 실패 기간만 지울 수 없다', () => {
    const loss = p({ periodEnd: 'x', operatingIncome: -60, totalDebt: 300, equity: 100, cash: 380 })
    for (const floor of [0, 0.1, 0.5, 0.99]) {
      expect(roicVerdict(loss, 0.21, WACC, floor).kind).toBe('DETERMINATE_MISS')
    }
  })

  it('자본비용 문턱이 실제로 쓰인다 — WACC를 올리면 같은 기간이 미달이 된다', () => {
    const per = p({
      periodEnd: '2025-12-31', operatingIncome: 1000, totalDebt: 2000, equity: 6000, cash: 1000,
    })
    const lo = roicVerdict(per, 0.21, 0.09, MIN_INVESTED)
    const hi = roicVerdict(per, 0.21, 0.20, MIN_INVESTED)
    expect(lo.kind === 'MEASURED' && lo.clears).toBe(true)
    expect(hi.kind === 'MEASURED' && hi.clears).toBe(false)
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
