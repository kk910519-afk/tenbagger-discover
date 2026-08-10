import type { AppConfig } from '@/config'
import type { CompanySnapshot, FinancialPeriod } from '@/domain/types'
import { interpolate } from '@/domain/curve'
import { ttmRevenueGrowth, revenueCagr3y, fcfMargin, operatingMargin } from '@/domain/metrics'
import { median, medianAbsoluteDeviation } from '@/domain/stats'

/**
 * 각 사유는 어떤 최소 요건이 충족되지 않았는지를 정확히 가리킨다 — "데이터 부족"이라는
 * 뭉뚱그린 사유 하나로는 UI가 "왜"를 설명할 수 없다.
 */
export type FairValueReason =
  | 'NON_POSITIVE_REVENUE'
  | 'INSUFFICIENT_REVENUE_HISTORY'
  | 'NOT_CASH_GENERATIVE'
  | 'NO_SHARE_COUNT'
  | 'NO_BALANCE_SHEET_DATA'
  | 'GROWTH_NOT_PROJECTABLE'
  | 'MARGIN_NOT_ANCHORABLE'
  | 'INVALID_ASSUMPTIONS'

/** UI가 "이 숫자가 어떻게 나왔는지"를 공개할 수 있도록, 계산에 실제로 쓰인 가정을 모두 담는다. */
export type FairValueAssumptions = {
  projectionYears: number
  discountRate: number
  terminalGrowthRate: number
  initialGrowthRate: number
  initialGrowthSource: 'blend' | 'ttm_yoy_only' | 'cagr_3y_only'
  /**
   * 성숙 FCF마진 — **전역 상수가 아니라 이 회사가 보여준 값**이다. 최근 연간 기간에서
   * 관측된 마진의 중앙값이며, 어느 기준(FCF/NOPAT)으로 쟀는지는 initialMarginSource와
   * 항상 같다.
   */
  matureFcfMargin: number
  /** 성숙마진 중앙값을 낸 연간 기간 수 — 몇 년치 실적 위에 선 가정인지 공개한다. */
  matureMarginPeriods: number
  /** median(|xᵢ − median|) / median. 0에 가까울수록 그 마진이 하나의 "수준"이라는 뜻. */
  matureMarginDispersion: number
  initialFcfMargin: number
  initialMarginSource: 'fcf' | 'nopat_proxy'
  /**
   * 이 투영이 실제로 주장하는 것 — projection_years 뒤 매출이 지금의 몇 배가 되는가.
   * 페이드 스케줄을 실제로 태운 결과이지 초기 성장률의 재표현이 아니다. 게이트가 보는
   * 값이 곧 화면에 공개되는 값이어야 하므로 가정에 함께 담는다.
   */
  impliedRevenueMultiple: number
  taxRate: number
  netCash: number
  shares: number
  sharesSource: 'diluted' | 'outstanding'
}

export type FairValueResult =
  | {
      status: 'OK'
      perShare: number
      enterpriseValue: number
      equityValue: number
      assumptions: FairValueAssumptions
      detail: string
    }
  | {
      status: 'INSUFFICIENT_DATA'
      reason: FairValueReason
      detail: string
    }

function insufficient(reason: FairValueReason, detail: string): FairValueResult {
  return { status: 'INSUFFICIENT_DATA', reason, detail }
}

/**
 * 성숙마진의 기준. 초기 마진의 출처와 **항상 같다** — 페이드는 초기값에서 성숙값으로
 * 가는 경로이므로, 양 끝이 서로 다른 측정이면 그 경로는 회사의 마진 수렴이 아니라
 * 두 지표의 혼합을 그린다.
 */
type MarginBasis = 'fcf' | 'nopat_proxy'

function marginOn(p: FinancialPeriod, basis: MarginBasis, taxRate: number): number | null {
  if (basis === 'fcf') return fcfMargin(p)
  const opM = operatingMargin(p)
  return opM === null ? null : opM * (1 - taxRate)
}

