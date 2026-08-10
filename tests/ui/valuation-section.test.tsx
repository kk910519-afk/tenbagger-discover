// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { ValuationSection } from '@/app/_components/Valuation'
import type { ValuationView } from '@/app/_queries/stock'
import type { MoatSignal, UncertaintyLevel } from '@/engines/valuation'

afterEach(() => cleanup())

function view(overrides: Partial<ValuationView> = {}): ValuationView {
  return {
    asOf: '2026-08-10',
    engineVersion: 'valuation-1.4.0+test',
    moatSignal: 'PERSISTENT',
    moatPeriodsEvaluated: 8,
    moatPeriodsClearing: 7,
    moatInsufficientReason: null,
    moatEvidence: ['최근 연간 8개 기간 중 7개에서 ROIC가 자본비용을 상회'],
    fairValueStatus: 'OK',
    fairValueReason: null,
    fairValuePerShare: 120.5,
    fairValueDetail: '5년 예측 + 터미널가치 · 5년 뒤 매출 1.51배를 전제',
    priceToFairValueStatus: 'OK',
    priceToFairValueRatio: 0.8,
    marginOfSafety: 0.2,
    valuationStatus: 'UNDERVALUED',
    uncertaintyLevel: 'MINIMAL',
    uncertaintyScore: 0.12,
    uncertaintyDrivers: [
      { key: 'data_completeness', status: 'MEASURED', risk: 0.12, detail: '핵심 재무 필드 10/10개 확보' },
    ],
    ...overrides,
  }
}

/**
 * 등급 이름은 Morningstar의 published tier 어휘를 쓰지 않는다는 제품 규칙을 화면에서
 * 고정한다. 엔진 타입만 바꾸고 UI가 옛 이름을 그대로 그리면 규칙은 지켜지지 않는다.
 */
describe('ValuationSection — 등급 이름', () => {
  const FORBIDDEN = ['WIDE', 'NARROW', 'VERY_HIGH', 'Wide Moat', 'No Moat']

  it('Morningstar의 등급 어휘를 화면에 그리지 않는다', () => {
    for (const moatSignal of ['PERSISTENT', 'INTERMITTENT', 'ABSENT', 'INSUFFICIENT_DATA'] as MoatSignal[]) {
      for (const uncertaintyLevel of ['MINIMAL', 'MODERATE', 'ELEVATED', 'SEVERE'] as UncertaintyLevel[]) {
        const { container, unmount } = render(
          <ValuationSection
            valuation={view({
              moatSignal,
              uncertaintyLevel,
              moatInsufficientReason: moatSignal === 'INSUFFICIENT_DATA' ? 'NOT_APPLICABLE' : null,
            })}
            price={96.4}
          />,
        )
        const text = container.textContent ?? ''
        for (const bad of FORBIDDEN) expect(text).not.toContain(bad)
        unmount()
      }
    }
  })

  it('프레이밍(Morningstar-Inspired)과 라벨(Moat Signal)은 그대로 남는다', () => {
    const { container } = render(<ValuationSection valuation={view()} price={96.4} />)
    const text = container.textContent ?? ''
    expect(text).toContain('Morningstar-Inspired')
    expect(text).toContain('Moat Signal')
    // "Economic Moat"라는 라벨은 여전히 금지다
    expect(text).not.toContain('Economic Moat')
  })

  it('네 등급을 각각 배지에 그리고 한국어 설명을 함께 낸다', () => {
    const cases: [MoatSignal, string][] = [
      ['PERSISTENT', '대부분의 해에 이어졌습니다'],
      ['INTERMITTENT', '넘은 해와 넘지 못한 해가 섞여'],
      ['ABSENT', '이어지는 초과 수익을 찾지 못했습니다'],
    ]
    for (const [signal, gloss] of cases) {
      const { container, unmount } = render(
        <ValuationSection valuation={view({ moatSignal: signal })} price={96.4} />,
      )
      const text = container.textContent ?? ''
      expect(text).toContain(signal)
      expect(text).toContain(gloss)
      unmount()
    }
  })

  it('불확실성 네 단계도 배지와 한국어 설명을 함께 낸다', () => {
    const cases: [UncertaintyLevel, string][] = [
      ['MINIMAL', '고르게 갖춰져 있습니다'],
      ['MODERATE', '흔들리는 부분이 있습니다'],
      ['ELEVATED', '확신이 낮습니다'],
      ['SEVERE', '확신할 근거가 거의 없습니다'],
    ]
    for (const [level, gloss] of cases) {
      const { container, unmount } = render(
        <ValuationSection valuation={view({ uncertaintyLevel: level })} price={96.4} />,
      )
      const text = container.textContent ?? ''
      expect(text).toContain(level)
      expect(text).toContain(gloss)
      unmount()
    }
  })

  /**
   * 개명이 절대 뭉개면 안 되는 구분. ABSENT는 "따져봤고 없었다"(회사에 대한 결론),
   * INSUFFICIENT_DATA는 "따져볼 수 없었다"(우리에 대한 진술)이고 후자는 세 사유로 다시
   * 갈린다. 화면에서 두 문장이 서로 달라야 구분이 살아 있는 것이다.
   */
  it('ABSENT와 INSUFFICIENT_DATA는 화면에서 다른 문장으로 갈린다', () => {
    const { container: absent } = render(
      <ValuationSection
        valuation={view({
          moatSignal: 'ABSENT',
          moatPeriodsClearing: 0,
          moatEvidence: ['최근 연간 8개 기간 중 0개에서 ROIC가 자본비용을 상회', '자본비용을 상회한 기간 없음'],
        })}
        price={96.4}
      />,
    )
    const absentText = absent.textContent ?? ''
    expect(absentText).toContain('ABSENT')
    expect(absentText).toContain('따져봤지만')
    expect(absentText).toContain('0개에서 ROIC가 자본비용을 상회')

    for (const reason of ['TOO_FEW_PERIODS', 'MISSING_FINANCIALS', 'NOT_APPLICABLE'] as const) {
      const { container, unmount } = render(
        <ValuationSection
          valuation={view({
            moatSignal: 'INSUFFICIENT_DATA',
            moatInsufficientReason: reason,
            moatEvidence: ['판정 불가'],
          })}
          price={96.4}
        />,
      )
      const text = container.textContent ?? ''
      // 판정하지 않았으므로 배지 대신 em dash, 그리고 사유별로 다른 문장
      expect(text).not.toContain('ABSENT')
      expect(text).not.toContain('따져봤지만')
      expect(text).toContain('—')
      unmount()
    }
  })

  it('INSUFFICIENT_DATA의 세 사유는 서로 다른 문장을 낸다', () => {
    const texts = (['TOO_FEW_PERIODS', 'MISSING_FINANCIALS', 'NOT_APPLICABLE'] as const).map(
      (reason) => {
        const { container, unmount } = render(
          <ValuationSection
            valuation={view({ moatSignal: 'INSUFFICIENT_DATA', moatInsufficientReason: reason })}
            price={96.4}
          />,
        )
        const t = container.textContent ?? ''
        unmount()
        return t
      },
    )
    expect(new Set(texts).size).toBe(3)
  })
})
