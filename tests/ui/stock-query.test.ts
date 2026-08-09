import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { getRawDb, runMigrations } from '@/db/client'
import { getStockDetail } from '@/app/_queries/stock'

let raw: Database.Database

beforeAll(() => {
  raw = getRawDb(join(mkdtempSync(join(tmpdir(), 'tb-stock-')), 'st.db'))
  runMigrations(raw)
  raw.prepare(
    `INSERT INTO themes (slug, name, display_order)
     VALUES ('ai-software-semi', 'AI / Software / Semiconductor', 1)`,
  ).run()
  raw.prepare(
    `INSERT INTO industries (slug, theme_slug, name)
     VALUES ('cybersecurity', 'ai-software-semi', 'Cybersecurity')`,
  ).run()
  raw.prepare(
    `INSERT INTO companies (cik, ticker, name, sic, sic_description, exchange,
                            fiscal_year_end, state_of_incorporation,
                            state_of_incorporation_description,
                            is_active, first_seen, last_updated)
     VALUES (99, 'CRWD', 'CrowdStrike Holdings', '7372', 'Prepackaged Software', 'Q',
             '0131', 'DE', 'DE',
             1, '2026-08-09', '2026-08-09')`,
  ).run()
  raw.prepare(
    `INSERT INTO company_industry (cik, industry_slug, theme_slug, is_primary, source)
     VALUES (99, 'cybersecurity', 'ai-software-semi', 1, 'override')`,
  ).run()
  raw.prepare(
    `INSERT INTO scores (cik, as_of, tenbagger, completeness, category, engine_version)
     VALUES (99, '2026-08-09', 84.2, 0.95, 'CHALLENGER', 'tenbagger-1.0.0+abcd1234')`,
  ).run()
  const insF = raw.prepare(
    `INSERT INTO score_factors
       (cik, as_of, engine, factor_key, raw, points, weight, status, percentile, detail)
     VALUES (99, '2026-08-09', 'tenbagger', ?, ?, ?, ?, ?, ?, ?)`,
  )
  insF.run('revenue_growth', 0.32, 16, 20, 'SCORED', 0.85, 'TTM 매출 +32.0%')
  insF.run('gross_margin', 0.78, 9, 10, 'SCORED', 0.9, '매출총이익률 +78.0%')
  insF.run('institutional_insider', null, null, 5, 'NOT_IMPLEMENTED', null, 'Phase 4')
  insF.run('balance_sheet', null, null, 5, 'NO_DATA', null, '현금·부채 데이터 없음')

  raw.prepare(
    `INSERT INTO red_flags (cik, as_of, code, severity, message, evidence)
     VALUES (99, '2026-08-09', 'DILUTION', 'WARNING', '희석주식수 1년 18% 증가',
             '{"ratio":0.18}')`,
  ).run()
  raw.prepare(
    `INSERT INTO market_data (cik, date, price, shares_outstanding, market_cap)
     VALUES (99, '2026-08-08', 412.5, 250000000, 103125000000)`,
  ).run()
  raw.prepare(
    `INSERT INTO financials (cik, period_end, period_type, revenue, gross_profit,
                             operating_income, fcf, cash, total_debt, computed_at)
     VALUES (99, '2025-03-31', 'TTM', 4000, 3120, 200, 1200, 4000, 700,
             '2026-08-09T00:00:00.000Z')`,
  ).run()
  raw.prepare(
    `INSERT INTO valuations (
       cik, as_of,
       fair_value_status, fair_value_per_share, fair_value_assumptions, fair_value_detail,
       price_to_fair_value_status, price_to_fair_value_ratio, margin_of_safety, valuation_status,
       moat_signal, moat_periods_evaluated, moat_periods_clearing, moat_evidence,
       uncertainty_level, uncertainty_score, uncertainty_drivers,
       engine_version
     ) VALUES (
       99, '2026-08-09',
       'OK', 500.0, '{}', '5년 예측 + 터미널가치',
       'OK', 0.825, 0.175, 'UNDERVALUED',
       'WIDE', 8, 7, '["최근 연간 8개 기간 중 7개에서 ROIC가 자본비용을 상회"]',
       'MEDIUM', 0.4, '[{"key":"revenue_predictability","status":"MEASURED","risk":0.4,"detail":"d"}]',
       'valuation-1.0.0'
     )`,
  ).run()
})

