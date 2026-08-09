import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseConfig } from '@/config'
import { computeUncertainty } from '@/engines/valuation/uncertainty'
import { eligibleForFairValue, wideMoatCompany } from '../fixtures/valuation-companies'

const cfg = parseConfig(readFileSync('config.yaml', 'utf8'))

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

  it('LOW/MEDIUM/HIGH/VERY_HIGH 중 하나를 항상 반환한다 (데이터가 거의 없어도 예외를 던지지 않는다)', () => {
    const empty = { ...eligibleForFairValue(), ttm: [], annual: [], quarterly: [] }
    const r = computeUncertainty(empty, cfg)
    expect(['LOW', 'MEDIUM', 'HIGH', 'VERY_HIGH']).toContain(r.level)
    // 아무것도 측정할 수 없으면 확신할 근거가 없다는 뜻 — 최고 불확실성으로 처리한다
    expect(r.level).toBe('VERY_HIGH')
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

  it('score는 MEASURED 드라이버의 risk 평균이며 0~1 범위다', () => {
    const r = computeUncertainty(eligibleForFairValue(), cfg)
    expect(r.score).toBeGreaterThanOrEqual(0)
    expect(r.score).toBeLessThanOrEqual(1)
  })
})
