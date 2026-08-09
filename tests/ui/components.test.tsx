// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { Value, SignedValue } from '@/app/_components/Value'
import { Badge, CategoryBadge } from '@/app/_components/Badge'
import { ScoreBar } from '@/app/_components/ScoreBar'

afterEach(() => cleanup())

describe('ScoreBar', () => {
  it('null과 0은 트랙이 다르게 렌더링된다', () => {
    const { container: nullContainer } = render(<ScoreBar value={null} />)
    const { container: zeroContainer } = render(<ScoreBar value={0} />)

    const nullTrack = nullContainer.querySelector('[data-score-state]')
    const zeroTrack = zeroContainer.querySelector('[data-score-state]')

    expect(nullTrack?.getAttribute('data-score-state')).toBe('unknown')
    expect(zeroTrack?.getAttribute('data-score-state')).toBe('value')

    // null: 점선 트랙, 채움 막대 없음(자식 없음)
    expect(nullTrack?.className).toMatch(/border-dashed/)
    expect(nullTrack?.children.length).toBe(0)

    // 0: 실선 트랙, 길이 0인 채움 막대는 존재한다
    expect(zeroTrack?.className).not.toMatch(/border-dashed/)
    expect(zeroTrack?.children.length).toBe(1)
    expect((zeroTrack?.children[0] as HTMLElement).style.width).toBe('0%')

    // 숫자 슬롯은 null일 때만 em dash
    expect(nullContainer.textContent).toContain('—')
    expect(zeroContainer.textContent).not.toContain('—')
    expect(zeroContainer.textContent).toContain('0')
  })

  it('max를 초과하는 값은 100%로 클램프한다', () => {
    const { container } = render(<ScoreBar value={150} max={100} />)
    const fill = container.querySelector('[data-score-state] > div') as HTMLElement
    expect(fill.style.width).toBe('100%')
  })

  it('음수 값은 0%로 클램프한다', () => {
    const { container } = render(<ScoreBar value={-20} max={100} />)
    const fill = container.querySelector('[data-score-state] > div') as HTMLElement
    expect(fill.style.width).toBe('0%')
  })
})

describe('SignedValue', () => {
  it('정확히 0은 중립으로 취급한다(양수 색 없음)', () => {
    const { container } = render(<SignedValue value={0} text="0.0%" />)
    const span = container.querySelector('span')
    expect(span?.className).not.toMatch(/color-positive/)
    expect(span?.className).not.toMatch(/color-risk/)
  })

  it('양수는 positive 색을 쓴다', () => {
    const { container } = render(<SignedValue value={5} text="+5.0%" />)
    const span = container.querySelector('span')
    expect(span?.className).toMatch(/color-positive/)
  })

  it('음수는 risk 색을 쓴다', () => {
    const { container } = render(<SignedValue value={-5} text="-5.0%" />)
    const span = container.querySelector('span')
    expect(span?.className).toMatch(/color-risk/)
  })
})

describe('CategoryBadge', () => {
  it('category가 null이면 아무것도 렌더링하지 않는다', () => {
    const { container } = render(<CategoryBadge category={null} />)
    expect(container.textContent).toBe('')
    expect(container.firstChild).toBeNull()
  })

  it('LEADER는 leader 톤 배지를 렌더링한다', () => {
    const { container } = render(<CategoryBadge category="LEADER" />)
    expect(container.textContent).toBe('LEADER')
    expect(container.querySelector('span')?.className).toMatch(/color-info/)
  })
})

describe('Value / Badge 기본 렌더링', () => {
  it('Value는 children을 그대로 표시한다', () => {
    const { container } = render(<Value>{'123'}</Value>)
    expect(container.textContent).toBe('123')
  })

  it('Badge는 지정한 톤의 클래스를 적용한다', () => {
    const { container } = render(<Badge tone="risk">RISK</Badge>)
    expect(container.querySelector('span')?.className).toMatch(/color-risk/)
  })
})
