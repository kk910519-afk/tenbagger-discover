import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { getRawDb, runMigrations } from '@/db/client'
import { writeValuations, type ValuationWrite } from '@/db/repositories/valuations'
import type { FairValueResult } from '@/engines/valuation/fair-value'
import type { PriceToFairValueResult } from '@/engines/valuation/price-to-fair-value'
import type { MoatResult } from '@/engines/valuation/moat-signal'
import type { UncertaintyResult } from '@/engines/valuation/uncertainty'

let raw: Database.Database

beforeEach(() => {
  raw = getRawDb(join(mkdtempSync(join(tmpdir(), 'tb-val-')), 'val.db'))
  runMigrations(raw)
})

const okFairValue: FairValueResult = {
  status: 'OK', perShare: 42, enterpriseValue: 4.2e9, equityValue: 4.2e9,
  assumptions: {
    projectionYears: 5, discountRate: 0.09, terminalGrowthRate: 0.025,
    initialGrowthRate: 0.2, initialGrowthSource: 'blend', matureFcfMargin: 0.15,
    initialFcfMargin: 0.2, initialMarginSource: 'fcf', taxRate: 0.21,
    netCash: 1e8, shares: 1e8, sharesSource: 'diluted',
  },
  detail: '테스트',
}
const insufficientFairValue: FairValueResult = {
  status: 'INSUFFICIENT_DATA', reason: 'NON_POSITIVE_REVENUE', detail: '테스트',
}
const okPtfv: PriceToFairValueResult = {
  status: 'OK', ratio: 0.8, marginOfSafety: 0.2, valuationStatus: 'UNDERVALUED',
}
const unavailablePtfv: PriceToFairValueResult = { status: 'UNAVAILABLE', reason: '테스트' }
const wideMoat: MoatResult = { signal: 'WIDE', periodsEvaluated: 8, periodsClearing: 7, evidence: ['a', 'b'] }
const insufficientMoat: MoatResult = { signal: 'INSUFFICIENT_DATA', periodsEvaluated: 1, periodsClearing: 0, evidence: ['a'] }
const lowUncertainty: UncertaintyResult = {
  level: 'LOW', score: 0.1,
  drivers: [{ key: 'data_completeness', status: 'MEASURED', risk: 0.1, detail: 'x' }],
}

function row(overrides: Partial<ValuationWrite> = {}): ValuationWrite {
  return {
    cik: 1, asOf: '2026-08-09', fairValue: okFairValue, priceToFairValue: okPtfv,
    moat: wideMoat, uncertainty: lowUncertainty, engineVersion: 'valuation-1.0.0+test',
    ...overrides,
  }
}

describe('writeValuations', () => {
  it('OK 상태의 내재가치를 저장한다', () => {
    writeValuations(raw, [row()])
    const r = raw.prepare('SELECT * FROM valuations WHERE cik = 1').get() as Record<string, unknown>
    expect(r.fair_value_status).toBe('OK')
    expect(r.fair_value_per_share).toBe(42)
    expect(r.valuation_status).toBe('UNDERVALUED')
    expect(r.moat_signal).toBe('WIDE')
    expect(r.uncertainty_level).toBe('LOW')
    expect(JSON.parse(r.moat_evidence as string)).toEqual(['a', 'b'])
  })

  it('INSUFFICIENT_DATA면 수치 컬럼은 null이고 사유가 남는다', () => {
    writeValuations(raw, [
      row({ fairValue: insufficientFairValue, priceToFairValue: unavailablePtfv, moat: insufficientMoat }),
    ])
    const r = raw.prepare('SELECT * FROM valuations WHERE cik = 1').get() as Record<string, unknown>
    expect(r.fair_value_status).toBe('INSUFFICIENT_DATA')
    expect(r.fair_value_reason).toBe('NON_POSITIVE_REVENUE')
    expect(r.fair_value_per_share).toBeNull()
    expect(r.price_to_fair_value_status).toBe('UNAVAILABLE')
    expect(r.valuation_status).toBeNull()
  })

  it('(cik, as_of) 이력이 쌓인다', () => {
    writeValuations(raw, [row({ asOf: '2026-08-01' })])
    writeValuations(raw, [row({ asOf: '2026-08-08' })])
    const n = raw.prepare('SELECT COUNT(*) c FROM valuations WHERE cik = 1').get() as { c: number }
    expect(n.c).toBe(2)
  })

  it('같은 (cik, as_of) 재실행 시 이전 결과가 덧대지 않고 완전히 교체된다 — 상태가 바뀌어도 잔존 행이 없다', () => {
    // 1차: OK
    writeValuations(raw, [row()])
    let count = raw.prepare('SELECT COUNT(*) c FROM valuations').get() as { c: number }
    expect(count.c).toBe(1)
    let r = raw.prepare('SELECT fair_value_status FROM valuations WHERE cik = 1').get() as { fair_value_status: string }
    expect(r.fair_value_status).toBe('OK')

    // 2차: 같은 (cik, as_of)로 재실행했는데 이번엔 INSUFFICIENT_DATA — 이전 OK의 잔재(주당가치,
    // 가정 등)가 하나도 남아있으면 안 된다.
    writeValuations(raw, [
      row({ fairValue: insufficientFairValue, priceToFairValue: unavailablePtfv, moat: insufficientMoat }),
    ])
    count = raw.prepare('SELECT COUNT(*) c FROM valuations').get() as { c: number }
    expect(count.c).toBe(1) // 중복 행이 생기지 않는다

    r = raw.prepare('SELECT * FROM valuations WHERE cik = 1').get() as { fair_value_status: string } & Record<string, unknown>
    expect(r.fair_value_status).toBe('INSUFFICIENT_DATA')
    expect((r as Record<string, unknown>).fair_value_per_share).toBeNull()
    expect((r as Record<string, unknown>).fair_value_assumptions).toBeNull()
    expect((r as Record<string, unknown>).moat_signal).toBe('INSUFFICIENT_DATA')
  })

  it('여러 회사를 한 번에 쓴다', () => {
    writeValuations(raw, [row({ cik: 1 }), row({ cik: 2 }), row({ cik: 3 })])
    const n = raw.prepare('SELECT COUNT(*) c FROM valuations').get() as { c: number }
    expect(n.c).toBe(3)
  })
})
