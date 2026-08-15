// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { RecordCards } from '@/app/_components/RecordCards'
import { CandidateTable } from '@/app/_components/CandidateTable'
import { TopCandidates } from '@/app/_components/TopCandidates'
import type { CandidateRow } from '@/app/_queries/industry'
import type { TopCandidate } from '@/app/_queries/top-candidates'

afterEach(() => cleanup())

/**
 * 좁은 화면에서 표가 짜부라지던 문제(한글 헤더가 한 글자씩 세로로 쪼개지고 마지막 열이
 * 소리 없이 잘려 나감)를 카드 레이아웃으로 바꿔 고쳤다. jsdom은 미디어 쿼리를 계산하지
 * 않으므로 "모바일에서 실제로 어떻게 보이는지"는 여기서 검증할 수 없다 — 대신 두 가지
 * 구조적 사실을 지킨다:
 *
 *  1. 표와 카드가 **둘 다** 렌더링되고 서로를 배타적으로 감춘다(md:hidden ↔ hidden md:block).
 *     한쪽만 남으면 그 화면 폭에서는 데이터가 통째로 사라진다.
 *  2. 카드가 표의 데이터를 빠뜨리지 않는다. 카드는 값을 손으로 옮겨 담는 구조라
 *     열이 하나 늘 때 조용히 누락되기 쉽다.
 */
function makeCandidate(overrides: Partial<CandidateRow> & { cik: number; ticker: string }): CandidateRow {
  return {
    name: `${overrides.ticker} Inc`,
    category: 'CHALLENGER',
    marketCap: 4.48e8,
    revenueGrowth: 0.225,
    grossMargin: 0.62,
    fcfMargin: 0.03,
    totalDebt: 1.2e8,
    tenbagger: 82,
    completeness: 0.95,
    criticalCount: 0,
    warningCount: 0,
    ...overrides,
  }
}

const TOP: TopCandidate = {
  cik: 3,
  ticker: 'ATLC',
  name: 'Atlanticus Holdings Corp',
  industrySlug: 'fintech',
  industryName: 'Fintech',
  tenbagger: 82,
  hasCriticalFlag: true,
  rationale: 'TTM 매출 22.5% 성장 — 직전 4개 분기 합계 기준 · 시가총액 $0.45B → 12점',
}

