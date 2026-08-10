import type { AppConfig } from '@/config'
import type { CompanySnapshot, FactorResult, RedFlag } from '@/domain/types'
import { interpolate } from '@/domain/curve'

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

export type ScaleDamping = {
  /** 성장 팩터의 normalized에 곱할 배수. 1.0이면 감쇠 없음 */
  multiplier: number
  /** detail에 이어 붙일 설명. 감쇠가 없으면 빈 문자열 */
  note: string
}

/**
 * TTM 매출 규모로 성장 팩터를 감쇠한다 (revenue_growth · revenue_acceleration 전용).
 *
 * 매출 기반이 극히 작으면 성장 "율"이 사업 확장이 아니라 마일스톤·협업 수령액 같은
 * 일회성 항목을 반영한다 — 즉 비율 자체가 정보를 잃는다. 하한선으로 잘라내면 진짜 초기
 * 단계 유망 기업까지 사라지므로 곡선(config.yaml scoring.revenue_scale_damping)으로
 * 배수를 줄인다.
 *
 * 매출을 모르면 감쇠하지 않는다 — 결측을 0이나 추정값으로 대체하지 않는다는 원칙(§8.1).
 * market_cap_opportunity는 대상이 아니다: 작은 시총에 높은 점수를 주는 것이 의도된 설계다.
 */
export function revenueScaleDamping(revenue: number | null, cfg: AppConfig): ScaleDamping {
  if (revenue === null) return { multiplier: 1, note: '' }

  const multiplier = interpolate(cfg.scoring.revenue_scale_damping.curve, revenue)
  if (multiplier >= 1) return { multiplier: 1, note: '' }

  return {
    multiplier,
    note:
      ` · TTM 매출 $${(revenue / 1_000_000).toFixed(1)}M — 매출 규모 감쇠 ` +
      `×${multiplier.toFixed(2)}`,
  }
}
