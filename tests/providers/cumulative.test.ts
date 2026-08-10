import { describe, it, expect } from 'vitest'
import { indexFacts } from '@/providers/fundamental/resolve'
import { resolveCumulative } from '@/providers/fundamental/cumulative'
import { normalizeFacts } from '@/providers/fundamental/normalizer'
import type { RawFact } from '@/providers/types'

const M = 1_000_000

function f(
  tag: string, qtrs: number, periodEnd: string, value: number, form = '10-Q',
): RawFact {
  return {
    cik: 1, tag, unit: 'USD',
    periodStart: null, periodEnd, qtrs, value, form,
    filedDate: '2026-01-01', accession: `a-${periodEnd}-${qtrs}`, source: 'bulk',
  }
}

function quarterOf(facts: RawFact[], periodEnd: string, field: 'revenue' | 'operatingIncome' | 'grossProfit') {
  return resolveCumulative(indexFacts(facts)).quarters.get(periodEnd)?.get(field)
}

describe('resolveCumulative — 회계연도 정렬', () => {
  it('span=k 누적은 종료일에서 뒤로 k개 분기를 덮는다 (6월 결산 회사의 반기 누적)', () => {
    // Microsoft형 6월 결산: FY2026 상반기는 2025-09-30 + 2025-12-31 이다.
    // 달력연도 기준이 아니라 (span, 종료일) 만으로 회계연도가 정해진다.
    const facts = [
      f('Revenues', 1, '2025-09-30', 70 * M),
      f('Revenues', 2, '2025-12-31', 150 * M),
    ]
    expect(quarterOf(facts, '2025-12-31', 'revenue')).toEqual({ value: 80 * M, derived: true })
  })

  it('연간 − 9개월 누적으로 Q4를 유도한다 (기존 Q4 재구성의 일반화)', () => {
    const facts = [
      f('Revenues', 1, '2025-03-31', 100 * M),
      f('Revenues', 1, '2025-06-30', 110 * M),
      f('Revenues', 1, '2025-09-30', 120 * M),
      f('Revenues', 3, '2025-09-30', 330 * M),
      f('Revenues', 4, '2025-12-31', 500 * M, '10-K'),
    ]
    expect(quarterOf(facts, '2025-12-31', 'revenue')).toEqual({ value: 170 * M, derived: true })
  })

  it('9개월 누적이 없어도 연간에서 신고 분기 3개를 빼 Q4를 유도한다', () => {
    const facts = [
      f('Revenues', 1, '2025-03-31', 100 * M),
      f('Revenues', 1, '2025-06-30', 110 * M),
      f('Revenues', 1, '2025-09-30', 120 * M),
      f('Revenues', 4, '2025-12-31', 500 * M, '10-K'),
    ]
    expect(quarterOf(facts, '2025-12-31', 'revenue')).toEqual({ value: 170 * M, derived: true })
  })

  it('덮는 구간이 실제 기간과 맞지 않으면(61일짜리 "분기") 누적을 쓰지 않는다', () => {
    const facts = [
      f('Revenues', 1, '2025-01-31', 80 * M),
      f('Revenues', 1, '2025-04-30', 100 * M),
      f('Revenues', 1, '2025-07-31', 110 * M),
      f('Revenues', 1, '2025-10-31', 130 * M),
      f('Revenues', 4, '2025-12-31', 500 * M, '10-K'),
    ]
    expect(quarterOf(facts, '2025-12-31', 'revenue')).toBeUndefined()
  })
})

