import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseConfig } from '@/config'
import { computeMoatSignal } from '@/engines/valuation/moat-signal'
import {
  wideMoatCompany, narrowMoatCompany, oneStrongYearCompany, insufficientMoatHistoryCompany,
  missingFinancialsMoatCompany, notApplicableMoatCompany,
  mixedGapCannotFlipMoatCompany, mixedGapCouldFlipMoatCompany,
  staleGloryMoatCompany, buybackNegativeEquityCompany,
  lossYearsDroppedByFloorCompany, allLossYearsCompany,
} from '../fixtures/valuation-companies'

const cfg = parseConfig(readFileSync('config.yaml', 'utf8'))

describe('computeMoatSignal', () => {
  it('연간 기간의 75% 이상에서 ROIC가 WACC를 지속적으로 상회하면 PERSISTENT', () => {
    const r = computeMoatSignal(wideMoatCompany(), cfg)
    expect(r.signal).toBe('PERSISTENT')
    expect(r.periodsClearing / r.periodsEvaluated).toBeGreaterThanOrEqual(cfg.valuation.moat.persistent_clear_ratio)
  })

  it('40~75% 구간이면 INTERMITTENT', () => {
    const r = computeMoatSignal(narrowMoatCompany(), cfg)
    expect(r.signal).toBe('INTERMITTENT')
  })

  it('한 해만 반짝 좋았던 기업은 PERSISTENT를 얻지 못한다 (마진·성장만으로 해자를 주지 않는다)', () => {
    const r = computeMoatSignal(oneStrongYearCompany(), cfg)
    expect(r.signal).not.toBe('PERSISTENT')
    expect(r.signal).toBe('ABSENT')
    expect(r.periodsClearing).toBe(1)
  })

  it('ROIC 산출 가능 기간이 최소 요건 미만이면 INSUFFICIENT_DATA — 아무것도 주장하지 않는다', () => {
    const r = computeMoatSignal(insufficientMoatHistoryCompany(), cfg)
    expect(r.signal).toBe('INSUFFICIENT_DATA')
    expect(r.periodsEvaluated).toBeLessThan(cfg.valuation.moat.min_periods_required)
  })

  it('매출이 결측이어도 ROIC 입력이 갖춰진 연간 기간은 전부 센다 (XEL 코호트)', () => {
    // ROIC는 영업이익·부채·자본·현금만 쓴다 — 매출은 쓰지 않는다. 한때 이 엔진이
    // `revenue !== null`인 연간 행만 셌는데, 그 필터는 오염(디멘션 슬라이스)이 아니라
    // **우리 쪽 태그 커버리지의 구멍**에도 그대로 걸렸다. XEL은 규제 유틸리티 매출
    // 태그를 추적하지 않아 2019~2025년 매출이 비어 있었고, 그 일곱 해는 네 필드가
    // 모두 갖춰져 있는데도 세어지지 않아 `TOO_FEW_PERIODS`(연간 실적 자체가 부족하다는
    // 진술)를 받았다. 실측으로 같은 처지의 회사가 38개였다.
    const real = wideMoatCompany()
    const revenueBlind = {
      ...real,
      annual: real.annual.map((p) => ({ ...p, revenue: null, grossProfit: null })),
    }
    const r = computeMoatSignal(revenueBlind, cfg)
    const clean = computeMoatSignal(real, cfg)
    expect(r.periodsEvaluated).toBe(clean.periodsEvaluated)
    expect(r.periodsClearing).toBe(clean.periodsClearing)
    expect(r.signal).toBe(clean.signal)
    expect(r.insufficientReason).toBeNull()
  })

  it('매출 결측을 이유로 TOO_FEW_PERIODS를 주지 않는다', () => {
    const real = wideMoatCompany()
    // 최근 5개 해의 매출만 비운다 — 남은 3개로는 최소 요건(4개)에 못 미치므로,
    // 매출로 거르는 규칙 아래에서는 "보고된 연간 실적이 3개뿐"이 된다.
    const partial = {
      ...real,
      annual: real.annual.map((p, i) => (i < 5 ? { ...p, revenue: null } : p)),
    }
    const r = computeMoatSignal(partial, cfg)
    expect(r.insufficientReason).not.toBe('TOO_FEW_PERIODS')
    expect(r.periodsEvaluated).toBe(computeMoatSignal(real, cfg).periodsEvaluated)
  })

  describe('INSUFFICIENT_DATA 사유 구분', () => {
    it('연간 기간 자체가 최소 요건보다 적으면 TOO_FEW_PERIODS', () => {
      const r = computeMoatSignal(insufficientMoatHistoryCompany(), cfg)
      expect(r.signal).toBe('INSUFFICIENT_DATA')
      expect(r.insufficientReason).toBe('TOO_FEW_PERIODS')
    })

    it('연간 기간은 충분하지만 재무 항목이 결측인 해가 있으면 MISSING_FINANCIALS', () => {
      const r = computeMoatSignal(missingFinancialsMoatCompany(), cfg)
      expect(r.signal).toBe('INSUFFICIENT_DATA')
      expect(r.insufficientReason).toBe('MISSING_FINANCIALS')
    })

    it('재무 항목은 모두 있지만 투하자본이 0 이하인 해뿐이면 NOT_APPLICABLE — 결측이 아니라 지표가 적용되지 않는 경우', () => {
      const r = computeMoatSignal(notApplicableMoatCompany(), cfg)
      expect(r.signal).toBe('INSUFFICIENT_DATA')
      expect(r.insufficientReason).toBe('NOT_APPLICABLE')
      expect(r.periodsEvaluated).toBe(0)
    })

    it('결측을 다 되돌려도 최소 요건을 못 채우면(진짜 병목은 투하자본) NOT_APPLICABLE — 결측 1개만으로 무조건 "모른다"고 하지 않는다', () => {
      const r = computeMoatSignal(mixedGapCannotFlipMoatCompany(), cfg)
      expect(r.signal).toBe('INSUFFICIENT_DATA')
      expect(r.insufficientReason).toBe('NOT_APPLICABLE')
    })

    it('결측을 다 되돌리면 최소 요건을 채우고도 남으면(결측이 결론을 바꿨을 수 있음) 투하자본 미달이 섞여 있어도 MISSING_FINANCIALS', () => {
      const r = computeMoatSignal(mixedGapCouldFlipMoatCompany(), cfg)
      expect(r.signal).toBe('INSUFFICIENT_DATA')
      expect(r.insufficientReason).toBe('MISSING_FINANCIALS')
    })

    it('PERSISTENT/INTERMITTENT/ABSENT 판정에는 insufficientReason이 없다', () => {
      expect(computeMoatSignal(wideMoatCompany(), cfg).insufficientReason).toBeNull()
      expect(computeMoatSignal(narrowMoatCompany(), cfg).insufficientReason).toBeNull()
      expect(computeMoatSignal(oneStrongYearCompany(), cfg).insufficientReason).toBeNull()
    })
  })

  // 테스트 리뷰 F6: 기존 픽스처는 전부 연간 기간이 8개 이하라 .slice(0, lookback_periods)를
  // .slice(0)으로 바꿔도 아무 테스트가 깨지지 않았다 — 창(window) 자체가 관측되지 않았다.
  it('lookback_periods 밖의 좋았던 시절은 더 이상 계산에 들어가지 않는다', () => {
    const r = computeMoatSignal(staleGloryMoatCompany(), cfg)
    expect(r.periodsEvaluated).toBe(cfg.valuation.moat.lookback_periods) // 12개가 아니라 8개
    expect(r.periodsClearing).toBe(0)
    expect(r.signal).toBe('ABSENT')
  })

  it('창을 넓히면 같은 기업의 판정이 ABSENT에서 INTERMITTENT로 바뀐다 — 창이 결론을 바꾼다', () => {
    const widened = structuredClone(cfg)
    widened.valuation.moat.lookback_periods = 14
    const r = computeMoatSignal(staleGloryMoatCompany(), widened)
    expect(r.periodsEvaluated).toBe(14)
    expect(r.periodsClearing).toBe(6) // 6/14 = 43% ≥ intermittent_clear_ratio(0.40)
    expect(r.signal).toBe('INTERMITTENT')
  })

  // 리뷰 Finding 2: 투하자본이 양수이기만 하면 분모로 인정하던 시절, 자사주 매입으로
  // 자본이 음수인 기업(DBX 실사례)은 ROIC 374%로 매 기간 WACC를 상회해 PERSISTENT를 받았다.
  it('투하자본이 상쇄 잔차인 기업은 PERSISTENT가 아니라 NOT_APPLICABLE이다', () => {
    const r = computeMoatSignal(buybackNegativeEquityCompany(), cfg)
    expect(r.signal).toBe('INSUFFICIENT_DATA')
    expect(r.insufficientReason).toBe('NOT_APPLICABLE')
    expect(r.periodsEvaluated).toBe(0)
    // 결측 때문이 아니다 — 네 항목이 모두 보고돼 있다
    expect(r.evidence.join(' ')).toContain('투하자본')
  })

  it('하한을 0으로 낮추면 같은 기업이 PERSISTENT를 되찾는다 — 하한이 막는 것이 무엇인지 고정한다', () => {
    const loose = structuredClone(cfg)
    loose.scoring.min_invested_capital_ratio = 0
    const r = computeMoatSignal(buybackNegativeEquityCompany(), loose)
    expect(r.signal).toBe('PERSISTENT')
    expect(r.periodsEvaluated).toBe(5)
  })

  /**
   * 리뷰 Part 2 — 투하자본 규모 하한이 **결론까지 버리고 있었다.**
   *
   * 이 엔진이 각 기간에 묻는 것은 "ROIC가 자본비용을 넘었는가"라는 부호 질문이고,
   * NOPAT ≤ 0이면 그 답은 분모의 크기와 무관하게 이미 "아니오"다. 그런 기간을 하한으로
   * 버리면 (a) 회사에 대한 결론이 우리에 대한 진술로 격하되고(50개 중 48개),
   * (b) 실패 기간만 사라져 등급이 **올라간다**(SEZL).
   */
  describe('규모 하한은 분모가 답을 바꿀 수 있을 때만 적용된다', () => {
    it('영업적자 기간은 규모 하한에 걸려도 미달로 세어 판정에 넣는다 (SEZL)', () => {
      const r = computeMoatSignal(lossYearsDroppedByFloorCompany(), cfg)
      expect(r.periodsEvaluated).toBe(6) // 하한이 부호를 무시하면 4가 된다
      expect(r.periodsClearing).toBe(3)
      expect(r.signal).toBe('INTERMITTENT') // 3/6 = 0.500
      // 3/4 = 0.750은 persistent_clear_ratio에 정확히 걸린다 — 불리한 증거 두 개를
      // 지운 대가로 최상위 등급을 받던 값이다.
      expect(r.signal).not.toBe('PERSISTENT')
    })

    it('전부 영업적자인 기업은 ABSENT다 — INSUFFICIENT_DATA로 격하되지 않는다', () => {
      const r = computeMoatSignal(allLossYearsCompany(), cfg)
      expect(r.signal).toBe('ABSENT')
      expect(r.insufficientReason).toBeNull()
      expect(r.periodsEvaluated).toBe(6) // 규모 하한이 4개를 버리면 2개가 되어 최소 요건 미달
      expect(r.periodsClearing).toBe(0)
    })

    it('하한은 상회 기간만 제거할 수 있다 — 등급을 올리는 것이 구조적으로 불가능하다', () => {
      // 하한을 0(꺼짐)부터 1(전부 차단)까지 훑으며 상회 비율이 단조 비증가인지 본다.
      const ratios = [0, 0.05, 0.1, 0.2, 0.5, 0.9].map((floor) => {
        const c = structuredClone(cfg)
        c.scoring.min_invested_capital_ratio = floor
        const r = computeMoatSignal(lossYearsDroppedByFloorCompany(), c)
        return r.periodsEvaluated === 0 ? 0 : r.periodsClearing / r.periodsEvaluated
      })
      for (let i = 1; i < ratios.length; i++) {
        expect(ratios[i]!).toBeLessThanOrEqual(ratios[i - 1]! + 1e-12)
      }
      expect(ratios[0]).toBeCloseTo(0.5, 10)
    })

    it('NOPAT > 0인 잔차 분모는 여전히 막는다 — 하한이 하던 일 자체는 그대로다', () => {
      const r = computeMoatSignal(buybackNegativeEquityCompany(), cfg)
      expect(r.signal).toBe('INSUFFICIENT_DATA')
      expect(r.periodsEvaluated).toBe(0)
    })
  })

  it('근거 문자열은 측정한 것만 말하고 해자의 "원천"은 이름 붙이지 않는다', () => {
    const r = computeMoatSignal(wideMoatCompany(), cfg)
    const joined = r.evidence.join(' ')
    for (const forbidden of ['전환비용', '네트워크효과', '무형자산', '원가우위', '효율적 규모', 'switching cost', 'network effect']) {
      expect(joined).not.toContain(forbidden)
    }
    expect(joined).toMatch(/ROIC/)
  })
})
