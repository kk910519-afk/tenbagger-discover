import type { FinancialPeriod } from './types.js'
import { yoy, cagr } from './growth.js'
import { olsSlope } from './stats.js'

const QUARTERS_PER_YEAR = 4

function ratio(numerator: number | null, revenue: number | null): number | null {
  if (numerator === null || revenue === null || revenue <= 0) return null
  return numerator / revenue
}

export function ttmRevenueGrowth(ttm: FinancialPeriod[]): number | null {
  return yoy(ttm[0]?.revenue ?? null, ttm[QUARTERS_PER_YEAR]?.revenue ?? null)
}

export function revenueCagr3y(ttm: FinancialPeriod[]): number | null {
  return cagr(ttm[0]?.revenue ?? null, ttm[12]?.revenue ?? null, 3)
}

/** 최근 2개 분기 YoY 평균 − 직전 2개 분기 YoY 평균. 분기 8개가 필요하다. */
export function revenueAcceleration(quarterly: FinancialPeriod[]): number | null {
  if (quarterly.length < 8) return null
  const q = (i: number) => quarterly[i]?.revenue ?? null
  const growthAt = (i: number) => yoy(q(i), q(i + QUARTERS_PER_YEAR))

  const recent = [growthAt(0), growthAt(1)]
  const prior = [growthAt(2), growthAt(3)]
  if (recent.some((v) => v === null) || prior.some((v) => v === null)) return null

  const mean = (xs: (number | null)[]) => (xs as number[]).reduce((a, b) => a + b, 0) / xs.length
  return mean(recent) - mean(prior)
}

export function grossMargin(p: FinancialPeriod | undefined): number | null {
  return p ? ratio(p.grossProfit, p.revenue) : null
}

export function operatingMargin(p: FinancialPeriod | undefined): number | null {
  return p ? ratio(p.operatingIncome, p.revenue) : null
}

export function fcfMargin(p: FinancialPeriod | undefined): number | null {
  return p ? ratio(p.fcf, p.revenue) : null
}

/** 오래된 순으로 반환한다. 기울기가 양수면 마진이 개선되고 있다는 뜻. */
export function grossMarginSeries(quarterly: FinancialPeriod[], n: number): number[] {
  const out: number[] = []
  for (const q of quarterly.slice(0, n)) {
    const gm = grossMargin(q)
    if (gm !== null) out.push(gm)
  }
  return out.reverse()
}

/** 분기당 기울기를 연율 bps로 환산한다. */
export function grossMarginTrendBps(
  quarterly: FinancialPeriod[],
  n: number,
): number | null {
  const series = grossMarginSeries(quarterly, n)
  if (series.length < n) return null
  const slope = olsSlope(series)
  return slope === null ? null : slope * QUARTERS_PER_YEAR * 10_000
}

/**
 * 투하자본이 "그 자체를 이루는 총액"에서 차지하는 비중. 0 근처면 투하자본은 큰 수들이
 * 상쇄되고 남은 잔차이며, 그것을 분모로 쓴 ROIC는 사업의 자본생산성이 아니라 자본구조의
 * 산물이다 — 자사주 매입으로 자본이 음수가 된 기업(DBX)과 현금이 부채+자본을 넘는
 * 기업(NTAP)이 같은 이유로 여기에 걸린다. 부호가 아니라 상쇄의 정도를 보므로 총액은
 * 절댓값 합으로 잡는다.
 */
function investedCapitalRatio(totalDebt: number, equity: number, cash: number): number | null {
  const gross = Math.abs(totalDebt) + Math.abs(equity) + Math.abs(cash)
  if (gross <= 0) return null
  return (totalDebt + equity - cash) / gross
}

export function roic(
  p: FinancialPeriod | undefined,
  taxRate: number,
  minInvestedCapitalRatio: number,
): number | null {
  if (!p || p.operatingIncome === null) return null
  if (p.totalDebt === null || p.equity === null || p.cash === null) return null
  const invested = p.totalDebt + p.equity - p.cash
  if (invested <= 0) return null
  const ratio = investedCapitalRatio(p.totalDebt, p.equity, p.cash)
  if (ratio === null || ratio < minInvestedCapitalRatio) return null
  return (p.operatingIncome * (1 - taxRate)) / invested
}

