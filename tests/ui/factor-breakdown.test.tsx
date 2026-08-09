// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { FactorBreakdown, StrengthWeakness } from '@/app/_components/FactorBreakdown'
import type { FactorView } from '@/app/_queries/stock'

afterEach(() => cleanup())

function factor(overrides: Partial<FactorView> & { key: string }): FactorView {
  return {
    weight: 10,
    points: 5,
    raw: 0.5,
    status: 'SCORED',
    percentile: 0.5,
    detail: 'detail',
    ...overrides,
  }
}

describe('FactorBreakdown — NO_DATA와 NOT_IMPLEMENTED는 다르게 읽혀야 한다', () => {
  it('NO_DATA는 "NO DATA" 배지를 단다', () => {
    const { container } = render(
      <FactorBreakdown factors={[factor({ key: 'balance_sheet', status: 'NO_DATA', points: null, percentile: null })]} />,
    )
    expect(container.textContent).toContain('NO DATA')
    expect(container.textContent).not.toContain('PHASE 4')
  })

  it('NOT_IMPLEMENTED는 "PHASE 4" 배지를 단다', () => {
    const { container } = render(
      <FactorBreakdown
        factors={[factor({ key: 'institutional_insider', status: 'NOT_IMPLEMENTED', points: null, percentile: null })]}
      />,
    )
    expect(container.textContent).toContain('PHASE 4')
    expect(container.textContent).not.toContain('NO DATA')
  })

  it('percentile이 null이면 산업 상위 % 문구를 렌더링하지 않는다', () => {
    const { container } = render(
      <FactorBreakdown factors={[factor({ key: 'balance_sheet', status: 'NO_DATA', points: null, percentile: null })]} />,
    )
    expect(container.textContent).not.toContain('산업 상위')
  })

  it('percentile이 있으면 "상위 몇%"로 뒤집어 보여준다 (0.9 백분위 → 상위 10%)', () => {
    const { container } = render(
      <FactorBreakdown factors={[factor({ key: 'gross_margin', percentile: 0.9 })]} />,
    )
    expect(container.textContent).toContain('산업 상위 10%')
  })

  it('알 수 없는 팩터 키는 라벨 매핑 없이 원래 키를 그대로 보여준다', () => {
    const { container } = render(<FactorBreakdown factors={[factor({ key: 'future_factor' })]} />)
    expect(container.textContent).toContain('future_factor')
  })
})

describe('StrengthWeakness — 배점이 아니라 fill ratio(획득/배점)로 가른다', () => {
  it('배점이 작아도 fill ratio가 높으면 배점이 큰 팩터보다 강점에서 앞선다', () => {
    // balance_sheet: 5점 만점에 5점 = 100%. revenue_growth: 20점 만점에 12점 = 60%.
    // 절대 점수(5 < 12)로만 보면 반대로 나오지만, fill ratio는 balance_sheet가 더 강하다.
    const factors: FactorView[] = [
      factor({ key: 'revenue_growth', weight: 20, points: 12 }),
      factor({ key: 'balance_sheet', weight: 5, points: 5 }),
    ]
    const { container } = render(<StrengthWeakness factors={factors} />)
    const strengthList = container.querySelector('h3')!.parentElement!.querySelector('ul')!
    const firstItem = strengthList.querySelector('li')!
    expect(firstItem.textContent).toContain('재무 안정성') // balance_sheet 라벨
  })

  it('NO_DATA/NOT_IMPLEMENTED 팩터는 비교 대상에서 제외된다', () => {
    const factors: FactorView[] = [
      factor({ key: 'balance_sheet', status: 'NO_DATA', points: null, percentile: null }),
      factor({ key: 'institutional_insider', status: 'NOT_IMPLEMENTED', points: null, percentile: null, weight: 5 }),
      factor({ key: 'revenue_growth', weight: 20, points: 16 }),
    ]
    const { container } = render(<StrengthWeakness factors={factors} />)
    expect(container.textContent).not.toContain('재무 안정성')
    expect(container.textContent).not.toContain('기관 / 내부자')
    expect(container.textContent).toContain('매출 성장')
  })

  it('스코어링된 팩터가 하나도 없으면 아무것도 렌더링하지 않는다', () => {
    const factors: FactorView[] = [
      factor({ key: 'balance_sheet', status: 'NO_DATA', points: null, percentile: null }),
    ]
    const { container } = render(<StrengthWeakness factors={factors} />)
    expect(container.firstChild).toBeNull()
  })

  it('weight가 0인 팩터는 나눗셈 대상에서 제외된다', () => {
    const factors: FactorView[] = [factor({ key: 'zero_weight', weight: 0, points: 0 })]
    const { container } = render(<StrengthWeakness factors={factors} />)
    expect(container.firstChild).toBeNull()
  })
})
