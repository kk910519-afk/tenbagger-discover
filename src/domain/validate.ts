import type { FinancialPeriod, FieldRejection } from './types.js'

/**
 * 물리적으로 불가능한 값이 스코어링/밸류에이션 엔진까지 도달하지 않도록 막는다.
 * 거부된 필드는 이 제품 전체가 이미 "결측"으로 다루는 null이 된다 — 0이나
 * 추정치로 대체하지 않는다(기존 "결측을 0으로 채우지 않는다" 원칙과 동일선상).
 *
 * 채택한 불변식은 "물리적으로" 불가능한 두 가지뿐이다:
 *
 * 1) revenue < 0 → null.
 *    매출은 청구액의 합이다. 개별 거래의 환불/조정이 있어도 분기·TTM
 *    단위로 집계된 회사 전체 매출이 음수가 되는 것은 정상적인 회계로는
 *    나올 수 없다(실측: SEC bulk의 디멘션 오염이나 세그먼트 태그 재사용이
 *    원인 — period-reconciliation-report.md 2절 참고). 실 DB에 36개사가
 *    있었다.
 * 2) grossProfit > revenue (revenue가 유효한 값일 때만 비교) → grossProfit null.
 *    매출총이익 = 매출 - 매출원가다. 이 부등식이 깨지려면 매출원가가
 *    음수여야 하는데, 매출원가는 회계상 음수가 될 수 없다.
 *
 * 의도적으로 넣지 않은 것: 매출총이익률 하한(예: -50%) 같은 규칙. 매출원가가
 * 매출을 크게 웃도는 것 자체(헐값 재고 처분, 초기 하드웨어 원가 역전 등)는
 * 실제로 벌어질 수 있는 부실 신호이지 물리적 불가능이 아니다. 같은 이유로
 * 영업이익·자본·FCF의 음수는 이 함수가 전혀 건드리지 않는다 — 적자 영업,
 * 자본잠식, 현금 소진은 이 제품이 정확히 찾아내야 하는 부실기업의 신호이므로
 * 여기서 지워버리면 안 된다.
 */
export function validatePeriod(
  cik: number,
  period: FinancialPeriod,
): { period: FinancialPeriod; rejections: FieldRejection[] } {
  const rejections: FieldRejection[] = []
  let { revenue, grossProfit } = period

  if (revenue !== null && revenue < 0) {
    rejections.push({
      cik,
      periodEnd: period.periodEnd,
      periodType: period.periodType,
      field: 'revenue',
      reason: 'revenue_negative',
      value: revenue,
    })
    revenue = null
  }

  if (grossProfit !== null && revenue !== null && grossProfit > revenue) {
    rejections.push({
      cik,
      periodEnd: period.periodEnd,
      periodType: period.periodType,
      field: 'grossProfit',
      reason: 'gross_profit_exceeds_revenue',
      value: grossProfit,
    })
    grossProfit = null
  }

  if (rejections.length === 0) return { period, rejections }
  return { period: { ...period, revenue, grossProfit }, rejections }
}