/**
 * roic()가 null인 이유를 셋으로 구분한다: 재무 항목 자체가 없는 것(MISSING_FIELDS, 진짜
 * "모른다")과, 항목은 다 있는데 투하자본(totalDebt + equity − cash)이 0 이하로 나오는
 * 것(NON_POSITIVE_INVESTED_CAPITAL — 현금이 부채·자본 합계보다 많은 초기 성장 단계
 * 기업에 흔하다. 이건 결측이 아니라 ROIC라는 지표 자체가 정의되지 않는 경우다), 그리고
 * 투하자본이 양수이긴 하지만 총액 대비 무시할 만큼 작아 분모로 쓸 수 없는 것
 * (IMMATERIAL_INVESTED_CAPITAL). 뒤의 둘은 "결측"이 아니라 "이 지표가 적용되지 않는다"는
 * 같은 성격이므로 소비자(moat-signal)는 둘을 함께 다룬다.
 *
 * roic() 본체는 건드리지 않는다 — Tenbagger 채점 엔진이 그 함수를 그대로 공유하므로,
 * 이 함수는 같은 조건을 별도로 재현해 분류만 얹을 뿐 roic()의 반환값에는 관여하지 않는다.
 */
export type RoicGap =
  | 'MISSING_FIELDS'
  | 'NON_POSITIVE_INVESTED_CAPITAL'
  | 'IMMATERIAL_INVESTED_CAPITAL'

export function roicGap(
  p: FinancialPeriod | undefined,
  minInvestedCapitalRatio: number,
): RoicGap | null {
  if (!p) return 'MISSING_FIELDS'
  if (p.operatingIncome === null || p.totalDebt === null || p.equity === null || p.cash === null) {
    return 'MISSING_FIELDS'
  }
  const invested = p.totalDebt + p.equity - p.cash
  if (invested <= 0) return 'NON_POSITIVE_INVESTED_CAPITAL'
  const ratio = investedCapitalRatio(p.totalDebt, p.equity, p.cash)
  if (ratio === null || ratio < minInvestedCapitalRatio) return 'IMMATERIAL_INVESTED_CAPITAL'
  return null
}

/** FCF가 음수인 기업만 의미가 있다. 분기 평균 소모액 기준 잔여 분기 수. */
export function cashRunwayQuarters(ttm: FinancialPeriod[]): number | null {
  const p = ttm[0]
  if (!p || p.fcf === null || p.fcf >= 0 || p.cash === null) return null
  const burnPerQuarter = -p.fcf / QUARTERS_PER_YEAR
  if (burnPerQuarter <= 0) return null
  return p.cash / burnPerQuarter
}

export function netCashToMarketCap(
  p: FinancialPeriod | undefined,
  marketCap: number | null,
): number | null {
  if (!p || marketCap === null || marketCap <= 0) return null
  if (p.cash === null || p.totalDebt === null) return null
  return (p.cash - p.totalDebt) / marketCap
}

/** EBITDA는 감가상각 태그를 안정적으로 얻기 어려워 영업이익으로 근사한다. */
export function debtToEbitda(p: FinancialPeriod | undefined): number | null {
  if (!p || p.totalDebt === null || p.operatingIncome === null) return null
  if (p.operatingIncome <= 0) return null
  return p.totalDebt / p.operatingIncome
}

function opexOf(p: FinancialPeriod | undefined): number | null {
  if (!p || p.grossProfit === null || p.operatingIncome === null) return null
  return p.grossProfit - p.operatingIncome
}

export function opexGrowth(ttm: FinancialPeriod[]): number | null {
  return yoy(opexOf(ttm[0]), opexOf(ttm[QUARTERS_PER_YEAR]))
}
