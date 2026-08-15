import type { AppConfig } from '@/config'
import type { CompanySnapshot, FinancialPeriod } from '@/domain/types'
import { yoy } from '@/domain/growth'
import { operatingMargin, debtToEbitda } from '@/domain/metrics'
import { stdev } from '@/domain/stats'
import { interpolate } from '@/domain/curve'
import { compactMagnitude } from '@/domain/display'

/**
 * "내재가치 추정을 얼마나 확신할 수 있는가"의 4단계. Morningstar가 published tier로 쓰는
 * 어휘(Low / Medium / High / Very High / Extreme)는 쓰지 않는다 — 프레이밍은
 * Morningstar-Inspired로 남기되 등급 이름은 우리 것이어야 한다(제품 오너 상시 규칙).
 * MINIMAL → MODERATE → ELEVATED → SEVERE 순으로 불확실성이 커지며, 방향과 임계값은
 * 이름이 바뀌어도 그대로다.
 */
export type UncertaintyLevel = 'MINIMAL' | 'MODERATE' | 'ELEVATED' | 'SEVERE'

export type UncertaintyDriverKey =
  | 'revenue_predictability'
  | 'operating_leverage'
  | 'financial_leverage'
  | 'data_completeness'
  | 'business_concentration'

export type UncertaintyDriver = {
  key: UncertaintyDriverKey
  status: 'MEASURED' | 'UNAVAILABLE'
  /** 0(불확실성 낮음)~1(불확실성 높음). UNAVAILABLE이면 항상 null. */
  risk: number | null
  detail: string
}

export type UncertaintyResult = {
  level: UncertaintyLevel
  /** MEASURED 드라이버들의 risk 평균에 커버리지 가중을 적용한 값 (0~1) */
  score: number
  drivers: UncertaintyDriver[]
}

/**
 * 커버리지 분모 — "그 회사에 대해 측정 가능했어야 할 드라이버".
 *
 * business_concentration은 빠진다: 10-K 서술 텍스트 파싱이 미구현이라 모든 회사에서
 * 동일하게 UNAVAILABLE이다. 우리가 아직 만들지 않은 신호를 회사의 불확실성으로 청구하면
 * 안 된다(competitive_advantage가 taxonomy 한계로 빠진 신호를 분모에서 빼는 것과 같은
 * 원칙). 나머지 넷은 전부 회사 사유다 — 이력이 짧다, 부채·영업이익이 없다는 것은 그
 * 회사에 대해 우리가 확신할 근거가 실제로 없다는 뜻이다.
 */
const APPLICABLE_DRIVERS: UncertaintyDriverKey[] = [
  'revenue_predictability',
  'operating_leverage',
  'financial_leverage',
  'data_completeness',
]

/** 내재가치 산출에 실제로 쓰이는 핵심 필드들. */
const CORE_FIELDS: (keyof FinancialPeriod)[] = [
  'revenue',
  'grossProfit',
  'operatingIncome',
  'fcf',
  'cash',
  'totalDebt',
  'equity',
  'sharesDiluted',
  'rdExpense',
  'sbc',
]

/**
 * **다른 드라이버가 이미 그 결측을 청구하는 필드.** 최신 TTM 구간에서 이 셋이 비면
 * 그것을 입력으로 쓰는 드라이버가 UNAVAILABLE이 되고, 커버리지 채움이 그 드라이버를
 * 최대 위험 1.0으로 청구한다. 같은 결측을 data_completeness가 또 청구하면 **하나의
 * 공백이 두 번 값을 매기는** 것이 된다 — 1,200개 중 394개가 그 상태였고, 40년 된
 * 급여처리 대기업 ADP가 영업이익 하나가 해소되지 않아 ELEVATED(0.614)가, XEL이
 * SEVERE(0.863)가 된 것이 그 결과다.
 *
 *   revenue        → revenue_predictability (매출 YoY 계열을 만들 수 없다)
 *   operatingIncome→ operating_leverage(영업이익률 계열) · financial_leverage(부채/영업이익)
 *   totalDebt      → financial_leverage
 *
 * 그래서 필드를 **분할**한다: 각 결측은 정확히 한 곳에서만 값이 매겨진다. 위 셋은 그
 * 드라이버가, 나머지 일곱은 data_completeness가 청구한다. 커버리지 분모는 4로 그대로
 * 두므로 이 엔진이 이미 검증한 항등식
 *   score = (Σ 측정된 risk + (4 − 측정 수)) / 4
 * 이 그대로 성립하고, 증거에 대한 단조성도 그대로다 — 결측이 채워지면 그 필드를 청구하던
 * 쪽(드라이버든 data_completeness든)의 위험이 반드시 내려간다.
 */
