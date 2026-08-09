import { describe, it, expect } from 'vitest'
import { readFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getRawDb, runMigrations } from '@/db/client'
import { parseConfig } from '@/config'
import { loadTaxonomy } from '@/taxonomy'
import { ingestUniverse, seedTaxonomy } from '@/pipeline/jobs/ingest-universe'
import { ingestFundamentals } from '@/pipeline/jobs/ingest-fundamentals'
import { refreshPrices } from '@/pipeline/jobs/refresh-prices'
import { computeScores } from '@/pipeline/jobs/compute-scores'
import { parseNasdaqTraded } from '@/providers/listing/nasdaq-trader'
import { createFixtureProvider } from '@/providers/price/fixture'
import { getOpportunityMap } from '@/app/_queries/map'
import { getIndustryView } from '@/app/_queries/industry'
import { getStockDetail } from '@/app/_queries/stock'
import type {
  BulkFundamentalProvider, CompanyFactsProvider, ListingProvider,
  ReferenceProvider, RawFact,
} from '@/providers/types'

const cfg = parseConfig(readFileSync('config.yaml', 'utf8'))
const taxonomy = loadTaxonomy()

const listings: ListingProvider = {
  fetchListings: async () =>
    parseNasdaqTraded(readFileSync('tests/fixtures/nasdaqtraded.txt', 'utf8')),
}

const reference: ReferenceProvider = {
  fetchTickerMap: async () => [
    { cik: 1045810, ticker: 'NVDA', title: 'NVIDIA CORP' },
    { cik: 1535527, ticker: 'CRWD', title: 'CrowdStrike Holdings, Inc.' },
  ],
  fetchCompany: async (cik) => ({
    cik, name: cik === 1045810 ? 'NVIDIA CORP' : 'CrowdStrike Holdings',
    sic: cik === 1045810 ? '3674' : '7372',
    sicDescription: 'x', exchanges: ['Nasdaq'], entityType: 'operating',
    fiscalYearEnd: '0131', filerCategory: 'Large accelerated filer',
    stateOfIncorporation: 'DE', stateOfIncorporationDescription: 'DE',
  }),
}

function facts(cik: number, scale: number): RawFact[] {
  const ends = ['2024-06-30', '2024-09-30', '2024-12-31', '2025-03-31']
  const out: RawFact[] = []
  ends.forEach((periodEnd, i) => {
    const rev = scale * (1 + i * 0.12)
    const add = (tag: string, value: number, qtrs = 1, unit = 'USD') =>
      out.push({
        cik, tag, unit, periodStart: null, periodEnd, qtrs, value,
        form: '10-Q', filedDate: '2025-06-01',
        accession: `a-${cik}-${periodEnd}-${tag}`, source: 'bulk',
      })
    add('Revenues', rev)
    add('GrossProfit', rev * 0.72)
    add('OperatingIncomeLoss', rev * 0.18)
    add('NetCashProvidedByUsedInOperatingActivities', rev * 0.22)
    add('PaymentsToAcquirePropertyPlantAndEquipment', rev * 0.04)
    add('ResearchAndDevelopmentExpense', rev * 0.20)
  })
  const inst = (tag: string, value: number, unit = 'USD') =>
    out.push({
      cik, tag, unit, periodStart: null, periodEnd: '2025-03-31', qtrs: 0, value,
      form: '10-Q', filedDate: '2025-06-01', accession: `i-${cik}-${tag}`, source: 'bulk',
    })
  inst('CashAndCashEquivalentsAtCarryingValue', scale * 8)
  inst('StockholdersEquity', scale * 12)
  inst('LongTermDebtNoncurrent', scale * 1)
  inst('EntityCommonStockSharesOutstanding', 100_000_000, 'shares')
  return out
}

const bulk: BulkFundamentalProvider = {
  fetchQuarter: async (_y, q) =>
    q === 2 ? [...facts(1045810, 1_000_000_000), ...facts(1535527, 200_000_000)] : [],
}
const companyFacts: CompanyFactsProvider = { fetchCompany: async () => [] }

describe('파이프라인 스모크 — ingest → score → 화면 쿼리', () => {
  it('전 구간이 실제 데이터로 이어진다', async () => {
    const raw = getRawDb(join(mkdtempSync(join(tmpdir(), 'tb-smoke-')), 'smoke.db'))
    runMigrations(raw)
    seedTaxonomy(raw, taxonomy)

    const uni = await ingestUniverse({ raw, cfg, taxonomy, listings, reference })
    expect(uni.classified).toBe(2)

    const fund = await ingestFundamentals({
      raw, cfg, bulk, companyFacts, asOf: '2026-08-09',
    })
    expect(fund.normalized).toBe(2)

    const px = await refreshPrices({
      raw, prices: createFixtureProvider('tests/fixtures/prices.json'),
    })
    expect(px.quoted).toBe(2)

    const sc = await computeScores({ raw, cfg, taxonomy, asOf: '2026-08-09' })
    expect(sc.scored).toBe(2)

    // 세 화면 쿼리가 모두 값을 낸다
    const map = getOpportunityMap(raw, cfg.scoring.min_completeness)
    const withCandidates = map.flatMap((t) => t.industries)
    expect(withCandidates.length).toBeGreaterThan(0)
    // 이 스모크 픽스처는 4분기치 최소 팩트만 채워서 completeness 기준(min_completeness)을
    // 넘지 못한다 (GM 변동성 등 8분기 이력이 필요한 신호가 NO_DATA로 빠진다). 즉 두 회사
    // 모두 completeness < min_completeness라 avgTenbagger/topCandidate는 null이 맞다 —
    // 화면 쿼리 배선 자체가 동작하는지는 candidateCount와 아래 종목 상세 쿼리로 확인한다.
    expect(withCandidates[0]!.candidateCount).toBeGreaterThan(0)
    expect(withCandidates[0]!.avgTenbagger).toBeNull()

    const industry = getIndustryView(raw, 'ai-infrastructure', cfg.scoring.min_completeness)
    expect(industry).not.toBeNull()

    const stock = getStockDetail(raw, 'CRWD', '2026-08-09')!
    expect(stock.tenbagger).not.toBeNull()
    expect(stock.factors).toHaveLength(9)
    expect(stock.industryName).toBe('Cybersecurity')

    raw.close()
  })
})
