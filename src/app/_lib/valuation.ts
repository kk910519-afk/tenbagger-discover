import type {
  FairValueReason,
  MoatInsufficientReason,
  MoatSignal,
  UncertaintyDriverKey,
  UncertaintyLevel,
  ValuationStatus,
} from '@/engines/valuation'

/**
 * fair_value_reason은 엔진 내부 코드 문자열이다(예: NOT_CASH_GENERATIVE) — 화면에 코드
 * 그대로 노출하지 않고 사람이 읽을 한국어 한 줄로 옮긴다. FairValueReason은 정확히 이
 * 7개뿐이다(src/engines/valuation/fair-value.ts) — Record<FairValueReason, string>으로
 * 선언해 새 사유가 엔진에 추가되면 이 파일이 컴파일 타임에 깨지도록 한다(누락 방지).
 */
export const FAIR_VALUE_REASON_LABELS: Record<FairValueReason, string> = {
  NON_POSITIVE_REVENUE: '최근 TTM 매출이 없거나 0 이하라 내재가치를 추정할 근거가 없습니다',
  INSUFFICIENT_REVENUE_HISTORY: '성장률을 추정할 매출 이력이 부족합니다',
  NOT_CASH_GENERATIVE: '잉여현금흐름과 영업이익이 모두 0 이하이거나 결측이라 매출을 현금으로 전환한다는 근거가 없습니다',
  NO_SHARE_COUNT: '희석주식수와 발행주식수 정보가 모두 없습니다',
  NO_BALANCE_SHEET_DATA: '현금 또는 총부채 데이터가 없습니다',
  GROWTH_NOT_PROJECTABLE:
    '최근 매출 성장률을 예측에 그대로 태우면 예측 구간이 끝날 때 매출이 지금의 몇 배로 ' +
    '불어나야 합니다 — 그만큼의 확대를 전제한 값은 이 회사에 대한 측정이 아니라 우리가 ' +
    '고른 가정이므로 숫자를 내지 않습니다',
  INVALID_ASSUMPTIONS: '할인율이 터미널 성장률보다 낮거나 같아 계산이 발산합니다',
}

export function fairValueReasonLabel(reason: FairValueReason | null): string {
  if (reason === null) return '내재가치를 계산할 수 없습니다'
  return FAIR_VALUE_REASON_LABELS[reason]
}

/**
 * Moat Signal이 INSUFFICIENT_DATA일 때 "왜 판정하지 않았는지"를 사람이 읽을 한국어
 * 한 줄로 옮긴다. 세 사유는 서로 다른 이야기라서 다른 문장을 쓴다(브리프 §Moat 사유
 * 구분) — TOO_FEW_PERIODS/MISSING_FINANCIALS는 데이터가 부족하다는 뜻이고,
 * NOT_APPLICABLE은 데이터는 다 있지만 ROIC라는 지표 자체가 이 회사에는 적용되지
 * 않는다는 뜻이다. "투하자본" 같은 전문용어 없이 누구나 읽을 수 있게 쓴다.
 * MoatInsufficientReason은 정확히 이 3개뿐이다(src/engines/valuation/moat-signal.ts)
 * — Record로 선언해 새 사유가 추가되면 이 파일이 컴파일 타임에 깨지도록 한다.
 */
export const MOAT_INSUFFICIENT_REASON_LABELS: Record<MoatInsufficientReason, string> = {
  TOO_FEW_PERIODS: '상장 후 보고된 연간 실적이 판정에 필요한 최소 기간보다 적어 아직 판단할 수 없습니다',
  MISSING_FINANCIALS:
    'ROIC 계산에 필요한 재무 항목(영업이익·부채·자본·현금)이 일부 연도에 보고되지 않아 판단할 수 없습니다',
  NOT_APPLICABLE:
    '사업에 실제로 투입된 자본이 0 이하이거나 회사 규모에 비해 무시할 만큼 작은 해가 있어 ROIC 자체를 정의할 수 없습니다 — ' +
    '데이터가 없어서가 아니라, 현금을 많이 쌓아둔 초기 성장 단계 기업이나 자사주를 크게 매입한 기업에는 이 지표가 적용되지 않기 때문입니다',
}

export function moatInsufficientReasonLabel(reason: MoatInsufficientReason | null): string {
  if (reason === null) return '평가할 데이터가 부족합니다'
  return MOAT_INSUFFICIENT_REASON_LABELS[reason]
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

/**
 * 등급 이름은 영문 코드 그대로 배지에 뜨므로, 그 옆에 프레임워크를 모르는 사람도 읽을 수
 * 있는 한국어 한 줄을 붙인다(페이지의 다른 설명문과 같은 톤 — 전문용어 없이, 무엇을
 * 봤는지만 말한다). ABSENT는 "측정했고 없었다", INSUFFICIENT_DATA는 "측정하지 못했다"로
 * 문장 자체를 다르게 써서 둘이 섞이지 않게 한다.
 * MoatSignal은 정확히 이 4개뿐이다 — Record로 선언해 등급이 늘면 컴파일 타임에 깨진다.
 */
export const MOAT_SIGNAL_LABELS: Record<MoatSignal, string> = {
  PERSISTENT: '자본비용을 넘는 수익이 대부분의 해에 이어졌습니다',
  INTERMITTENT: '넘은 해와 넘지 못한 해가 섞여 있습니다',
  ABSENT: '따져봤지만 이어지는 초과 수익을 찾지 못했습니다',
  INSUFFICIENT_DATA: '따져볼 수 없었습니다',
}

/** MINIMAL→SEVERE 순으로 "이 내재가치 추정을 얼마나 믿을 수 있는지"가 낮아진다. */
export const UNCERTAINTY_LEVEL_LABELS: Record<UncertaintyLevel, string> = {
  MINIMAL: '추정을 뒷받침할 근거가 고르게 갖춰져 있습니다',
  MODERATE: '대체로 갖춰졌지만 흔들리는 부분이 있습니다',
  ELEVATED: '근거가 부족하거나 실적이 들쭉날쭉해 확신이 낮습니다',
  SEVERE: '확신할 근거가 거의 없습니다 — 내재가치를 참고로만 보십시오',
}

/** Value/Badge 둘 다 받는 톤 이름 — 기존 시맨틱 색 5종 중 4종(neutral은 무색)만 쓴다. */
export type Tone = 'neutral' | 'positive' | 'risk' | 'watch'

/** 지속(PERSISTENT)/간헐(INTERMITTENT)/없음(ABSENT)을 색으로도 구분한다 — 색이 주된 신호는 아니다. */
export function moatTone(signal: MoatSignal): Tone {
  if (signal === 'PERSISTENT') return 'positive'
  if (signal === 'INTERMITTENT') return 'watch'
  return 'neutral' // ABSENT, INSUFFICIENT_DATA
}

export function valuationStatusTone(status: ValuationStatus | null): Tone {
  if (status === 'UNDERVALUED') return 'positive'
  if (status === 'OVERVALUED') return 'risk'
  return 'neutral' // FAIRLY_VALUED, null
}

export function uncertaintyTone(level: UncertaintyLevel): Tone {
  if (level === 'MINIMAL') return 'positive'
  if (level === 'MODERATE') return 'watch'
  return 'risk' // ELEVATED, SEVERE
}
