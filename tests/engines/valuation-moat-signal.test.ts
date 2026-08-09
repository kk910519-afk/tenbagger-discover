import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseConfig } from '@/config'
import { computeMoatSignal } from '@/engines/valuation/moat-signal'
import {
  wideMoatCompany, narrowMoatCompany, oneStrongYearCompany, insufficientMoatHistoryCompany,
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

  it('근거 문자열은 측정한 것만 말하고 해자의 "원천"은 이름 붙이지 않는다', () => {
    const r = computeMoatSignal(wideMoatCompany(), cfg)
    const joined = r.evidence.join(' ')
    for (const forbidden of ['전환비용', '네트워크효과', '무형자산', '원가우위', '효율적 규모', 'switching cost', 'network effect']) {
      expect(joined).not.toContain(forbidden)
    }
    expect(joined).toMatch(/ROIC/)
  })
})
