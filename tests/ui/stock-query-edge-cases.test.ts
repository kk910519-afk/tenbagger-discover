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
    expect(d!.price).toBeNull()
    expect(d!.priceDate).toBeNull()
    expect(d!.quality.grossMargin).toBeNull()
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
         moat_signal, moat_periods_evaluated, moat_periods_clearing, moat_evidence,
         uncertainty_level, uncertainty_score, uncertainty_drivers,
         engine_version
       ) VALUES (
         501, '2026-08-09',
         'INSUFFICIENT_DATA', 'NOT_CASH_GENERATIVE', '잉여현금흐름과 영업이익이 모두 0 이하',
         'UNAVAILABLE',
         'INSUFFICIENT_DATA', 2, 0, '["ROIC를 산출할 수 있는 연간 기간이 2개뿐 — 최소 4개 필요"]',
         'VERY_HIGH', 0.9, '[]',
         'valuation-1.0.0'
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
  })
})
