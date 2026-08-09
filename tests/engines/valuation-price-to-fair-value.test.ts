import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseConfig } from '@/config'
import { computeFairValue } from '@/engines/valuation/fair-value'
import { computePriceToFairValue } from '@/engines/valuation/price-to-fair-value'
import type { FairValueResult } from '@/engines/valuation/fair-value'
import { eligibleForFairValue, preRevenueCompany } from '../fixtures/valuation-companies'

const cfg = parseConfig(readFileSync('config.yaml', 'utf8'))

function okFairValue(perShare: number): FairValueResult {
  return {
    status: 'OK', perShare, enterpriseValue: perShare * 1e8, equityValue: perShare * 1e8,
    assumptions: {
      projectionYears: 5, discountRate: 0.09, terminalGrowthRate: 0.025,
      initialGrowthRate: 0.1, initialGrowthSource: 'blend', matureFcfMargin: 0.15,
      initialFcfMargin: 0.15, initialMarginSource: 'fcf', taxRate: 0.21,
      netCash: 0, shares: 1e8, sharesSource: 'diluted',
    },
    detail: '테스트용',
  }
}

describe('computePriceToFairValue', () => {
  it('내재가치가 INSUFFICIENT_DATA면 UNAVAILABLE — 0이나 FAIRLY_VALUED로 얼버무리지 않는다', () => {
    const fv = computeFairValue(preRevenueCompany(), cfg)
    const r = computePriceToFairValue(fv, 20, cfg)
    expect(r.status).toBe('UNAVAILABLE')
  })

  it('현재가가 없으면 UNAVAILABLE', () => {
    const fv = okFairValue(50)
    const r = computePriceToFairValue(fv, null, cfg)
    expect(r.status).toBe('UNAVAILABLE')
  })

  it('내재가치가 0 이하로 산출되면 UNAVAILABLE (비율이 의미를 갖지 않음)', () => {
    const fv = okFairValue(-10)
    const r = computePriceToFairValue(fv, 20, cfg)
    expect(r.status).toBe('UNAVAILABLE')
  })

  it('price/fair_value ≤ undervalued_max_ratio면 UNDERVALUED', () => {
    const fv = okFairValue(100)
    const r = computePriceToFairValue(fv, 80, cfg) // ratio 0.8 ≤ 0.85
    expect(r.status).toBe('OK')
    if (r.status === 'OK') {
      expect(r.ratio).toBeCloseTo(0.8, 6)
      expect(r.marginOfSafety).toBeCloseTo(0.2, 6)
      expect(r.valuationStatus).toBe('UNDERVALUED')
    }
  })

  it('price/fair_value ≥ overvalued_min_ratio면 OVERVALUED', () => {
    const fv = okFairValue(100)
    const r = computePriceToFairValue(fv, 130, cfg) // ratio 1.3 ≥ 1.15
    expect(r.status).toBe('OK')
    if (r.status === 'OK') {
      expect(r.valuationStatus).toBe('OVERVALUED')
      expect(r.marginOfSafety).toBeLessThan(0)
    }
  })

  it('중간 구간은 FAIRLY_VALUED', () => {
    const fv = okFairValue(100)
    const r = computePriceToFairValue(fv, 100, cfg) // ratio 1.0
    expect(r.status).toBe('OK')
    if (r.status === 'OK') expect(r.valuationStatus).toBe('FAIRLY_VALUED')
  })

  it('전체 파이프라인: eligibleForFairValue 픽스처로 OK 결과를 얻는다', () => {
    const s = eligibleForFairValue()
    const fv = computeFairValue(s, cfg)
    const r = computePriceToFairValue(fv, s.price, cfg)
    expect(fv.status).toBe('OK')
    expect(r.status).toBe('OK')
  })
})
