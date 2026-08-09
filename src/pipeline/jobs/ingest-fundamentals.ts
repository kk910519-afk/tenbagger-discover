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
// 실패율 경고 메시지에 담을 CIK 샘플 개수. 판정 자체는 config.yaml의
// ingest.normalize_failure_rate_threshold / normalize_failure_min_sample이 담당한다.
const FAILURE_SAMPLE_SIZE = 10

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

    // 회사 하나의 정규화/저장이 실패해도(잘못된 사실 조합, 개별 쓰기 오류 등)
    // 이미 받아온 벌크/API 데이터 전체를 버리지 않는다 — normalizeFacts와
    // replaceFinancials를 모두 같은 try 안에 두어 어느 쪽이 던지든 나머지
    // 회사는 계속 recompute한다.
    let normalized = 0
    let noData = 0
    let normalizeFailed = 0
    const normalizeFailedCiks: string[] = []
    // 결함 3(ingest-hardening 과제): 물리적으로 불가능해 null로 거부된 필드를
    // "안 보이게 조용히 사라지는" 대신 셀 수 있게 잡 통계에 남긴다.
    let rejected = 0
    const rejectionSample: string[] = []
    for (const cik of ciks) {
      try {
        const result = normalizeFacts(getFacts(raw, cik))
        if (result.quarterly.length === 0 && result.annual.length === 0) { noData++; continue }
        replaceFinancials(raw, cik, result)
        normalized++
        if (result.rejections.length > 0) {
          rejected += result.rejections.length
          for (const r of result.rejections) {
            if (rejectionSample.length < FAILURE_SAMPLE_SIZE) {
              rejectionSample.push(`${r.cik}:${r.periodType}:${r.periodEnd}:${r.field}:${r.reason}`)
            }
          }
        }
      } catch {
        normalizeFailed++
        normalizeFailedCiks.push(String(cik))
      }
    }

    // 회사 단위 격리는 개별 데이터 결함을 잡기 위한 것이지, 정규화 로직 자체가
    // 깨졌거나(회귀) 벌크 아카이브가 손상된 경우까지 조용히 "성공"으로 덮기
    // 위한 것이 아니다. 표본이 충분한데 실패율이 임계치를 넘으면 잡 전체를
    // 던져 runJob이 failed로 기록하게 한다 — 소규모 유니버스(예: 산업 하나에
    // 회사 3개, 그중 2개 실패)에서는 실패율 자체가 노이즈이므로 최소 표본
    // 크기 미만이면 이 가드를 건너뛴다.
    if (ciks.size >= cfg.ingest.normalize_failure_min_sample) {
      const failureRate = normalizeFailed / ciks.size
      if (failureRate > cfg.ingest.normalize_failure_rate_threshold) {
        const sample = normalizeFailedCiks.slice(0, FAILURE_SAMPLE_SIZE).join(', ')
        throw new Error(
          `정규화 실패율이 임계치를 초과했습니다: ${(failureRate * 100).toFixed(1)}% ` +
          `(${normalizeFailed}/${ciks.size}, 임계치 ${(cfg.ingest.normalize_failure_rate_threshold * 100).toFixed(0)}%) ` +
          `— 실패 CIK 샘플: ${sample}`,
        )
      }
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
      validationRejected: rejected,
      validationRejectedSample: rejectionSample,
      quarterErrors,
    }
  })
}
