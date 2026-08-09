// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { ThemeMomentumStrip } from '@/app/_components/ThemeMomentumStrip'
import type { ThemeMomentum } from '@/app/_queries/theme-momentum'

afterEach(() => cleanup())

const SIX_THEMES: ThemeMomentum[] = [
  {
    slug: 'ai-software-semi', name: 'AI / Software / Semiconductor', displayOrder: 1,
    candidateCount: 12, medianRevenueGrowth: 0.22, medianRevenueAcceleration: 0.05,
    topCandidate: { ticker: 'ALAB', name: 'Astera Labs', tenbagger: 98 },
  },
  {
    slug: 'healthcare-biotech', name: 'Healthcare / Biotechnology', displayOrder: 2,
    candidateCount: 8, medianRevenueGrowth: 0.10, medianRevenueAcceleration: 0.02,
    topCandidate: { ticker: 'ASMB', name: 'Assembly Bio', tenbagger: 81 },
  },
  {
    slug: 'industrial-automation-defense', name: 'Industrial / Automation / Defense', displayOrder: 3,
    candidateCount: 3, medianRevenueGrowth: 0.05, medianRevenueAcceleration: 0.01,
    topCandidate: { ticker: 'SENS', name: 'Senstar', tenbagger: 77 },
  },
  {
    slug: 'digital-consumer-fintech', name: 'Digital Consumer / Fintech', displayOrder: 4,
    candidateCount: 6, medianRevenueGrowth: 0.08, medianRevenueAcceleration: 0.03,
    topCandidate: { ticker: 'FTCH', name: 'Fintech Co', tenbagger: 65 },
  },
  {
    slug: 'energy-next', name: 'Energy / Next Energy', displayOrder: 5,
    candidateCount: 4, medianRevenueGrowth: -0.02, medianRevenueAcceleration: -0.01,
    topCandidate: { ticker: 'GRID', name: 'Grid Co', tenbagger: 55 },
  },
  {
    // 적격 후보가 하나도 없는 테마 — em dash로 렌더링돼야 한다
    slug: 'emerging-tech', name: 'Emerging Technology', displayOrder: 6,
    candidateCount: 0, medianRevenueGrowth: null, medianRevenueAcceleration: null,
    topCandidate: null,
  },
]

describe('ThemeMomentumStrip', () => {
  it('테마 6개를 모두 렌더링한다(적격 후보가 0명인 테마 포함)', () => {
    const { container } = render(<ThemeMomentumStrip themes={SIX_THEMES} />)
    for (const t of SIX_THEMES) {
      expect(container.textContent).toContain(t.name)
    }
  })

  it('적격 후보가 있는 테마는 후보 수·중앙값·Top Pick을 숫자로 보여준다', () => {
    const { container } = render(<ThemeMomentumStrip themes={SIX_THEMES} />)
    expect(container.textContent).toContain('12')
    expect(container.textContent).toContain('+22.0%')
    expect(container.textContent).toContain('ALAB')
    const link = container.querySelector('a[href="/stock/ALAB"]')
    expect(link).not.toBeNull()
  })

  it('적격 후보가 0명인 테마는 후보 수만 0으로 보여주고, 나머지는 em dash다(0으로 위장하지 않는다)', () => {
    const { container } = render(<ThemeMomentumStrip themes={SIX_THEMES} />)
    const card = Array.from(container.querySelectorAll('h3')).find(
      (h) => h.textContent === 'Emerging Technology',
    )!.closest('div')!
    expect(card.textContent).toContain('0')
    // 매출성장·매출가속·Top Pick 세 자리 모두 em dash여야 한다(0%가 아니라)
    const dashes = (card.textContent!.match(/—/g) ?? []).length
    expect(dashes).toBe(3)
    expect(card.textContent).not.toContain('0.0%')
  })

  it('LEADER 카테고리 회사가 Top Pick으로 노출되지 않는 것은 쿼리 계층 책임이다 — 컴포넌트는 받은 topCandidate를 그대로 링크한다', () => {
    // (LEADER 제외 로직 자체는 theme-momentum-query.test.ts에서 검증한다. 여기서는
    // 컴포넌트가 topCandidate가 null이 아닐 때 항상 /stock/[ticker]로 링크하는지만 본다.)
    const { container } = render(<ThemeMomentumStrip themes={[SIX_THEMES[0]!]} />)
    expect(container.querySelector('a[href="/stock/ALAB"]')).not.toBeNull()
  })
})
