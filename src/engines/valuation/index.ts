/** 게이트, 페이드 스케줄, 곡선 등 이 엔진의 계산 규칙을 바꾸면 반드시 올린다. */
export const ENGINE_VERSION = 'valuation-1.0.0'

export { computeFairValue } from './fair-value.js'
export type { FairValueResult, FairValueReason, FairValueAssumptions } from './fair-value.js'

export { computePriceToFairValue } from './price-to-fair-value.js'
export type { PriceToFairValueResult, ValuationStatus } from './price-to-fair-value.js'

export { computeMoatSignal } from './moat-signal.js'
export type { MoatResult, MoatSignal } from './moat-signal.js'

export { computeUncertainty } from './uncertainty.js'
export type {
  UncertaintyResult,
  UncertaintyLevel,
  UncertaintyDriver,
  UncertaintyDriverKey,
} from './uncertainty.js'
