import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseConfig } from '@/config'
import { computeFairValue } from '@/engines/valuation/fair-value'
import {
  eligibleForFairValue,
  preRevenueCompany,
  shortRevenueHistoryCompany,
  cashBurningCompany,
  noShareCountCompany,
  noBalanceSheetCompany,
  hyperGrowthCompany,
  capexHeavyCompany,
  ttmYoyOnlyCompany,
  cagr3yOnlyCompany,
  lowDemonstratedMarginCompany,
  shortMarginHistoryCompany,
  negativeMarginHistoryCompany,
  volatileMarginHistoryCompany,
} from '../fixtures/valuation-companies'

const cfg = parseConfig(readFileSync('config.yaml', 'utf8'))

/** OK가 아니면 이유를 그대로 드러내며 실패한다 — 게이트 변경이 조용히 통과하지 않도록. */
function ok(snapshotResult: ReturnType<typeof computeFairValue>) {
  if (snapshotResult.status !== 'OK') {
    throw new Error(`OK를 기대했으나 INSUFFICIENT_DATA(${snapshotResult.reason})`)
  }
  return snapshotResult
}

describe('computeFairValue — 7개 충분성 게이트', () => {
  it('모든 게이트를 통과하면 OK와 주당 내재가치를 반환한다', () => {
    const r = computeFairValue(eligibleForFairValue(), cfg)
    expect(r.status).toBe('OK')
    if (r.status === 'OK') {
      expect(r.perShare).toBeGreaterThan(0)
      expect(Number.isFinite(r.perShare)).toBe(true)
      // 가정이 함께 공개되어야 한다 — 숫자만 던지고 근거를 숨기지 않는다
      expect(r.assumptions.projectionYears).toBe(cfg.valuation.projection_years)
      expect(r.assumptions.discountRate).toBe(cfg.scoring.wacc_assumption)
      expect(r.assumptions.terminalGrowthRate).toBe(cfg.valuation.terminal_growth_rate)
    }
  })

  it('최근 TTM 매출이 0 이하면 NON_POSITIVE_REVENUE — 사전매출 기업은 값을 내지 않는다', () => {
    const r = computeFairValue(preRevenueCompany(), cfg)
    expect(r.status).toBe('INSUFFICIENT_DATA')
    if (r.status === 'INSUFFICIENT_DATA') expect(r.reason).toBe('NON_POSITIVE_REVENUE')
  })

  it('성장률을 추정할 매출 이력이 부족하면 INSUFFICIENT_REVENUE_HISTORY', () => {
    const r = computeFairValue(shortRevenueHistoryCompany(), cfg)
    expect(r.status).toBe('INSUFFICIENT_DATA')
    if (r.status === 'INSUFFICIENT_DATA') expect(r.reason).toBe('INSUFFICIENT_REVENUE_HISTORY')
  })

  it('현금을 태우기만 하는 기업(FCF·영업이익 모두 적자)은 숫자 대신 NOT_CASH_GENERATIVE를 반환한다', () => {
    const s = cashBurningCompany()
    expect(s.ttm[0]!.fcf).toBeLessThan(0)
    expect(s.ttm[0]!.operatingIncome).toBeLessThan(0)
    const r = computeFairValue(s, cfg)
    expect(r.status).toBe('INSUFFICIENT_DATA')
    if (r.status === 'INSUFFICIENT_DATA') expect(r.reason).toBe('NOT_CASH_GENERATIVE')
  })

  it('희석주식수와 발행주식수가 모두 없으면 NO_SHARE_COUNT', () => {
    const r = computeFairValue(noShareCountCompany(), cfg)
    expect(r.status).toBe('INSUFFICIENT_DATA')
    if (r.status === 'INSUFFICIENT_DATA') expect(r.reason).toBe('NO_SHARE_COUNT')
  })

  // 이 테스트의 이름은 "현금 **또는** 총부채"인데 픽스처는 둘 다 null이었다. 그래서
  // 조건을 `||`에서 `&&`로 바꾸는 변이가 살아남았다 — 둘 다 없으면 어느 쪽 조건이든
  // 참이기 때문이다. 이름이 주장하는 것을 실제로 관측하려면 **한 쪽만** 없는 입력이
  // 필요하다. 셋을 모두 덮는다.
  it('현금과 총부채가 모두 없으면 NO_BALANCE_SHEET_DATA — 순현금을 0으로 대신 채우지 않는다', () => {
    const r = computeFairValue(noBalanceSheetCompany(), cfg)
    expect(r.status).toBe('INSUFFICIENT_DATA')
    if (r.status === 'INSUFFICIENT_DATA') expect(r.reason).toBe('NO_BALANCE_SHEET_DATA')
  })

  it('현금만 없어도 NO_BALANCE_SHEET_DATA (총부채는 있다)', () => {
    const s = eligibleForFairValue()
    s.ttm = s.ttm.map((p) => ({ ...p, cash: null }))
    expect(s.ttm[0]!.totalDebt).not.toBeNull()
    const r = computeFairValue(s, cfg)
    expect(r.status).toBe('INSUFFICIENT_DATA')
    if (r.status === 'INSUFFICIENT_DATA') expect(r.reason).toBe('NO_BALANCE_SHEET_DATA')
  })

  it('총부채만 없어도 NO_BALANCE_SHEET_DATA (현금은 있다)', () => {
    const s = eligibleForFairValue()
    s.ttm = s.ttm.map((p) => ({ ...p, totalDebt: null }))
    expect(s.ttm[0]!.cash).not.toBeNull()
    const r = computeFairValue(s, cfg)
    expect(r.status).toBe('INSUFFICIENT_DATA')
    if (r.status === 'INSUFFICIENT_DATA') expect(r.reason).toBe('NO_BALANCE_SHEET_DATA')
  })

  // 리뷰 Finding 1: 추세 성장률 하나가 5년 복리로 증폭되면 시총 $588M 기업의 내재가치가
  // $50.7B(주당 $545.63, "98.6% 저평가")으로 나온다. 막는 기준은 성장'률'이 아니라 그
  // 투영이 실제로 주장하는 매출 확대 배수다. 상한을 넘으면 깎지 않고 숫자를 내지 않는다.
  it('암시 매출배수가 투영 상한을 넘으면 GROWTH_NOT_PROJECTABLE — 상한으로 깎아서 계산하지 않는다', () => {
    const s = hyperGrowthCompany()
    const r = computeFairValue(s, cfg)
    expect(r.status).toBe('INSUFFICIENT_DATA')
    if (r.status === 'INSUFFICIENT_DATA') {
      expect(r.reason).toBe('GROWTH_NOT_PROJECTABLE')
      // 사유만이 아니라 "몇 배인지"를 실제로 말한다 — 초기성장률 2.64709901을 이 페이드에
      // 태우면 26.72배다(CRMD 실사례의 63.41배와 같은 성질).
      expect(r.detail).toContain('26.72배')
      expect(r.detail).toContain('3.00배')
    }
  })

  it('상한을 올려 주면 같은 기업이 값을 내며, 그 값이 터무니없다는 것이 이 게이트의 근거다', () => {
    const loose = structuredClone(cfg)
    loose.valuation.max_implied_revenue_multiple = 100
    const r = ok(computeFairValue(hyperGrowthCompany(), loose))
    // 게이트가 없으면 주가 $7.44짜리 회사의 내재가치가 주당 수백 달러로 나온다.
    expect(r.perShare).toBeGreaterThan(100)
    expect(r.assumptions.impliedRevenueMultiple).toBeCloseTo(26.72255683, 7)
  })

  it('상한 바로 아래 배수는 그대로 통과한다 (경계는 초과일 때만 막는다)', () => {
    const tight = structuredClone(cfg)
    // 기준 픽스처의 암시 배수 1.50961028에 정확히 맞춘 상한 — 같은 값은 막지 않는다
    tight.valuation.max_implied_revenue_multiple = 1.5096102846356103
    expect(computeFairValue(eligibleForFairValue(), tight).status).toBe('OK')
    tight.valuation.max_implied_revenue_multiple = 1.5096
    expect(computeFairValue(eligibleForFairValue(), tight).status).toBe('INSUFFICIENT_DATA')
  })

  /**
   * 이 게이트를 초기 성장률 상한이 아니라 **결과** 상한으로 둔 이유 자체를 고정한다.
   * 같은 회사·같은 초기 성장률(0.17933864)이라도 페이드 스케줄이 달라지면 투영이 주장하는
   * 결과가 달라진다: 실제 스케줄에서는 1.50961028배지만 페이드를 없애면 2.28135376배다.
   * 그러므로 상한 2.0은 앞을 통과시키고 뒤를 막아야 한다 — 초기 성장률만 보는 게이트로는
   * 이 두 경우를 절대 구분할 수 없다.
   */
  it('같은 성장률이라도 페이드 스케줄이 바뀌면 판정이 갈린다 — 성장률 상한으로는 낼 수 없는 구분', () => {
    const capped = structuredClone(cfg)
    capped.valuation.max_implied_revenue_multiple = 2.0

    const withFade = ok(computeFairValue(eligibleForFairValue(), capped))
    expect(withFade.assumptions.initialGrowthRate).toBeCloseTo(0.17933864, 8)
    expect(withFade.assumptions.impliedRevenueMultiple).toBeCloseTo(1.50961028, 8)

    const noFade = structuredClone(capped)
    noFade.valuation.fade_curve = [[0, 1.0], [5, 1.0]]
    const r = computeFairValue(eligibleForFairValue(), noFade)
    expect(r.status).toBe('INSUFFICIENT_DATA')
    if (r.status === 'INSUFFICIENT_DATA') {
      expect(r.reason).toBe('GROWTH_NOT_PROJECTABLE')
      expect(r.detail).toContain('2.28배')
    }
  })
})

