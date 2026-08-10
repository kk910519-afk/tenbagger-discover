/**
 * 게이트, 페이드 스케줄, 곡선 등 이 엔진의 계산 규칙을 바꾸면 반드시 올린다.
 * 계산 규칙이 그대로여도 **입력의 정의**가 바뀌면 같은 회사의 판정이 달라지므로
 * 그때도 올린다 — 그러지 않으면 점수 이력에서 "회사가 바뀌었나"와 "잣대가
 * 바뀌었나"를 구분할 수 없다.
 *
 * 1.1.0 — `totalDebt`의 정의 확장(debt-coverage 과제). ROIC의 투하자본과 DCF의
 * 순부채가 모두 이 값을 쓰므로 Moat Signal·Fair Value가 함께 움직인다. 규칙 자체는
 * 손대지 않았다(해자 임계값·WACC·기간 요구치 모두 동일).
 *
 * 1.2.0 — MoatResult에 insufficientReason이 추가됐다(moat-reason 과제). WIDE/NARROW/
 * NONE/INSUFFICIENT_DATA의 판정 규칙·임계값은 전혀 바뀌지 않았지만, INSUFFICIENT_DATA일
 * 때 저장되는 산출물의 모양(스키마)이 바뀌었으므로 올린다 — 이전 버전으로 저장된 행은
 * 이 필드가 없다는 걸 engine_version으로 구분할 수 있어야 한다.
 */
export const ENGINE_VERSION = 'valuation-1.2.0'

export { computeFairValue } from './fair-value.js'
export type { FairValueResult, FairValueReason, FairValueAssumptions } from './fair-value.js'

export { computePriceToFairValue } from './price-to-fair-value.js'
export type { PriceToFairValueResult, ValuationStatus } from './price-to-fair-value.js'

export { computeMoatSignal } from './moat-signal.js'
export type { MoatResult, MoatSignal, MoatInsufficientReason } from './moat-signal.js'

export { computeUncertainty } from './uncertainty.js'
export type {
  UncertaintyResult,
  UncertaintyLevel,
  UncertaintyDriver,
  UncertaintyDriverKey,
} from './uncertainty.js'
