import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseConfig } from '@/config'
import { computeUncertainty } from '@/engines/valuation/uncertainty'
import type { UncertaintyDriverKey } from '@/engines/valuation/uncertainty'
import type { CompanySnapshot } from '@/domain/types'
import {
  eligibleForFairValue,
  wideMoatCompany,
  valuationBase,
  valuationPeriod,
} from '../fixtures/valuation-companies'

const cfg = parseConfig(readFileSync('config.yaml', 'utf8'))

function riskOf(s: CompanySnapshot, key: UncertaintyDriverKey): number | null {
  return computeUncertainty(s, cfg).drivers.find((d) => d.key === key)?.risk ?? null
}

/** TTM 한 구간만 보고한 신규 상장 기업 — 이력이 필요한 드라이버는 전부 UNAVAILABLE. */
function noHistoryCompany(over: Partial<CompanySnapshot> = {}): CompanySnapshot {
  return valuationBase({
    ticker: 'NOHIST',
    ttm: [
      valuationPeriod('2025-40', 'TTM', {
        revenue: 100_000_000, grossProfit: 60_000_000, operatingIncome: -5_000_000,
        fcf: 1_000_000, cash: 50_000_000, totalDebt: 10_000_000, equity: 40_000_000,
        sharesDiluted: 20_000_000, rdExpense: 8_000_000,
      }),
    ],
    ...over,
  })
}

describe('computeUncertainty', () => {
  it('사업 집중도(business_concentration)는 항상 UNAVAILABLE로 보고한다 — 10-K 텍스트 파싱 미구현', () => {
    const r = computeUncertainty(eligibleForFairValue(), cfg)
    const concentration = r.drivers.find((d) => d.key === 'business_concentration')
    expect(concentration).toBeDefined()
    expect(concentration!.status).toBe('UNAVAILABLE')
    expect(concentration!.risk).toBeNull()
  })

  it('사업 집중도는 입력 데이터가 풍부한 기업에서도 여전히 UNAVAILABLE이다', () => {
    const r = computeUncertainty(wideMoatCompany(), cfg)
    const concentration = r.drivers.find((d) => d.key === 'business_concentration')
    expect(concentration!.status).toBe('UNAVAILABLE')
  })

  it('MINIMAL/MODERATE/ELEVATED/SEVERE 중 하나를 항상 반환한다 (데이터가 거의 없어도 예외를 던지지 않는다)', () => {
    const empty = { ...eligibleForFairValue(), ttm: [], annual: [], quarterly: [] }
    const r = computeUncertainty(empty, cfg)
    expect(['MINIMAL', 'MODERATE', 'ELEVATED', 'SEVERE']).toContain(r.level)
    // 아무것도 측정할 수 없으면 확신할 근거가 없다는 뜻 — 최고 불확실성으로 처리한다
    expect(r.level).toBe('SEVERE')
  })

  it('데이터 완전성 드라이버는 항상 MEASURED다 (핵심 필드 유무만으로 계산 가능)', () => {
    const r = computeUncertainty(eligibleForFairValue(), cfg)
    const completeness = r.drivers.find((d) => d.key === 'data_completeness')
    expect(completeness!.status).toBe('MEASURED')
    expect(completeness!.risk).not.toBeNull()
  })

  it('드라이버 5개를 모두 보고한다 — 측정하지 못한 것도 왜 그런지와 함께 남긴다', () => {
    const r = computeUncertainty(eligibleForFairValue(), cfg)
    expect(r.drivers).toHaveLength(5)
    for (const d of r.drivers) expect(d.detail).toMatch(/\S/)
  })

  it('score는 0~1 범위다', () => {
    const r = computeUncertainty(eligibleForFairValue(), cfg)
    expect(r.score).toBeGreaterThanOrEqual(0)
    expect(r.score).toBeLessThanOrEqual(1)
  })
})

/**
 * 드라이버별 risk와 집계 규칙을 실제 수치로 고정한다. eligibleForFairValue()는 완전히
 * 결정적이다: 매출 YoY 8개 구간의 표준편차 0.05227875, 영업이익률은 0.30으로 일정(표준편차 0),
 * 부채/영업이익 = 1e8/3e8 = 0.3333배, 핵심 필드 8/10. 범위만 확인하면 어떤 집계를 써도
 * 통과한다(테스트 리뷰 F2).
 */
describe('computeUncertainty — 드라이버 수치 고정', () => {
  const r = computeUncertainty(eligibleForFairValue(), cfg)
  const byKey = Object.fromEntries(r.drivers.map((d) => [d.key, d]))

  it('매출 예측가능성 = 성장률 표준편차 곡선', () => {
    // sd 0.05227875 → 곡선 [[0,0],[0.08,0.20]] 구간 → 0.13069688
    expect(byKey.revenue_predictability!.status).toBe('MEASURED')
    expect(byKey.revenue_predictability!.risk).toBeCloseTo(0.13069688, 8)
  })

  it('영업 레버리지 = 영업이익률 표준편차 곡선 (마진이 일정하면 0)', () => {
    expect(byKey.operating_leverage!.risk).toBeCloseTo(0, 10)
  })

  it('재무 레버리지 = 1 − balance_sheet.leverage_curve(부채/영업이익)', () => {
    // 0.3333배 → goodness 0.95 → risk 0.05. 부호를 뒤집지 않으면 0.95가 된다.
    expect(byKey.financial_leverage!.risk).toBeCloseTo(0.05, 10)
  })

  it('데이터 완전성 = 핵심 필드 비율 곡선', () => {
    // 8/10 → 0.8 → 곡선 [[0.70,0.45],[0.85,0.20]] 구간 → 0.28333333
    expect(byKey.data_completeness!.risk).toBeCloseTo(0.28333333, 8)
    expect(byKey.data_completeness!.detail).toContain('8/10')
  })

  it('집계는 평균이다 — 최댓값도 최솟값도 아니다', () => {
    const measured = r.drivers.filter((d) => d.status === 'MEASURED')
    const risks = measured.map((d) => d.risk!)
    const mean = risks.reduce((a, b) => a + b, 0) / risks.length
    expect(r.score).toBeCloseTo(mean, 12)
    expect(r.score).toBeCloseTo(0.11600755, 8)
    expect(r.score).not.toBeCloseTo(Math.max(...risks), 3)
    expect(r.score).not.toBeCloseTo(Math.min(...risks), 3)
    expect(r.level).toBe('MINIMAL')
  })
})

