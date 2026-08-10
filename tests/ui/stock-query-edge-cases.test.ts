import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getRawDb, runMigrations } from '@/db/client'
import { getStockDetail } from '@/app/_queries/stock'

/**
 * stock-query.test.ts의 시나리오는 CRWD가 이미 완전히 스코어링되어 있어서
 * "회사는 존재하지만 파이프라인이 아직 채점하지 않은 상태"가 한 번도 실행되지
 * 않는다. industry-query-edge-cases.test.ts / map-query-edge-cases.test.ts에서
 * 이미 걸렸던 것과 같은 모양의 버그(scores를 INNER JOIN해서 미스코어링 회사가
 * 통째로 사라지는 문제)가 Stock Detail 화면에도 반복되지 않는지 검증한다.
 */
describe('getStockDetail 스코어링 파이프라인 실행 전', () => {
  function seedBase(db: ReturnType<typeof getRawDb>) {
    db.prepare(
      `INSERT INTO themes (slug, name, display_order) VALUES ('ai-software-semi', 'AI', 1)`,
    ).run()
    db.prepare(
      `INSERT INTO industries (slug, theme_slug, name)
       VALUES ('sensors', 'ai-software-semi', 'Sensors')`,
    ).run()
  }

  it('scores 행이 아예 없어도 404가 아니라 정체성과 재무는 그대로 나오고 점수 섹션만 빈다', () => {
    const db = getRawDb(join(mkdtempSync(join(tmpdir(), 'tb-stock-edge-')), 's.db'))
    runMigrations(db)
    seedBase(db)
    db.prepare(
      `INSERT INTO companies (cik, ticker, name, sic, exchange, is_active, first_seen, last_updated)
       VALUES (401, 'FRESH', 'FRESH Inc', '3674', 'Q', 1, '2026-08-09', '2026-08-09')`,
    ).run()
    db.prepare(
      `INSERT INTO company_industry (cik, industry_slug, theme_slug, is_primary, source)
       VALUES (401, 'sensors', 'ai-software-semi', 1, 'sic')`,
    ).run()
    db.prepare(
      `INSERT INTO financials (cik, period_end, period_type, revenue, gross_profit,
                               operating_income, fcf, cash, total_debt, computed_at)
       VALUES (401, '2025-03-31', 'TTM', 1000, 600, 50, 30, 200, 10, '2026-08-09T00:00:00.000Z')`,
    ).run()
    // scores/score_factors/red_flags/market_data 행 없음 — pipeline:universe 직후를 재현한다.

    const d = getStockDetail(db, 'FRESH', '2026-08-09')
    db.close()

    expect(d).not.toBeNull()
    expect(d!.ticker).toBe('FRESH')
    expect(d!.name).toBe('FRESH Inc')
    expect(d!.industryName).toBe('Sensors')
    expect(d!.classificationSource).toBe('sic')

    // 점수 관련 필드는 전부 null이지 0이나 거짓 기본값이 아니다.
    expect(d!.category).toBeNull()
    expect(d!.tenbagger).toBeNull()
    expect(d!.completeness).toBeNull()
    expect(d!.engineVersion).toBeNull()
    expect(d!.factors).toEqual([])
    expect(d!.flags).toEqual([])

    // 재무는 scores와 무관하게 그대로 나온다.
    expect(d!.quality.grossMargin).toBeCloseTo(0.6)
    expect(d!.quality.cash).toBe(200)

    // 설립 주 정보를 캡처하기 전에 만들어진 회사 행이라도(NULL) 죽지 않는다.
    expect(d!.fiscalYearEnd).toBeNull()
    expect(d!.stateOfIncorporation).toBeNull()
    expect(d!.stateOfIncorporationDescription).toBeNull()

    // valuations 행도 없다 — INNER JOIN이었다면 이 회사 자체가 사라졌을 것이다.
    expect(d!.valuation).toBeNull()

    // Tenbagger Score 신선도 항목은 날짜가 없어 UNKNOWN으로 이어져야 한다(null 비교 강제형변환 금지).
    const scoreFreshness = d!.freshness.find((f) => f.label === 'Tenbagger Score')!
    expect(scoreFreshness.date).toBeNull()
  })

  it('시가총액/시세 데이터가 아예 없는 회사도 죽지 않고 null로 나온다', () => {
    const db = getRawDb(join(mkdtempSync(join(tmpdir(), 'tb-stock-edge2-')), 's.db'))
    runMigrations(db)
    seedBase(db)
    db.prepare(
      `INSERT INTO companies (cik, ticker, name, is_active, first_seen, last_updated)
       VALUES (402, 'NOPRC', 'NOPRC Inc', 1, '2026-08-09', '2026-08-09')`,
    ).run()
    db.prepare(
      `INSERT INTO company_industry (cik, industry_slug, theme_slug, is_primary, source)
       VALUES (402, 'sensors', 'ai-software-semi', 1, 'sic')`,
    ).run()

    const d = getStockDetail(db, 'NOPRC', '2026-08-09')
    db.close()

    expect(d).not.toBeNull()
    expect(d!.marketCap).toBeNull()
    expect(d!.marketCapBasis).toBeNull()
    expect(d!.price).toBeNull()
    expect(d!.priceDate).toBeNull()
    expect(d!.quality.grossMargin).toBeNull()
  })

  it('희석평균주식수 폴백으로 계산된 시가총액은 basis를 diluted_fallback으로 준다', () => {
    const db = getRawDb(join(mkdtempSync(join(tmpdir(), 'tb-stock-edge4-')), 's.db'))
    runMigrations(db)
    seedBase(db)
    db.prepare(
      `INSERT INTO companies (cik, ticker, name, is_active, first_seen, last_updated)
       VALUES (404, 'FALLBACK', 'Fallback Inc', 1, '2026-08-09', '2026-08-09')`,
    ).run()
    db.prepare(
      `INSERT INTO company_industry (cik, industry_slug, theme_slug, is_primary, source)
       VALUES (404, 'sensors', 'ai-software-semi', 1, 'sic')`,
    ).run()
    db.prepare(
      `INSERT INTO market_data (cik, date, price, shares_outstanding, market_cap, shares_basis)
       VALUES (404, '2026-08-08', 50, 40000000, 2000000000, 'diluted_fallback')`,
    ).run()

    const d = getStockDetail(db, 'FALLBACK', '2026-08-09')
    db.close()

    expect(d).not.toBeNull()
    expect(d!.marketCap).toBe(2_000_000_000)
    expect(d!.marketCapBasis).toBe('diluted_fallback')
  })

  it('없는 회사(company_industry 없음 포함)는 여전히 null', () => {
    const db = getRawDb(join(mkdtempSync(join(tmpdir(), 'tb-stock-edge3-')), 's.db'))
    runMigrations(db)
    seedBase(db)
    db.prepare(
      `INSERT INTO companies (cik, ticker, name, is_active, first_seen, last_updated)
       VALUES (403, 'ORPHAN', 'Orphan Inc', 1, '2026-08-09', '2026-08-09')`,
    ).run()
    // company_industry 행 없음 — 분류 파이프라인 전이거나 데이터 문제.

    const d = getStockDetail(db, 'ORPHAN', '2026-08-09')
    db.close()

    expect(d).toBeNull()
  })
})

