import type { AppConfig } from '@/config'
import type { CompanySnapshot } from '@/domain/types'
import { interpolate } from '@/domain/curve'
import { ttmRevenueGrowth, revenueCagr3y, fcfMargin, operatingMargin } from '@/domain/metrics'

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
  | 'INVALID_ASSUMPTIONS'

/** UI가 "이 숫자가 어떻게 나왔는지"를 공개할 수 있도록, 계산에 실제로 쓰인 가정을 모두 담는다. */
export type FairValueAssumptions = {
  projectionYears: number
  discountRate: number
  terminalGrowthRate: number
  initialGrowthRate: number
  initialGrowthSource: 'blend' | 'ttm_yoy_only' | 'cagr_3y_only'
  matureFcfMargin: number
  initialFcfMargin: number
  initialMarginSource: 'fcf' | 'nopat_proxy'
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
 * 명시적 다년 FCF 예측 + 터미널가치를 요구수익률로 할인하고, 순현금을 더해 희석주식수로
 * 나눈 주당 내재가치. 모든 가정은 config.yaml의 valuation 섹션에 있다 — 코드에 숨은
 * 리터럴은 없다.
 *
 * 게이트가 이 함수의 핵심이다: 사전매출 단계이거나 현금을 태우기만 하는 기업에 마진을
 * 투영하는 것은 밸류에이션이 아니라 저작(authorship)이다. 여섯 가지를 최소 요건으로 둔다.
 *   1) 최근 TTM 매출이 양수 — 매출이 없으면 애초에 밸류에이션 대상이 아니다
 *   2) 성장률을 추정할 매출 이력(TTM YoY 또는 3Y CAGR 중 하나) — 없으면 초기 성장률 자체가 조작
 *   3) 매출을 현금으로 전환한다는 증거(FCF>0 또는 영업이익>0) — 적자 소각 기업을 배제
 *   4) 희석주식수 또는 발행주식수 — 주당 가치로 나눌 분모가 없으면 숫자를 낼 수 없다
 *   5) 현금과 총부채가 모두 존재 — "순현금 반영"이 공식의 일부이므로, 없는 값을 0으로
 *      대신 채우지 않고 통째로 INSUFFICIENT_DATA 처리한다
 *   6) 초기 성장률이 valuation.max_projectable_growth 이하 — 추세 성장률 하나가 5년간
 *      복리로 곱해지므로, 그 상한을 넘는 값은 상한으로 깎지 않고(깎는 것은 우리가 성장률을
 *      지어내는 일이다) 숫자를 내지 않는다. 근거와 수치는 config.yaml의 주석 참고.
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

  // 페이드 곡선은 초기 성장률을 터미널 성장률로 수렴시킬 뿐 상한을 두지 않는다 — 그래서
  // 한 번의 극단적 추세치가 5년 복리로 증폭된다(CRMD: +385% → 매출 63배 → 주당 $545.63,
  // 시총의 73배). 상한을 넘으면 그 값을 상한으로 대체하지 않고 판단을 포기한다: 대체하는
  // 순간 화면의 숫자는 회사에 대한 측정이 아니라 우리가 고른 가정이 된다.
  if (initialGrowthRate > v.max_projectable_growth) {
    return insufficient(
      'GROWTH_NOT_PROJECTABLE',
      `추세 성장률 ${(initialGrowthRate * 100).toFixed(1)}%가 투영 상한 ` +
        `${(v.max_projectable_growth * 100).toFixed(1)}%를 초과 — 이 비율을 ${v.projection_years}년 ` +
        '복리로 늘리면 측정이 아니라 가정이 되므로 내재가치를 산출하지 않음',
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

  const years = v.projection_years
  const matureFcfMargin = v.mature_fcf_margin
  const fadeCurve = v.fade_curve

  let revenueI = revenue
  const projectedFcf: number[] = []
  for (let year = 1; year <= years; year++) {
    const fade = interpolate(fadeCurve, year)
    const growth = terminalGrowthRate + fade * (initialGrowthRate - terminalGrowthRate)
    revenueI = revenueI * (1 + growth)
    const margin = matureFcfMargin + fade * (initialFcfMargin - matureFcfMargin)
    projectedFcf.push(revenueI * margin)
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
    initialFcfMargin,
    initialMarginSource,
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
      `초기 FCF마진 ${(initialFcfMargin * 100).toFixed(1)}% → 성숙마진 ${(matureFcfMargin * 100).toFixed(1)}%로 수렴`,
  }
}
