import type { AppConfig } from '@/config'
import type { Listing } from '@/providers/types'

export type FilterResult = { pass: boolean; reason: string | null }

const PASS: FilterResult = { pass: true, reason: null }

const SECURITY_TYPE_SEPARATOR = ' - '

/**
 * Nasdaq의 Security Name 컬럼은 "Company Name - Security Type" 형식이다
 * (예: "NVIDIA Corporation - Common Stock", "Some Co - Warrant").
 * 증권 종류는 마지막 " - " 뒤쪽에 온다 — 회사명 자체에 " - "가 여러 번 나올 수 있으므로
 * 마지막 구분자를 기준으로 자른다. 구분자가 전혀 없으면 증권 종류를 알 수 없다는 뜻이므로
 * null을 반환한다 (호출부에서 별도 사유로 처리한다).
 */
function securityTypeSuffix(name: string): string | null {
  const idx = name.lastIndexOf(SECURITY_TYPE_SEPARATOR)
  if (idx === -1) return null
  return name.slice(idx + SECURITY_TYPE_SEPARATOR.length)
}

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

  // 증권 종류 접미사만으로 판정한다. 회사명 전체를 대상으로 부분 문자열 매칭을 하면
  // "UnitedHealth", "Unity Software", "Rightside" 같은 정상적인 보통주 회사명이
  // exclude 키워드("Unit", "Right")를 우연히 포함해 잘못 걸러진다.
  const type = securityTypeSuffix(l.securityName)
  if (type === null) {
    // Nasdaq 명명 규칙을 따르지 않아 증권 종류를 판정할 근거가 없는 이름이다.
    // 보통주인지 확신할 수 없으므로 통과시키지 않되, 우선주/워런트 등과 구분되는
    // 별도 사유 코드로 남겨 후속 리포팅에서 이 케이스를 따로 조사할 수 있게 한다.
    return { pass: false, reason: 'UNKNOWN_SECURITY_TYPE' }
  }
  if (u.security_name_exclude.some((p) => type.includes(p))) {
    return { pass: false, reason: 'NOT_COMMON_STOCK' }
  }
  if (!u.security_name_include.some((p) => type.includes(p))) {
    return { pass: false, reason: 'NOT_COMMON_STOCK' }
  }
  return PASS
}
