import type { AppConfig } from '@/config'
import type { CompanySnapshot, FactorResult, RedFlag } from '@/domain/types'

export type FactorContext = {
  snapshot: CompanySnapshot
  cfg: AppConfig
  flags: RedFlag[]
}

export type FactorFn = (ctx: FactorContext) => FactorResult

/** normalized는 0~1. points = weight × normalized */
export function scored(
  key: string,
  weight: number,
  raw: number | null,
  normalized: number,
  detail: string,
): FactorResult {
  return { key, weight, points: weight * normalized, raw, status: 'SCORED', detail }
}

export function noData(key: string, weight: number, detail: string): FactorResult {
  return { key, weight, points: null, raw: null, status: 'NO_DATA', detail }
}

export function notImplemented(key: string, weight: number): FactorResult {
  return {
    key, weight, points: null, raw: null, status: 'NOT_IMPLEMENTED',
    detail: 'Phase 4에서 구현 예정 — 모든 기업에 동일 적용되어 상대 순위에 영향 없음',
  }
}

export function pct(v: number | null, digits = 1): string {
  if (v === null) return '—'
  const sign = v > 0 ? '+' : ''
  return `${sign}${(v * 100).toFixed(digits)}%`
}