type MatureMargin =
  | { ok: true; margin: number; periods: number; dispersion: number }
  | { ok: false; detail: string }

/**
 * 성숙 FCF마진을 그 회사가 **실제로 보여준** 마진에서 뽑는다. 전역 상수를 쓰지 않는 이유는
 * config.yaml의 valuation.mature_margin 주석에 측정과 함께 적어 두었다.
 *
 * 연간 기간을 쓴다: TTM은 분기마다 겹치므로 "몇 개의 뚜렷한 해를 봤다"고 말할 수 없다
 * (Moat Signal이 연간을 쓰는 이유와 같고, 창의 크기도 같은 근거로 같은 값이다).
 * 평균이 아니라 중앙값을 쓴다: 한 해의 대규모 일회성 항목이 영구 가정을 통째로 옮기면
 * 안 된다.
 *
 * 세 가지 경우에는 값을 만들지 않고 거부한다 — 전역 기본값으로 조용히 메우지 않는다.
 *   1) 관측 기간이 min_periods 미만: 잴 것이 없다.
 *   2) 중앙값이 0 이하: 매출을 현금으로 바꾼 적이 대체로 없는 회사다. 최근 TTM 하나가
 *      흑자라는 이유로 영구 양(+)의 마진을 부여하는 것은 측정이 아니라 저작이다.
 *   3) 산포(MAD/중앙값)가 max_dispersion 초과: 흩어짐이 수준만큼 크면 그 중앙값은
 *      "수준"이 아니다.
 */
function matureMarginFrom(
  annual: FinancialPeriod[],
  basis: MarginBasis,
  taxRate: number,
  cfgMargin: AppConfig['valuation']['mature_margin'],
): MatureMargin {
  const basisLabel = basis === 'fcf' ? 'FCF마진' : 'NOPAT마진'
  const observed: number[] = []
  for (const p of annual.slice(0, cfgMargin.lookback_periods)) {
    const v = marginOn(p, basis, taxRate)
    if (v !== null) observed.push(v)
  }

  if (observed.length < cfgMargin.min_periods) {
    return {
      ok: false,
      detail:
        `성숙마진을 앵커할 연간 ${basisLabel} 이력이 ${observed.length}개뿐 — ` +
        `최소 ${cfgMargin.min_periods}개 필요. 전역 기본 마진으로 대신 채우지 않는다`,
    }
  }

  const m = median(observed)!
  if (m <= 0) {
    return {
      ok: false,
      detail:
        `최근 연간 ${observed.length}개 기간의 ${basisLabel} 중앙값이 ${(m * 100).toFixed(1)}% — ` +
        '매출을 현금으로 전환한 이력이 대체로 없어 영구 마진을 가정할 근거가 없음',
    }
  }

  const dispersion = medianAbsoluteDeviation(observed)! / m
  if (dispersion > cfgMargin.max_dispersion) {
    return {
      ok: false,
      detail:
        `최근 연간 ${observed.length}개 기간의 ${basisLabel}이 중앙값 ${(m * 100).toFixed(1)}%를 ` +
        `중심으로 ${dispersion.toFixed(2)}배만큼 흩어져 있음(상한 ${cfgMargin.max_dispersion.toFixed(2)}) — ` +
        '하나의 성숙 수준이라고 말할 수 없음',
    }
  }

  return { ok: true, margin: m, periods: observed.length, dispersion }
}