/**
 * 게이트가 아니라 **산술** 자체를 고정한다. eligibleForFairValue()는 완전히 결정적이므로
 * 모든 중간값이 하나의 수로 정해진다 — config.yaml 값(할인율 9%, 터미널 2.5%, 페이드
 * 1/0.8/0.6/0.4/0.2/0)과 픽스처의 연간 마진 이력만 보고 엔진과 무관하게 재계산한
 * 숫자다. 성숙마진은 더 이상 config에 상수로 있지 않고 픽스처의 이력 중앙값 0.175다.
 * 이 블록이 없으면 DCF 전체를 `const perShare = 1`로 바꿔도 스위트가 통과한다(F1).
 */
describe('computeFairValue — 산술 고정', () => {
  const r = ok(computeFairValue(eligibleForFairValue(), cfg))

  it('초기 성장률은 TTM YoY와 3Y CAGR의 blend 가중치를 그대로 따른다', () => {
    expect(r.assumptions.initialGrowthSource).toBe('blend')
    // 0.6 × 0.21550625 + 0.4 × 0.12508722 = 0.17933864
    // (가중치를 서로 바꾸면 0.16125483 — 이 픽스처는 두 입력이 달라 그 차이가 관측된다)
    expect(r.assumptions.initialGrowthRate).toBeCloseTo(0.17933864, 8)
    expect(r.assumptions.initialGrowthRate).not.toBeCloseTo(0.16125483, 4)
  })

  it('초기 FCF마진·주식수·순현금은 스냅샷에서 그대로 온다', () => {
    expect(r.assumptions.initialFcfMargin).toBeCloseTo(0.25, 10)
    expect(r.assumptions.initialMarginSource).toBe('fcf')
    expect(r.assumptions.sharesSource).toBe('diluted')
    expect(r.assumptions.shares).toBe(100_000_000)
    expect(r.assumptions.netCash).toBe(400_000_000) // 5e8 − 1e8, 빼는 것이지 더하는 것이 아니다
  })

  it('암시 매출배수는 페이드를 태운 매출 경로에서 나온다 — 초기 성장률의 재표현이 아니다', () => {
    // 매출 경로 = 1 × Π(1 + 0.025 + fade_y × (0.17933864 − 0.025)), fade = 0.8/0.6/0.4/0.2/0
    expect(r.assumptions.impliedRevenueMultiple).toBeCloseTo(1.50961028463561, 10)
    // 페이드를 무시하고 초기 성장률을 5년 유지하면 2.28135376 — 이 두 값이 다르다는 것이
    // 페이드가 실제로 적용됐다는 증거다(fade = 1 변이를 잡는다).
    expect(r.assumptions.impliedRevenueMultiple).not.toBeCloseTo(2.28135375581574, 4)
    expect(r.detail).toContain('1.51배')
  })

  it('기업가치·자기자본가치·주당가치를 정확한 값으로 고정한다', () => {
    expect(r.enterpriseValue).toBeCloseTo(3_783_597_583.26, 1)
    expect(r.equityValue).toBeCloseTo(4_183_597_583.26, 1)
    expect(r.perShare).toBeCloseTo(41.83597583, 6)
    // 옛 전역 성숙마진 0.15를 그대로 쓰면 37.19177146이 나온다 — 두 값이 다르다는 것이
    // 성숙마진이 이제 회사별 측정이라는 증거다(상수 복귀 변이를 이 블록이 잡는다).
    expect(r.perShare).not.toBeCloseTo(37.19177146, 4)
  })

  it('할인율을 올리면 주당가치가 내려간다 (단조성)', () => {
    const higher = structuredClone(cfg)
    higher.scoring.wacc_assumption = 0.12
    const h = ok(computeFairValue(eligibleForFairValue(), higher))
    expect(h.assumptions.discountRate).toBe(0.12)
    expect(h.perShare).toBeCloseTo(30.14739481, 6)
    expect(h.perShare).toBeLessThan(r.perShare)
  })

  it('페이드 곡선이 실제로 적용된다 — 초기 성장률을 5년 내내 유지하면 값이 커진다', () => {
    const noFade = structuredClone(cfg)
    noFade.valuation.fade_curve = [[0, 1.0], [5, 1.0]]
    const n = ok(computeFairValue(eligibleForFairValue(), noFade))
    expect(n.perShare).toBeGreaterThan(r.perShare * 1.5)
  })

  it('터미널가치가 기업가치에 들어간다 — 터미널 성장률을 낮추면 값이 내려간다', () => {
    const lowTv = structuredClone(cfg)
    lowTv.valuation.terminal_growth_rate = 0.0
    const l = ok(computeFairValue(eligibleForFairValue(), lowTv))
    expect(l.perShare).toBeLessThan(r.perShare)
  })
})

