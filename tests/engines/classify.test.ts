import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseConfig } from '@/config'
import { classifyIndustry, classifyAll } from '@/engines/classify'
import type { CompanySnapshot, FinancialPeriod } from '@/domain/types'

const cfg = parseConfig(readFileSync('config.yaml', 'utf8'))

function co(
  cik: number, marketCap: number | null,
  fin: Partial<FinancialPeriod> = {}, industrySlug = 'semiconductors',
): CompanySnapshot {
  const ttm: FinancialPeriod[] = [{
    periodEnd: '2025-03-31', periodType: 'TTM',
    revenue: 1_000_000_000, grossProfit: null, operatingIncome: 100_000_000,
    netIncome: null, ocf: null, capex: null, fcf: null, cash: null,
    totalDebt: null, equity: null, sharesDiluted: null, sharesOutstanding: null,
    sbc: null, rdExpense: null, ...fin,
  }]
  return {
    cik, ticker: `T${cik}`, name: `T${cik}`,
    themeSlug: 'ai-software-semi', industrySlug,
    industry: {
      slug: industrySlug, name: industrySlug, themeSlug: 'ai-software-semi',
      tamUsd: null, tamCagr: null, tamSource: null, tamAsOf: null,
    },
    classificationSource: 'sic', marketCap, price: null, priceDate: null,
    sharesOutstanding: null, ttm, annual: [], quarterly: [],
    industryStats: {
      candidateCount: 0, medianGrossMargin: null,
      medianRevenueGrowth: null, distributions: {},
    },
    asOf: '2026-08-09',
  }
}

// co()와 달리 TTM 실적 자체가 없는(공시가 아직 없는) 기업을 만들 때 사용한다.
function coNoTtm(
  cik: number, marketCap: number | null, industrySlug = 'semiconductors',
): CompanySnapshot {
  const base = co(cik, marketCap, {}, industrySlug)
  return { ...base, ttm: [] }
}

describe('classifyIndustry — Leader', () => {
  it('시총 최대값의 25% 이상인 상위 기업을 Leader로 지정한다', () => {
    const m = classifyIndustry([
      co(1, 400e9), co(2, 200e9), co(3, 50e9), co(4, 10e9), co(5, 1e9),
    ], cfg)
    expect(m.get(1)).toBe('LEADER')
    expect(m.get(2)).toBe('LEADER')
    expect(m.get(3)).toBe('CHALLENGER')   // 50e9 < 400e9 × 0.25 = 100e9
  })

  it('조건에 미달해도 상위 2개는 Leader로 만든다', () => {
    const m = classifyIndustry([co(1, 400e9), co(2, 10e9), co(3, 5e9)], cfg)
    expect(m.get(1)).toBe('LEADER')
    expect(m.get(2)).toBe('LEADER')
  })

  it('Leader는 최대 5개까지', () => {
    const members = Array.from({ length: 8 }, (_, i) => co(i + 1, 100e9 - i * 1e9))
    const m = classifyIndustry(members, cfg)
    expect([...m.values()].filter((v) => v === 'LEADER')).toHaveLength(5)
  })

  it('후보가 3개 미만이면 Leader를 지정하지 않는다', () => {
    const m = classifyIndustry([co(1, 400e9), co(2, 100e9)], cfg)
    expect([...m.values()]).not.toContain('LEADER')
    expect(m.get(1)).toBe('CHALLENGER')
  })

  it('경계값: 후보가 정확히 3개(leader_min_industry_candidates)면 Leader를 지정한다', () => {
    const m = classifyIndustry([co(1, 400e9), co(2, 300e9), co(3, 10e9)], cfg)
    expect(m.get(1)).toBe('LEADER')
    expect([...m.values()]).toContain('LEADER')
  })

  it('경계값: 시총이 최대값의 정확히 25%면 Leader로 지정한다(>=)', () => {
    // max=400e9, threshold=100e9. co(2)는 정확히 threshold와 같다.
    const m = classifyIndustry([co(1, 400e9), co(2, 100e9), co(3, 1e9)], cfg)
    expect(m.get(2)).toBe('LEADER')
  })

  it('경계값: 산업 전체 시총이 null이면 아무도 Leader가 되지 않는다', () => {
    const m = classifyIndustry([co(1, null), co(2, null), co(3, null)], cfg)
    expect([...m.values()]).not.toContain('LEADER')
    expect(m.get(1)).toBe('EMERGING')
    expect(m.get(2)).toBe('EMERGING')
    expect(m.get(3)).toBe('EMERGING')
  })
})

