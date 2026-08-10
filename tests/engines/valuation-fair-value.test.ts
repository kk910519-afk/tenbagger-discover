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
} from '../fixtures/valuation-companies'

const cfg = parseConfig(readFileSync('config.yaml', 'utf8'))

/** OK가 아니면 이유를 그대로 드러내며 실패한다 — 게이트 변경이 조용히 통과하지 않도록. */
function ok(snapshotResult: ReturnType<typeof computeFairValue>) {
  if (snapshotResult.status !== 'OK') {
    throw new Error(`OK를 기대했으나 INSUFFICIENT_DATA(${snapshotResult.reason})`)
  }
  return snapshotResult
}

describe('computeFairValue — 6개 충분성 게이트', () => {
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

  it('현금 또는 총부채가 없으면 NO_BALANCE_SHEET_DATA — 순현금을 0으로 대신 채우지 않는다', () => {
    const r = computeFairValue(noBalanceSheetCompany(), cfg)
    expect(r.status).toBe('INSUFFICIENT_DATA')
    if (r.status === 'INSUFFICIENT_DATA') expect(r.reason).toBe('NO_BALANCE_SHEET_DATA')
  })

  // 리뷰 Finding 1: 추세 성장률 하나가 5년 복리로 증폭되면 시총 $692M 기업의 내재가치가
  // $50.7B(주당 $545.63, "98.6% 저평가")으로 나온다. 상한을 넘으면 상한값으로 깎지 않고
  // 숫자를 내지 않는다 — 깎는 것은 성장률을 우리가 지어내는 일이다.
  it('추세 성장률이 투영 상한을 넘으면 GROWTH_NOT_PROJECTABLE — 상한으로 깎아서 계산하지 않는다', () => {
    const s = hyperGrowthCompany()
    const r = computeFairValue(s, cfg)
    expect(r.status).toBe('INSUFFICIENT_DATA')
    if (r.status === 'INSUFFICIENT_DATA') {
      expect(r.reason).toBe('GROWTH_NOT_PROJECTABLE')
      expect(r.detail).toContain('투영 상한')
    }
  })

  it('상한을 올려 주면 같은 기업이 값을 내며, 그 값이 터무니없다는 것이 이 게이트의 근거다', () => {
    const loose = structuredClone(cfg)
    loose.valuation.max_projectable_growth = 100
    const r = ok(computeFairValue(hyperGrowthCompany(), loose))
    // 게이트가 없으면 주가 $7.44짜리 회사의 내재가치가 주당 수백 달러로 나온다.
    expect(r.perShare).toBeGreaterThan(100)
  })

  it('상한 바로 아래 성장률은 그대로 통과한다 (경계는 초과일 때만 막는다)', () => {
    const tight = structuredClone(cfg)
    // 기준 픽스처의 초기 성장률 0.17933864에 정확히 맞춘 상한 — 같은 값은 막지 않는다
    tight.valuation.max_projectable_growth = 0.17933863656393517
    expect(computeFairValue(eligibleForFairValue(), tight).status).toBe('OK')
    tight.valuation.max_projectable_growth = 0.17
    expect(computeFairValue(eligibleForFairValue(), tight).status).toBe('INSUFFICIENT_DATA')
  })
})

/**
 * 게이트가 아니라 **산술** 자체를 고정한다. eligibleForFairValue()는 완전히 결정적이므로
 * 모든 중간값이 하나의 수로 정해진다 — config.yaml 값(할인율 9%, 터미널 2.5%, 페이드
 * 1/0.8/0.6/0.4/0.2/0, 성숙마진 15%)만 보고 엔진과 무관하게 재계산한 숫자다.
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

  it('기업가치·자기자본가치·주당가치를 정확한 값으로 고정한다', () => {
    expect(r.enterpriseValue).toBeCloseTo(3_319_177_146.41, 1)
    expect(r.equityValue).toBeCloseTo(3_719_177_146.41, 1)
    expect(r.perShare).toBeCloseTo(37.19177146, 6)
  })

  it('할인율을 올리면 주당가치가 내려간다 (단조성)', () => {
    const higher = structuredClone(cfg)
    higher.scoring.wacc_assumption = 0.12
    const h = ok(computeFairValue(eligibleForFairValue(), higher))
    expect(h.assumptions.discountRate).toBe(0.12)
    expect(h.perShare).toBeCloseTo(27.13298244, 6)
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
    expect(r.perShare).toBeCloseTo(37.19177146, 6)
  })

  it('희석주식수가 없으면 발행주식수로 내려간다', () => {
    const s = eligibleForFairValue()
    s.ttm = s.ttm.map((p) => ({ ...p, sharesDiluted: null }))
    s.sharesOutstanding = 50_000_000
    const r = ok(computeFairValue(s, cfg))
    expect(r.assumptions.sharesSource).toBe('outstanding')
    expect(r.perShare).toBeCloseTo(37.19177146 * 2, 6)
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