/**
 * fair_value_status가 INSUFFICIENT_DATA면 price_to_fair_value_status/margin_of_safety도
 * 함께 없어야 하는 연쇄가 실제로 그렇게 저장·조회되는지 확인한다. 스코어링은 이미
 * 끝난 회사(점수 섹션은 정상)라도 밸류에이션은 독립적으로 INSUFFICIENT_DATA일 수 있다 —
 * 두 파이프라인 스텝이 서로 다른 데이터 요건을 갖기 때문이다.
 */
/**
 * 최종 리뷰 Finding 1: TTM 재무는 신고된 분기값이 아니라 누적 공시 간 차분(cumulative_diff)
 * 으로 재구성될 수 있는데, 화면 어디에도 그 사실이 드러나지 않았다. financials.source_tags에
 * 필드별로 기록된 provenance를 getStockDetail이 필드 단위로 해석해 quality.*Derived
 * 플래그를 만드는지 검증한다 — "현금만 유도됐는데 매출도 유도된 것처럼" 보이면 안 된다.
 */
describe('getStockDetail Finding 1 — TTM 유도 필드를 필드 단위로 표시한다', () => {
  function seedCompany(
    db: ReturnType<typeof getRawDb>,
    cik: number,
    ticker: string,
    sourceTags: Record<string, string>,
  ) {
    db.prepare(
      `INSERT INTO themes (slug, name, display_order) VALUES ('ai-software-semi', 'AI', 1)`,
    ).run()
    db.prepare(
      `INSERT INTO industries (slug, theme_slug, name)
       VALUES ('semis', 'ai-software-semi', 'Semiconductors')`,
    ).run()
    db.prepare(
      `INSERT INTO companies (cik, ticker, name, is_active, first_seen, last_updated)
       VALUES (?, ?, ?, 1, '2026-08-09', '2026-08-09')`,
    ).run(cik, ticker, `${ticker} Inc`)
    db.prepare(
      `INSERT INTO company_industry (cik, industry_slug, theme_slug, is_primary, source)
       VALUES (?, 'semis', 'ai-software-semi', 1, 'sic')`,
    ).run(cik)
    db.prepare(
      `INSERT INTO financials (cik, period_end, period_type, revenue, gross_profit,
                               operating_income, ocf, capex, fcf, cash, total_debt,
                               source_tags, computed_at)
       VALUES (?, '2026-06-27', 'TTM', 1000, 600, 200, 150, 50, 100, 300, 20, ?,
               '2026-08-09T00:00:00.000Z')`,
    ).run(cik, JSON.stringify(sourceTags))
  }

  it('ocf만 cumulative_diff면 FCF Margin만 유도로 표시되고 매출/마진/현금은 아니다', () => {
    const db = getRawDb(join(mkdtempSync(join(tmpdir(), 'tb-stock-derived1-')), 's.db'))
    runMigrations(db)
    seedCompany(db, 601, 'PARTDRV', {
      revenue: 'Revenues',
      grossProfit: 'GrossProfit',
      operatingIncome: 'OperatingIncomeLoss',
      ocf: 'cumulative_diff',
      capex: 'PaymentsToAcquirePropertyPlantAndEquipment',
      cash: 'CashAndCashEquivalentsAtCarryingValue',
      totalDebt: 'DebtCurrent',
      derived: 'cumulative_diff@2026-06-27',
    })

    const d = getStockDetail(db, 'PARTDRV', '2026-08-09')
    db.close()

    expect(d).not.toBeNull()
    expect(d!.quality.fcfMarginDerived).toBe(true) // ocf가 유도됐으므로 fcf도 유도
    expect(d!.quality.revenueDerived).toBe(false)
    expect(d!.quality.grossMarginDerived).toBe(false)
    expect(d!.quality.operatingMarginDerived).toBe(false)
    expect(d!.quality.cashDerived).toBe(false)
    expect(d!.quality.totalDebtDerived).toBe(false)
  })

  it('revenue가 cumulative_diff면 revenue를 쓰는 모든 지표가 유도로 표시되지만 현금/부채는 아니다', () => {
    const db = getRawDb(join(mkdtempSync(join(tmpdir(), 'tb-stock-derived2-')), 's.db'))
    runMigrations(db)
    seedCompany(db, 602, 'REVDRV', {
      revenue: 'cumulative_diff',
      grossProfit: 'GrossProfit',
      operatingIncome: 'OperatingIncomeLoss',
      ocf: 'NetCashProvidedByUsedInOperatingActivities',
      capex: 'PaymentsToAcquirePropertyPlantAndEquipment',
      cash: 'CashAndCashEquivalentsAtCarryingValue',
      totalDebt: 'DebtCurrent',
      derived: 'cumulative_diff@2026-06-27',
    })

    const d = getStockDetail(db, 'REVDRV', '2026-08-09')
    db.close()

    expect(d).not.toBeNull()
    expect(d!.quality.revenueDerived).toBe(true)
    expect(d!.quality.grossMarginDerived).toBe(true)
    expect(d!.quality.operatingMarginDerived).toBe(true)
    expect(d!.quality.fcfMarginDerived).toBe(true)
    expect(d!.quality.cashDerived).toBe(false)
    expect(d!.quality.totalDebtDerived).toBe(false)
  })

  it('모든 필드가 직접 신고된 태그면 유도 플래그가 전부 false다(완전 보고 케이스)', () => {
    const db = getRawDb(join(mkdtempSync(join(tmpdir(), 'tb-stock-derived3-')), 's.db'))
    runMigrations(db)
    seedCompany(db, 603, 'ALLRPT', {
      revenue: 'Revenues',
      grossProfit: 'GrossProfit',
      operatingIncome: 'OperatingIncomeLoss',
      ocf: 'NetCashProvidedByUsedInOperatingActivities',
      capex: 'PaymentsToAcquirePropertyPlantAndEquipment',
      cash: 'CashAndCashEquivalentsAtCarryingValue',
      totalDebt: 'DebtCurrent',
    })

    const d = getStockDetail(db, 'ALLRPT', '2026-08-09')
    db.close()

    expect(d).not.toBeNull()
    expect(d!.quality.revenueDerived).toBe(false)
    expect(d!.quality.grossMarginDerived).toBe(false)
    expect(d!.quality.operatingMarginDerived).toBe(false)
    expect(d!.quality.fcfMarginDerived).toBe(false)
    expect(d!.quality.cashDerived).toBe(false)
    expect(d!.quality.totalDebtDerived).toBe(false)
  })

  it('source_tags가 깨진 JSON이어도 죽지 않고 유도되지 않은 것으로 안전하게 처리한다', () => {
    const db = getRawDb(join(mkdtempSync(join(tmpdir(), 'tb-stock-derived4-')), 's.db'))
    runMigrations(db)
    db.prepare(
      `INSERT INTO themes (slug, name, display_order) VALUES ('ai-software-semi', 'AI', 1)`,
    ).run()
    db.prepare(
      `INSERT INTO industries (slug, theme_slug, name)
       VALUES ('semis', 'ai-software-semi', 'Semiconductors')`,
    ).run()
    db.prepare(
      `INSERT INTO companies (cik, ticker, name, is_active, first_seen, last_updated)
       VALUES (604, 'BADJSON', 'BADJSON Inc', 1, '2026-08-09', '2026-08-09')`,
    ).run()
    db.prepare(
      `INSERT INTO company_industry (cik, industry_slug, theme_slug, is_primary, source)
       VALUES (604, 'semis', 'ai-software-semi', 1, 'sic')`,
    ).run()
    db.prepare(
      `INSERT INTO financials (cik, period_end, period_type, revenue, gross_profit, source_tags, computed_at)
       VALUES (604, '2026-06-27', 'TTM', 1000, 600, '{not valid json', '2026-08-09T00:00:00.000Z')`,
    ).run()

    const d = getStockDetail(db, 'BADJSON', '2026-08-09')
    db.close()

    expect(d).not.toBeNull()
    expect(d!.quality.revenueDerived).toBe(false)
    expect(d!.quality.grossMarginDerived).toBe(false)
  })
})

