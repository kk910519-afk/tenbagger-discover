import type { AppConfig } from '@/config'
import type { Listing } from '@/providers/types'

export type FilterResult = { pass: boolean; reason: string | null }

const PASS: FilterResult = { pass: true, reason: null }

/**
 * 상장 메타데이터만으로 판정 가능한 유니버스 조건.
 * 시가총액·SIC 조건은 데이터가 더 필요하므로 ingest-universe 잡에서 별도로 적용한다.
 */
export function passesListingFilter(l: Listing, cfg: AppConfig): FilterResult {
  const u = cfg.universe
  if (l.isEtf) return { pass: false, reason: 'ETF' }
  if (l.isTestIssue) return { pass: false, reason: 'TEST_ISSUE' }
  if (!u.exchanges.includes(l.exchange)) return { pass: false, reason: 'EXCHANGE' }
  if (l.financialStatus && u.exclude_financial_status.includes(l.financialStatus)) {
    return { pass: false, reason: 'FINANCIAL_STATUS' }
  }

  const name = l.securityName
  if (u.security_name_exclude.some((p) => name.includes(p))) {
    return { pass: false, reason: 'NOT_COMMON_STOCK' }
  }
  if (!u.security_name_include.some((p) => name.includes(p))) {
    return { pass: false, reason: 'NOT_COMMON_STOCK' }
  }
  return PASS
}