describe('classifyIndustry — Challenger / Emerging', () => {
  const leaders = [co(101, 500e9), co(102, 400e9), co(103, 300e9)]

  it('시총 $2B 미만은 Emerging', () => {
    const m = classifyIndustry([...leaders, co(1, 1.5e9)], cfg)
    expect(m.get(1)).toBe('EMERGING')
  })

  it('$2B~$5B에서 영업적자면 Emerging', () => {
    const m = classifyIndustry(
      [...leaders, co(1, 3e9, { operatingIncome: -10_000_000 })], cfg,
    )
    expect(m.get(1)).toBe('EMERGING')
  })

  it('$2B~$5B에서 매출이 $500M 미만이면 Emerging', () => {
    const m = classifyIndustry([...leaders, co(1, 3e9, { revenue: 300_000_000 })], cfg)
    expect(m.get(1)).toBe('EMERGING')
  })

  it('$2B~$5B에서 흑자이고 매출이 충분하면 Challenger', () => {
    const m = classifyIndustry([...leaders, co(1, 3e9)], cfg)
    expect(m.get(1)).toBe('CHALLENGER')
  })

  it('$5B 이상 비-Leader는 Challenger', () => {
    const m = classifyIndustry([...leaders, co(1, 20e9, { operatingIncome: -1 })], cfg)
    expect(m.get(1)).toBe('CHALLENGER')
  })

  it('시총이 null이면 Emerging', () => {
    const m = classifyIndustry([...leaders, co(1, null)], cfg)
    expect(m.get(1)).toBe('EMERGING')
  })

  it('경계값: 시총이 정확히 $2B(challenger_min_market_cap)면 실적 조건으로 판정한다', () => {
    const m = classifyIndustry([...leaders, co(1, 2e9)], cfg)
    expect(m.get(1)).toBe('CHALLENGER')
  })

  it('경계값: 시총이 정확히 $5B(emerging_max_market_cap)면 영업적자여도 Challenger', () => {
    const m = classifyIndustry([...leaders, co(1, 5e9, { operatingIncome: -1 })], cfg)
    expect(m.get(1)).toBe('CHALLENGER')
  })

  it('경계값: 매출이 정확히 $500M(emerging_revenue_threshold)이고 흑자면 Challenger', () => {
    const m = classifyIndustry([...leaders, co(1, 3e9, { revenue: 500_000_000 })], cfg)
    expect(m.get(1)).toBe('CHALLENGER')
  })

  it('경계값: 영업이익이 정확히 0이면 적자로 취급해 Emerging', () => {
    const m = classifyIndustry([...leaders, co(1, 3e9, { operatingIncome: 0 })], cfg)
    expect(m.get(1)).toBe('EMERGING')
  })

  it('$2B~$5B에서 TTM 실적 자체가 없으면 성숙하다고 볼 수 없어 Emerging', () => {
    const m = classifyIndustry([...leaders, coNoTtm(1, 3e9)], cfg)
    expect(m.get(1)).toBe('EMERGING')
  })
})

describe('classifyAll', () => {
  it('산업별로 독립 판정한다', () => {
    const m = classifyAll([
      co(1, 400e9, {}, 'semiconductors'), co(2, 200e9, {}, 'semiconductors'),
      co(3, 100e9, {}, 'semiconductors'),
      co(4, 3e9, {}, 'cybersecurity'), co(5, 2.5e9, {}, 'cybersecurity'),
      co(6, 2.2e9, {}, 'cybersecurity'),
    ], cfg)
    expect(m.get(1)).toBe('LEADER')
    expect(m.get(4)).toBe('LEADER')   // 작은 산업에서도 최대값 기준으로 Leader가 나온다
    expect(m.size).toBe(6)
  })
})
