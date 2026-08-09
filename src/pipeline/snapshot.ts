import type Database from 'better-sqlite3'
import type { AppConfig } from '@/config'
import type { Taxonomy } from '@/taxonomy'
import type { CompanySnapshot, IndustryStats } from '@/domain/types'
import { median } from '@/domain/stats'
import {
  ttmRevenueGrowth, revenueAcceleration, grossMargin, fcfMargin, roic,
} from '@/domain/metrics'
import { getFinancialsFor } from '@/db/repositories/financials'
import { getLatestMarketData } from '@/db/repositories/market'

export const DISTRIBUTION_KEYS = [
  'revenue_growth', 'revenue_acceleration', 'gross_margin',
  'fcf_margin', 'market_cap', 'roic',
] as const

export type SnapshotDeps = {
  raw: Database.Database
  taxonomy: Taxonomy
  cfg: AppConfig
  asOf: string
}

type CompanyRow = {
  cik: number
  ticker: string
  name: string
  industrySlug: string
  themeSlug: string
  source: 'sic' | 'override'
}

const EMPTY_STATS: IndustryStats = {
  candidateCount: 0,
  medianGrossMargin: null,
  medianRevenueGrowth: null,
  distributions: {},
}

export function buildSnapshots(deps: SnapshotDeps): CompanySnapshot[] {
  const { raw, taxonomy, cfg, asOf } = deps

  const rows = raw
    .prepare(
      `SELECT c.cik, c.ticker, c.name,
              ci.industry_slug AS industrySlug, ci.theme_slug AS themeSlug, ci.source
       FROM companies c
       JOIN company_industry ci ON ci.cik = c.cik
       WHERE c.is_active = 1
       ORDER BY c.cik`,
    )
    .all() as CompanyRow[]

  // 1차: 산업 통계 없이 스냅샷을 만든다
  const partial: CompanySnapshot[] = []
  for (const r of rows) {
    const industry = taxonomy.industries.get(r.industrySlug)
    if (!industry) continue // taxonomy 로더가 무결성을 검증하므로 정상 경로에서는 발생하지 않는다

    const fin = getFinancialsFor(raw, r.cik)
    const market = getLatestMarketData(raw, r.cik)

    partial.push({
      cik: r.cik,
      ticker: r.ticker,
      name: r.name,
      themeSlug: r.themeSlug,
      industrySlug: r.industrySlug,
      industry,
      classificationSource: r.source,
      marketCap: market?.marketCap ?? null,
      price: market?.price ?? null,
      priceDate: market?.date ?? null,
      sharesOutstanding: market?.sharesOutstanding ?? null,
      ttm: fin.ttm,
      annual: fin.annual,
      quarterly: fin.quarterly,
      industryStats: EMPTY_STATS,
      asOf,
    })
  }

  // 2차: 산업별 통계를 계산해 붙인다
  const byIndustry = new Map<string, CompanySnapshot[]>()
  for (const s of partial) {
    const list = byIndustry.get(s.industrySlug)
    if (list) list.push(s)
    else byIndustry.set(s.industrySlug, [s])
  }

  const statsByIndustry = new Map<string, IndustryStats>()
  for (const [slug, members] of byIndustry) {
    const values: Record<string, number[]> = {}
    for (const key of DISTRIBUTION_KEYS) values[key] = []

    for (const s of members) {
      const push = (key: string, v: number | null) => {
        if (v !== null && Number.isFinite(v)) values[key]!.push(v)
      }
      push('revenue_growth', ttmRevenueGrowth(s.ttm))
      push('revenue_acceleration', revenueAcceleration(s.quarterly))
      push('gross_margin', grossMargin(s.ttm[0]))
      push('fcf_margin', fcfMargin(s.ttm[0]))
      push('market_cap', s.marketCap)
      push('roic', roic(s.ttm[0], cfg.scoring.tax_rate))
    }
    for (const key of DISTRIBUTION_KEYS) values[key]!.sort((a, b) => a - b)

    statsByIndustry.set(slug, {
      candidateCount: members.length,
      medianGrossMargin: median(values.gross_margin!),
      medianRevenueGrowth: median(values.revenue_growth!),
      distributions: values,
    })
  }

  return partial.map((s) => ({
    ...s,
    industryStats: statsByIndustry.get(s.industrySlug) ?? EMPTY_STATS,
  }))
}
