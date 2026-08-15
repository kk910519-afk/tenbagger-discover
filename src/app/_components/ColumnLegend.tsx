import { Legend, type LegendItem } from './Legend'

/**
 * 후보 테이블 위에 항상 보이는 범례. "이 숫자가 뭔지"만 짧게 답한다 —
 * "어떻게 해석할지"는 각 헤더의 툴팁(hover/focus)이 맡는다. 페이지당 한 번,
 * 첫 번째 그룹 위에만 렌더링한다 (그룹마다 반복하지 않는다).
 */
const LEGEND_ITEMS: LegendItem[] = [
  { label: 'Market Cap', help: '회사 전체의 시장 가격. 주가 × 발행주식수.' },
  { label: 'Rev Growth', help: '최근 1년 매출이 그 전 1년보다 얼마나 늘었는지.' },
  { label: 'Gross Margin', help: '매출에서 원가를 뺀 비율. 하나 팔 때 얼마가 남는지.' },
  { label: 'FCF Margin', help: '사업을 굴리고 실제로 손에 남은 현금의 비율.' },
  { label: 'Debt', help: '갚아야 할 빚의 총액.' },
  { label: 'Tenbagger', help: '9개 항목을 종합한 성장 잠재력 점수. 0~100.' },
  { label: 'Risk', help: '재무적으로 위험한 신호가 잡혔는지.' },
]

export function ColumnLegend() {
  return <Legend items={LEGEND_ITEMS} />
}
