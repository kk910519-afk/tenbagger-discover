import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseConfig } from '@/config'
import { computeMoatSignal } from '@/engines/valuation/moat-signal'
import {
  wideMoatCompany, narrowMoatCompany, oneStrongYearCompany, insufficientMoatHistoryCompany,
  missingFinancialsMoatCompany, notApplicableMoatCompany,
  mixedGapCannotFlipMoatCompany, mixedGapCouldFlipMoatCompany,
} from '../fixtures/valuation-companies'

const cfg = parseConfig(readFileSync('config.yaml', 'utf8'))

describe('computeMoatSignal', () => {
  it('연간 기간의 75% 이상에서 ROIC가 WACC를 지속적으로 상회하면 WIDE', () => {
    const r = computeMoatSignal(wideMoatCompany(), cfg)
    expect(r.signal).toBe('WIDE')
    expect(r.periodsClearing / r.periodsEvaluated).toBeGreaterThanOrEqual(cfg.valuation.moat.wide_clear_ratio)
  })

  it('40~75% 구간이면 NARROW', () => {
    const r = computeMoatSignal(narrowMoatCompany(), cfg)
    expect(r.signal).toBe('NARROW')
  })

  it('한 해만 반짝 좋았던 기업은 WIDE를 얻지 못한다 (마진·성장만으로 해자를 주지 않는다)', () => {
    const r = computeMoatSignal(oneStrongYearCompany(), cfg)
    expect(r.signal).not.toBe('WIDE')
    expect(r.signal).toBe('NONE')
    expect(r.periodsClearing).toBe(1)
  })

  it('ROIC 산출 가능 기간이 최소 요건 미만이면 INSUFFICIENT_DATA — 아무것도 주장하지 않는다', () => {
    const r = computeMoatSignal(insufficientMoatHistoryCompany(), cfg)
    expect(r.signal).toBe('INSUFFICIENT_DATA')
    expect(r.periodsEvaluated).toBeLessThan(cfg.valuation.moat.min_periods_required)
  })

  describe('INSUFFICIENT_DATA 사유 구분', () => {
    it('연간 기간 자체가 최소 요건보다 적으면 TOO_FEW_PERIODS', () => {
      const r = computeMoatSignal(insufficientMoatHistoryCompany(), cfg)
      expect(r.signal).toBe('INSUFFICIENT_DATA')
      expect(r.insufficientReason).toBe('TOO_FEW_PERIODS')
    })

    it('연간 기간은 충분하지만 재무 항목이 결측인 해가 있으면 MISSING_FINANCIALS', () => {
      const r = computeMoatSignal(missingFinancialsMoatCompany(), cfg)
      expect(r.signal).toBe('INSUFFICIENT_DATA')
      expect(r.insufficientReason).toBe('MISSING_FINANCIALS')
    })

    it('재무 항목은 모두 있지만 투하자본이 0 이하인 해뿐이면 NOT_APPLICABLE — 결측이 아니라 지표가 적용되지 않는 경우', () => {
      const r = computeMoatSignal(notApplicableMoatCompany(), cfg)
      expect(r.signal).toBe('INSUFFICIENT_DATA')
      expect(r.insufficientReason).toBe('NOT_APPLICABLE')
      expect(r.periodsEvaluated).toBe(0)
    })

    it('결측을 다 되돌려도 최소 요건을 못 채우면(진짜 병목은 투하자본) NOT_APPLICABLE — 결측 1개만으로 무조건 "모른다"고 하지 않는다', () => {
      const r = computeMoatSignal(mixedGapCannotFlipMoatCompany(), cfg)
      expect(r.signal).toBe('INSUFFICIENT_DATA')
      expect(r.insufficientReason).toBe('NOT_APPLICABLE')
    })

    it('결측을 다 되돌리면 최소 요건을 채우고도 남으면(결측이 결론을 바꿨을 수 있음) 투하자본 미달이 섞여 있어도 MISSING_FINANCIALS', () => {
      const r = computeMoatSignal(mixedGapCouldFlipMoatCompany(), cfg)
      expect(r.signal).toBe('INSUFFICIENT_DATA')
      expect(r.insufficientReason).toBe('MISSING_FINANCIALS')
    })

    it('WIDE/NARROW/NONE 판정에는 insufficientReason이 없다', () => {
      expect(computeMoatSignal(wideMoatCompany(), cfg).insufficientReason).toBeNull()
      expect(computeMoatSignal(narrowMoatCompany(), cfg).insufficientReason).toBeNull()
      expect(computeMoatSignal(oneStrongYearCompany(), cfg).insufficientReason).toBeNull()
    })
  })

  it('근거 문자열은 측정한 것만 말하고 해자의 "원천"은 이름 붙이지 않는다', () => {
    const r = computeMoatSignal(wideMoatCompany(), cfg)
    const joined = r.evidence.join(' ')
    for (const forbidden of ['전환비용', '네트워크효과', '무형자산', '원가우위', '효율적 규모', 'switching cost', 'network effect']) {
      expect(joined).not.toContain(forbidden)
    }
    expect(joined).toMatch(/ROIC/)
  })
})
