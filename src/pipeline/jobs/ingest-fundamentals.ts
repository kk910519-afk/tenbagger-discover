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
    const apiFailedCiks: string[] = []
    for (const cik of stale) {
      try {
        apiFacts += insertFacts(raw, await companyFacts.fetchCompany(cik))
      } catch {
        apiFailed++
        apiFailedCiks.push(String(cik))
      }
    }

    // 회사 하나의 정규화가 실패해도(잘못된 사실 조합 등) 이미 받아온 벌크/API
    // 데이터 전체를 버리지 않는다 — 나머지 회사는 계속 recompute한다.
    let normalized = 0
    let noData = 0
    let normalizeFailed = 0
    const normalizeFailedCiks: string[] = []
    for (const cik of ciks) {
      let result
      try {
        result = normalizeFacts(getFacts(raw, cik))
      } catch {
        normalizeFailed++
        normalizeFailedCiks.push(String(cik))
        continue
      }
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
      apiFailedCiks,
      normalized,
      noData,
      normalizeFailed,
      normalizeFailedCiks,
      quarterErrors,
    }
  })
}
