import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseConfig } from '@/config'
import { grossMarginFactor } from '@/engines/tenbagger/factors/gross-margin'
import { operatingLeverageFactor } from '@/engines/tenbagger/factors/operating-leverage'
import type { FactorContext } from '@/engines/tenbagger/factor-utils'
import type { CompanySnapshot, FinancialPeriod } from '@/domain/types'

const cfg = parseConfig(readFileSync('config.yaml', 'utf8'))

function fp(periodEnd: string, over: Partial<FinancialPeriod> = {}): FinancialPeriod {
  return {
    periodEnd, periodType: 'TTM', revenue: null, grossProfit: null,
    operatingIncome: null, netIncome: null, ocf: null, capex: null, fcf: null,
    cash: null, totalDebt: null, equity: null, sharesDiluted: null,
    sharesOutstanding: null, sbc: null, rdExpense: null, ...over,
  }
}

function ctx(over: Partial<CompanySnapshot>): FactorContext {
  return {
    cfg, flags: [],
    snapshot: {
      cik: 1, ticker: 'T', name: 'T',
      themeSlug: 'ai-software-semi', industrySlug: 'semiconductors',
      industry: {
        slug: 'semiconductors', name: 'Semiconductors', themeSlug: 'ai-software-semi',
        tamUsd: null, tamCagr: null, tamSource: null, tamAsOf: null,
      },
      classificationSource: 'sic', marketCap: 1e9, price: 10,
      priceDate: '2026-08-08', sharesOutstanding: 1e8, sharesBasis: 'reported',
      ttm: [], annual: [], quarterly: [],
      industryStats: {
        candidateCount: 5, medianGrossMargin: 0.6,
        medianRevenueGrowth: 0.18, distributions: {},
      },
      asOf: '2026-08-09', ...over,
    },
  }
}

/** 마진이 개선되는 8개 분기 (최근순) */
function improvingQuarters(): FinancialPeriod[] {
  return [0.74, 0.72, 0.70, 0.68, 0.66, 0.64, 0.62, 0.60].map((gm, i) =>
    fp(`2025-${String(20 - i).padStart(2, '0')}`, {
      periodType: 'Q', revenue: 100, grossProfit: gm * 100,
    }),
  )
}

describe('grossMarginFactor', () => {
  it('수준과 추세를 블렌드한다', () => {
    const r = grossMarginFactor(
      ctx({
        ttm: [fp('2025-03-31', { revenue: 1000, grossProfit: 740 })],
        quarterly: improvingQuarters(),
      }),
    )
    expect(r.key).toBe('gross_margin')
    expect(r.weight).toBe(10)
    expect(r.status).toBe('SCORED')
    expect(r.raw).toBeCloseTo(0.74)
    expect(r.points!).toBeGreaterThan(9)   // 74% + 개선 추세
    expect(r.detail).toContain('74.0%')
    expect(r.detail).toContain('bp')
  })

  it('분기가 부족하면 수준만으로 채점한다', () => {
    const r = grossMarginFactor(
      ctx({ ttm: [fp('2025-03-31', { revenue: 1000, grossProfit: 400 })] }),
    )
    expect(r.status).toBe('SCORED')
    expect(r.detail).toContain('추세 산출 불가')
    // level = 400/1000 = 0.40 → level_curve의 (0.40, 0.50) 노드에 정확히 걸림 → score 0.50
    // weight 10 → points 5.0. 블렌드(level 0.6)를 잘못 적용하면 3.0이 나와 이 값과 어긋난다.
    expect(r.raw).toBeCloseTo(0.4)
    expect(r.points).toBeCloseTo(5.0)
  })

  it('매출총이익이 없으면 NO_DATA', () => {
    const r = grossMarginFactor(ctx({ ttm: [fp('2025-03-31', { revenue: 1000 })] }))
    expect(r.status).toBe('NO_DATA')
  })
})