describe('computeUncertainty — 방향과 임계값', () => {
  it('부채가 많을수록 재무 레버리지 위험이 높다 (부호가 뒤집히면 반대로 나온다)', () => {
    const low = eligibleForFairValue()
    const high = eligibleForFairValue()
    high.ttm = high.ttm.map((p) => ({ ...p, totalDebt: 1_200_000_000 })) // 4배 레버리지
    const lowRisk = riskOf(low, 'financial_leverage')!
    const highRisk = riskOf(high, 'financial_leverage')!
    expect(highRisk).toBeGreaterThan(lowRisk)
    expect(lowRisk).toBeCloseTo(0.05, 10)
    expect(highRisk).toBeCloseTo(0.7, 10) // 4배 → goodness 0.30 → risk 0.70
  })

  it('level_thresholds 경계를 정확히 걷는다 (임계값을 뒤바꾸면 깨진다)', () => {
    // score를 직접 만들 수 없으므로 임계값을 옮겨 같은 회사의 등급이 어떻게 갈리는지 본다.
    // 기준 픽스처의 score는 0.11600755다.
    const at = (moderate: number, elevated: number, severe: number) => {
      const c = structuredClone(cfg)
      c.valuation.uncertainty.level_thresholds = { moderate, elevated, severe }
      return computeUncertainty(eligibleForFairValue(), c).level
    }
    expect(at(0.25, 0.50, 0.75)).toBe('MINIMAL')
    expect(at(0.11600755, 0.50, 0.75)).toBe('MODERATE') // 경계는 이상(>=)
    expect(at(0.05, 0.11600755, 0.75)).toBe('ELEVATED')
    expect(at(0.05, 0.08, 0.11600755)).toBe('SEVERE')
  })
})

/**
 * 리뷰 Finding 4: 측정된 것만 평균 내면 이력이 없는 회사가 제품에서 가장 확신 높은
 * 라벨(MINIMAL)을 받는다 — 불확실성 지표가 정확히 거꾸로 작동한다.
 */
describe('computeUncertainty — 커버리지가 낮으면 불확실성이 높아진다', () => {
  it('이력이 하나도 없는 회사는 MINIMAL이 아니라 SEVERE다', () => {
    const r = computeUncertainty(noHistoryCompany(), cfg)
    const measured = r.drivers.filter((d) => d.status === 'MEASURED')
    // 측정 가능한 것은 data_completeness 하나뿐 (영업 적자라 재무 레버리지도 불가)
    expect(measured).toHaveLength(1)
    expect(measured[0]!.key).toBe('data_completeness')
    // 수정 전: score = data_completeness의 risk 그대로(0.13) → MINIMAL
    // 수정 후: 0.25 × 0.13 + 0.75 × 1.0
    expect(r.score).toBeCloseTo(0.25 * measured[0]!.risk! + 0.75, 10)
    expect(r.score).toBeGreaterThan(0.75)
    expect(r.level).toBe('SEVERE')
  })

  it('증거가 많을수록 불확실성이 낮다 — 같은 회사에서 드라이버가 늘면 score가 내려간다', () => {
    const thin = computeUncertainty(noHistoryCompany(), cfg)
    const full = computeUncertainty(eligibleForFairValue(), cfg)
    expect(full.drivers.filter((d) => d.status === 'MEASURED')).toHaveLength(4)
    expect(full.score).toBeLessThan(thin.score)
  })

  it('측정 가능한 드라이버가 하나도 없으면 1.0 (판단 불가 = 최고 위험)', () => {
    const empty = { ...eligibleForFairValue(), ttm: [], annual: [], quarterly: [] }
    const r = computeUncertainty(empty, cfg)
    expect(r.score).toBeCloseTo(1, 10)
    expect(r.level).toBe('SEVERE')
  })

  it('미구현 드라이버(business_concentration)는 커버리지 분모에서 빠진다', () => {
    // 네 드라이버가 모두 측정되면 커버리지는 4/4 = 1이어야 한다. 분모에 5를 쓰면
    // 감쇠가 걸려 평균보다 높은 score가 나온다.
    const r = computeUncertainty(eligibleForFairValue(), cfg)
    const risks = r.drivers.filter((d) => d.status === 'MEASURED').map((d) => d.risk!)
    expect(r.score).toBeCloseTo(risks.reduce((a, b) => a + b, 0) / risks.length, 12)
  })
})