/**
 * 명시적 다년 FCF 예측 + 터미널가치를 요구수익률로 할인하고, 순현금을 더해 희석주식수로
 * 나눈 주당 내재가치. 모든 가정은 config.yaml의 valuation 섹션에 있다 — 코드에 숨은
 * 리터럴은 없다.
 *
 * 게이트가 이 함수의 핵심이다: 사전매출 단계이거나 현금을 태우기만 하는 기업에 마진을
 * 투영하는 것은 밸류에이션이 아니라 저작(authorship)이다. 일곱 가지를 최소 요건으로 둔다.
 *   1) 최근 TTM 매출이 양수 — 매출이 없으면 애초에 밸류에이션 대상이 아니다
 *   2) 성장률을 추정할 매출 이력(TTM YoY 또는 3Y CAGR 중 하나) — 없으면 초기 성장률 자체가 조작
 *   3) 매출을 현금으로 전환한다는 증거(FCF>0 또는 영업이익>0) — 적자 소각 기업을 배제
 *   4) 희석주식수 또는 발행주식수 — 주당 가치로 나눌 분모가 없으면 숫자를 낼 수 없다
 *   5) 현금과 총부채가 모두 존재 — "순현금 반영"이 공식의 일부이므로, 없는 값을 0으로
 *      대신 채우지 않고 통째로 INSUFFICIENT_DATA 처리한다
 *   6) 페이드 스케줄을 실제로 태웠을 때의 **암시 매출배수**가
 *      valuation.max_implied_revenue_multiple 이하 — 상한을 넘으면 값을 깎지 않고(깎는
 *      것은 우리가 성장률을 지어내는 일이다) 숫자를 내지 않는다. 근거와 수치는
 *      config.yaml의 주석 참고.
 *   7) **성숙 FCF마진을 그 회사의 연간 실적에서 앵커할 수 있음** — 기업가치의 약 4분의
 *      3이 터미널 블록에서 나오고 그 터미널 FCF는 `매출₅ × 성숙마진`이므로, 성숙마진이
 *      전역 상수면 DCF는 매출배수를 DCF 옷을 입혀 내놓는 것이 된다. 이력이 짧거나·
 *      중앙값이 0 이하거나·흩어짐이 수준만큼 크면 기본값으로 메우지 않고 거부한다.
 */