describe('RecordCards — 표를 대신하는 카드 목록', () => {
  it('항목이 없으면 빈 껍데기를 남기지 않는다', () => {
    const { container } = render(<RecordCards items={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('제목·순번·헤드라인·필드·노트를 모두 렌더링한다', () => {
    const { container } = render(
      <RecordCards
        items={[
          {
            key: 'a',
            rank: '01',
            title: 'ATLC',
            href: '/stock/ATLC/',
            subtitle: 'Atlanticus Holdings Corp',
            meta: 'Fintech',
            headline: { label: '점수', value: '82' },
            fields: [{ label: '시가총액', value: '$448M' }],
            note: '근거 문장',
          },
        ]}
      />,
    )
    const text = container.textContent ?? ''
    for (const fragment of ['01', 'ATLC', 'Atlanticus Holdings Corp', 'Fintech', '점수', '82', '시가총액', '$448M', '근거 문장']) {
      expect(text).toContain(fragment)
    }
    expect(container.querySelector('a[href="/stock/ATLC/"]')).not.toBeNull()
  })

  it('href가 없으면 제목을 링크로 감싸지 않는다', () => {
    const { container } = render(
      <RecordCards items={[{ key: 'a', title: '제목', fields: [] }]} />,
    )
    expect(container.querySelector('a')).toBeNull()
  })

  it('span 필드만 두 칸을 차지한다', () => {
    const { container } = render(
      <RecordCards
        items={[
          {
            key: 'a',
            title: '제목',
            fields: [
              { label: '넓은 항목', value: 'x', span: true },
              { label: '좁은 항목', value: 'y' },
            ],
          },
        ]}
      />,
    )
    const cells = Array.from(container.querySelectorAll('dl > div'))
    expect(cells).toHaveLength(2)
    expect(cells[0]!.className).toContain('col-span-2')
    expect(cells[1]!.className).not.toContain('col-span-2')
  })

  it('카드 목록 자체는 md 이상에서 숨는다', () => {
    const { container } = render(<RecordCards items={[{ key: 'a', title: 'A', fields: [] }]} />)
    expect(container.querySelector('[data-record-cards]')?.className).toContain('md:hidden')
  })
})

describe('CandidateTable — 표와 카드가 같은 사실을 말한다', () => {
  const rows = [makeCandidate({ cik: 3, ticker: 'ATLC', name: 'Atlanticus Holdings Corp' })]

  it('표와 카드가 함께 렌더링되고 서로 배타적으로 감춰진다', () => {
    const { container } = render(
      <CandidateTable rows={rows} showAll={false} industrySlug="fintech" insufficientBelow={0.6} />,
    )
    const cards = container.querySelector('[data-record-cards]')
    const tableWrap = container.querySelector('table')!.parentElement!

    expect(cards).not.toBeNull()
    expect(cards!.className).toContain('md:hidden')
    expect(tableWrap.className).toContain('hidden')
    expect(tableWrap.className).toContain('md:block')
  })

  it('표는 폭이 모자라면 줄어들지 않고 넘친다 (min-width + 가로 스크롤)', () => {
    const { container } = render(
      <CandidateTable rows={rows} showAll={false} industrySlug="fintech" insufficientBelow={0.6} />,
    )
    const table = container.querySelector('table')!
    expect(table.className).toMatch(/min-w-\[/)
    expect(table.parentElement!.className).toContain('overflow-x-auto')
  })

  it('카드가 표의 지표를 하나도 빠뜨리지 않는다', () => {
    const { container } = render(
      <CandidateTable rows={rows} showAll={false} industrySlug="fintech" insufficientBelow={0.6} />,
    )
    const cardText = container.querySelector('[data-record-cards]')!.textContent ?? ''
    for (const label of ['Market Cap', 'Rev Growth', 'Gross Margin', 'FCF Margin', 'Debt', 'Tenbagger']) {
      expect(cardText, `카드에 ${label}이(가) 없다`).toContain(label)
    }
    expect(cardText).toContain('ATLC')
    expect(cardText).toContain('$448M')
    expect(cardText).toContain('82')
  })

  it('카드도 표와 같은 위험 배지를 보여준다', () => {
    const flagged = [makeCandidate({ cik: 4, ticker: 'RISKY', criticalCount: 2 })]
    const { container } = render(
      <CandidateTable rows={flagged} showAll={false} industrySlug="fintech" insufficientBelow={0.6} />,
    )
    const cardText = container.querySelector('[data-record-cards]')!.textContent ?? ''
    expect(cardText).toContain('RED FLAG')
  })

  it('배지가 없는 행은 카드에 빈 노트 줄을 남기지 않는다', () => {
    const clean = [makeCandidate({ cik: 5, ticker: 'CLEAN' })]
    const { container } = render(
      <CandidateTable rows={clean} showAll={false} industrySlug="fintech" insufficientBelow={0.6} />,
    )
    const card = container.querySelector('[data-record-cards] li')!
    // 카드의 마지막 블록은 필드 그리드여야 한다 — 그 뒤에 빈 div가 붙지 않는다.
    expect(card.lastElementChild!.tagName).toBe('DL')
  })

  it('카드도 미리보기 개수(10개)를 그대로 따른다', () => {
    const many = Array.from({ length: 14 }, (_, i) => makeCandidate({ cik: i + 100, ticker: `T${i}` }))
    const { container } = render(
      <CandidateTable rows={many} showAll={false} industrySlug="fintech" insufficientBelow={0.6} />,
    )
    expect(container.querySelectorAll('[data-record-cards] li')).toHaveLength(10)
    expect(container.querySelectorAll('tbody tr')).toHaveLength(10)
  })
})

describe('TopCandidates — 표와 카드가 같은 사실을 말한다', () => {
  it('카드는 근거 문장을 자르지 않고 전문을 보여준다', () => {
    const { container } = render(<TopCandidates candidates={[TOP]} />)
    const cardText = container.querySelector('[data-record-cards]')!.textContent ?? ''
    expect(cardText).toContain(TOP.rationale)
    expect(cardText).toContain('RED FLAG')
  })

  it('순번·티커·회사명·산업·점수를 모두 담는다', () => {
    const { container } = render(<TopCandidates candidates={[TOP]} />)
    const cards = container.querySelector('[data-record-cards]')!
    const cardText = cards.textContent ?? ''
    expect(cardText).toContain('01')
    expect(cardText).toContain('ATLC')
    expect(cardText).toContain('Atlanticus Holdings Corp')
    expect(cardText).toContain('Fintech')
    expect(cardText).toContain('82')
    expect(cards.querySelector('a[href="/stock/ATLC/"]')).not.toBeNull()
    expect(cards.querySelector('a[href="/industry/fintech/"]')).not.toBeNull()
  })

  it('표와 카드가 서로 배타적으로 감춰지고, 표는 min-width로 넘친다', () => {
    const { container } = render(<TopCandidates candidates={[TOP]} />)
    const table = container.querySelector('table')!
    expect(table.className).toMatch(/min-w-\[/)
    expect(table.parentElement!.className).toContain('hidden')
    expect(table.parentElement!.className).toContain('md:block')
    expect(container.querySelector('[data-record-cards]')!.className).toContain('md:hidden')
  })
})