describe('resolveCumulative — 값 충돌 해소 (Microsoft FY2026 실사례)', () => {
  // 실 DB(cik 789019): 2026-01-28 신고 10-Q의 매출 관련 사실이 통째로 디멘션
  // 슬라이스로 오염돼 있다. 반기 누적(9,796M)과 그 분기 신고값(5,958M)이
  // 서로는 정합하지만 1분기(77,673M)·9개월(241,832M)과는 모순이다.
  const facts = [
    f('RevenueFromContractWithCustomerExcludingAssessedTax', 1, '2025-09-30', 77_673 * M),
    f('RevenueFromContractWithCustomerExcludingAssessedTax', 1, '2025-12-31', 5_958 * M),
    f('RevenueFromContractWithCustomerExcludingAssessedTax', 2, '2025-12-31', 9_796 * M),
    f('RevenueFromContractWithCustomerExcludingAssessedTax', 1, '2026-03-31', 82_886 * M),
    f('RevenueFromContractWithCustomerExcludingAssessedTax', 3, '2026-03-31', 241_832 * M),
    f('RevenueFromContractWithCustomerExcludingAssessedTax', 4, '2026-06-30', 331_839 * M, '10-K'),
  ]

  it('오염된 반기 누적과 신고 분기를 버리고 실제 분기 매출을 복원한다', () => {
    expect(quarterOf(facts, '2025-12-31', 'revenue')).toEqual({ value: 81_273 * M, derived: true })
  })

  it('오염되지 않은 분기는 신고값 그대로 남는다', () => {
    expect(quarterOf(facts, '2026-03-31', 'revenue')).toEqual({ value: 82_886 * M, derived: false })
    expect(quarterOf(facts, '2025-09-30', 'revenue')).toEqual({ value: 77_673 * M, derived: false })
  })

  it('복원된 매출 덕분에 매출총이익이 불가능값 검증에 걸리지 않는다', () => {
    const withGp = [...facts, f('GrossProfit', 1, '2025-12-31', 55_295 * M)]
    const q = normalizeFacts(withGp).quarterly.find((p) => p.periodEnd === '2025-12-31')!
    expect(q.revenue).toBe(81_273 * M)
    expect(q.grossProfit).toBe(55_295 * M)
  })
})

describe('resolveCumulative — 신고 분기를 덮어쓸 수 있는 필드는 매출뿐', () => {
  // Workhorse 실사례 형태: 매출총이익 사다리에서 1분기 신고값과 반기 누적이
  // 충돌한다. 어느 쪽이 오염인지 가릴 근거가 없으므로 신고 분기는 그대로 두고
  // 누적 쪽을 버린다.
  const base = [
    f('GrossProfit', 1, '2025-03-31', -1.08 * M),
    f('GrossProfit', 1, '2025-06-30', -7.38 * M),
    f('GrossProfit', 2, '2025-06-30', -11.91 * M),
  ]

  it('매출총이익은 신고 분기값이 유지된다', () => {
    expect(quarterOf(base, '2025-03-31', 'grossProfit')).toEqual({ value: -1.08 * M, derived: false })
    expect(quarterOf(base, '2025-06-30', 'grossProfit')).toEqual({ value: -7.38 * M, derived: false })
  })

  it('매출총이익은 모순되는 누적 쪽을 버리므로 두 분기 합이 신고값 합과 같다', () => {
    const q1 = quarterOf(base, '2025-03-31', 'grossProfit')!.value!
    const q2 = quarterOf(base, '2025-06-30', 'grossProfit')!.value!
    expect(q1 + q2).toBeCloseTo(-8.46 * M, -3) // 반기 누적 -11.91M을 따르지 않는다
  })

  // 위 두 테스트는 규칙이 아니라 이 픽스처의 산술을 관측한다: 가드를 열어 모든 필드가
  // 신고 분기를 덮어쓸 수 있게 해도, 이 숫자들에서는 매출용 tie-break가 우연히 같은 해를
  // 고른다(테스트 리뷰 F3). 아래는 매출 픽스처를 그대로 옮겨와 두 규칙이 실제로 갈리는
  // 지점을 만든다 — 같은 입력에서 매출은 누적을 따르고 매출총이익·영업이익은 따르지 않는다.
  const discriminating = (tag: string) => [
    f(tag, 1, '2025-03-31', 100 * M),
    f(tag, 1, '2025-06-30', 3 * M),
    f(tag, 2, '2025-06-30', 210 * M),
  ]

  it('같은 숫자라도 매출총이익은 신고 분기를 지키고 누적을 버린다', () => {
    const gp = discriminating('GrossProfit')
    // 가드가 열리면 "1분기가 오염됐다"는 해(q1 = 207M)가 선택되어 두 값이 모두 달라진다.
    expect(quarterOf(gp, '2025-03-31', 'grossProfit')).toEqual({ value: 100 * M, derived: false })
    expect(quarterOf(gp, '2025-06-30', 'grossProfit')).toEqual({ value: 3 * M, derived: false })
    const sum = quarterOf(gp, '2025-03-31', 'grossProfit')!.value!
      + quarterOf(gp, '2025-06-30', 'grossProfit')!.value!
    expect(sum).toBe(103 * M) // 누적 210M을 따르지 않는다
  })

  it('영업이익도 마찬가지다 (Alphabet 사건이 실제로 다룬 필드)', () => {
    const oi = discriminating('OperatingIncomeLoss')
    expect(quarterOf(oi, '2025-03-31', 'operatingIncome')).toEqual({ value: 100 * M, derived: false })
    expect(quarterOf(oi, '2025-06-30', 'operatingIncome')).toEqual({ value: 3 * M, derived: false })
  })

  it('매출은 반대로 누적 쪽을 채택해 두 분기 합이 반기 누적과 같아진다', () => {
    // 어느 분기가 오염됐는지는 두 rung만으로 가릴 수 없지만, 합계(=TTM에 들어가는
    // 값)는 누적 사실을 따른다.
    const rev = [
      f('Revenues', 1, '2025-03-31', 100 * M),
      f('Revenues', 1, '2025-06-30', 3 * M),
      f('Revenues', 2, '2025-06-30', 210 * M),
    ]
    const q1 = quarterOf(rev, '2025-03-31', 'revenue')!.value!
    const q2 = quarterOf(rev, '2025-06-30', 'revenue')!.value!
    expect(q1 + q2).toBe(210 * M)
  })
})