describe('getStockDetail 밸류에이션이 INSUFFICIENT_DATA인 회사', () => {
  it('fair value가 없으면 price-to-fair-value/margin-of-safety도 null로 연쇄된다', () => {
    const db = getRawDb(join(mkdtempSync(join(tmpdir(), 'tb-stock-valedge-')), 's.db'))
    runMigrations(db)
    db.prepare(
      `INSERT INTO themes (slug, name, display_order) VALUES ('ai-software-semi', 'AI', 1)`,
    ).run()
    db.prepare(
      `INSERT INTO industries (slug, theme_slug, name)
       VALUES ('biotech', 'ai-software-semi', 'Biotech')`,
    ).run()
    db.prepare(
      `INSERT INTO companies (cik, ticker, name, is_active, first_seen, last_updated)
       VALUES (501, 'PRECL', 'Preclinical Inc', 1, '2026-08-09', '2026-08-09')`,
    ).run()
    db.prepare(
      `INSERT INTO company_industry (cik, industry_slug, theme_slug, is_primary, source)
       VALUES (501, 'biotech', 'ai-software-semi', 1, 'sic')`,
    ).run()
    db.prepare(
      `INSERT INTO valuations (
         cik, as_of,
         fair_value_status, fair_value_reason, fair_value_detail,
         price_to_fair_value_status,
         moat_signal, moat_periods_evaluated, moat_periods_clearing, moat_insufficient_reason, moat_evidence,
         uncertainty_level, uncertainty_score, uncertainty_drivers,
         engine_version
       ) VALUES (
         501, '2026-08-09',
         'INSUFFICIENT_DATA', 'NOT_CASH_GENERATIVE', '잉여현금흐름과 영업이익이 모두 0 이하',
         'UNAVAILABLE',
         'INSUFFICIENT_DATA', 2, 0, 'TOO_FEW_PERIODS', '["보고된 연간 실적이 2개뿐 — 판정에 필요한 최소 4개에 못 미침"]',
         'SEVERE', 0.9, '[]',
         'valuation-1.2.0'
       )`,
    ).run()

    const d = getStockDetail(db, 'PRECL', '2026-08-09')
    db.close()

    expect(d).not.toBeNull()
    const v = d!.valuation!
    expect(v).not.toBeNull()
    expect(v.fairValueStatus).toBe('INSUFFICIENT_DATA')
    expect(v.fairValueReason).toBe('NOT_CASH_GENERATIVE')
    expect(v.fairValuePerShare).toBeNull()
    expect(v.priceToFairValueStatus).toBe('UNAVAILABLE')
    expect(v.priceToFairValueRatio).toBeNull()
    expect(v.marginOfSafety).toBeNull()
    expect(v.valuationStatus).toBeNull()
    expect(v.moatSignal).toBe('INSUFFICIENT_DATA')
    expect(v.moatInsufficientReason).toBe('TOO_FEW_PERIODS')
  })
})
