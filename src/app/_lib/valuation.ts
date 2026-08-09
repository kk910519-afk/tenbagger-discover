import type {
  FairValueReason,
  MoatSignal,
  UncertaintyDriverKey,
  UncertaintyLevel,
  ValuationStatus,
} from '@/engines/valuation'

/**
 * fair_value_reason은 엔진 내부 코드 문자열이다(예: NOT_CASH_GENERATIVE) — 화면에 코드
 * 그대로 노출하지 않고 사람이 읽을 한국어 한 줄로 옮긴다. FairValueReason은 정확히 이
 * 6개뿐이다(src/engines/valuation/fair-value.ts) — Record<FairValueReason, string>으로
 * 선언해 새 사유가 엔진에 추가되면 이 파일이 컴파일 타임에 깨지도록 한다(누락 방지).
 */
export const FAIR_VALUE_REASON_LABELS: Record<FairValueReason, string> = {
  NON_POSITIVE_REVENUE: '최근 TTM 매출이 없거나 0 이하라 내재가치를 추정할 근거가 없습니다',
  INSUFFICIENT_REVENUE_HISTORY: '성장률을 추정할 매출 이력이 부족합니다',
  NOT_CASH_GENERATIVE: '잉여현금흐름과 영업이익이 모두 0 이하이거나 결측이라 매출을 현금으로 전환한다는 근거가 없습니다',
  NO_SHARE_COUNT: '희석주식수와 발행주식수 정보가 모두 없습니다',
  NO_BALANCE_SHEET_DATA: '현금 또는 총부채 데이터가 없습니다',
  INVALID_ASSUMPTIONS: '할인율이 터미널 성장률보다 낮거나 같아 계산이 발산합니다',
}

export function fairValueReasonLabel(reason: FairValueReason | null): string {
  if (reason === null) return '내재가치를 계산할 수 없습니다'
  return FAIR_VALUE_REASON_LABELS[reason]
}

/**
 * price_to_fair_value_status가 UNAVAILABLE인 이유는 valuations 테이블에 별도 컬럼으로
 * 저장돼 있지 않다(엔진의 PriceToFairValueResult.reason은 영속화 대상이 아니다 —
 * src/db/repositories/valuations.ts 참고). 대신 이미 조회한 fairValueStatus/
 * fairValuePerShare/현재가로 computePriceToFairValue의 3가지 UNAVAILABLE 분기를
 * 그대로 재구성한다(엔진 계산 규칙 자체는 건드리지 않는다 — 순서만 복제).
 */
export function priceToFairValueUnavailableReason(
  fairValueStatus: 'OK' | 'INSUFFICIENT_DATA',
  fairValuePerShare: number | null,
  price: number | null,
): string {
  if (fairValueStatus !== 'OK') return '내재가치를 추정할 수 없어 비교할 수 없습니다'
  if (fairValuePerShare !== null && fairValuePerShare <= 0) {
    return '산출된 내재가치가 0 이하라 비율이 의미를 갖지 않습니다'
  }
  if (price === null) return '현재가 데이터가 없습니다'
  return '비교할 수 없습니다'
}

export const UNCERTAINTY_DRIVER_LABELS: Record<UncertaintyDriverKey, string> = {
  revenue_predictability: '매출 예측가능성',
  operating_leverage: '영업 레버리지',
  financial_leverage: '재무 레버리지',
  data_completeness: '데이터 완전성',
  business_concentration: '사업 집중도',
}

/** Value/Badge 둘 다 받는 톤 이름 — 기존 시맨틱 색 5종 중 4종(neutral은 무색)만 쓴다. */
export type Tone = 'neutral' | 'positive' | 'risk' | 'watch'

/** WIDE(양호)/NARROW(일부)/NONE(근거 없음)를 색으로도 구분한다 — 색이 주된 신호는 아니다. */
export function moatTone(signal: MoatSignal): Tone {
  if (signal === 'WIDE') return 'positive'
  if (signal === 'NARROW') return 'watch'
  return 'neutral' // NONE, INSUFFICIENT_DATA
}

export function valuationStatusTone(status: ValuationStatus | null): Tone {
  if (status === 'UNDERVALUED') return 'positive'
  if (status === 'OVERVALUED') return 'risk'
  return 'neutral' // FAIRLY_VALUED, null
}

export function uncertaintyTone(level: UncertaintyLevel): Tone {
  if (level === 'LOW') return 'positive'
  if (level === 'MEDIUM') return 'watch'
  return 'risk' // HIGH, VERY_HIGH
}