describe('resolveCumulative — 반올림 잡음은 충돌이 아니다 (NVIDIA 실사례)', () => {
  // 실 DB: NVIDIA의 "충돌" 28건은 대부분 1,000,000 단위 반올림 차이였다.
  const facts = [
    f('GrossProfit', 1, '2025-04-27', 22_574 * M),
    f('GrossProfit', 1, '2025-07-27', 20_406 * M),
    f('GrossProfit', 2, '2025-07-27', 42_979 * M), // 합계는 42,980M
  ]

  it('백만 단위 반올림 차이(0.08%)는 그대로 통과한다', () => {
    expect(quarterOf(facts, '2025-07-27', 'grossProfit')).toEqual({
      value: 20_406 * M, derived: false,
    })
  })

  it('반올림 잡음은 오염으로 기록되지 않는다 — 값만 보면 두 경로를 구분할 수 없다', () => {
    // 허용오차가 잡음을 흡수하지 못하면 반기 누적이 모순으로 판정돼 버려진다. 그때도
    // grossProfit은 신고 분기를 덮어쓸 수 없으므로 **같은 값·같은 derived**가 남는다 —
    // 두 경로가 갈리는 유일한 관측점이 rejected다(테스트 리뷰 F4).
    expect(resolveCumulative(indexFacts(facts)).rejected.size).toBe(0)
  })
})

describe('resolveCumulative — 분기 인접 판정 창', () => {
  it('보고 간격이 분기 창을 벗어나면 연속한 분기로 묶지 않는다', () => {
    // 45일 · 137일 간격 — 개별 간격은 분기(60~120일)가 아니지만 양끝 합계(182일)는
    // 우연히 2분기 길이(182.6일)와 맞아떨어져 구간 길이 검증만으로는 걸러지지 않는다.
    // 인접 창 자체가 없으면 span=3 누적이 그대로 채택돼 없는 분기가 유도된다.
    const facts = [
      f('Revenues', 1, '2025-01-15', 10 * M),
      f('Revenues', 1, '2025-03-01', 20 * M),
      f('Revenues', 3, '2025-07-16', 100 * M),
    ]
    expect(quarterOf(facts, '2025-07-16', 'revenue')).toBeUndefined()
  })

  it('간격이 정상 분기면 같은 모양의 누적을 정상적으로 쓴다 (음성 대조군)', () => {
    const facts = [
      f('Revenues', 1, '2025-01-15', 10 * M),
      f('Revenues', 1, '2025-04-16', 20 * M),
      f('Revenues', 3, '2025-07-16', 100 * M),
    ]
    expect(quarterOf(facts, '2025-07-16', 'revenue')).toEqual({ value: 70 * M, derived: true })
  })
})