export function computeFairValue(snapshot: CompanySnapshot, cfg: AppConfig): FairValueResult {
  const v = cfg.valuation
  const ttm0 = snapshot.ttm[0]
  const revenue = ttm0?.revenue ?? null

  if (revenue === null || revenue <= 0) {
    return insufficient(
      'NON_POSITIVE_REVENUE',
      '최근 TTM 매출이 없거나 0 이하 — 내재가치를 추정할 근거가 없음',
    )
  }

  const ttmYoy = ttmRevenueGrowth(snapshot.ttm)
  const cagr3y = revenueCagr3y(snapshot.ttm)
  if (ttmYoy === null && cagr3y === null) {
    return insufficient(
      'INSUFFICIENT_REVENUE_HISTORY',
      '성장률을 추정할 매출 이력 부족 — TTM YoY(5개 분기)·3Y CAGR(13개 분기) 모두 산출 불가',
    )
  }

  const fcf0 = ttm0?.fcf ?? null
  const opInc0 = ttm0?.operatingIncome ?? null
  const fcfPositive = fcf0 !== null && fcf0 > 0
  const opIncPositive = opInc0 !== null && opInc0 > 0
  if (!fcfPositive && !opIncPositive) {
    return insufficient(
      'NOT_CASH_GENERATIVE',
      '잉여현금흐름과 영업이익이 모두 0 이하(또는 결측) — 매출을 현금으로 전환한다는 근거가 없음',
    )
  }

  const dilutedShares = ttm0?.sharesDiluted ?? null
  const outstandingShares = snapshot.sharesOutstanding ?? null
  let shares: number
  let sharesSource: FairValueAssumptions['sharesSource']
  if (dilutedShares !== null && dilutedShares > 0) {
    shares = dilutedShares
    sharesSource = 'diluted'
  } else if (outstandingShares !== null && outstandingShares > 0) {
    shares = outstandingShares
    sharesSource = 'outstanding'
  } else {
    return insufficient('NO_SHARE_COUNT', '희석주식수와 발행주식수 모두 없음')
  }

  const cash = ttm0?.cash ?? null
  const totalDebt = ttm0?.totalDebt ?? null
  if (cash === null || totalDebt === null) {
    return insufficient(
      'NO_BALANCE_SHEET_DATA',
      '현금 또는 총부채 데이터 없음 — 순현금 조정 없이는 주당 가치를 계산할 수 없음',
    )
  }
  const netCash = cash - totalDebt

  const discountRate = cfg.scoring.wacc_assumption
  const terminalGrowthRate = v.terminal_growth_rate
  // config 스키마가 이미 terminal < wacc를 강제하지만, 이 함수는 순수 함수로서 독립적으로도
  // 안전해야 한다(스키마를 우회한 손수 조립 cfg로 호출될 수 있음) — 방어적으로 다시 확인한다.
  if (discountRate <= terminalGrowthRate) {
    return insufficient(
      'INVALID_ASSUMPTIONS',
      'discount rate가 terminal growth rate 이하 — 터미널가치가 발산함',
    )
  }

  // 초기 성장률: scoring.factors.revenue_growth.blend를 재사용한다 — 채점 엔진이 이미
  // "TTM YoY와 3Y CAGR을 어떤 비중으로 섞을지"에 대한 답을 갖고 있으므로 같은 질문에
  // 또 다른 답을 config에 중복해서 두지 않는다.
  const blend = cfg.scoring.factors.revenue_growth.blend
  let initialGrowthRate: number
  let initialGrowthSource: FairValueAssumptions['initialGrowthSource']
  if (ttmYoy !== null && cagr3y !== null) {
    initialGrowthRate = blend.ttm_yoy * ttmYoy + blend.cagr_3y * cagr3y
    initialGrowthSource = 'blend'
  } else if (ttmYoy !== null) {
    initialGrowthRate = ttmYoy
    initialGrowthSource = 'ttm_yoy_only'
  } else {
    initialGrowthRate = cagr3y!
    initialGrowthSource = 'cagr_3y_only'
  }

  const years = v.projection_years
  const fadeCurve = v.fade_curve

  // 페이드 곡선은 초기 성장률을 터미널 성장률로 수렴시킬 뿐 상한을 두지 않는다 — 그래서
  // 한 번의 극단적 추세치가 복리로 증폭된다(CRMD: +385% → 매출 63배 → 주당 $545.63,
  // 시총의 73배). 막아야 할 것은 성장'률'이 아니라 그 투영이 실제로 주장하는 결과이므로,
  // 페이드를 그대로 태워 매출 경로를 먼저 만들고 그 마지막 해가 지금의 몇 배인지로
  // 판단한다. 같은 초기 성장률이라도 페이드 스케줄·예측 연차·터미널 성장률이 달라지면
  // 결과는 크게 달라지는데, 초기 성장률 상한은 그 차이를 보지 못한다.
  const revenuePath: number[] = []
  let revenueI = revenue
  for (let year = 1; year <= years; year++) {
    const fade = interpolate(fadeCurve, year)
    const growth = terminalGrowthRate + fade * (initialGrowthRate - terminalGrowthRate)
    revenueI = revenueI * (1 + growth)
    revenuePath.push(revenueI)
  }
  const impliedRevenueMultiple = revenuePath[revenuePath.length - 1]! / revenue

  // 상한을 넘으면 그 값을 상한으로 대체하지 않고 판단을 포기한다: 대체하는 순간 화면의
  // 숫자는 회사에 대한 측정이 아니라 우리가 고른 가정이 된다.
  if (impliedRevenueMultiple > v.max_implied_revenue_multiple) {
    return insufficient(
      'GROWTH_NOT_PROJECTABLE',
      `추세 성장률 ${(initialGrowthRate * 100).toFixed(1)}%를 페이드에 태우면 ${years}년 뒤 매출이 ` +
        `${impliedRevenueMultiple.toFixed(2)}배가 되어 투영 상한 ` +
        `${v.max_implied_revenue_multiple.toFixed(2)}배를 초과 — 이만큼의 확대를 전제한 값은 ` +
        '측정이 아니라 가정이므로 내재가치를 산출하지 않음',
    )
  }

  // 초기 FCF마진: 실제 FCF마진이 양수면 그것을 쓴다. FCF가 없거나 음수인데 영업이익이
  // 양수라서 게이트를 통과한 경우(자본지출이 큰 성장 단계) NOPAT마진으로 대신한다 —
  // 이 기업이 게이트를 통과한 근거 자체가 그 지표였으므로 투영 기준도 같아야 한다.
  const taxRate = cfg.scoring.tax_rate
  const fcfM = fcfMargin(ttm0)
  let initialFcfMargin: number
  let initialMarginSource: FairValueAssumptions['initialMarginSource']
  if (fcfM !== null && fcfM > 0) {
    initialFcfMargin = fcfM
    initialMarginSource = 'fcf'
  } else {
    const opM = operatingMargin(ttm0)!
    initialFcfMargin = opM * (1 - taxRate)
    initialMarginSource = 'nopat_proxy'
  }

  // 일곱 번째 게이트 — 성숙마진. 터미널가치가 기업가치의 4분의 3을 차지하고 그 터미널
  // FCF가 `매출₅ × 성숙마진`이므로, 이 하나가 회사별 측정이 아니면 DCF 전체가 매출배수가
  // 된다. 앵커할 이력이 없으면 전역값으로 메우지 않고 숫자를 내지 않는다.
  const anchored = matureMarginFrom(snapshot.annual, initialMarginSource, taxRate, v.mature_margin)
  if (!anchored.ok) {
    return insufficient('MARGIN_NOT_ANCHORABLE', anchored.detail)
  }
  const matureFcfMargin = anchored.margin

  // 매출 경로는 게이트가 이미 만든 것을 그대로 쓴다 — 게이트가 본 투영과 값을 내는 투영이
  // 같은 하나여야 한다(두 번 계산하면 둘이 갈라질 수 있다).
  const projectedFcf: number[] = []
  for (let year = 1; year <= years; year++) {
    const fade = interpolate(fadeCurve, year)
    const margin = matureFcfMargin + fade * (initialFcfMargin - matureFcfMargin)
    projectedFcf.push(revenuePath[year - 1]! * margin)
  }

  let pv = 0
  for (let i = 0; i < projectedFcf.length; i++) {
    pv += projectedFcf[i]! / Math.pow(1 + discountRate, i + 1)
  }
  const terminalFcf = projectedFcf[projectedFcf.length - 1]! * (1 + terminalGrowthRate)
  const terminalValue = terminalFcf / (discountRate - terminalGrowthRate)
  const enterpriseValue = pv + terminalValue / Math.pow(1 + discountRate, years)
  const equityValue = enterpriseValue + netCash
  const perShare = equityValue / shares

  const assumptions: FairValueAssumptions = {
    projectionYears: years,
    discountRate,
    terminalGrowthRate,
    initialGrowthRate,
    initialGrowthSource,
    matureFcfMargin,
    matureMarginPeriods: anchored.periods,
    matureMarginDispersion: anchored.dispersion,
    initialFcfMargin,
    initialMarginSource,
    impliedRevenueMultiple,
    taxRate,
    netCash,
    shares,
    sharesSource,
  }

  return {
    status: 'OK',
    perShare,
    enterpriseValue,
    equityValue,
    assumptions,
    detail:
      `${years}년 예측 + 터미널가치, 할인율(WACC) ${(discountRate * 100).toFixed(1)}% · ` +
      `초기성장률 ${(initialGrowthRate * 100).toFixed(1)}% → 터미널 ${(terminalGrowthRate * 100).toFixed(1)}%로 수렴 · ` +
      `초기 FCF마진 ${(initialFcfMargin * 100).toFixed(1)}% → 성숙마진 ${(matureFcfMargin * 100).toFixed(1)}%로 수렴` +
      `(최근 연간 ${anchored.periods}개 기간 ${initialMarginSource === 'fcf' ? 'FCF마진' : 'NOPAT마진'} 중앙값) · ` +
      `${years}년 뒤 매출 ${impliedRevenueMultiple.toFixed(2)}배를 전제`,
  }
}