const DRIVER_BLOCKING_FIELDS: (keyof FinancialPeriod)[] = ['revenue', 'operatingIncome', 'totalDebt']

/** data_completeness가 청구하는 필드 = 핵심 필드 − 드라이버가 이미 청구하는 필드. */
const COMPLETENESS_FIELDS: (keyof FinancialPeriod)[] = CORE_FIELDS.filter(
  (f) => !DRIVER_BLOCKING_FIELDS.includes(f),
)

function revenueYoySeries(ttm: FinancialPeriod[], n: number): number[] {
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    const g = yoy(ttm[i]?.revenue ?? null, ttm[i + 4]?.revenue ?? null)
    if (g !== null) out.push(g)
  }
  return out
}

function operatingMarginSeries(ttm: FinancialPeriod[], n: number): number[] {
  const out: number[] = []
  for (let i = 0; i < n && i < ttm.length; i++) {
    const m = operatingMargin(ttm[i])
    if (m !== null) out.push(m)
  }
  return out
}

function dataCompleteness(p: FinancialPeriod | undefined): number {
  if (!p) return 0
  let present = 0
  for (const field of COMPLETENESS_FIELDS) {
    if (p[field] !== null) present++
  }
  return present / COMPLETENESS_FIELDS.length
}

/**
 * 내재가치를 얼마나 확신을 갖고 추정할 수 있는지를 나타낸다 — 주가 변동성이 아니다.
 * 제품 오너가 지정한 다섯 가지 드라이버 중 사업 집중도(business concentration)는 10-K
 * 서술 텍스트 파싱이 필요해 이번 단계에서는 계산하지 않는다. 없는 것을 조용히 빼고
 * 나머지만으로 "완전한 평가"인 척하지 않도록, 항상 다섯 번째 드라이버로 명시적으로
 * UNAVAILABLE을 반환한다.
 */
