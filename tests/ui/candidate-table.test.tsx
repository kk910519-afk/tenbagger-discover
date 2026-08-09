// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { cleanup, render, fireEvent } from '@testing-library/react'
import { CandidateTable } from '@/app/_components/CandidateTable'
import type { CandidateRow } from '@/app/_queries/industry'

afterEach(() => cleanup())

function makeRow(overrides: Partial<CandidateRow> & { cik: number; ticker: string }): CandidateRow {
  return {
    name: `${overrides.ticker} Inc`,
    category: 'CHALLENGER',
    marketCap: 5e9,
    revenueGrowth: 0.3,
    grossMargin: 0.6,
    fcfMargin: 0.1,
    totalDebt: 100,
    tenbagger: 50,
    completeness: 0.95,
    criticalCount: 0,
    warningCount: 0,
    ...overrides,
  }
}

describe('CandidateTable — 미평가/DATA 배지', () => {
  it('completeness가 null이면 미평가 배지만 뜨고 DATA 배지는 뜨지 않는다', () => {
    const rows = [makeRow({ cik: 1, ticker: 'NOSCR', completeness: null })]
    const { container } = render(
      <CandidateTable rows={rows} showAll={false} industrySlug="semiconductors" insufficientBelow={0.6} />,
    )
    expect(container.textContent).toContain('미평가')
    expect(container.textContent).not.toContain('DATA')
  })

  it('completeness가 임계값 미만인 실측치면 DATA 배지가 뜨고 미평가는 뜨지 않는다', () => {
    // 티커/회사명이 'DATA'라는 부분 문자열을 우연히도 포함하지 않도록 고른다 —
    // 그러면 배지가 안 떠도 toContain('DATA')가 거짓으로 통과해버린다.
    const rows = [makeRow({ cik: 2, ticker: 'SPARSE', completeness: 0.3 })]
    const { container } = render(
      <CandidateTable rows={rows} showAll={false} industrySlug="semiconductors" insufficientBelow={0.6} />,
    )
    expect(container.textContent).toContain('DATA')
    expect(container.textContent).not.toContain('미평가')
  })
})

describe('CandidateTable — 미리보기/View All', () => {
  it('10개를 초과하는 그룹은 View All 링크에 잘리지 않은 전체 개수를 표시한다', () => {
    const rows = Array.from({ length: 11 }, (_, i) => makeRow({ cik: i + 1, ticker: `T${i}` }))
    const { container } = render(
      <CandidateTable rows={rows} showAll={false} industrySlug="semiconductors" insufficientBelow={0.6} />,
    )
    const link = container.querySelector('a[href$="?all=1"]')
    expect(link?.textContent).toBe('View All Candidates (11)')
    expect(link?.textContent).not.toContain('(10)')
    // 미리보기 자체는 10개로 잘려 있어야 한다
    expect(container.querySelectorAll('tbody tr')).toHaveLength(10)
  })

  it('10개 이하인 그룹은 View All 링크를 렌더링하지 않는다', () => {
    const rows = Array.from({ length: 10 }, (_, i) => makeRow({ cik: i + 1, ticker: `T${i}` }))
    const { container } = render(
      <CandidateTable rows={rows} showAll={false} industrySlug="semiconductors" insufficientBelow={0.6} />,
    )
    expect(container.querySelector('a[href$="?all=1"]')).toBeNull()
    expect(container.textContent).not.toContain('View All')
  })
})

describe('CandidateTable — 헤더 툴팁', () => {
  it('Ticker 헤더에는 툴팁 트리거(점선 밑줄)가 없다', () => {
    const rows = [makeRow({ cik: 1, ticker: 'AAA' })]
    const { container } = render(
      <CandidateTable rows={rows} showAll={false} industrySlug="semiconductors" insufficientBelow={0.6} />,
    )
    const tickerTh = Array.from(container.querySelectorAll('th')).find(
      (th) => th.textContent === 'Ticker',
    )!
    expect(tickerTh.querySelector('[tabindex="0"]')).toBeNull()
  })

  it('Ticker를 제외한 나머지 8개 헤더 전부에 툴팁 트리거가 붙는다', () => {
    const rows = [makeRow({ cik: 1, ticker: 'AAA' })]
    const { container } = render(
      <CandidateTable rows={rows} showAll={false} industrySlug="semiconductors" insufficientBelow={0.6} />,
    )
    const headers = Array.from(container.querySelectorAll('thead th'))
    expect(headers).toHaveLength(9)
    const withTooltip = headers.filter((th) => th.querySelector('[tabindex="0"]') !== null)
    expect(withTooltip).toHaveLength(8)
  })

  it('Company 헤더에 focus하면 승인된 문구가 그대로 뜬다', () => {
    const rows = [makeRow({ cik: 1, ticker: 'AAA' })]
    const { container } = render(
      <CandidateTable rows={rows} showAll={false} industrySlug="semiconductors" insufficientBelow={0.6} />,
    )
    const companyTh = Array.from(container.querySelectorAll('th')).find(
      (th) => th.textContent === 'Company',
    )!
    const trigger = companyTh.querySelector('[tabindex="0"]') as HTMLElement
    fireEvent.focus(trigger)
    const panel = container.querySelector('[role="tooltip"]')
    expect(panel?.textContent).toBe(
      '산업 분류가 SIC 기본값인지 수동 교정인지 표시합니다. 기본값이면 같은 산업 내 비교가 거칠 수 있습니다.',
    )
  })
})