const detail = () => getStockDetail(raw, 'CRWD', '2026-08-09')!

describe('getStockDetail', () => {
  it('없는 티커는 null', () => {
    expect(getStockDetail(raw, 'NOPE', '2026-08-09')).toBeNull()
  })

  it('티커 대소문자를 구분하지 않는다', () => {
    expect(getStockDetail(raw, 'crwd', '2026-08-09')!.ticker).toBe('CRWD')
  })

  it('Overview 정보를 모은다', () => {
    const d = detail()
    expect(d.name).toBe('CrowdStrike Holdings')
    expect(d.industryName).toBe('Cybersecurity')
    expect(d.themeName).toBe('AI / Software / Semiconductor')
    expect(d.classificationSource).toBe('override')
    expect(d.category).toBe('CHALLENGER')
    expect(d.marketCap).toBe(103_125_000_000)
    expect(d.price).toBe(412.5)
  })

  it('회사 정보 필드(회계연도 말/설립 주)를 담는다', () => {
    const d = detail()
    expect(d.fiscalYearEnd).toBe('0131')
    expect(d.stateOfIncorporation).toBe('DE')
    expect(d.stateOfIncorporationDescription).toBe('DE')
  })

  it('Quality 지표를 계산한다', () => {
    const d = detail()
    expect(d.quality.grossMargin).toBeCloseTo(0.78)
    expect(d.quality.operatingMargin).toBeCloseTo(0.05)
    expect(d.quality.fcfMargin).toBeCloseTo(0.30)
    expect(d.quality.cash).toBe(4000)
    expect(d.quality.totalDebt).toBe(700)
  })

  it('팩터를 배점 내림차순으로 준다', () => {
    const keys = detail().factors.map((f) => f.key)
    expect(keys[0]).toBe('revenue_growth')   // weight 20
  })

  it('팩터의 status와 백분위를 보존한다', () => {
    const f = detail().factors.find((x) => x.key === 'institutional_insider')!
    expect(f.status).toBe('NOT_IMPLEMENTED')
    expect(f.points).toBeNull()
    const g = detail().factors.find((x) => x.key === 'revenue_growth')!
    expect(g.percentile).toBeCloseTo(0.85)
  })

  it('Red Flag를 evidence와 함께 준다', () => {
    const flags = detail().flags
    expect(flags).toHaveLength(1)
    expect(flags[0]!.code).toBe('DILUTION')
    expect(flags[0]!.evidence).toEqual({ ratio: 0.18 })
  })

  it('데이터 신선도 항목을 만든다', () => {
    const labels = detail().freshness.map((f) => f.label)
    expect(labels).toContain('Price')
    expect(labels).toContain('Financials')
    expect(labels).toContain('Tenbagger Score')
  })

  it('밸류에이션이 계산된 회사는 4개 지표를 모두 담는다', () => {
    const v = detail().valuation!
    expect(v).not.toBeNull()
    expect(v.moatSignal).toBe('WIDE')
    expect(v.moatPeriodsEvaluated).toBe(8)
    expect(v.moatPeriodsClearing).toBe(7)
    expect(v.moatEvidence).toEqual(['최근 연간 8개 기간 중 7개에서 ROIC가 자본비용을 상회'])
    expect(v.fairValueStatus).toBe('OK')
    expect(v.fairValuePerShare).toBeCloseTo(500.0)
    expect(v.priceToFairValueStatus).toBe('OK')
    expect(v.priceToFairValueRatio).toBeCloseTo(0.825)
    expect(v.marginOfSafety).toBeCloseTo(0.175)
    expect(v.valuationStatus).toBe('UNDERVALUED')
    expect(v.uncertaintyLevel).toBe('MEDIUM')
    expect(v.uncertaintyScore).toBeCloseTo(0.4)
    expect(v.uncertaintyDrivers).toHaveLength(1)
    expect(v.uncertaintyDrivers[0]!.key).toBe('revenue_predictability')
  })
})
