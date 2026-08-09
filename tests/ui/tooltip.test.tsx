// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { cleanup, render, fireEvent } from '@testing-library/react'
import { Tooltip } from '@/app/_components/Tooltip'

afterEach(() => cleanup())

const HELP = '설명 텍스트'

function getTrigger(container: HTMLElement): HTMLElement {
  return container.querySelector('[tabindex="0"]') as HTMLElement
}

function getPanel(container: HTMLElement): HTMLElement | null {
  return container.querySelector('[role="tooltip"]')
}

describe('Tooltip — 마우스 hover로 열고 닫는다', () => {
  it('mouseEnter로 열리고 mouseLeave로 닫힌다', () => {
    const { container } = render(<Tooltip text={HELP}>Label</Tooltip>)
    expect(getPanel(container)).toBeNull()

    fireEvent.mouseEnter(getTrigger(container))
    expect(getPanel(container)?.textContent).toBe(HELP)

    fireEvent.mouseLeave(getTrigger(container))
    expect(getPanel(container)).toBeNull()
  })
})

describe('Tooltip — 키보드 focus로도 열린다', () => {
  it('focus로 열리고 blur로 닫힌다 (hover 없이)', () => {
    const { container } = render(<Tooltip text={HELP}>Label</Tooltip>)
    const trigger = getTrigger(container)

    fireEvent.focus(trigger)
    expect(getPanel(container)?.textContent).toBe(HELP)

    fireEvent.blur(trigger)
    expect(getPanel(container)).toBeNull()
  })

  it('트리거는 Tab으로 도달 가능하다(tabIndex=0)', () => {
    const { container } = render(<Tooltip text={HELP}>Label</Tooltip>)
    expect(getTrigger(container)).not.toBeNull()
  })
})

describe('Tooltip — Escape로 닫힌다', () => {
  it('열린 상태에서 Escape를 누르면 닫힌다', () => {
    const { container } = render(<Tooltip text={HELP}>Label</Tooltip>)
    const trigger = getTrigger(container)

    fireEvent.focus(trigger)
    expect(getPanel(container)).not.toBeNull()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(getPanel(container)).toBeNull()
  })

  it('닫힌 상태에서 Escape를 눌러도 에러 없이 아무 일도 일어나지 않는다', () => {
    const { container } = render(<Tooltip text={HELP}>Label</Tooltip>)
    expect(() => fireEvent.keyDown(document, { key: 'Escape' })).not.toThrow()
    expect(getPanel(container)).toBeNull()
  })
})

describe('Tooltip — 보조기술과의 연결(aria-describedby)', () => {
  it('트리거의 aria-describedby가 열린 툴팁 패널의 id와 일치한다', () => {
    const { container } = render(<Tooltip text={HELP}>Label</Tooltip>)
    const trigger = getTrigger(container)

    fireEvent.focus(trigger)
    const panel = getPanel(container)!
    expect(trigger.getAttribute('aria-describedby')).toBe(panel.id)
    expect(panel.id).toBeTruthy()
  })

  it('네이티브 title 속성은 쓰지 않는다', () => {
    const { container } = render(<Tooltip text={HELP}>Label</Tooltip>)
    expect(getTrigger(container).getAttribute('title')).toBeNull()
  })
})

describe('Tooltip — 헤더가 정보 존재를 시각적으로 알린다', () => {
  it('트리거에 점선 밑줄 스타일이 적용된다', () => {
    const { container } = render(<Tooltip text={HELP}>Label</Tooltip>)
    expect(getTrigger(container).className).toMatch(/border-dotted/)
  })
})