export function computeUncertainty(snapshot: CompanySnapshot, cfg: AppConfig): UncertaintyResult {
  const u = cfg.valuation.uncertainty
  const drivers: UncertaintyDriver[] = []

  // 1. 매출 예측가능성 — 최근 TTM YoY 성장률의 변동성. 표준편차가 클수록 미래 성장률
  //    가정의 신뢰도가 낮다.
  const growthSeries = revenueYoySeries(snapshot.ttm, u.growth_lookback_quarters)
  if (growthSeries.length >= u.min_periods) {
    const sd = stdev(growthSeries)!
    drivers.push({
      key: 'revenue_predictability',
      status: 'MEASURED',
      risk: interpolate(u.revenue_predictability_curve, sd),
      detail: `최근 ${growthSeries.length}개 구간 매출 YoY 성장률 표준편차 ${compactMagnitude(sd * 100, 1)}%p`,
    })
  } else {
    drivers.push({
      key: 'revenue_predictability',
      status: 'UNAVAILABLE',
      risk: null,
      detail: `매출 성장률 이력 부족 (${growthSeries.length}/${u.min_periods}개 구간)`,
    })
  }

  // 2. 영업 레버리지 — 영업이익률 변동성을 프록시로 쓴다. 마진이 기간마다 크게 출렁이는
  //    사업은 고정비 비중이 크거나 가격결정력이 불안정하다는 신호이며, 어느 쪽이든
  //    미래 마진을 하나의 값으로 못박기 어렵게 만든다.
  const marginSeries = operatingMarginSeries(snapshot.ttm, u.growth_lookback_quarters)
  if (marginSeries.length >= u.min_periods) {
    const sd = stdev(marginSeries)!
    drivers.push({
      key: 'operating_leverage',
      status: 'MEASURED',
      risk: interpolate(u.operating_margin_volatility_curve, sd),
      detail: `최근 ${marginSeries.length}개 구간 영업이익률 표준편차 ${compactMagnitude(sd * 100, 1)}%p`,
    })
  } else {
    drivers.push({
      key: 'operating_leverage',
      status: 'UNAVAILABLE',
      risk: null,
      detail: `영업이익률 이력 부족 (${marginSeries.length}/${u.min_periods}개 구간)`,
    })
  }

  // 3. 재무 레버리지 — balance_sheet 팩터의 leverage_curve(부채/영업이익 → 0~1 "양호도")를
  //    그대로 재사용하고 부호만 뒤집는다. 같은 질문("이 레버리지 수준이 괜찮은가")에
  //    대한 답을 두 곳에 따로 정의하지 않는다.
  const leverage = debtToEbitda(snapshot.ttm[0])
  if (leverage !== null) {
    const goodness = interpolate(cfg.scoring.factors.balance_sheet.leverage_curve, leverage)
    drivers.push({
      key: 'financial_leverage',
      status: 'MEASURED',
      risk: 1 - goodness,
      detail: `부채/영업이익 ${leverage.toFixed(1)}배`,
    })
  } else {
    drivers.push({
      key: 'financial_leverage',
      status: 'UNAVAILABLE',
      risk: null,
      detail: '부채 또는 영업이익 데이터 없음',
    })
  }

  // 4. 데이터 완전성 — 항상 계산 가능하다 (필드가 전부 없으면 0, 있으면 1).
  //    분모는 핵심 필드 전체가 아니라 **다른 드라이버가 청구하지 않는 필드**다. 매출·
  //    영업이익·총부채의 결측은 위 세 드라이버가 UNAVAILABLE이 되면서 커버리지 채움이
  //    이미 최대 위험으로 청구했으므로, 여기서 또 청구하면 같은 공백에 두 번 값을
  //    매기게 된다(DRIVER_BLOCKING_FIELDS 주석 참고).
  const completeness = dataCompleteness(snapshot.ttm[0])
  drivers.push({
    key: 'data_completeness',
    status: 'MEASURED',
    risk: interpolate(u.data_completeness_curve, completeness),
    detail:
      `핵심 재무 필드 ${Math.round(completeness * COMPLETENESS_FIELDS.length)}/${COMPLETENESS_FIELDS.length}개 확보 ` +
      '(매출·영업이익·총부채는 각 드라이버가 따로 반영)',
  })

  // 5. 사업 집중도 — 미구현. 계산하지 않았다는 사실 자체를 드라이버로 남긴다.
  drivers.push({
    key: 'business_concentration',
    status: 'UNAVAILABLE',
    risk: null,
    detail: '10-K 서술 텍스트 파싱이 필요 — 이번 단계에서는 평가하지 않음',
  })

  const measured = drivers.filter(
    (d): d is UncertaintyDriver & { risk: number } => d.status === 'MEASURED' && d.risk !== null,
  )
  // 측정된 것들의 평균만 쓰면 증거가 적을수록 불확실성이 **낮게** 나온다 — 이력이 0개인
  // 회사가 제품에서 가장 확신 높은 라벨(MINIMAL)을 받는 역전이다. 그래서 측정하지 못한 회사
  // 사유 드라이버는 최대 위험(1.0)으로 채운다. "측정 가능한 것이 하나도 없다"는 입력에
  // 대해 이 엔진이 이미 명시해 둔 규칙("판단 불가 = 최고 위험")을 부분 결측까지 연속적으로
  // 확장한 것이며, 커버리지가 1이면 예전과 정확히 같은 값이 나온다.
  const mean =
    measured.length > 0 ? measured.reduce((s, d) => s + d.risk, 0) / measured.length : 1
  const coverage = measured.length / APPLICABLE_DRIVERS.length
  const confidence = interpolate(u.coverage_curve, coverage)
  const score = mean * confidence + 1 * (1 - confidence)

  const t = u.level_thresholds
  let level: UncertaintyLevel
  if (score >= t.severe) level = 'SEVERE'
  else if (score >= t.elevated) level = 'ELEVATED'
  else if (score >= t.moderate) level = 'MODERATE'
  else level = 'MINIMAL'

  return { level, score, drivers }
}