describe('operatingLeverageFactor', () => {
  /**
   * 금액은 백만 달러 단위로 둔다. 이 팩터도 scoring.revenue_scale_damping의 대상이 되어
   * 1년 전 TTM 매출이 $50M 미만이면 배수가 곱해지므로, 매출을 "1000달러"로 두면 곡선·
   * 블렌드를 검증하려던 기대값이 감쇠와 뒤섞인다(factors-growth.test.ts와 같은 이유).
   * 감쇠 자체는 아래 별도 describe에서 검증한다.
   */
  const M = 1_000_000

  /** 현재와 1년 전 TTM. index 4가 1년 전 */
  function ttmPair(now: Partial<FinancialPeriod>, prior: Partial<FinancialPeriod>) {
    const out = [fp('2025-03-31', now)]
    for (let i = 1; i < 4; i++) out.push(fp(`2024-${12 - i}-31`))
    out.push(fp('2024-03-31', prior))
    return out
  }

  it('마진이 개선되고 opex가 매출보다 느리게 늘면 고득점', () => {
    const r = operatingLeverageFactor(
      ctx({
        ttm: ttmPair(
          { revenue: 1500 * M, grossProfit: 1050 * M, operatingIncome: 300 * M },  // opex 750, 마진 20%
          { revenue: 1000 * M, grossProfit: 700 * M, operatingIncome: 100 * M },   // opex 600, 마진 10%
        ),
      }),
    )
    expect(r.key).toBe('operating_leverage')
    expect(r.status).toBe('SCORED')
    // 매출 +50%, opex +25% → 격차 +25%p, 영업이익률 +10%p
    expect(r.points!).toBeGreaterThan(9)
    expect(r.detail).toContain('영업이익률')
  })

  it('opex가 매출보다 빨리 늘면 저득점', () => {
    const r = operatingLeverageFactor(
      ctx({
        ttm: ttmPair(
          { revenue: 1100 * M, grossProfit: 770 * M, operatingIncome: -50 * M },
          { revenue: 1000 * M, grossProfit: 700 * M, operatingIncome: 100 * M },
        ),
      }),
    )
    expect(r.points!).toBeLessThan(3)
  })

  it('1년 전 TTM이 없으면 NO_DATA', () => {
    const r = operatingLeverageFactor(
      ctx({ ttm: [fp('2025-03-31', { revenue: 1000 * M, operatingIncome: 100 * M })] }),
    )
    expect(r.status).toBe('NO_DATA')
  })

  it('비용 증가율을 산출할 그로스마진 데이터가 없으면 영업이익률 변화만으로 채점한다', () => {
    // grossProfit이 없는 분기가 하나라도 있으면 opexGrowth가 null → growthGap null.
    // operatingMargin은 grossProfit 없이 revenue/operatingIncome만으로 계산되므로 marginDeltaPp는 살아남는다.
    const r = operatingLeverageFactor(
      ctx({
        ttm: [
          fp('2025-03-31', { revenue: 1500 * M, operatingIncome: 300 * M }),   // grossProfit 없음 → opex 산출 불가
          fp('2024-11-31'),
          fp('2024-10-31'),
          fp('2024-9-31'),
          fp('2024-03-31', { revenue: 1000 * M, grossProfit: 700 * M, operatingIncome: 100 * M }),
        ],
      }),
    )
    expect(r.status).toBe('SCORED')
    expect(r.detail).toContain('영업이익률')
    expect(r.detail).toContain('비용 증가율 산출 불가')
    // 영업이익률 20% - 10% = +10.0%p → margin_delta_curve의 (10, 1.00) 노드에 정확히 걸림 → score 1.00
    // weight 10 → points 10.0. 블렌드(margin_delta 0.5)를 잘못 적용하면 5.0이 나와 이 값과 어긋난다.
    expect(r.raw).toBeCloseTo(10.0)
    expect(r.points).toBeCloseTo(10.0)
  })

  it('영업이익률 변화를 산출할 수 없으면 매출-비용 증가율 격차만으로 채점한다', () => {
    // 당기 매출을 0으로 두면 operatingMargin(now)이 revenue<=0으로 null이 되어
    // marginDeltaPp가 null이 된다. opexOf는 revenue와 무관하게 grossProfit/operatingIncome만
    // 필요하므로 growthGap은 살아남는다. opexOf(now)=0, opexOf(prior)=600으로 두면
    // revGrowth(-1) - opexGrowth(-1) = growthGap 0으로 딱 떨어진다.
    const r = operatingLeverageFactor(
      ctx({
        ttm: [
          fp('2025-03-31', { revenue: 0, grossProfit: 0, operatingIncome: 0 }),
          fp('2024-11-31'),
          fp('2024-10-31'),
          fp('2024-9-31'),
          fp('2024-03-31', { revenue: 1000 * M, grossProfit: 700 * M, operatingIncome: 100 * M }),
        ],
      }),
    )
    expect(r.status).toBe('SCORED')
    expect(r.detail).toContain('매출-비용 증가율 격차')
    expect(r.detail).toContain('영업이익률 변화 산출 불가')
    // growthGap = revGrowth(0/1000-1=-1) - opexGrowth(0/600-1=-1) = 0
    // → growth_gap_curve의 (0, 0.50) 노드에 정확히 걸림 → score 0.50, weight 10.
    // 여기서는 **현재 매출이 0**이라 매출 규모 감쇠 ×0.40이 곱해져 points 2.0이 된다 —
    // 비율의 한쪽이 잡음 구간이면 비율은 정보를 잃는다는 같은 규칙이다.
    // 블렌드(growth_gap 0.5)를 잘못 적용하면 1.0이 나와 이 값과 어긋난다.
    // raw는 marginDeltaPp가 null이므로 growthGap(0)으로 폴백한다.
    expect(r.raw).toBeCloseTo(0)
    expect(r.points).toBeCloseTo(2.0)
  })
})

