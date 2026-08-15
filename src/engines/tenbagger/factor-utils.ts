import type { AppConfig } from '@/config'
import type { CompanySnapshot, FactorResult, RedFlag } from '@/domain/types'
import { interpolate } from '@/domain/curve'
import { compactMagnitude } from '@/domain/display'

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
  if (v === null || !Number.isFinite(v)) return '—'
  const sign = v > 0 ? '+' : ''
  return `${sign}${compactMagnitude(v * 100, digits)}%`
}

/** bp 표기도 같은 경계를 쓴다 — 매출총이익률 추세는 기저가 무너지면 백만 bp까지 간다. */
export function bpsPerYear(v: number): string {
  if (!Number.isFinite(v)) return '—'
  const sign = v > 0 ? '+' : ''
  return `${sign}${compactMagnitude(v, 0)}bp/년`
}

/**
 * detail 문자열용 금액 표기. 기저 매출이 $726K인지 $0.7M인지가 이 화면의 요점이므로
 * 백만 달러 미만은 천 단위로 적는다 — 반올림해서 "$0.7M"이라고 쓰면 읽는 사람이
 * 판단해야 할 바로 그 사실이 흐려진다.
 */
export function usdCompact(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return '—'
  const sign = v < 0 ? '-' : ''
  const abs = Math.abs(v)
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(2)}T`
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(0)}K`
  return `${sign}$${abs.toFixed(0)}`
}

/**
 * 성장률이 표기 한계를 넘으면 퍼센트 대신 "기저 → 현재 (N배)"로 적는다.
 * 배수는 성장률과 같은 사실을 다른 단위로 쓴 것이고(1 + 성장률), 기저 금액은 읽는 사람이
 * 그 배수를 신뢰할지 스스로 판단할 근거다.
 */
export function growthPhrase(
  label: string,
  rate: number,
  base: number | null,
  current: number | null,
  limit: number,
): string {
  if (Math.abs(rate) < limit || base === null || current === null) {
    return `${label} ${pct(rate)}`
  }
  return `${label} ${usdCompact(base)} → ${usdCompact(current)} (${(1 + rate).toFixed(0)}배)`
}

export type ScaleInput = {
  /** detail에 그대로 들어가는 이름 — 어느 기간이 분모였는지 화면에서 읽혀야 한다. */
  label: string
  revenue: number | null
}

export type ScaleDamping = {
  /** 팩터의 normalized에 곱할 배수. 1.0이면 감쇠 없음 */
  multiplier: number
  /** detail에 이어 붙일 설명. 감쇠가 없으면 빈 문자열 */
  note: string
}

/**
 * 매출 규모로 비율 기반 팩터를 감쇠한다
 * (revenue_growth · revenue_acceleration · operating_leverage).
 *
 * 매출 기반이 극히 작으면 "율"이 사업 확장이 아니라 마일스톤·협업 수령액 같은 일회성
 * 항목을 반영한다 — 즉 비율 자체가 정보를 잃는다. 하한선으로 잘라내면 진짜 초기 단계
 * 유망 기업까지 사라지므로 곡선(config.yaml scoring.revenue_scale_damping)으로 배수를 줄인다.
 *
 * **어느 기간을 보는가**: 호출부가 자기 비율의 **분모가 된 기간**을 첫 입력으로 넘긴다.
 * 최신 매출만 보면 SEPN처럼 $726K → $98.88M이 된 회사가 감쇠 구간 밖으로 빠져나가는데,
 * +13,520%를 만든 분모는 $726K다. 여러 입력을 받으면 **배수가 가장 작은 쪽**을 채택한다 —
 * 비율은 두 수에 대한 진술이므로 어느 한쪽이라도 잡음 구간이면 비율은 정보를 잃는다.
 *
 * 매출을 모르는 입력은 건너뛴다 — 결측을 0이나 추정값으로 대체하지 않는다는 원칙(§8.1).
 * 전부 결측이면 감쇠하지 않는다.
 * market_cap_opportunity는 대상이 아니다: 작은 시총에 높은 점수를 주는 것이 의도된 설계다.
 */
export function revenueScaleDamping(inputs: ScaleInput[], cfg: AppConfig): ScaleDamping {
  let worst: { input: ScaleInput; multiplier: number } | null = null
  for (const input of inputs) {
    if (input.revenue === null) continue
    const multiplier = interpolate(cfg.scoring.revenue_scale_damping.curve, input.revenue)
    if (worst === null || multiplier < worst.multiplier) worst = { input, multiplier }
  }
  if (worst === null || worst.multiplier >= 1) return { multiplier: 1, note: '' }

  return {
    multiplier: worst.multiplier,
    note:
      ` · ${worst.input.label} ${usdCompact(worst.input.revenue)} — 매출 규모 감쇠 ` +
      `×${worst.multiplier.toFixed(2)}`,
  }
}