describe('computeFairValue — 초기값의 출처 분기', () => {
  it('FCF가 적자이고 영업이익만 흑자면 nopat_proxy 마진을 쓴다 (영업이익률 × (1 − 세율))', () => {
    const r = ok(computeFairValue(capexHeavyCompany(), cfg))
    expect(r.assumptions.initialMarginSource).toBe('nopat_proxy')
    // 영업이익률 0.30 × (1 − 0.21) = 0.237 — 세금 공제를 빼먹으면 0.30이 된다
    expect(r.assumptions.initialFcfMargin).toBeCloseTo(0.237, 10)
    expect(r.assumptions.taxRate).toBe(cfg.scoring.tax_rate)
  })

  // 페이드는 초기값에서 성숙값으로 가는 경로다. 양 끝이 서로 다른 측정이면 그 경로는
  // 회사의 마진 수렴이 아니라 두 지표의 혼합을 그린다 — 그래서 성숙마진의 기준은
  // 초기 마진의 출처를 그대로 따라간다.
  it('초기 마진이 nopat_proxy면 성숙마진도 NOPAT 이력에서 나온다 (FCF 이력이 아니라)', () => {
    const r = ok(computeFairValue(capexHeavyCompany(), cfg))
    // 연간 영업이익률 중앙값 0.175 × 0.79 = 0.13825
    expect(r.assumptions.matureFcfMargin).toBeCloseTo(0.13825, 10)
    // 같은 픽스처의 연간 FCF마진 중앙값은 0.40이다 — 기준을 섞으면 이 값이 나온다
    expect(r.assumptions.matureFcfMargin).not.toBeCloseTo(0.4, 3)
    expect(r.perShare).toBeCloseTo(34.73201506, 6)
    expect(r.detail).toContain('NOPAT마진 중앙값')
  })

  it('3Y CAGR을 못 구하면 TTM YoY만 쓴다 (blend가 아니다)', () => {
    const r = ok(computeFairValue(ttmYoyOnlyCompany(), cfg))
    expect(r.assumptions.initialGrowthSource).toBe('ttm_yoy_only')
    expect(r.assumptions.initialGrowthRate).toBeCloseTo(0.21550625, 8)
  })

  it('TTM YoY를 못 구하면 3Y CAGR만 쓴다', () => {
    const r = ok(computeFairValue(cagr3yOnlyCompany(), cfg))
    expect(r.assumptions.initialGrowthSource).toBe('cagr_3y_only')
    expect(r.assumptions.initialGrowthRate).toBeCloseTo(0.12508722, 8)
  })

  it('희석주식수가 있으면 발행주식수보다 우선한다', () => {
    const s = eligibleForFairValue()
    s.sharesOutstanding = 50_000_000 // 희석(1e8)의 절반 — 잘못 고르면 주당가치가 두 배가 된다
    const r = ok(computeFairValue(s, cfg))
    expect(r.assumptions.sharesSource).toBe('diluted')
    expect(r.assumptions.shares).toBe(100_000_000)
    expect(r.perShare).toBeCloseTo(41.83597583, 6)
  })

  it('희석주식수가 없으면 발행주식수로 내려간다', () => {
    const s = eligibleForFairValue()
    s.ttm = s.ttm.map((p) => ({ ...p, sharesDiluted: null }))
    s.sharesOutstanding = 50_000_000
    const r = ok(computeFairValue(s, cfg))
    expect(r.assumptions.sharesSource).toBe('outstanding')
    expect(r.perShare).toBeCloseTo(41.83597583 * 2, 6)
  })
})

