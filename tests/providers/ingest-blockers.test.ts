import { describe, it, expect } from 'vitest'
import {
  indexFacts, resolveStock, resolveTotalDebt, type InstantContext,
} from '@/providers/fundamental/resolve'
import { normalizeFacts } from '@/providers/fundamental/normalizer'
import type { RawFact } from '@/providers/types'

// 최종 리뷰(final-review-ingest.md)가 라이브 DB에서 확인한 결함들의 회귀 테스트.
// 값은 전부 실제 신고 숫자다 — 범위가 아니라 계산된 값 자체를 고정한다.

function fact(p: Partial<RawFact>): RawFact {
  return {
    cik: 1, tag: 'Revenues', unit: 'USD', periodStart: null,
    periodEnd: '2025-03-31', qtrs: 1, value: 100, form: '10-Q',
    filedDate: '2025-05-01', accession: 'a', source: 'bulk', ...p,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// F1 — API가 같은 회계기간을 두 개의 period_end로 내보낸다
// 실측: Transcat(TRNS, CIK 99302), accession 0001437749-25-033338.
// `Revenues` qtrs=1 / period_start 2025-06-29 가 period_end 2025-09-27과
// 2025-09-30 두 개로 들어오고 값(82,272,000)은 완전히 같다.
// ─────────────────────────────────────────────────────────────────────────────
describe('F1 — indexFacts: API 내부 중복 기간 정합 (TRNS 실사례)', () => {
  const trns = (periodEnd: string, tag: string, value: number, qtrs = 1): RawFact => fact({
    cik: 99302, source: 'api', qtrs, periodStart: qtrs === 1 ? '2025-06-29' : '2025-03-30',
    periodEnd, tag, value, filedDate: '2025-11-05', accession: '0001437749-25-033338',
  })

  it('같은 (qtrs, period_start)에 값까지 같은 두 API 날짜는 하나로 합쳐진다', () => {
    const idx = indexFacts([
      trns('2025-09-27', 'Revenues', 82_272_000),
      trns('2025-09-27', 'GrossProfit', 26_762_000),
      trns('2025-09-27', 'OperatingIncomeLoss', 3_505_000),
      trns('2025-09-27', 'NetIncomeLoss', 1_269_000),
      trns('2025-09-27', 'CostOfGoodsAndServicesSold', 55_510_000),
      trns('2025-09-27', 'ShareBasedCompensation', 2_970_000),
      trns('2025-09-30', 'Revenues', 82_272_000),
    ])
    const q1 = idx.duration.get(1)!
    expect([...q1.keys()]).toEqual(['2025-09-27'])
    expect(q1.get('2025-09-27')!.get('Revenues')).toBe(82_272_000)
    expect(q1.get('2025-09-30')).toBeUndefined()
  })

  it('canonical 날짜는 사실이 더 많이 찍힌 쪽이다 — 소수파 날짜로 합쳐지지 않는다', () => {
    const idx = indexFacts([
      trns('2025-09-30', 'Revenues', 82_272_000),
      trns('2025-09-27', 'Revenues', 82_272_000),
      trns('2025-09-27', 'GrossProfit', 26_762_000),
    ])
    expect([...idx.duration.get(1)!.keys()]).toEqual(['2025-09-27'])
  })

  it('값이 다르면 합치지 않는다 — 전신/후신 법인이 같은 명목 기간을 쓰는 경우 (VTRS 실사례)', () => {
    const idx = indexFacts([
      fact({
        cik: 1792044, source: 'api', qtrs: 1, periodStart: '2020-01-01',
        periodEnd: '2020-03-29', tag: 'Revenues', value: 2_724_800_000, filedDate: '2020-05-08',
      }),
      fact({
        cik: 1792044, source: 'api', qtrs: 1, periodStart: '2020-01-01',
        periodEnd: '2020-03-31', tag: 'Revenues', value: 2_881_300_000, filedDate: '2020-05-08',
      }),
    ])
    expect([...idx.duration.get(1)!.keys()].sort()).toEqual(['2020-03-29', '2020-03-31'])
  })

  it('period_start가 다르면 합치지 않는다 — 같은 qtrs 버킷의 서로 다른 스텁 기간 (KRMD 실사례)', () => {
    const idx = indexFacts([
      fact({
        source: 'api', qtrs: 1, periodStart: '2016-03-01', periodEnd: '2016-05-31',
        tag: 'Revenues', value: 5_000_000,
      }),
      fact({
        source: 'api', qtrs: 1, periodStart: '2016-04-01', periodEnd: '2016-06-30',
        tag: 'Revenues', value: 5_000_000,
      }),
    ])
    expect([...idx.duration.get(1)!.keys()].sort()).toEqual(['2016-05-31', '2016-06-30'])
  })

  it('종료일 간격이 허용치(20일)를 넘으면 합치지 않는다', () => {
    const idx = indexFacts([
      fact({
        source: 'api', qtrs: 1, periodStart: '2025-06-29', periodEnd: '2025-09-27',
        tag: 'Revenues', value: 82_272_000,
      }),
      fact({
        source: 'api', qtrs: 1, periodStart: '2025-06-29', periodEnd: '2025-10-18',
        tag: 'Revenues', value: 82_272_000,
      }),
    ])
    expect([...idx.duration.get(1)!.keys()].sort()).toEqual(['2025-09-27', '2025-10-18'])
  })

  it('기간 그리드는 qtrs 버킷을 가로질러 공유된다 — 회계연도 말 bulk 유령 분기 (CSCO 실사례)', () => {
    // Cisco는 회계연도 말에 별도 4분기를 신고하지 않아 API에 qtrs=1 사실이 없다.
    // 버킷별로 정합하면 bulk의 2025-07-31이 붙을 곳이 없어 전 항목 NULL인 유령
    // 분기가 진짜 마감일(2025-07-26) 닷새 뒤에 생긴다.
    const idx = indexFacts([
      fact({
        cik: 858877, source: 'api', qtrs: 4, periodStart: '2024-07-28',
        periodEnd: '2025-07-26', tag: 'GrossProfit', value: 36_790_000_000,
        filedDate: '2025-09-04',
      }),
      fact({
        cik: 858877, source: 'bulk', qtrs: 1, periodEnd: '2025-07-31',
        tag: 'CostOfGoodsAndServicesSold', value: 355_000_000, filedDate: '2025-09-04',
      }),
    ])
    expect([...idx.duration.get(1)!.keys()]).toEqual(['2025-07-26'])
    expect(idx.duration.get(1)!.get('2025-07-26')!.get('CostOfGoodsAndServicesSold'))
      .toBe(355_000_000)
  })

  it('겹치는 태그가 없는 시점 날짜는 합치지 않는다 — 표지 발행주식수 날짜 보호', () => {
    const idx = indexFacts([
      fact({
        source: 'api', qtrs: 0, periodEnd: '2026-03-28', tag: 'StockholdersEquity',
        value: 5_000_000,
      }),
      fact({
        source: 'api', qtrs: 0, periodEnd: '2026-04-15', unit: 'shares',
        tag: 'EntityCommonStockSharesOutstanding', value: 244_415_099,
      }),
    ])
    expect([...idx.instant.keys()].sort()).toEqual(['2026-03-28', '2026-04-15'])
  })
})

describe('F1 — 가중평균 주식수는 병합 증거가 아니다 (SYPR 실사례)', () => {
  // SYPR(CIK 864240) Q3 FY2025는 API에 두 날짜로 들어온다. 2025-09-28에는 사실 22건
  // (진짜 마감일), 2025-09-29에는 **딱 2건** — 둘 다 기본 가중평균 주식수이고 값이
  // 22,251,000 / 22,011,000으로 1.1% 다르다. 가중평균은 기간 종료일이 하루만 움직여도
  // 값이 달라지는 것이 정상이므로, 이것을 "값이 다르다"는 증거로 쓰면 정확히 같은
  // 분기인 경우에 병합이 거부된다. 그러면 bulk의 2025-09-30이 더 가까운 09-29로 붙어
  // 완전한 중복 분기가 만들어지고, 최신 TTM이 9월을 두 번 센다.
  const sypr = (
    periodEnd: string, tag: string, value: number, qtrs: number, source: 'api' | 'bulk' = 'api',
  ): RawFact => fact({
    cik: 864240, source, qtrs, periodEnd, tag, value,
    periodStart: qtrs === 1 ? '2025-06-30' : '2025-01-01',
    filedDate: '2025-11-10', accession: 'sypr-q3',
  })

  // 실측 밀도: 2025-09-28에 API 사실 22건, 2025-09-29에 2건.
  const real = [
    sypr('2025-09-28', 'Revenues', 28_672_000, 1),
    sypr('2025-09-28', 'GrossProfit', 2_051_000, 1),
    sypr('2025-09-28', 'NetIncomeLoss', 517_000, 1),
    sypr('2025-09-28', 'OperatingIncomeLoss', 601_000, 1),
    sypr('2025-09-28', 'CostOfGoodsAndServicesSold', 26_621_000, 1),
    sypr('2025-09-28', 'ShareBasedCompensation', 121_000, 1),
    sypr('2025-09-28', 'ResearchAndDevelopmentExpense', 44_000, 1),
    sypr('2025-09-28', 'Revenues', 84_733_000, 3),
    sypr('2025-09-28', 'GrossProfit', 6_431_000, 3),
    sypr('2025-09-28', 'WeightedAverageNumberOfSharesOutstandingBasic', 22_251_000, 3),
  ]
  const stray = sypr('2025-09-29', 'WeightedAverageNumberOfSharesOutstandingBasic', 22_011_000, 3)

  it('겹치는 태그가 가중평균 주식수뿐이면 밀도 비대칭으로 판정해 흡수한다', () => {
    const idx = indexFacts([...real, stray])
    expect([...idx.duration.get(3)!.keys()]).toEqual(['2025-09-28'])
  })

  it('bulk 분기는 같은 qtrs 버킷에 사실이 있는 날짜로 투영된다 — 유령 날짜가 훔쳐가지 못한다', () => {
    // 병합이 안 되는 경우에도(값이 어긋나는 진짜 다른 실체 등) 거리만으로 고르면
    // |09-30 − 09-29| = 1 이 |09-30 − 09-28| = 2 를 이겨 bulk 분기 전체가 qtrs=3에만
    // 존재하는 날짜로 붙는다. 같은 버킷 우선 규칙이 그것을 막는다.
    const idx = indexFacts([
      ...real,
      // 값이 크게 어긋나 병합이 거부되는 유령 날짜(qtrs=3에만 존재)
      sypr('2025-09-29', 'Revenues', 1_000_000, 3),
      sypr('2025-09-29', 'GrossProfit', 100_000, 3),
      sypr('2025-09-29', 'NetIncomeLoss', 10_000, 3),
      sypr('2025-09-29', 'ShareBasedCompensation', 1_000, 3),
      sypr('2025-09-30', 'Revenues', 28_672_000, 1, 'bulk'),
      sypr('2025-09-30', 'GrossProfit', 2_051_000, 1, 'bulk'),
    ])
    expect([...idx.duration.get(1)!.keys()]).toEqual(['2025-09-28'])
  })

  it('겹치는 태그가 다수 일치하면 소수의 불일치로 거부하지 않는다 (COHU/BLFS 부류)', () => {
    const idx = indexFacts([
      fact({ source: 'api', qtrs: 1, periodStart: '2017-01-01', periodEnd: '2017-03-25', tag: 'Revenues', value: 100 }),
      fact({ source: 'api', qtrs: 1, periodStart: '2017-01-01', periodEnd: '2017-03-25', tag: 'GrossProfit', value: 40 }),
      fact({ source: 'api', qtrs: 1, periodStart: '2017-01-01', periodEnd: '2017-03-25', tag: 'NetIncomeLoss', value: 10 }),
      fact({ source: 'api', qtrs: 1, periodStart: '2017-01-01', periodEnd: '2017-03-25', tag: 'OperatingIncomeLoss', value: 12 }),
      fact({ source: 'api', qtrs: 1, periodStart: '2017-01-01', periodEnd: '2017-04-01', tag: 'Revenues', value: 100 }),
      fact({ source: 'api', qtrs: 1, periodStart: '2017-01-01', periodEnd: '2017-04-01', tag: 'GrossProfit', value: 40 }),
      fact({ source: 'api', qtrs: 1, periodStart: '2017-01-01', periodEnd: '2017-04-01', tag: 'NetIncomeLoss', value: 10 }),
      fact({ source: 'api', qtrs: 1, periodStart: '2017-01-01', periodEnd: '2017-04-01', tag: 'OperatingIncomeLoss', value: 99 }),
    ])
    expect([...idx.duration.get(1)!.keys()]).toEqual(['2017-03-25'])
  })

  it('겹치는 항목이 전부 어긋나면 여전히 합치지 않는다 (VTRS 전신/후신 보호)', () => {
    const idx = indexFacts([
      fact({ source: 'api', qtrs: 1, periodStart: '2020-01-01', periodEnd: '2020-03-29', tag: 'Revenues', value: 2_724_800_000 }),
      fact({ source: 'api', qtrs: 1, periodStart: '2020-01-01', periodEnd: '2020-03-29', tag: 'GrossProfit', value: 1_000_000_000 }),
      fact({ source: 'api', qtrs: 1, periodStart: '2020-01-01', periodEnd: '2020-03-31', tag: 'Revenues', value: 2_881_300_000 }),
      fact({ source: 'api', qtrs: 1, periodStart: '2020-01-01', periodEnd: '2020-03-31', tag: 'GrossProfit', value: 1_400_000_000 }),
    ])
    expect([...idx.duration.get(1)!.keys()].sort()).toEqual(['2020-03-29', '2020-03-31'])
  })
})

describe('F2(심층) — 티어 1·2가 롤업 태그에 닿는다', () => {
  const cases: [string, Record<string, number>, number][] = [
    ['TSLA 2026-06-30', { DebtCurrent: 1_340_000_000, LongTermDebt: 7_721_000_000 }, 9_061_000_000],
    ['ADBE 2026-05-29', { DebtCurrent: 1_843_000_000, LongTermDebt: 4_802_000_000 }, 6_645_000_000],
    ['XRX 2026-06-30', { DebtCurrent: 70_000_000, LongTermDebt: 4_153_000_000 }, 4_223_000_000],
    ['MU 2025-11-27', { DebtCurrent: 569_000_000, LongTermDebt: 8_844_000_000 }, 9_413_000_000],
    ['SWKS 2026-07-03', { DebtCurrent: 0, LongTermDebt: 496_900_000 }, 496_900_000],
    ['MTCH 2026-06-30', { LongTermDebtCurrent: 0, LongTermDebt: 3_551_878_000 }, 3_551_878_000],
    [
      'VRSK 2026-03-31',
      { DebtCurrent: 258_400_000, DebtLongtermAndShorttermCombinedAmount: 4_475_600_000 },
      4_475_600_000,
    ],
  ]
  for (const [name, tags, expected] of cases) {
    it(`${name} — 옛 티어 구조는 유동 부분만 냈다`, () => {
      expect(resolveTotalDebt(new Map(Object.entries(tags)))!.value).toBe(expected)
    })
  }
})

describe('F1 — normalizeFacts: TTM이 같은 분기를 두 번 세지 않는다 (TRNS 실사례)', () => {
  // 실측 TRNS 분기 매출: 2025-06-28 76,424 / 2025-09-27 82,272 / 2025-12-27 83,856
  //                      / 2026-03-28 88,793 / 2026-06-27 92,945 (천 달러)
  // 결함 상태에서는 2025-09-30 중복 분기가 창에 끼어 TTM = 92,945 + 83,856
  // + 82,272 + 82,272 = 341,345 (9월 두 번, 6월 탈락)이 됐다.
  const q = (start: string, end: string, value: number, dup?: string): RawFact[] => {
    const rows = [fact({
      cik: 99302, source: 'api', qtrs: 1, periodStart: start, periodEnd: end,
      tag: 'Revenues', value, filedDate: end, accession: `acc-${end}`,
    })]
    if (dup !== undefined) {
      rows.push(fact({
        cik: 99302, source: 'api', qtrs: 1, periodStart: start, periodEnd: dup,
        tag: 'Revenues', value, filedDate: end, accession: `acc-${end}`,
      }))
    }
    return rows
  }

  const facts = [
    ...q('2025-03-30', '2025-06-28', 76_424_000),
    ...q('2025-06-29', '2025-09-27', 82_272_000, '2025-09-30'),
    ...q('2025-09-28', '2025-12-27', 83_856_000),
    ...q('2025-12-28', '2026-03-28', 88_793_000),
    ...q('2026-03-29', '2026-06-27', 92_945_000),
  ]

  it('분기 행은 중복 없이 5개다', () => {
    const r = normalizeFacts(facts)
    expect(r.quarterly.map((p) => p.periodEnd)).toEqual([
      '2026-06-27', '2026-03-28', '2025-12-27', '2025-09-27', '2025-06-28',
    ])
  })

  it('최신 TTM 매출은 347,866,000이다 (92,945 + 88,793 + 83,856 + 82,272)', () => {
    const r = normalizeFacts(facts)
    expect(r.ttm[0]!.periodEnd).toBe('2026-06-27')
    expect(r.ttm[0]!.revenue).toBe(347_866_000)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// F2 — 티어 1~3이 단기차입금을 버린다
// ─────────────────────────────────────────────────────────────────────────────
describe('F2 — resolveTotalDebt: 단기차입금은 티어와 무관하게 더해진다', () => {
  it('NFLX 2026-06-30: 비유동 장기차입금 + ShortTermBorrowings', () => {
    expect(resolveTotalDebt(new Map([
      ['LongTermDebtNoncurrent', 11_825_548_000],
      ['ShortTermBorrowings', 2_483_758_000],
    ]))).toEqual({
      value: 14_309_306_000,
      tag: 'LongTermDebtNoncurrent+ShortTermBorrowings',
    })
  })

  it('CEG 2026-06-30: 비유동 + 유동만기 + ShortTermBorrowings', () => {
    expect(resolveTotalDebt(new Map([
      ['LongTermDebtNoncurrent', 19_111_000_000],
      ['LongTermDebtCurrent', 363_000_000],
      ['ShortTermBorrowings', 5_226_000_000],
    ]))).toEqual({
      value: 24_700_000_000,
      tag: 'LongTermDebtNoncurrent+LongTermDebtCurrent+ShortTermBorrowings',
    })
  })

  it('GEHC 2025-09-30: 단기차입금이 유동 만기분을 품고 있으면 더하지 않는다 (리뷰 반례)', () => {
    // 회사 자신의 장기차입금 롤업 `LongTermDebt`(10,282,000,000)가
    // `LongTermDebtNoncurrent + ShortTermBorrowings`와 정확히 일치한다 —
    // 즉 여기서 단기차입금은 별도 항목이 아니라 유동 부분 그 자체다.
    // 더하면 $2.0B 이중계상이 된다.
    expect(resolveTotalDebt(new Map([
      ['LongTermDebt', 10_282_000_000],
      ['LongTermDebtNoncurrent', 8_277_000_000],
      ['LongTermDebtCurrent', 2_002_000_000],
      ['ShortTermBorrowings', 2_005_000_000],
    ]))).toEqual({ value: 10_282_000_000, tag: 'LongTermDebt' })
  })

  it('AMAT 2026-04-26: 같은 잔액을 두 이름으로 태깅했으면 더하지 않는다', () => {
    expect(resolveTotalDebt(new Map([
      ['LongTermDebtNoncurrent', 5_256_000_000],
      ['LongTermDebtCurrent', 1_199_000_000],
      ['ShortTermBorrowings', 1_199_000_000],
    ]))).toEqual({
      value: 6_455_000_000,
      tag: 'LongTermDebtNoncurrent+LongTermDebtCurrent',
    })
  })

  it('LITE 2025-12-27: 중복 태깅 판정은 값이 같을 때만', () => {
    expect(resolveTotalDebt(new Map([
      ['LongTermDebtNoncurrent', 47_100_000],
      ['LongTermDebtCurrent', 3_240_200_000],
      ['ShortTermBorrowings', 3_240_200_000],
    ]))).toEqual({
      value: 3_287_300_000,
      tag: 'LongTermDebtNoncurrent+LongTermDebtCurrent',
    })
  })

  it('유동 부분은 총계 DebtCurrent와 구성요소 합 중 큰 쪽이다', () => {
    expect(resolveTotalDebt(new Map([
      ['LongTermDebtNoncurrent', 1000],
      ['LongTermDebtCurrent', 100], ['ShortTermBorrowings', 50],
      ['DebtCurrent', 400],
    ]))).toEqual({
      value: 1400,
      tag: 'LongTermDebtNoncurrent+LongTermDebtCurrent+DebtCurrent',
    })

    expect(resolveTotalDebt(new Map([
      ['LongTermDebtNoncurrent', 1000],
      ['LongTermDebtCurrent', 100], ['ShortTermBorrowings', 350],
      ['DebtCurrent', 400],
    ]))).toEqual({
      value: 1450,
      tag: 'LongTermDebtNoncurrent+LongTermDebtCurrent+ShortTermBorrowings',
    })
  })

  it('DebtCurrent만 있어도 단기차입금이 더 크면 그쪽을 쓴다 (티어 2)', () => {
    expect(resolveTotalDebt(new Map([
      ['DebtCurrent', 300], ['ShortTermBorrowings', 900],
    ]))).toEqual({ value: 900, tag: 'ShortTermBorrowings' })
    // 티어 2가 유동 부분만 낼 때도 0은 null이다 — 유동 총계 0은 비유동 잔액에 대해
    // 아무 말도 하지 않는다(MTCH 2026-06-30의 `LongTermDebtCurrent`=0이 그 경우다).
    expect(resolveTotalDebt(new Map([['DebtCurrent', 0]]))).toBeNull()
  })

  it('장·단기 합산 총계 태그(티어 3)에는 단기차입금을 더하지 않는다 — 정의상 포함', () => {
    expect(resolveTotalDebt(new Map([
      ['DebtLongtermAndShorttermCombinedAmount', 4200], ['ShortTermBorrowings', 400],
    ]))).toEqual({ value: 4200, tag: 'DebtLongtermAndShorttermCombinedAmount' })
  })

  it('XEL 실사례(티어 4)는 그대로 유지된다', () => {
    expect(resolveTotalDebt(new Map([
      ['LongTermDebt', 16_000_000_000], ['ShortTermBorrowings', 600_000_000],
    ]))).toEqual({ value: 16_600_000_000, tag: 'LongTermDebt+ShortTermBorrowings' })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// F3 — 다종류주 발행사의 표지 발행주식수는 한 종류만 덮는다
// ─────────────────────────────────────────────────────────────────────────────
describe('F3 — 표지 발행주식수의 주식 종류 커버리지 (MBLY 실사례)', () => {
  const period = (
    end: string, cover: number, basic: number, diluted: number, coverDate: string,
  ): RawFact[] => [
    fact({
      cik: 1910139, source: 'api', qtrs: 1, periodStart: '2026-03-29', periodEnd: end,
      tag: 'Revenues', value: 500_000_000, filedDate: end,
    }),
    fact({
      cik: 1910139, source: 'api', qtrs: 1, periodStart: '2026-03-29', periodEnd: end,
      unit: 'shares', tag: 'WeightedAverageNumberOfSharesOutstandingBasic',
      value: basic, filedDate: end,
    }),
    fact({
      cik: 1910139, source: 'api', qtrs: 1, periodStart: '2026-03-29', periodEnd: end,
      unit: 'shares', tag: 'WeightedAverageNumberOfDilutedSharesOutstanding',
      value: diluted, filedDate: end,
    }),
    fact({
      cik: 1910139, source: 'api', qtrs: 0, periodEnd: coverDate, unit: 'shares',
      tag: 'EntityCommonStockSharesOutstanding', value: cover, filedDate: coverDate,
    }),
  ]

  it('표지값이 기본가중평균의 40% 미만이면 종류주 누락으로 보고 null로 남긴다', () => {
    // MBLY 2026-06-27: 표지 244,415,099(Class A) vs 기본가중평균 818,000,000(전 종류).
    const r = normalizeFacts(period('2026-06-27', 244_415_099, 818_000_000, 818_000_000, '2026-04-15'))
    const q = r.quarterly.find((p) => p.periodEnd === '2026-06-27')!
    expect(q.sharesOutstanding).toBeNull()
    expect(q.sharesDiluted).toBe(818_000_000)
    expect(r.sourceTags['Q:2026-06-27']!.sharesOutstanding).toBeUndefined()
  })

  it('표지값이 기본가중평균과 정합하면 그대로 쓴다', () => {
    const r = normalizeFacts(period('2026-06-27', 800_000_000, 818_000_000, 818_000_000, '2026-04-15'))
    expect(r.quarterly.find((p) => p.periodEnd === '2026-06-27')!.sharesOutstanding)
      .toBe(800_000_000)
  })

  it('전환우선주로 희석주식수만 큰 회사는 걸러내지 않는다 (TENX 실사례)', () => {
    // TENX 2025-09-30: 표지 4,562,500 / 기본 4,562,500 / 희석 39,741,404.
    const r = normalizeFacts(period('2026-06-27', 4_562_500, 4_562_500, 39_741_404, '2026-04-15'))
    expect(r.quarterly.find((p) => p.periodEnd === '2026-06-27')!.sharesOutstanding)
      .toBe(4_562_500)
  })

  it('기본가중평균이 그 기간에 직접 신고되지 않아도(유도 분기) 소급해서 판정한다', () => {
    // MBLY 회계연도 말 유도 분기(2025-12-27)에는 직접 신고된 태그가 없어, 기간별
    // 태그 맵만 보면 이 행만 가드를 통과해 Class A 단독 주식수가 살아남는다.
    const facts = [
      // 직전 분기: 기본가중평균이 직접 신고됨
      fact({
        cik: 1910139, source: 'api', qtrs: 1, periodStart: '2025-06-29',
        periodEnd: '2025-09-27', unit: 'shares',
        tag: 'WeightedAverageNumberOfSharesOutstandingBasic', value: 814_000_000,
        filedDate: '2025-10-23',
      }),
      fact({
        cik: 1910139, source: 'api', qtrs: 1, periodStart: '2025-06-29',
        periodEnd: '2025-09-27', tag: 'Revenues', value: 500_000_000, filedDate: '2025-10-23',
      }),
      // 해당 분기: 매출만 있고 주식수 태그가 전혀 없다
      fact({
        cik: 1910139, source: 'api', qtrs: 1, periodStart: '2025-09-28',
        periodEnd: '2025-12-27', tag: 'Revenues', value: 520_000_000, filedDate: '2026-02-12',
      }),
      // 표지 발행주식수(Class A 단독)
      fact({
        cik: 1910139, source: 'api', qtrs: 0, periodEnd: '2025-10-15', unit: 'shares',
        tag: 'EntityCommonStockSharesOutstanding', value: 216_005_938, filedDate: '2025-10-23',
      }),
    ]
    const r = normalizeFacts(facts)
    expect(r.quarterly.find((p) => p.periodEnd === '2025-12-27')!.sharesOutstanding).toBeNull()
  })

  it('단위 스케일 오류(1000배)일 때는 판정을 포기하고 표지값을 유지한다 (VERI 실사례)', () => {
    // VERI 2026-03-31: 표지 91,806,023 / 기본·희석 92,899,169,000(1000배 오기).
    const r = normalizeFacts(period('2026-06-27', 91_806_023, 92_899_169_000, 92_899_169_000, '2026-04-15'))
    expect(r.quarterly.find((p) => p.periodEnd === '2026-06-27')!.sharesOutstanding)
      .toBe(91_806_023)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// F4 — 가산 그룹의 구성요소가 서로 다른 대차대조표에서 오면 안 된다
// ─────────────────────────────────────────────────────────────────────────────
describe('F4 — 가산 그룹의 대차대조표 일자 정합', () => {
  const ctx = (
    dates: Record<string, string>,
    opts?: {
      absent?: Record<string, string[]>
      instant?: Record<string, Record<string, number>>
    },
  ): InstantContext => ({
    dates: new Map(Object.entries(dates)),
    absent: new Map(Object.entries(opts?.absent ?? {}).map(([d, t]) => [d, new Set(t)])),
    instant: new Map(
      Object.entries(opts?.instant ?? {}).map(([d, t]) => [d, new Map(Object.entries(t))]),
    ),
  })

  it('앵커가 유동 구역만 재측정했으면 비유동 잔액은 이월된다 (QCOM/NXPI 회귀)', () => {
    // NXPI 2026-03-29: 10-Q는 `DebtCurrent` 750,000,000만 태깅하지만 같은 대차대조표의
    // `Long-term debt`는 신고서 원문에 그대로 있다(직전 10-K 10,972,000,000).
    // 유동 총계는 비유동 구역에 대해 아무 말도 하지 않는다.
    expect(resolveTotalDebt(
      new Map([['LongTermDebtNoncurrent', 10_972_000_000], ['DebtCurrent', 750_000_000]]),
      ctx({ LongTermDebtNoncurrent: '2025-12-31', DebtCurrent: '2026-03-29' }),
    )).toEqual({
      value: 11_722_000_000,
      tag: 'LongTermDebtNoncurrent+DebtCurrent',
    })
  })

  it('앵커에 같은 구역을 덮는 태그가 있으면 낡은 값은 버린다 (QCOM 2026-06-28)', () => {
    // 앵커에 `LongTermDebt`(유동+비유동을 함께 재는 태그)가 있으므로 2025-09-28의
    // `LongTermDebtNoncurrent` 14,811,000,000은 그 값의 **이전 상태**일 뿐이다.
    // 신고서 원문: `Short-term debt 2,489` + `Long-term debt 12,781` = 15,270.
    expect(resolveTotalDebt(
      new Map([
        ['LongTermDebt', 12_781_000_000],
        ['LongTermDebtCurrent', 1_991_000_000],
        ['DebtCurrent', 2_489_000_000],
        ['LongTermDebtNoncurrent', 14_811_000_000],
        ['DebtLongtermAndShorttermCombinedAmount', 14_811_000_000],
      ]),
      ctx({
        LongTermDebt: '2026-06-28',
        LongTermDebtCurrent: '2026-06-28',
        DebtCurrent: '2026-06-28',
        LongTermDebtNoncurrent: '2025-09-28',
        DebtLongtermAndShorttermCombinedAmount: '2025-09-28',
      }),
    )).toEqual({ value: 15_270_000_000, tag: 'LongTermDebt+DebtCurrent' })
  })

  it('같은 신고서가 다른 일자에는 태깅하고 이 일자에는 안 했으면 사라진 것이다 (CVV 2025-12-31)', () => {
    // CVV FY2025 10-K: `LongTermDebtNoncurrent`를 비교연도(2024-12-31)에는 181,000으로
    // 태깅하고 당기(2025-12-31)에는 태깅하지 않았다 — 실제로 장비대출 잔액 전부가
    // 유동으로 재분류돼 비유동 잔액이 0이다. 이월하면 안 된다.
    expect(resolveTotalDebt(
      new Map([['LongTermDebtCurrent', 181_000], ['LongTermDebtNoncurrent', 113_000]]),
      ctx(
        { LongTermDebtCurrent: '2025-12-31', LongTermDebtNoncurrent: '2025-09-30' },
        { absent: { '2025-12-31': ['LongTermDebtNoncurrent'] } },
      ),
    )).toEqual({ value: 181_000, tag: 'LongTermDebtCurrent' })
  })

  it('낡은 태그가 앵커 태그의 다른 이름이면 이월하지 않는다 (LPTH 2026-03-31)', () => {
    // LPTH 2025-09-30에서 `LongTermDebtNoncurrent`와 `LongTermLoansPayable`은 둘 다
    // 4,867,298 — 같은 줄의 두 이름이다. 앵커(2026-03-31)에서 그 줄은 103,661로
    // 다시 측정됐으므로 낡은 이름을 함께 더하면 이미 상환된 대출을 두 번 세게 된다.
    expect(resolveTotalDebt(
      new Map([
        ['LongTermLoansPayable', 103_661],
        ['LoansPayableCurrent', 113_085],
        ['LongTermDebtNoncurrent', 4_867_298],
      ]),
      ctx(
        {
          LongTermLoansPayable: '2026-03-31',
          LoansPayableCurrent: '2026-03-31',
          LongTermDebtNoncurrent: '2025-09-30',
        },
        {
          instant: {
            '2025-09-30': { LongTermDebtNoncurrent: 4_867_298, LongTermLoansPayable: 4_867_298 },
          },
        },
      ),
    )).toEqual({ value: 216_746, tag: 'LongTermLoansPayable+LoansPayableCurrent' })
  })

  it('CDNS 실사례: 낡은 리볼버 0이 최신 대차대조표의 부채에 섞이지 않는다', () => {
    // 0은 더해도 값을 바꾸지 않지만, 이월된 0이 유일한 근거가 되는 상황(티어 3 단독)
    // 에서는 확신에 찬 0을 만든다 — nonZero가 그때도 null로 남긴다.
    expect(resolveTotalDebt(
      new Map([['LinesOfCreditCurrent', 0], ['LongTermDebtNoncurrent', 2_500_000_000]]),
      ctx({ LinesOfCreditCurrent: '2023-12-31', LongTermDebtNoncurrent: '2024-12-31' }),
    )).toEqual({ value: 2_500_000_000, tag: 'LongTermDebtNoncurrent' })
    expect(resolveTotalDebt(
      new Map([['LinesOfCreditCurrent', 0]]),
      ctx({ LinesOfCreditCurrent: '2023-12-31' }),
    )).toBeNull()
  })

  it('현금과 단기투자자산은 서로의 부재를 증언하지 못한다 — 부재 단언이 있을 때만 버린다', () => {
    const values = new Map([
      ['CashAndCashEquivalentsAtCarryingValue', 8_346_000_000],
      ['ShortTermInvestments', 7_764_000_000],
    ])
    expect(resolveStock(values, ctx({
      CashAndCashEquivalentsAtCarryingValue: '2025-07-26',
      ShortTermInvestments: '2025-07-26',
    })).fields.cash).toBe(16_110_000_000)
    // 단기투자자산이 다시 태깅되지 않았을 뿐이면 잔액은 이월된다.
    expect(resolveStock(values, ctx({
      CashAndCashEquivalentsAtCarryingValue: '2025-07-26',
      ShortTermInvestments: '2024-07-27',
    })).fields.cash).toBe(16_110_000_000)
    // 같은 신고서가 부재를 단언했으면 버린다.
    expect(resolveStock(values, ctx(
      {
        CashAndCashEquivalentsAtCarryingValue: '2025-07-26',
        ShortTermInvestments: '2024-07-27',
      },
      { absent: { '2025-07-26': ['ShortTermInvestments'] } },
    )).fields.cash).toBe(8_346_000_000)
  })

  it('최신 대차대조표에 현금성자산이 없으면 단기투자자산만으로 현금을 만들지 않는다', () => {
    expect(resolveStock(
      new Map([
        ['CashAndCashEquivalentsAtCarryingValue', 100],
        ['ShortTermInvestments', 900],
      ]),
      ctx(
        {
          CashAndCashEquivalentsAtCarryingValue: '2024-12-31',
          ShortTermInvestments: '2025-12-31',
        },
        { absent: { '2025-12-31': ['CashAndCashEquivalentsAtCarryingValue'] } },
      ),
    ).fields.cash).toBeNull()
  })

  it('normalizeFacts는 pickInstant의 일자와 부재 단언을 실제로 넘긴다 (배선 회귀)', () => {
    // 같은 accession이 2025-03-31에는 `LongTermDebtCurrent`를 태깅하고 2026-03-31에는
    // 태깅하지 않았다 → 부재 단언 → 이월하지 않는다. 배선이 끊기면 400을 이월해 1300이 된다.
    const facts = [
      fact({ source: 'api', qtrs: 1, periodStart: '2026-01-01', periodEnd: '2026-03-31',
        tag: 'Revenues', value: 1000, filedDate: '2026-04-30' }),
      fact({ source: 'api', qtrs: 0, periodEnd: '2026-03-31', accession: 'x',
        tag: 'LongTermDebtNoncurrent', value: 900, filedDate: '2026-04-30' }),
      fact({ source: 'api', qtrs: 0, periodEnd: '2025-03-31', accession: 'x',
        tag: 'LongTermDebtNoncurrent', value: 800, filedDate: '2026-04-30' }),
      fact({ source: 'api', qtrs: 0, periodEnd: '2025-03-31', accession: 'x',
        tag: 'LongTermDebtCurrent', value: 400, filedDate: '2026-04-30' }),
    ]
    const q = normalizeFacts(facts).quarterly.find((p) => p.periodEnd === '2026-03-31')!
    expect(q.totalDebt).toBe(900)
  })
})
