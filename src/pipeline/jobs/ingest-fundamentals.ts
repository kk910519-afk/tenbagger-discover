import type Database from 'better-sqlite3'
import type { AppConfig } from '@/config'
import type { BulkFundamentalProvider, CompanyFactsProvider } from '@/providers/types'
import { normalizeFacts } from '@/providers/fundamental/normalizer'
import { listUniverseCiks } from '@/db/repositories/companies'
import {
  insertFacts, getFacts, replaceFinancials, selectStaleCiks,
} from '@/db/repositories/financials'
import { recentQuarters } from '@/pipeline/quarters'
import { runJob, type JobStats } from '@/pipeline/runner'

const INCREMENTAL_STALE_DAYS = 120

export type FundamentalsDeps = {
  raw: Database.Database
  cfg: AppConfig
  bulk: BulkFundamentalProvider
  companyFacts: CompanyFactsProvider
  asOf: string
}

export async function ingestFundamentals(deps: FundamentalsDeps): Promise<JobStats> {
  const { raw, cfg, bulk, companyFacts, asOf } = deps

  return runJob(raw, 'fundamentals', async () => {
    const ciks = new Set(listUniverseCiks(raw))
    const quarters = recentQuarters(asOf, cfg.ingest.bulk_quarters)

    let bulkFacts = 0
    let quartersLoaded = 0
    const quarterErrors: string[] = []
    for (const q of quarters) {
      try {
        bulkFacts += insertFacts(raw, await bulk.fetchQuarter(q.year, q.quarter, ciks))
        quartersLoaded++
      } catch (e) {
        // 아직 공개되지 않은 분기는 404가 난다. 잡 전체를 중단시키지 않는다.
        quarterErrors.push(`${q.year}Q${q.quarter}: ${e instanceof Error ? e.message : e}`)
      }
    }

    // 벌크가 덮지 못한 기업만 API로 보충한다
    const stale = selectStaleCiks(raw, asOf, INCREMENTAL_STALE_DAYS)
    let apiFacts = 0
    let apiFailed = 0
    for (const cik of stale) {
      try {
        apiFacts += insertFacts(raw, await companyFacts.fetchCompany(cik))
      } catch {
        apiFailed++
      }
    }

    let normalized = 0
    let noData = 0
    for (const cik of ciks) {
      const result = normalizeFacts(getFacts(raw, cik))
      if (result.quarterly.length === 0 && result.annual.length === 0) { noData++; continue }
      replaceFinancials(raw, cik, result)
      normalized++
    }

    return {
      universeSize: ciks.size,
      quartersRequested: quarters.length,
      quartersLoaded,
      bulkFacts,
      staleCompanies: stale.length,
      apiFacts,
      apiFailed,
      normalized,
      noData,
      quarterErrors,
    }
  })
}