describe('resolveCumulative — 유도값 신뢰성', () => {
  it('신고 분기가 모두 같은 부호인데 유도값만 반대·거대하면 거부한다 (Alphabet 실사례)', () => {
    const facts = [
      f('OperatingIncomeLoss', 1, '2025-03-31', 30_606 * M),
      f('OperatingIncomeLoss', 1, '2025-06-30', 31_271 * M),
      f('OperatingIncomeLoss', 2, '2025-06-30', 61_877 * M),
      f('OperatingIncomeLoss', 1, '2025-09-30', 31_228 * M),
      f('OperatingIncomeLoss', 3, '2025-09-30', 93_105 * M),
      f('OperatingIncomeLoss', 4, '2025-12-31', -16_760 * M, '10-K'),
    ]
    expect(quarterOf(facts, '2025-12-31', 'operatingIncome')).toEqual({ value: null, derived: true })

    // 같은 오염 사실에서 나온 연간 값도 null이 된다.
    const r = normalizeFacts(facts)
    expect(r.annual.find((p) => p.periodEnd === '2025-12-31')!.operatingIncome).toBeNull()
    expect(r.quarterly.find((p) => p.periodEnd === '2025-12-31')!.operatingIncome).toBeNull()
  })

  it('신고 분기의 부호가 이미 섞여 있으면 큰 반전도 진짜 신호로 남긴다 (ON Semiconductor 실사례)', () => {
    const facts = [
      f('OperatingIncomeLoss', 1, '2025-04-04', -573.7 * M),
      f('OperatingIncomeLoss', 1, '2025-07-04', 193.4 * M),
      f('OperatingIncomeLoss', 1, '2025-10-03', 264.4 * M),
      f('OperatingIncomeLoss', 4, '2025-12-31', 84.2 * M, '10-K'),
    ]
    const q = quarterOf(facts, '2025-12-31', 'operatingIncome')
    expect(q?.derived).toBe(true)
    expect(q?.value).toBeCloseTo(200.1 * M, -3)
  })

  it('신고 분기가 1개뿐이면 유도값을 신뢰성 검사로 지우지 않는다', () => {
    const facts = [
      f('OperatingIncomeLoss', 1, '2025-09-30', 10 * M),
      f('OperatingIncomeLoss', 2, '2025-12-31', -500 * M),
    ]
    expect(quarterOf(facts, '2025-12-31', 'operatingIncome')).toEqual({
      value: -510 * M, derived: true,
    })
  })
})

describe('normalizeFacts — 누적 차분 유도의 provenance', () => {
  it('유도된 필드는 sourceTags에 cumulative_diff로 남는다', () => {
    const facts = [
      f('Revenues', 1, '2025-03-31', 100 * M),
      f('Revenues', 1, '2025-06-30', 110 * M),
      f('Revenues', 1, '2025-09-30', 120 * M),
      f('Revenues', 4, '2025-12-31', 500 * M, '10-K'),
    ]
    const r = normalizeFacts(facts)
    expect(r.sourceTags['Q:2025-12-31']!.revenue).toBe('cumulative_diff')
    expect(r.sourceTags['Q:2025-12-31']!.derived).toBe('cumulative_diff')
    // 신고 분기는 태그명이 그대로 남는다
    expect(r.sourceTags['Q:2025-09-30']!.revenue).toBe('Revenues')
    expect(r.sourceTags['Q:2025-09-30']!.derived).toBeUndefined()
  })
})
