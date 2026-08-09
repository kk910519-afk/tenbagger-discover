import type { AppConfig } from '@/config'
import type { CompanySnapshot, FinancialPeriod } from '@/domain/types'
import { yoy } from '@/domain/growth'
import { operatingMargin, debtToEbitda } from '@/domain/metrics'
import { stdev } from '@/domain/stats'
import { interpolate } from '@/domain/curve'

export type UncertaintyLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH'

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
  /** MEASURED 드라이버들의 risk 평균 (0~1) */
  score: number
  drivers: UncertaintyDriver[]
}

/** 내재가치 산출에 실제로 쓰이는 핵심 필드들 — data_completeness 드라이버의 분모다. */
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
  for (const field of CORE_FIELDS) {
    if (p[field] !== null) present++
  }
  return present / CORE_FIELDS.length
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
      detail: `최근 ${growthSeries.length}개 구간 매출 YoY 성장률 표준편차 ${(sd * 100).toFixed(1)}%p`,
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
      detail: `최근 ${marginSeries.length}개 구간 영업이익률 표준편차 ${(sd * 100).toFixed(1)}%p`,
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
  const completeness = dataCompleteness(snapshot.ttm[0])
  drivers.push({
    key: 'data_completeness',
    status: 'MEASURED',
    risk: interpolate(u.data_completeness_curve, completeness),
    detail: `핵심 재무 필드 ${Math.round(completeness * CORE_FIELDS.length)}/${CORE_FIELDS.length}개 확보`,
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
  // data_completeness는 항상 MEASURED이므로 실무에서는 도달하지 않지만, 순수 함수로서
  // "측정 가능한 것이 하나도 없다"는 입력에도 안전해야 한다 — 그 경우 확신할 근거가
  // 전혀 없다는 뜻이므로 최댓값(불확실성 최고)으로 처리한다. 조작된 중립값이 아니라
  // "판단 불가 = 최고 위험"이라는 명시적 규칙이다.
  const score =
    measured.length > 0 ? measured.reduce((s, d) => s + d.risk, 0) / measured.length : 1

  const t = u.level_thresholds
  let level: UncertaintyLevel
  if (score >= t.very_high) level = 'VERY_HIGH'
  else if (score >= t.high) level = 'HIGH'
  else if (score >= t.medium) level = 'MEDIUM'
  else level = 'LOW'

  return { level, score, drivers }
}
