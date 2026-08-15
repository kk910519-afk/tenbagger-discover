/**
 * 화면에 낼 수 있는 자릿수로 숫자를 옮기는 규칙. 순수 함수이므로 엔진(tenbagger·
 * valuation)과 UI가 함께 읽는다 — 같은 규칙이 세 군데에 따로 구현되어 갈라지는 것을 막는다.
 */

/**
 * 만(10⁴) 단위 경계.
 *
 * 다섯 자리 이상의 퍼센트는 화면에서 정보가 아니라 경보가 된다 — "+176460.1%"에서 읽을
 * 수 있는 것은 "크다"뿐이다. 그런 숫자는 예외 없이 분모가 미미해서 생기며(매출 $726K로
 * 나눈 비율), 읽는 사람이 판단하려면 비율이 아니라 그 분모를 봐야 한다.
 *
 * 그 분모를 알고 있는 자리에서는 비율 대신 **비율을 만든 두 값**을 적는 것이 가장 낫고
 * (engines/tenbagger의 revenue_growth·revenue_acceleration·operating_leverage가 그렇게
 * 한다), 이 경계는 그렇게 하지 못하는 나머지 자리를 위한 안전망이다. 한국어에서 표준인
 * 만 단위로 **같은 값을 다시 적을 뿐** 깎거나 감추지 않는다 — 표기 변환이지 캡이 아니다.
 */
export const MAN_UNIT = 10_000

/** |n| 이 만 단위 경계를 넘으면 "N.N만"으로 적는다. 부호는 호출부가 붙인다. */
export function compactMagnitude(n: number, digits: number): string {
  return Math.abs(n) < MAN_UNIT ? n.toFixed(digits) : `${(n / MAN_UNIT).toFixed(1)}만`
}