/**
 * 리뷰 Part 1: 성숙 FCF마진이 308개 기업 전부에서 단 하나의 값(0.15)이었다. 페이드가
 * projection_years에서 0이 되므로 최종연도 FCF는 정의상 `매출₅ × 0.15`이고, 그 위에 선
 * 터미널가치가 기업가치의 약 75%다 — 즉 DCF는 매출배수를 DCF 옷을 입혀 내놓고 있었고
 * P/FV가 회사의 현재 마진과 ρ = +0.394로 상관했다. 이 블록은 그 상수가 회사별 측정으로
 * 바뀌었다는 것과, 측정할 수 없을 때 **기본값으로 메우지 않는다**는 것을 고정한다.
 */
describe('computeFairValue — 성숙마진 앵커', () => {
  it('성숙마진은 그 회사의 연간 마진 이력 중앙값이다 — 평균도, 전역 상수도 아니다', () => {
    const r = ok(computeFairValue(eligibleForFairValue(), cfg))
    // 이력 [0.30, 0.19, 0.18, 0.18, 0.17, 0.16, 0.10, 0.02]
    expect(r.assumptions.matureFcfMargin).toBeCloseTo(0.175, 10)
    expect(r.assumptions.matureFcfMargin).not.toBeCloseTo(0.1625, 4) // 평균
    expect(r.assumptions.matureFcfMargin).not.toBeCloseTo(0.15, 4) // 옛 전역 상수
    expect(r.assumptions.matureMarginPeriods).toBe(8)
    // MAD 0.015 / 중앙값 0.175
    expect(r.assumptions.matureMarginDispersion).toBeCloseTo(0.08571429, 8)
    expect(r.detail).toContain('최근 연간 8개 기간 FCF마진 중앙값')
  })

  it('서로 다른 회사는 서로 다른 성숙마진을 받는다 — 이 값은 더 이상 전역 상수가 아니다', () => {
    const rich = ok(computeFairValue(eligibleForFairValue(), cfg))
    const thin = ok(computeFairValue(lowDemonstratedMarginCompany(), cfg))
    expect(rich.assumptions.matureFcfMargin).toBeCloseTo(0.175, 10)
    expect(thin.assumptions.matureFcfMargin).toBeCloseTo(0.02, 10)
  })

  /**
   * XRX 실사례: 마진 2.1%인 회사가 주당 $166.91(주가 $3.24)을 받았다. 성장이 아니라
   * 마진 가정이 만든 값이며, 암시 매출배수 1.47배로 **상한 게이트의 한참 아래**에서
   * 벌어지던 일이다 — 그래서 배수 상한으로는 잡을 수 없었다.
   */
  it('마진이 얇은 회사에 15%를 얹어주지 않는다 — 옛 전역 상수였다면 값이 몇 배가 됐다', () => {
    const s = lowDemonstratedMarginCompany()
    const anchored = ok(computeFairValue(s, cfg))
    // 초기 0.02 · 성숙 0.02 → 전 구간이 실제 마진 위에 선다
    expect(anchored.assumptions.initialFcfMargin).toBeCloseTo(0.02, 10)
    expect(anchored.perShare).toBeCloseTo(8.14148712, 6)
    // 옛 전역 상수 0.15였다면 같은 입력에서 $32.29 — 3.96배다. 이 회사에 대해 달라진
    // 것은 아무것도 없고 우리가 고른 가정 하나가 사라졌을 뿐이다.
    expect(anchored.perShare * 3.9).toBeLessThan(32.29134983)
    // 배수 게이트는 이 회사를 전혀 건드리지 않는다(1.51배 < 3.00배) — 마진 아티팩트는
    // 상한 안쪽에서 발생했다는 리뷰의 지적을 그대로 못박는다.
    expect(anchored.assumptions.impliedRevenueMultiple).toBeCloseTo(1.50961028, 8)
    expect(anchored.assumptions.impliedRevenueMultiple).toBeLessThan(
      cfg.valuation.max_implied_revenue_multiple,
    )
  })

  it('성숙마진이 커지면 주당가치도 커진다 (단조성)', () => {
    const low = ok(computeFairValue(lowDemonstratedMarginCompany(), cfg))
    const high = ok(computeFairValue(eligibleForFairValue(), cfg))
    expect(high.perShare).toBeGreaterThan(low.perShare)
  })

  describe('앵커할 수 없으면 거부한다 — 전역 기본값으로 메우지 않는다', () => {
    it('연간 마진 관측이 min_periods 미만이면 MARGIN_NOT_ANCHORABLE', () => {
      const r = computeFairValue(shortMarginHistoryCompany(), cfg)
      expect(r.status).toBe('INSUFFICIENT_DATA')
      if (r.status === 'INSUFFICIENT_DATA') {
        expect(r.reason).toBe('MARGIN_NOT_ANCHORABLE')
        expect(r.detail).toContain('3개뿐')
      }
    })

    it('연간 마진 중앙값이 0 이하면 MARGIN_NOT_ANCHORABLE — 최근 한 해 흑자로 영구 마진을 주지 않는다', () => {
      const s = negativeMarginHistoryCompany()
      // 현금전환 게이트는 통과한다(최신 TTM FCF는 양수) — 거부는 **이력** 때문이다
      expect(s.ttm[0]!.fcf!).toBeGreaterThan(0)
      const r = computeFairValue(s, cfg)
      expect(r.status).toBe('INSUFFICIENT_DATA')
      if (r.status === 'INSUFFICIENT_DATA') {
        expect(r.reason).toBe('MARGIN_NOT_ANCHORABLE')
        expect(r.detail).toContain('중앙값이 -1.9%')
      }
    })

    it('산포가 상한을 넘으면 MARGIN_NOT_ANCHORABLE — 흩어짐은 수준이 아니다', () => {
      const r = computeFairValue(volatileMarginHistoryCompany(), cfg)
      expect(r.status).toBe('INSUFFICIENT_DATA')
      if (r.status === 'INSUFFICIENT_DATA') {
        expect(r.reason).toBe('MARGIN_NOT_ANCHORABLE')
        expect(r.detail).toContain('3.17배만큼 흩어져')
      }
    })

    it('산포 상한을 그 값 위로 올리면 같은 기업이 값을 낸다 — 문턱이 무엇을 막는지 고정한다', () => {
      const loose = structuredClone(cfg)
      loose.valuation.mature_margin.max_dispersion = 4.0
      const r = ok(computeFairValue(volatileMarginHistoryCompany(), loose))
      expect(r.assumptions.matureFcfMargin).toBeCloseTo(0.0145, 10)
      expect(r.assumptions.matureMarginDispersion).toBeCloseTo(3.17241379, 8)
    })

    it('앵커 창을 좁히면 다른 기간이 중앙값을 만든다 — 창이 결론을 바꾼다', () => {
      const narrow = structuredClone(cfg)
      narrow.valuation.mature_margin.lookback_periods = 4
      const r = ok(computeFairValue(eligibleForFairValue(), narrow))
      // 최근 4개 [0.30, 0.19, 0.18, 0.18] → 중앙값 0.185 (8개 창의 0.175가 아니다)
      expect(r.assumptions.matureFcfMargin).toBeCloseTo(0.185, 10)
      expect(r.assumptions.matureMarginPeriods).toBe(4)
    })
  })
})

describe('computeFairValue — 순수성/결정성', () => {
  it('같은 입력에는 항상 같은 결과를 반환한다', () => {
    const s = eligibleForFairValue()
    const a = computeFairValue(s, cfg)
    const b = computeFairValue(s, cfg)
    expect(a).toEqual(b)
  })

  it('discount rate가 terminal growth rate 이하면 INVALID_ASSUMPTIONS를 반환한다(스키마를 우회해도 안전)', () => {
    const bad = structuredClone(cfg)
    bad.valuation.terminal_growth_rate = bad.scoring.wacc_assumption + 0.01
    const r = computeFairValue(eligibleForFairValue(), bad)
    expect(r.status).toBe('INSUFFICIENT_DATA')
    if (r.status === 'INSUFFICIENT_DATA') expect(r.reason).toBe('INVALID_ASSUMPTIONS')
  })
})
