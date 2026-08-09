// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { cleanup, render, fireEvent } from '@testing-library/react'
import { OpportunityScatter } from '@/app/_components/OpportunityScatter'
import type { OpportunityMark } from '@/app/_queries/opportunity-scatter'

afterEach(() => cleanup())

const MARKS: OpportunityMark[] = [
  {
    slug: 'semiconductors', name: 'Semiconductors', themeSlug: 'ai-software-semi',
    themeName: 'AI / Software / Semiconductor', candidateCount: 72,
    medianRevenueGrowth: 0.22, medianTenbagger: 54, medianMarketCap: 4.19e9,
  },
  {
    slug: 'pharmaceuticals', name: 'Pharmaceuticals', themeSlug: 'healthcare-biotech',
    themeName: 'Healthcare / Biotechnology', candidateCount: 122,
    medianRevenueGrowth: -0.07, medianTenbagger: 33, medianMarketCap: 7.5e8,
  },
  {
    // 후보는 있지만 전원 시가총액 데이터가 없는 산업 — "크기를 매길 수 없음" 케이스
    slug: 'quantum-computing', name: 'Quantum Computing', themeSlug: 'emerging-tech',
    themeName: 'Emerging Technology', candidateCount: 3,
    medianRevenueGrowth: 0.30, medianTenbagger: 40, medianMarketCap: null,
  },
]

describe('OpportunityScatter — 마크 신원 확인', () => {
  it('모든 마크는 산업 상세로 링크되는 실제 앵커이고, 호버 없이도 이름이 상시 보인다', () => {
    const { container } = render(<OpportunityScatter marks={MARKS} />)
    const link = container.querySelector('a[href="/industry/semiconductors"]')
    expect(link).not.toBeNull()
    // 상시 텍스트 라벨(마크 옆 <text>) — hover/focus 없이도 SVG 텍스트로 존재한다
    expect(container.textContent).toContain('Semiconductors')
    expect(container.textContent).toContain('Pharmaceuticals')
  })

  it('링크에 aria-label로 핵심 수치가 항상 들어 있다(호버 전에도 스크린리더가 읽을 수 있다)', () => {
    const { container } = render(<OpportunityScatter marks={MARKS} />)
    const link = container.querySelector('a[href="/industry/semiconductors"]')!
    const label = link.getAttribute('aria-label')!
    expect(label).toContain('Semiconductors')
    expect(label).toContain('54')
    expect(label).toContain('산업 상세')
  })

  it('키보드 focus로 마크의 상세 정보(tooltip)가 뜨고, blur로 닫힌다', () => {
    const { container } = render(<OpportunityScatter marks={MARKS} />)
    const link = container.querySelector('a[href="/industry/semiconductors"]') as HTMLElement
    expect(container.querySelector('[role="tooltip"]')).toBeNull()

    fireEvent.focus(link)
    const panel = container.querySelector('[role="tooltip"]')
    expect(panel).not.toBeNull()
    expect(panel!.textContent).toContain('Semiconductors')
    expect(panel!.textContent).toContain('AI / Software / Semiconductor')

    fireEvent.blur(link)
    expect(container.querySelector('[role="tooltip"]')).toBeNull()
  })

  it('Escape로도 tooltip이 닫힌다', () => {
    const { container } = render(<OpportunityScatter marks={MARKS} />)
    const link = container.querySelector('a[href="/industry/semiconductors"]') as HTMLElement
    fireEvent.focus(link)
    expect(container.querySelector('[role="tooltip"]')).not.toBeNull()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(container.querySelector('[role="tooltip"]')).toBeNull()
  })

  it('마우스 호버로도 같은 tooltip이 뜬다(hover-only가 아니라 focus와 동등하다)', () => {
    const { container } = render(<OpportunityScatter marks={MARKS} />)
    const link = container.querySelector('a[href="/industry/pharmaceuticals"]') as HTMLElement
    fireEvent.mouseEnter(link)
    const panel = container.querySelector('[role="tooltip"]')
    expect(panel!.textContent).toContain('Pharmaceuticals')
    fireEvent.mouseLeave(link)
    expect(container.querySelector('[role="tooltip"]')).toBeNull()
  })
})

describe('OpportunityScatter — 시가총액 결측 처리', () => {
  it('시가총액이 없는 마크는 채워진 원이 아니라 점선 테두리 원으로 그려진다', () => {
    const { container } = render(<OpportunityScatter marks={MARKS} />)
    const quantumLink = container.querySelector('a[href="/industry/quantum-computing"]')!
    const circles = quantumLink.querySelectorAll('circle')
    // [0]은 히트 타깃(투명), [1]이 실제 표시 마크
    const visible = circles[1]!
    expect(visible.getAttribute('fill')).toBe('none')
    expect(visible.getAttribute('stroke-dasharray')).toBe('2,2')
  })

  it('시가총액이 있는 마크는 채워진 원으로 그려진다(점선이 아니다)', () => {
    const { container } = render(<OpportunityScatter marks={MARKS} />)
    const semiLink = container.querySelector('a[href="/industry/semiconductors"]')!
    const visible = semiLink.querySelectorAll('circle')[1]!
    expect(visible.getAttribute('fill')).not.toBe('none')
    expect(visible.hasAttribute('stroke-dasharray')).toBe(false)
  })

  it('시가총액 결측 마크의 aria-label도 "데이터 없음"을 명시한다(0이나 최소값으로 위장하지 않는다)', () => {
    const { container } = render(<OpportunityScatter marks={MARKS} />)
    const link = container.querySelector('a[href="/industry/quantum-computing"]')!
    expect(link.getAttribute('aria-label')).toContain('데이터 없음')
  })
})

describe('OpportunityScatter — 표 보기(접근성 twin)', () => {
  it('모든 마크가 표 형태로도 존재한다', () => {
    const { container } = render(<OpportunityScatter marks={MARKS} />)
    const details = container.querySelector('details')!
    expect(details).not.toBeNull()
    const rows = details.querySelectorAll('tbody tr')
    expect(rows).toHaveLength(3)
    expect(details.textContent).toContain('Semiconductors')
    expect(details.textContent).toContain('Quantum Computing')
  })
})

describe('OpportunityScatter — 빈 데이터', () => {
  it('마크가 없으면 안내 문구를 보여주고 빈 svg를 그리지 않는다', () => {
    const { container } = render(<OpportunityScatter marks={[]} />)
    expect(container.querySelector('svg')).toBeNull()
    expect(container.textContent).toContain('산업이 아직 없습니다')
  })
})
