import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseConfig } from '@/config'
import { computeFairValue } from '@/engines/valuation/fair-value'
import {
  eligibleForFairValue,
  preRevenueCompany,
  shortRevenueHistoryCompany,
  cashBurningCompany,
  noShareCountCompany,
  noBalanceSheetCompany,
} from '../fixtures/valuation-companies'

const cfg = parseConfig(readFileSync('config.yaml', 'utf8'))

describe('computeFairValue — 5개 충분성 게이트', () => {
  it('모든 게이트를 통과하면 OK와 주당 내재가치를 반환한다', () => {
    const r = computeFairValue(eligibleForFairValue(), cfg)
    expect(r.status).toBe('OK')
    if (r.status === 'OK') {
      expect(r.perShare).toBeGreaterThan(0)
      expect(Number.isFinite(r.perShare)).toBe(true)
      // 가정이 함께 공개되어야 한다 — 숫자만 던지고 근거를 숨기지 않는다
      expect(r.assumptions.projectionYears).toBe(cfg.valuation.projection_years)
      expect(r.assumptions.discountRate).toBe(cfg.scoring.wacc_assumption)
      expect(r.assumptions.terminalGrowthRate).toBe(cfg.valuation.terminal_growth_rate)
    }
  })

  it('최근 TTM 매출이 0 이하면 NON_POSITIVE_REVENUE — 사전매출 기업은 값을 내지 않는다', () => {
    const r = computeFairValue(preRevenueCompany(), cfg)
    expect(r.status).toBe('INSUFFICIENT_DATA')
    if (r.status === 'INSUFFICIENT_DATA') expect(r.reason).toBe('NON_POSITIVE_REVENUE')
  })

  it('성장률을 추정할 매출 이력이 부족하면 INSUFFICIENT_REVENUE_HISTORY', () => {
    const r = computeFairValue(shortRevenueHistoryCompany(), cfg)
    expect(r.status).toBe('INSUFFICIENT_DATA')
    if (r.status === 'INSUFFICIENT_DATA') expect(r.reason).toBe('INSUFFICIENT_REVENUE_HISTORY')
  })

  it('현금을 태우기만 하는 기업(FCF·영업이익 모두 적자)은 숫자 대신 NOT_CASH_GENERATIVE를 반환한다', () => {
    const s = cashBurningCompany()
    expect(s.ttm[0]!.fcf).toBeLessThan(0)
    expect(s.ttm[0]!.operatingIncome).toBeLessThan(0)
    const r = computeFairValue(s, cfg)
    expect(r.status).toBe('INSUFFICIENT_DATA')
    if (r.status === 'INSUFFICIENT_DATA') expect(r.reason).toBe('NOT_CASH_GENERATIVE')
  })

  it('희석주식수와 발행주식수가 모두 없으면 NO_SHARE_COUNT', () => {
    const r = computeFairValue(noShareCountCompany(), cfg)
    expect(r.status).toBe('INSUFFICIENT_DATA')
    if (r.status === 'INSUFFICIENT_DATA') expect(r.reason).toBe('NO_SHARE_COUNT')
  })

  it('현금 또는 총부채가 없으면 NO_BALANCE_SHEET_DATA — 순현금을 0으로 대신 채우지 않는다', () => {
    const r = computeFairValue(noBalanceSheetCompany(), cfg)
    expect(r.status).toBe('INSUFFICIENT_DATA')
    if (r.status === 'INSUFFICIENT_DATA') expect(r.reason).toBe('NO_BALANCE_SHEET_DATA')
  })
})

describe('computeFairValue — 순수성/결정성', () => {
  it('같은 입력에는 항상 같은 결과를 반환한다', () => {
    const s = eligibleForFairValue()
    const a = computeFairValue(s, cfg)
    const b = computeFairValue(s, cfg)
    expect(a).toEqual(b)
  })

  it('discount rate가 terminal growth rate 이하면 INVALID_ASSUMPTIONS를 반환한다(스키마를 우회해도 안전)', () => {
    const bad = structuredClone(cfg)
    bad.valuation.terminal_growth_rate = bad.scoring.wacc_assumption + 0.01
    const r = computeFairValue(eligibleForFairValue(), bad)
    expect(r.status).toBe('INSUFFICIENT_DATA')
    if (r.status === 'INSUFFICIENT_DATA') expect(r.reason).toBe('INVALID_ASSUMPTIONS')
  })
})