/**
 * 이 팩터는 감쇠 대상이 아니었고, 성장 팩터가 감쇠된 뒤 바로 그 회사들의 최대 득점원이
 * 되었다(검증 리뷰 finding #6이 "direction currently benign"으로 남겨둔 구조다).
 * 두 신호 모두 1년 전 TTM 매출을 분모로 갖는다 — 기저 영업이익률 = 1년 전 영업이익 ÷
 * 1년 전 매출이고, 매출·비용 증가율도 1년 전 값이 분모다.
 */
describe('operatingLeverageFactor — 매출 규모 감쇠와 극단 비율 표기', () => {
  /** SEPN 실측 (DB 2026-08-11): 매출 $726K → $98.88M, 영업손익 -$102.2M → -$43.5M */
  function sepn() {
    return operatingLeverageFactor(
      ctx({
        ttm: [
          fp('2026-06-30', { revenue: 98_882_000, operatingIncome: -43_545_000 }),
          fp('2026-03-31'), fp('2025-12-31'), fp('2025-09-30'),
          fp('2025-06-30', { revenue: 726_000, operatingIncome: -102_156_000 }),
        ],
      }),
    )
  }

  it('기저 TTM 매출로 감쇠한다 — 예전에는 10/10 만점이었다 (SEPN 실측)', () => {
    const r = sepn()
    expect(r.status).toBe('SCORED')
    expect(r.raw).toBeCloseTo(14027.03704, 5)     // +14,027.0%p — raw는 감쇠 전 원시값
    expect(r.points).toBeCloseTo(10 * 0.40, 6)    // 곡선 상한 1.00 × 감쇠 0.40
    expect(r.detail).toContain('직전 TTM 매출 $726K — 매출 규모 감쇠 ×0.40')
  })

  it('영업이익률 변화가 ±100%p를 넘으면 %p 대신 영업손익 금액과 기저 매출을 적는다 (SEPN 실측)', () => {
    const r = sepn()
    expect(r.detail).toContain('영업손익 -$102.2M → -$43.5M (직전 TTM 매출 $726K)')
    // 홈 화면 Top 5에 그대로 나오던 문자열
    expect(r.detail).not.toContain('14027')
    expect(r.detail).not.toMatch(/\d{5,}(\.\d+)?%/)
  })

  it('±100%p 아래 마진 변화는 그대로 %p로 적는다 — 정상 구간을 건드리지 않는다', () => {
    const M = 1_000_000
    const r = operatingLeverageFactor(
      ctx({
        ttm: [
          fp('2025-03-31', { revenue: 1500 * M, operatingIncome: 300 * M }),
          fp('2024-11-31'), fp('2024-10-31'), fp('2024-9-31'),
          fp('2024-03-31', { revenue: 1000 * M, operatingIncome: 100 * M }),
        ],
      }),
    )
    expect(r.detail).toContain('영업이익률 +10.0%p')
  })

  it('매출-비용 증가율 격차가 한계를 넘으면 양쪽 증가율을 따로 적는다', () => {
    const M = 1_000_000
    const r = operatingLeverageFactor(
      ctx({
        ttm: [
          fp('2025-03-31', { revenue: 1000 * M, grossProfit: 700 * M, operatingIncome: 100 * M }),
          fp('2024-11-31'), fp('2024-10-31'), fp('2024-9-31'),
          // opex는 그대로 $600M인데 매출만 $50M → $1,000M (20배)
          fp('2024-03-31', { revenue: 50 * M, grossProfit: 40 * M, operatingIncome: -560 * M }),
        ],
      }),
    )
    expect(r.detail).toContain('매출 증가율 20배 vs 비용 증가율 0.0%')
    expect(r.detail).toContain('영업손익 -$560.0M → $100.0M (직전 TTM 매출 $50.0M)')
    expect(r.detail).not.toMatch(/\d{5,}(\.\d+)?%/)
  })
})
