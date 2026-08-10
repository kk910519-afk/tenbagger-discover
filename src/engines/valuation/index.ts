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
 * 1.2.0 — MoatResult에 insufficientReason이 추가됐다(moat-reason 과제). 네 등급의
 * 판정 규칙·임계값은 전혀 바뀌지 않았지만, INSUFFICIENT_DATA일
 * 때 저장되는 산출물의 모양(스키마)이 바뀌었으므로 올린다 — 이전 버전으로 저장된 행은
 * 이 필드가 없다는 걸 engine_version으로 구분할 수 있어야 한다.
 *
 * 1.3.0 — 세 가지 판정 규칙이 바뀐다.
 *   · Fair Value에 여섯 번째 게이트. 상한을 넘는 추세 성장률은 깎지 않고
 *     GROWTH_NOT_PROJECTABLE로 돌린다(리뷰 Finding 1).
 *   · Moat Signal이 쓰는 ROIC에 투하자본 규모 하한(scoring.min_invested_capital_ratio).
 *     자본이 음수이거나 현금이 많아 투하자본이 상쇄 잔차인 기간은 NOT_APPLICABLE이 되어
 *     최상위 등급 판정에서 빠진다(리뷰 Finding 2).
 *   · Uncertainty가 측정하지 못한 드라이버를 최대 위험으로 채운다 — 이력이 없는 회사가
 *     가장 확신 높은 라벨을 받던 역전을 없앤다(리뷰 Finding 4).
 *
 * 1.4.0 — 두 가지가 바뀐다(제품 오너 결정).
 *   · Fair Value의 여섯 번째 게이트가 초기 성장률 상한(valuation.max_projectable_growth,
 *     제거됨)에서 **암시 매출배수** 상한(valuation.max_implied_revenue_multiple)으로
 *     바뀐다. 페이드를 실제로 태운 결과를 보므로 fade_curve·projection_years·
 *     terminal_growth_rate가 달라져도 같은 것을 막는다. 여전히 깎지 않고 거부한다.
 *     FairValueAssumptions에 impliedRevenueMultiple이 추가되므로 산출물의 모양도 바뀐다.
 *   · 등급 이름이 바뀐다: MoatSignal WIDE/NARROW/NONE → PERSISTENT/INTERMITTENT/ABSENT,
 *     UncertaintyLevel LOW/MEDIUM/HIGH/VERY_HIGH → MINIMAL/MODERATE/ELEVATED/SEVERE.
 *     Morningstar의 published tier 어휘를 쓰지 않기 위한 개명이며 임계값·판정 규칙은
 *     전혀 바뀌지 않는다 — 어떤 회사의 등급 소속도 움직이지 않는다. 그래도 저장된 값의
 *     어휘가 달라졌으므로, 옛 이름으로 저장된 행과 구분할 수 있어야 해서 올린다.
 *
 * 1.5.0 — 세 가지 판정 규칙이 바뀐다(검증 리뷰 재작업).
 *   · **성숙 FCF마진이 전역 상수(0.15)에서 회사별 앵커로 바뀐다.** 최근 연간 기간에서
 *     관측된 마진(초기 마진과 같은 기준)의 중앙값을 쓰고, 이력이 짧거나·중앙값이 0
 *     이하거나·산포가 수준만큼 크면 기본값으로 메우지 않고 MARGIN_NOT_ANCHORABLE로
 *     거부한다. 기업가치의 약 75%가 터미널 블록이므로 이것은 모든 fair_value_per_share를
 *     움직이는 변경이며, FairValueAssumptions에 matureMarginPeriods·
 *     matureMarginDispersion이 추가되어 산출물의 모양도 바뀐다.
 *   · **Moat Signal의 투하자본 규모 하한이 NOPAT > 0인 기간에만 걸린다.** NOPAT ≤ 0인
 *     기간은 분모와 무관하게 자본비용 미달이 확정돼 있으므로 유효 기간으로 센다. 결론
 *     (ABSENT)이 비결론으로 격하되지 않고, 실패 기간만 지워 등급이 올라가는 경로도
 *     닫힌다. 판정이 실제로 바뀌므로 올린다.
 *   · **Uncertainty의 data_completeness가 다른 드라이버가 청구하는 필드를 분모에서
 *     뺀다.** 하나의 결측에 두 번 값을 매기던 것을 필드 분할로 정리한 것이며, 저장되는
 *     uncertainty_score가 움직인다.
 */
export const ENGINE_VERSION = 'valuation-1.5.0'

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
