import type { AppConfig } from '@/config'
import type { FairValueResult } from './fair-value.js'

export type ValuationStatus = 'UNDERVALUED' | 'FAIRLY_VALUED' | 'OVERVALUED'

export type PriceToFairValueResult =
  | {
      status: 'OK'
      ratio: number
      /** (fairValue - price) / fairValue. 양수 = 저평가(안전마진 존재), 음수 = 고평가. */
      marginOfSafety: number
      valuationStatus: ValuationStatus
    }
  | {
      status: 'UNAVAILABLE'
      reason: string
    }

/**
 * 내재가치가 INSUFFICIENT_DATA면 이 값들도 존재할 수 없다 — 0이나 "FAIRLY_VALUED"로
 * 얼버무리지 않는다. 그 상태를 표현하려고 별도의 UNAVAILABLE 분기를 둔다.
 */
export function computePriceToFairValue(
  fairValue: FairValueResult,
  price: number | null,
  cfg: AppConfig,
): PriceToFairValueResult {
  if (fairValue.status !== 'OK') {
    return { status: 'UNAVAILABLE', reason: '내재가치를 추정할 수 없음 (INSUFFICIENT_DATA)' }
  }
  if (fairValue.perShare <= 0) {
    return { status: 'UNAVAILABLE', reason: '산출된 내재가치가 0 이하 — 비율이 의미를 갖지 않음' }
  }
  if (price === null || price <= 0) {
    return { status: 'UNAVAILABLE', reason: '현재가 없음' }
  }

  const ratio = price / fairValue.perShare
  const marginOfSafety = (fairValue.perShare - price) / fairValue.perShare
  const bands = cfg.valuation.price_to_fair_value

  let valuationStatus: ValuationStatus
  if (ratio <= bands.undervalued_max_ratio) valuationStatus = 'UNDERVALUED'
  else if (ratio >= bands.overvalued_min_ratio) valuationStatus = 'OVERVALUED'
  else valuationStatus = 'FAIRLY_VALUED'

  return { status: 'OK', ratio, marginOfSafety, valuationStatus }
}
