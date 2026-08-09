import { describe, it, expect } from 'vitest'
import { parseConfig } from '@/config'
import { readFileSync } from 'node:fs'

describe('parseConfig', () => {
  it('실제 config.yaml을 파싱한다', () => {
    const raw = readFileSync('config.yaml', 'utf8')
    const cfg = parseConfig(raw)
    expect(cfg.universe.min_market_cap).toBe(300_000_000)
    expect(cfg.scoring.factors.revenue_growth.weight).toBe(20)
    expect(cfg.scoring.factors.institutional_insider.implemented).toBe(false)
  })

  it('가중치 합이 100이다', () => {
    const cfg = parseConfig(readFileSync('config.yaml', 'utf8'))
    const total = Object.values(cfg.scoring.factors)
      .reduce((sum, f) => sum + f.weight, 0)
    expect(total).toBe(100)
  })

  it('곡선의 x가 오름차순이 아니면 거부한다', () => {
    const bad = `
universe: { exchanges: [N], min_market_cap: 1, min_avg_dollar_volume: null,
  exclude_financial_status: [], exclude_sic: [], security_name_include: [],
  security_name_exclude: [] }
ingest: { bulk_quarters: 1, sec_user_agent: "x", sec_rate_limit_per_sec: 10, cache_dir: "." }
classification: { leader_ratio_of_max: 0.25, leader_max: 5, leader_min: 2,
  leader_min_industry_candidates: 3, challenger_min_market_cap: 1,
  emerging_max_market_cap: 2, emerging_revenue_threshold: 1 }
staleness: { price_days: 5, financials_days: 120, scores_days: 14, tam_days: 400 }
scoring:
  min_completeness: 0.6
  wacc_assumption: 0.09
  tax_rate: 0.21
  min_industry_candidates: 3
  factors:
    revenue_growth:
      weight: 100
      blend: { ttm_yoy: 0.6, cagr_3y: 0.4 }
      curve: [[0.5, 0.0], [0.1, 1.0]]
quality_gate: { revenue_decline_years: 2, extreme_dilution: 0.5, dilution_warning: 0.15,
  gm_collapse_bps: 500, sbc_of_revenue: 0.25, debt_to_ebitda: 5,
  runway_critical_quarters: 2, runway_low_quarters: 6 }
`
    expect(() => parseConfig(bad)).toThrow(/오름차순/)
  })
})
