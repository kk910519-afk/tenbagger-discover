// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { ColumnLegend } from '@/app/_components/ColumnLegend'

afterEach(() => cleanup())

describe('ColumnLegend — 테이블 위 상시 범례', () => {
  it('7개 지표 라벨을 전부 렌더링한다', () => {
    const { container } = render(<ColumnLegend />)
    const labels = ['Market Cap', 'Rev Growth', 'Gross Margin', 'FCF Margin', 'Debt', 'Tenbagger', 'Risk']
    for (const label of labels) {
      expect(container.textContent).toContain(label)
    }
  })

  it('각 지표의 승인된 "무엇인지" 문구를 그대로 표시한다', () => {
    const { container } = render(<ColumnLegend />)
    expect(container.textContent).toContain('회사 전체의 시장 가격. 주가 × 발행주식수.')
    expect(container.textContent).toContain('최근 1년 매출이 그 전 1년보다 얼마나 늘었는지.')
    expect(container.textContent).toContain('매출에서 원가를 뺀 비율. 하나 팔 때 얼마가 남는지.')
    expect(container.textContent).toContain('사업을 굴리고 실제로 손에 남은 현금의 비율.')
    expect(container.textContent).toContain('갚아야 할 빚의 총액.')
    expect(container.textContent).toContain('9개 항목을 종합한 성장 잠재력 점수. 0~100.')
    expect(container.textContent).toContain('재무적으로 위험한 신호가 잡혔는지.')
  })

  it('상호작용 없이(툴팁 트리거 없이) 항상 보이는 정적 텍스트다', () => {
    const { container } = render(<ColumnLegend />)
    expect(container.querySelector('[tabindex="0"]')).toBeNull()
    expect(container.querySelector('[role="tooltip"]')).toBeNull()
  })
})
