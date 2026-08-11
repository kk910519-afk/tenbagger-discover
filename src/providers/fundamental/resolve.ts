import type { RawFact } from '../types.js'
import {
  BASIC_SHARES_CHAIN, CASH_TAG_SHAPES, DEBT_COMBINED_TOTAL_TAG, DEBT_CURRENT_TOTAL_TAG,
  DEBT_TAGS, DEBT_TAG_SHAPES, DEBT_WITH_LEASES_NONCURRENT_TAG, DEBT_WITH_LEASES_SPANNING_TAG,
  FINANCE_LEASE_BY_REGION, INDUSTRY_REVENUE_TOTAL_TAGS, LONG_TERM_DEBT_CURRENT_TAG,
  LONG_TERM_DEBT_FAMILY, LONG_TERM_DEBT_NONCURRENT_TAG, LONG_TERM_DEBT_TOTAL_TAG,
  OPERATING_COST_TOTAL_TAG, OPERATING_EXPENSES_TAG, SHORT_TERM_BORROWING_TAGS,
  SPECIFIC_DEBT_FAMILIES, type DebtFamily, type DebtRegion, type DebtTagShape,
} from './tags.js'

export type FactIndex = {
  /** qtrs → periodEnd → tag → value */
  duration: Map<number, Map<string, Map<string, number>>>
  /** periodEnd → tag → value */
  instant: Map<string, Map<string, number>>
  /**
   * 시점 축에서 **신고자가 부재를 명시한** 태그. periodEnd → 그 일자에 없다고
   * 단언된 태그 집합.
   *
   * 근거: 하나의 신고서(accession)는 보통 두 개의 대차대조표 일자(당기·전기)를
   * 함께 태깅한다. 그 신고서가 어떤 개념을 **전기에는 태깅하고 당기에는 태깅하지
   * 않았다면**, 그것은 "이번에는 안 썼다"가 아니라 "당기 대차대조표에 그 줄이
   * 없다"는 신고자 자신의 진술이다. 실측(CVV, FY2025 10-K, accession
   * 0001437749-26-000?): 같은 신고서가 `LongTermDebtNoncurrent`를 2024-12-31에는
   * 181,000으로 태깅하고 2025-12-31에는 태깅하지 않았다 — 실제로 그 10-K의 부채
   * 표는 `장비대출 181 / 유동성 대체 181 / 유동분 제외 장기 —`로, 잔액 전부가
   * 유동으로 재분류돼 비유동 잔액이 0이 됐다.
   */
  absent: Map<string, Set<string>>
}

const DAY_MS = 86_400_000

// SEC 대량 데이터셋(financial-statement-data-sets, num.txt)은 회계기간
// 종료일을 달력월 말일로 반올림해 저장하는 반면, 기업별 XBRL API
// (companyfacts)는 신고자가 실제로 보고한 정확한 날짜를 준다. 같은 회계
// 분기가 두 소스에서 서로 다른 period_end로 들어오면 DB의 UNIQUE(cik, tag,
// period_end, qtrs, form) 제약을 피해가며 별개의 기간으로 중복 저장된다.
//
// 실측(2026-08, 1,200개사 financial_facts): 같은 (cik, tag, qtrs)로 가장
// 가까운 API/bulk 쌍을 매칭했을 때 날짜 차이는 —
//   duration(분기/연간) 태그: 최대 14일 (p50=2, p90=4, p95=6, p99=7)
//   instant(시점) 태그:       최대 19일 (p50=0, p90=3, p95=4, p99=6)
// 였다. 반대로 서로 다른 회계기간이 우연히 최근접으로 매칭된 오탐 사례는
// 29일부터 나타난다(분기 간격 ~90일의 일부이며, 회계월 중순에 마감하는
// 소형주에서 발생). 20일은 실측 최댓값(19일)보다 약간 크면서 오탐 구간
// (29일+)과는 충분히 떨어져 있어 안전한 상한이다 — 이 값을 넓히면 서로
// 다른 분기를 병합할 위험이, 좁히면 일부 신고자의 버그가 그대로 남는다.
const CROSS_SOURCE_TOLERANCE_DAYS = 20

// 두 사실이 "같은 숫자"인지 판정할 때의 상대 허용오차. cumulative.ts의
// REL_TOLERANCE와 같은 값이며 근거도 같다 — 같은 수치가 신고서마다 천/백만 단위로
// 다르게 반올림돼 들어오는 잡음(실측 최대 0.08%)은 흡수하고, 디멘션 오염이나 서로
// 다른 기간의 값(수 배~수백 배 차이)과는 자릿수가 다르다.
const DUPLICATE_REL_TOLERANCE = 5e-3

function daysBetween(a: string, b: string): number {
  return Math.abs(Date.parse(a) - Date.parse(b)) / DAY_MS
}

function sameNumber(a: number, b: number): boolean {
  return Math.abs(a - b) <= DUPLICATE_REL_TOLERANCE * Math.max(Math.abs(a), Math.abs(b), 1)
}

// 오기 날짜 판정. TRNS·SYPR 실측에서 오기 날짜에 딸려 온 사실은 각각 2건이고 진짜
// 마감일에는 22건이 붙었다. 3건 이하 + 5배 이상이면 "몇 개 태그만 잘못 찍힌 날짜"로
// 본다 — 진짜 회계 마감일이 3건 이하로 얇게 들어오는 경우는 실측에서 없었고, 있더라도
// 20일 이내에 그보다 5배 두꺼운 다른 마감일이 함께 존재하지는 않는다.
const SPARSE_DATE_MAX_FACTS = 3
const SPARSE_DATE_DOMINANCE = 5

/** 가중평균 주식수 계열(기본·희석) — 기간 종료일이 바뀌면 값이 달라지는 것이 정상이다. */
const WEIGHTED_AVERAGE_SHARE_TAGS: ReadonlySet<string> = new Set<string>([
  'WeightedAverageNumberOfDilutedSharesOutstanding',
  ...BASIC_SHARES_CHAIN,
])

/** `${qtrs}|${tag}` 키에서 태그 부분이 가중평균 주식수인지 판정한다. */
function isWeightedAverageShares(key: string): boolean {
  const bar = key.indexOf('|')
  return WEIGHTED_AVERAGE_SHARE_TAGS.has(bar < 0 ? key : key.slice(bar + 1))
}

/** `native` — 신고자가 찍은 period_end가 canonical 날짜와 같은가(옮겨져 오지 않았는가). */
type FactEntry = { value: number; filedDate: string; native: boolean }

/**
 * 사실이 놓이는 날짜 축. 기간(qtrs>=1) 사실의 period_end와 시점(qtrs=0) 사실의
 * period_end는 서로 다른 종류의 날짜다 — 표지 발행주식수처럼 회계기간 종료일과
 * 무관한 날짜에 찍히는 시점 값이 있기 때문에, 두 축을 한 그리드로 섞으면
 * 기간 종료일이 표지 날짜로 빨려 들어갈 수 있다.
 */
type DateAxis = 'instant' | 'duration'

function axisOf(qtrs: number): DateAxis {
  return qtrs === 0 ? 'instant' : 'duration'
}

/** offset 없는 단순 union-find. 노드 = period_end 문자열. */
class DateUnion {
  private parent = new Map<string, string>()

  find(x: string): string {
    let cur = x
    while (this.parent.get(cur) !== undefined && this.parent.get(cur) !== cur) {
      cur = this.parent.get(cur)!
    }
    return cur
  }

  union(a: string, b: string): void {
    const ra = this.find(a)
    const rb = this.find(b)
    this.parent.set(ra, ra)
    this.parent.set(rb, ra === rb ? rb : ra)
  }
}

/**
 * **API가 같은 회계기간을 두 개의 period_end로 내보내는 문제**를 해소한다.
 *
 * 이전 구현은 `apiPeriods.has(periodEnd)`로 조기 반환해 "API 날짜는 정의상
 * canonical"이라고 보았다. 그 전제는 period-reconciliation 과제에서 확인한 표본
 * (bulk num.txt의 월말 반올림)에만 맞고, SEC companyfacts 자체가 같은 신고서
 * (accession)의 같은 회계분기를 두 날짜로 내보내는 사례를 설명하지 못한다.
 * 실측(Transcat, CIK 99302, accession 0001437749-25-033338): `Revenues`가
 * qtrs=1 / period_start 2025-06-29에 대해 period_end 2025-09-27과 2025-09-30
 * 두 개로 들어오고 값(82,272,000)은 완전히 같다. 두 날짜가 모두 살아남아
 * 분기 행이 두 개가 되고, TTM 창이 9월을 두 번 세고 6월을 떨어뜨렸다.
 *
 * **회계기간의 정체성은 (기간 길이, 시작일, 종료일)이다.** companyfacts의 duration
 * 사실은 `start`를 100% 제공한다(실측: API duration 669,268건 중 start 결측 0건,
 * bulk는 전건 결측). 그래서 duration 축에서는 같은 `qtrs` 안에서 **시작일과 종료일이
 * 모두** 허용치 이내인 쌍만 같은 기간의 후보로 본다. 한쪽 끝만 보면 1개월 스텁과 한
 * 분기가 같은 기간으로 묶인다 — deriveQtrs의 반올림 때문에 그 둘이 같은 qtrs 버킷에
 * 들어오는 사례가 실제로 있다(KRMD 2016: start 2016-03-01에 종료일 03-31·05-31·06-30).
 *
 * 후보가 됐어도 **합치려면 값이 일치해야 한다**:
 *
 *  1) 종료일·시작일 간격이 각각 CROSS_SOURCE_TOLERANCE_DAYS 이내.
 *  2) 두 날짜가 함께 신고한 (qtrs, tag)의 값이 **모두 같고** 겹치는 항목이 최소
 *     하나 있을 것. 실측: 같은 start·20일 이내인 87쌍 중 68쌍은 전 항목이 일치하는
 *     순수 중복이지만, 17쌍은 값이 다르다 — VTRS(2020, Mylan/Upjohn), RPAY·SYM
 *     (SPAC 전신 법인)처럼 한 CIK 아래 전신·후신 두 실체의 숫자가 같은 명목 기간에
 *     들어온 경우다. 그런 쌍을 합치면 근거 없이 한쪽 값을 버리는 것이 되므로 손대지
 *     않는다(기존 동작 유지). **값이 같은 중복만 합치므로 이 병합은 어떤 숫자도
 *     바꾸지 않는다 — 중복된 기간 하나가 사라질 뿐이다.**
 *
 * 시점(instant) 축에는 시작일이라는 개념이 없으므로 종료일 근접성과 (2)만 본다.
 * 표지 발행주식수처럼 대차대조표 일자와 무관한 날짜에 홀로 찍히는 값은 다른
 * 날짜와 겹치는 태그가 없어 조건 (2)를 만족할 수 없고, 따라서 절대 병합되지 않는다.
 *
 * canonical 대표는 **그 CIK의 API 사실이 가장 많이 찍힌 날짜**다(동수면 이른 날짜).
 * 실제 회계 마감일에는 재무제표 전체가 붙지만 오기 날짜에는 몇 개 태그만 딸려
 * 오기 때문이다 — TRNS 2025-09-27에는 API 사실 22건, 2025-09-30에는 2건이다.
 */
function canonicaliseApiDates(facts: RawFact[]): Record<DateAxis, Map<string, string>> {
  // 축 → period_end → `${qtrs}|${tag}` → value
  const byAxis: Record<DateAxis, Map<string, Map<string, number>>> = {
    instant: new Map(),
    duration: new Map(),
  }
  // duration 축에서만: qtrs → period_end → 그 종료일로 신고된 period_start 집합
  const startsOf = new Map<number, Map<string, Set<string>>>()
  // period_end → 그 날짜에 찍힌 API 사실 수(축 무관 — 실제 마감일 판정용)
  const factCount = new Map<string, number>()

  for (const f of facts) {
    if (f.source !== 'api') continue
    const axis = axisOf(f.qtrs)
    let byEnd = byAxis[axis].get(f.periodEnd)
    if (!byEnd) { byEnd = new Map(); byAxis[axis].set(f.periodEnd, byEnd) }
    byEnd.set(`${f.qtrs}|${f.tag}`, f.value)
    factCount.set(f.periodEnd, (factCount.get(f.periodEnd) ?? 0) + 1)
    if (axis === 'duration' && f.periodStart !== null) {
      let byEndStarts = startsOf.get(f.qtrs)
      if (!byEndStarts) { byEndStarts = new Map(); startsOf.set(f.qtrs, byEndStarts) }
      let starts = byEndStarts.get(f.periodEnd)
      if (!starts) { starts = new Set(); byEndStarts.set(f.periodEnd, starts) }
      starts.add(f.periodStart)
    }
  }

  // 병합은 **축마다 따로** 한다. 시점 축에서 두 날짜가 같다고 판정됐다고 해서
  // 기간 축의 같은 문자열 날짜까지 끌려가면, 시점 근거로 서로 다른 회계기간이
  // 합쳐질 수 있다.
  const union: Record<DateAxis, DateUnion> = {
    instant: new DateUnion(),
    duration: new DateUnion(),
  }

  const mergeable = (axis: DateAxis, a: string, b: string): boolean => {
    if (daysBetween(a, b) > CROSS_SOURCE_TOLERANCE_DAYS) return false
    const ta = byAxis[axis].get(a)
    const tb = byAxis[axis].get(b)
    if (!ta || !tb) return false
    let agree = 0
    let disagree = 0
    for (const [key, va] of ta) {
      const vb = tb.get(key)
      if (vb === undefined) continue
      // 가중평균 주식수는 **증거로 쓰지 않는다.** 정의상 "기간 중 발행돼 있던 주식수의
      // 시간가중 평균"이라 기간 종료일이 하루라도 움직이면 값이 달라지는 것이 정상이다 —
      // 즉 두 날짜가 사실은 같은 분기임을 보여주는 상황에서 오히려 확실하게 어긋난다.
      // 실측(SYPR, CIK 864240): 2025-09-28과 2025-09-29에 겹치는 태그가 기본
      // 가중평균 주식수 단 하나뿐인데 값이 22,251,000 / 22,011,000으로 1.1% 달라
      // 병합이 거부됐고, 그 결과 유령 분기가 살아남아 최신 TTM이 9월을 두 번 셌다.
      if (isWeightedAverageShares(key)) continue
      if (sameNumber(va, vb)) agree++
      else disagree++
    }
    // 겹치는 (가중평균이 아닌) 항목이 하나라도 있으면 **다수결**로 판정한다. 실측:
    // 20일 이내인데 병합되지 않은 API 쌍 18개 중 6개가 태그 하나의 불일치로 거부됐고
    // (BLFS 4-of-5 일치, COHU 3-of-4, LIND 3-of-4), 반면 합치면 안 되는 전신/후신
    // 법인 쌍(VTRS·RPAY·SYM)은 겹치는 20개 항목이 **하나도** 일치하지 않는다 —
    // 두 집단은 다수결로 깨끗이 갈린다.
    if (agree > disagree) return true
    // **다수결이 성립하려면 관측이 둘 이상이어야 한다.** 겹치는 항목이 딱 하나이고
    // 그것이 어긋난 경우는 다수결이 아니라 단일 관측이다. 그런데 그 하나가 어긋나는
    // 것은 오기 날짜에서 정확히 예상되는 일이다 — 오기 날짜에 딸려 오는 소수의
    // 사실은 보통 그 날짜에만 존재하는 디멘션 슬라이스나 위임장(DEF 14A) 수치라서
    // 진짜 마감일의 같은 태그와 값이 다르다. 그래서 이 경우에만 아래 **밀도 비대칭**
    // 검사로 넘긴다(0건일 때와 같은 처리). 실측으로 이 한 줄이 가르는 것 —
    // 잔여 중복 분기 31쌍 전수와 유니버스 1,200개사 전체를 재판정했을 때 새로 병합되는
    // 기간 축 쌍은 정확히 아래 다섯이고, 병합이 취소되는 쌍은 하나도 없다:
    //   ALGM 2022-06-12~06-24 (1 vs 19건) — 유령 쪽의 유일한 사실이 DEF 14A의
    //        `NetIncomeLoss` 187,494,000이다. 이 유령이 TTM 앵커를 차지해 매출 NULL ·
    //        순이익 279,380,000(실제 102,133,000)짜리 TTM을 만들고, 진짜 분기
    //        2022-06-24의 TTM은 창 길이 182일로 거부돼 사라졌다.
    //   TER  2020-03-29~03-31 (24 vs 1건) — 매출 704,355,000 / 704,356,000, 1달러 차이.
    //   LFCR 2012-08-26~08-28 (41 vs 2건) — 매출·순이익 전 항목 동일.
    //   STEX 2022-03-30~03-31 (2 vs 17건) — 유령 쪽 전 필드 NULL.
    //   IIIV 2018-06-25~06-30 (2 vs 29건) — 유령 쪽 매출 NULL.
    // 다섯 모두 유령 쪽에 TTM 행이 하나 생기고 진짜 분기의 TTM이 사라져 있었다.
    //
    // **기간(duration) 축에서만 넘긴다.** 이 축의 후보 쌍은 이미 시작일과 종료일이
    // *둘 다* 허용치 이내임이 확인된 것이라(아래 startsClose) 같은 회계기간이라는
    // 증거가 날짜만으로도 이미 서 있고, 남은 질문은 "둘 중 어느 날짜가 오기인가"뿐이다.
    // 시점(instant) 축에는 시작일이라는 개념이 없어 근접성만으로는 그 증거가 서지
    // 않는다 — 표지 발행주식수 날짜는 대차대조표 일자 며칠 옆에 정당하게 존재하며
    // 같은 기간이 아니다. 같은 규칙을 시점 축까지 넓히면 유니버스 전체에서 158쌍이
    // 새로 병합되고 그중에는 ADP 2019-06-30~07-01(36 vs 2건) 같은 표지 날짜가 들어
    // 있다. 그래서 넓히지 않는다.
    if (agree + disagree >= 2) return false
    if (agree + disagree === 1 && axis === 'instant') return false
    // 겹치는 항목이 전혀 없으면 값으로는 판정할 수 없다. 이때만 **밀도 비대칭**을 본다:
    // 진짜 회계 마감일에는 재무제표 전체가 붙지만 오기 날짜에는 태그 몇 개만 딸려 온다
    // (TRNS 22건 vs 2건, SYPR 22건 vs 2건). 한쪽이 SPARSE_DATE_MAX_FACTS건 이하이고
    // 다른 쪽이 그 SPARSE_DATE_DOMINANCE배 이상이면 희소한 쪽을 오기로 보고 흡수한다.
    const na = factCount.get(a) ?? 0
    const nb = factCount.get(b) ?? 0
    const lo = Math.min(na, nb)
    const hi = Math.max(na, nb)
    return lo > 0 && lo <= SPARSE_DATE_MAX_FACTS && hi >= SPARSE_DATE_DOMINANCE * lo
  }

  // duration: 같은 qtrs 안에서 **시작일과 종료일이 모두** 허용치 이내인 쌍만 후보다.
  // 회계기간의 정체성은 (시작일, 종료일)이므로 양쪽 끝이 다 가까워야 같은 기간이다 —
  // 1개월 스텁과 한 분기는 종료일이 가깝더라도 시작일이 두 달 넘게 벌어진다.
  const startsClose = (a: Set<string> | undefined, b: Set<string> | undefined): boolean => {
    if (!a || !b) return false
    for (const x of a) for (const y of b) {
      if (daysBetween(x, y) <= CROSS_SOURCE_TOLERANCE_DAYS) return true
    }
    return false
  }
  for (const byEndStarts of startsOf.values()) {
    const list = [...byEndStarts.keys()].sort()
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (daysBetween(list[i]!, list[j]!) > CROSS_SOURCE_TOLERANCE_DAYS) break
        if (!startsClose(byEndStarts.get(list[i]!), byEndStarts.get(list[j]!))) continue
        if (mergeable('duration', list[i]!, list[j]!)) union.duration.union(list[i]!, list[j]!)
      }
    }
  }

  // instant: start가 없으므로 근접한 모든 날짜 쌍이 후보다.
  const instantEnds = [...byAxis.instant.keys()].sort()
  for (let i = 0; i < instantEnds.length; i++) {
    for (let j = i + 1; j < instantEnds.length; j++) {
      if (daysBetween(instantEnds[i]!, instantEnds[j]!) > CROSS_SOURCE_TOLERANCE_DAYS) break
      if (mergeable('instant', instantEnds[i]!, instantEnds[j]!)) {
        union.instant.union(instantEnds[i]!, instantEnds[j]!)
      }
    }
  }

  // 클러스터별 대표 선정 — 사실이 가장 많은 날짜, 동수면 이른 날짜. 사실 수는
  // 축을 가리지 않고 센다: 진짜 회계 마감일에는 손익·현금흐름·재무상태가 모두
  // 붙지만 오기 날짜에는 몇 개 태그만 딸려 오기 때문이다.
  const canonical: Record<DateAxis, Map<string, string>> = {
    instant: new Map(),
    duration: new Map(),
  }
  for (const axis of ['instant', 'duration'] as const) {
    const clusters = new Map<string, string[]>()
    for (const end of byAxis[axis].keys()) {
      const root = union[axis].find(end)
      let list = clusters.get(root)
      if (!list) { list = []; clusters.set(root, list) }
      list.push(end)
    }
    for (const members of clusters.values()) {
      let best = members[0]!
      for (const m of members) {
        const n = factCount.get(m) ?? 0
        const bn = factCount.get(best) ?? 0
        if (n > bn || (n === bn && m < best)) best = m
      }
      for (const m of members) canonical[axis].set(m, best)
    }
  }
  return canonical
}

/**
 * 회사 전체(모든 qtrs 버킷)에 대해 canonical 날짜 사전을 한 번만 만든다.
 *
 * 이전 구현은 이 계산을 qtrs 버킷마다 따로 했다. 그러면 같은 회계 마감일이
 * 어느 버킷에 API 데이터가 있느냐에 따라 서로 다른 정체성을 갖게 된다 —
 * 실측(Cisco, CIK 858877): bulk에 `qtrs=1 / 2025-07-31 / CostOfGoodsAndServicesSold`가
 * 있는데 Cisco는 회계연도 말에 별도 4분기를 신고하지 않으므로 API에는 qtrs=1
 * 사실이 없다. qtrs=1 버킷 안에는 붙을 API 날짜가 하나도 없어 2025-07-31이
 * 그대로 살아남고, 진짜 마감일 2025-07-26 닷새 뒤에 전 항목이 NULL인 유령
 * 분기가 생긴다. 기간 축의 그리드를 모든 qtrs 버킷에서 공유하면 2025-07-31은
 * qtrs=4의 2025-07-26으로 붙는다.
 *
 * 축(instant/duration)은 분리한다 — 표지 발행주식수처럼 회계 마감일과 무관한
 * 날짜에 찍히는 시점 값이 기간 종료일을 끌어당기지 않도록.
 */
function buildCanonicalIndex(facts: RawFact[]): (f: RawFact) => string {
  const apiCanonical = canonicaliseApiDates(facts)

  // 축별 canonical API 날짜 그리드. bulk 날짜는 이 그리드에만 투영된다.
  const grid: Record<DateAxis, string[]> = { instant: [], duration: [] }
  const gridSet: Record<DateAxis, Set<string>> = { instant: new Set(), duration: new Set() }
  // canonical 날짜 → 그 날짜에 API 사실이 존재하는 qtrs 버킷 집합.
  const bucketsOf = new Map<string, Set<number>>()
  for (const f of facts) {
    if (f.source !== 'api') continue
    const axis = axisOf(f.qtrs)
    const canonical = apiCanonical[axis].get(f.periodEnd) ?? f.periodEnd
    if (!gridSet[axis].has(canonical)) {
      gridSet[axis].add(canonical)
      grid[axis].push(canonical)
    }
    let buckets = bucketsOf.get(canonical)
    if (!buckets) { buckets = new Set(); bucketsOf.set(canonical, buckets) }
    buckets.add(f.qtrs)
  }
  grid.instant.sort()
  grid.duration.sort()

  const bulkCache = new Map<string, string>()

  return (f: RawFact): string => {
    const axis = axisOf(f.qtrs)
    if (f.source === 'api') return apiCanonical[axis].get(f.periodEnd) ?? f.periodEnd
    const key = `${axis}|${f.qtrs}|${f.periodEnd}`
    const cached = bulkCache.get(key)
    if (cached !== undefined) return cached
    let resolved = f.periodEnd
    if (!gridSet[axis].has(f.periodEnd)) {
      // **같은 qtrs 버킷에 API 사실이 있는 canonical 날짜를 우선한다.** 그리드를 버킷
      // 사이에서 공유하는 것 자체는 필요하다(CSCO: qtrs=1 버킷이 비어 있어 bulk
      // 2025-07-31이 qtrs=4의 진짜 마감일 2025-07-26에 붙어야 한다). 하지만 거리만
      // 보면 **한 버킷에만 존재하는 날짜가 다른 버킷의 분기를 통째로 훔칠 수** 있다 —
      // 실측(SYPR): 2025-09-29에는 qtrs=3의 가중평균 주식수 2건밖에 없는데
      // |09-30 − 09-29| = 1 이 |09-30 − 09-28| = 2 를 이겨 bulk 분기 전체가 그리로
      // 붙었고, 그 결과 완전한 중복 분기가 만들어졌다. 같은 버킷에 실제 사실이 있는
      // 날짜를 먼저 찾고, 없을 때만 다른 버킷의 날짜로 넘어간다.
      let best: string | null = null
      let bestDiff = Infinity
      let bestSameBucket = false
      for (const apiEnd of grid[axis]) {
        const diff = daysBetween(f.periodEnd, apiEnd)
        if (diff > CROSS_SOURCE_TOLERANCE_DAYS) continue
        const sameBucket = bucketsOf.get(apiEnd)?.has(f.qtrs) ?? false
        if (best !== null && bestSameBucket && !sameBucket) continue
        if (best !== null && sameBucket === bestSameBucket && diff >= bestDiff) continue
        best = apiEnd
        bestDiff = diff
        bestSameBucket = sameBucket
      }
      // 대응하는 API 날짜가 전혀 없는 기간의 bulk 사실은 자기 자신의 period_end를
      // 그대로 쓴다 — 대응 기간이 없다고 그 기간 자체를 버리지 않는다.
      resolved = best ?? f.periodEnd
    }
    bulkCache.set(key, resolved)
    return resolved
  }
}

/**
 * canonical 날짜 위에서 `qtrs → periodEnd → tag → value` 색인을 만든다.
 *
 * 같은 canonical 날짜·같은 태그에 값이 여럿이면 소스 안에서는 filedDate가 늦은
 * 값이 이기고(정정 공시 우선, 동률이면 먼저 만난 값 — 재실행 결정성), 소스 사이
 * 에서는 **API가 언제나 bulk를 이긴다**. bulk 쪽 날짜가 반올림된 근사치라는 점
 * 외에도, 실측 검증(Apple CIK 320193, accession 0000320193-26-000006)에서 bulk가
 * 세그먼트별 매출 분해값(제품 축 디멘션)을 연결 재무제표 총계인 것처럼 흘려보낸
 * 사례가 확인됐다 — SEC의 num.txt coreg 필드는 "법인(자회사)" 디멘션만 표시하고
 * 제품/서비스 축 같은 다른 디멘션은 표시하지 않기 때문에, 소스 코드의
 * `coreg !== ''` 필터를 통과해도 총계가 아닐 수 있다.
 */
export function indexFacts(facts: RawFact[]): FactIndex {
  const duration: FactIndex['duration'] = new Map()
  const instant: FactIndex['instant'] = new Map()
  const canonicalOf = buildCanonicalIndex(facts)

  // qtrs → source → canonical periodEnd → tag → entry
  const chosen = new Map<number, Record<'api' | 'bulk', Map<string, Map<string, FactEntry>>>>()
  // accession → { 그 신고서가 시점 사실을 실은 일자들, 태그 → 그 태그를 실은 일자들 }
  const byAccession = new Map<string, { dates: Set<string>; tags: Map<string, Set<string>> }>()

  for (const f of facts) {
    const periodEnd = canonicalOf(f)
    if (f.qtrs === 0) {
      let acc = byAccession.get(f.accession)
      if (!acc) { acc = { dates: new Set(), tags: new Map() }; byAccession.set(f.accession, acc) }
      acc.dates.add(periodEnd)
      let tagDates = acc.tags.get(f.tag)
      if (!tagDates) { tagDates = new Set(); acc.tags.set(f.tag, tagDates) }
      tagDates.add(periodEnd)
    }
    let bySource = chosen.get(f.qtrs)
    if (!bySource) { bySource = { api: new Map(), bulk: new Map() }; chosen.set(f.qtrs, bySource) }
    const byPeriod = bySource[f.source]
    let byTag = byPeriod.get(periodEnd)
    if (!byTag) { byTag = new Map(); byPeriod.set(periodEnd, byTag) }
    const prev = byTag.get(f.tag)
    // **자기 날짜로 신고된 값이, 옮겨져 온 값보다 우선한다.** `periodEnd`는 canonical
    // 날짜이고 `f.periodEnd`는 신고자가 실제로 찍은 날짜다. 둘이 다르면 그 사실은
    // "이 기간의 정정 공시"가 아니라 **다른 날짜에 잘못 찍혔다가 여기로 옮겨진 값**
    // 이다. 옮겨진 값이 늦게 신고됐다는 이유로 자기 날짜의 값을 덮으면, 날짜 정합이
    // 오히려 숫자를 망가뜨린다.
    //
    // 실측(ALGM, CIK 866291): 2022-06-12에 찍힌 `NetIncomeLoss` 187,494,000은 2026년에
    // 제출된 DEF 14A(위임장)의 값이다. 이 날짜가 진짜 마감일 2022-06-24로 흡수되면
    // filedDate 2026-06-24가 10-Q의 2023-08-04를 이겨, 그 분기의 순이익이 실제
    // 10,247,000 대신 187,494,000으로 저장된다. 옮겨져 온 값은 **빈 칸을 채울 수는
    // 있어도**(그 태그가 canonical 날짜에 아예 없을 때) 자기 날짜의 값을 대체하지
    // 못한다. 같은 등급 안에서는 종전대로 filedDate가 늦은 쪽이 이기고(정정 공시
    // 우선), 동률이면 먼저 만난 값을 쓴다(재실행 결정성).
    const native = f.periodEnd === periodEnd
    if (prev !== undefined && (prev.native !== native
      ? prev.native
      : prev.filedDate >= f.filedDate)) continue
    byTag.set(f.tag, { value: f.value, filedDate: f.filedDate, native })
  }

  for (const [qtrs, bySource] of chosen) {
    const out = new Map<string, Map<string, number>>()
    for (const [periodEnd, byTag] of bySource.api) {
      let tags = out.get(periodEnd)
      if (!tags) { tags = new Map(); out.set(periodEnd, tags) }
      for (const [tag, entry] of byTag) tags.set(tag, entry.value)
    }
    for (const [periodEnd, byTag] of bySource.bulk) {
      let tags = out.get(periodEnd)
      if (!tags) { tags = new Map(); out.set(periodEnd, tags) }
      // 같은 canonical 기간에 API 값이 이미 있으면 그쪽을 우선한다
      for (const [tag, entry] of byTag) if (!tags.has(tag)) tags.set(tag, entry.value)
    }
    if (qtrs === 0) {
      for (const [periodEnd, tags] of out) instant.set(periodEnd, tags)
    } else {
      duration.set(qtrs, out)
    }
  }

  // 같은 신고서가 어떤 개념을 다른 일자에는 태깅하고 이 일자에는 태깅하지 않았다면,
  // 그 개념은 이 대차대조표에 **없다**는 신고자의 진술이다(FactIndex.absent 주석 참고).
  const absent = new Map<string, Set<string>>()
  for (const acc of byAccession.values()) {
    if (acc.dates.size < 2) continue
    for (const [tag, tagDates] of acc.tags) {
      if (tagDates.size === acc.dates.size) continue
      for (const date of acc.dates) {
        if (tagDates.has(date)) continue
        let set = absent.get(date)
        if (!set) { set = new Set(); absent.set(date, set) }
        set.add(tag)
      }
    }
  }

  return { duration, instant, absent }
}

const REVENUE_CHAIN = [
  'RevenueFromContractWithCustomerExcludingAssessedTax',
  'Revenues',
  'SalesRevenueNet',
  'RevenueFromContractWithCustomerIncludingAssessedTax',
]
const COST_CHAIN = ['CostOfRevenue', 'CostOfGoodsAndServicesSold']
const OCF_CHAIN = [
  'NetCashProvidedByUsedInOperatingActivities',
  'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations',
]
const CAPEX_CHAIN = [
  'PaymentsToAcquirePropertyPlantAndEquipment',
  'PaymentsToAcquireProductiveAssets',
]

/** 체인에서 처음 발견된 값과 그 태그명을 반환한다. */
function firstOf(
  tags: Map<string, number>,
  chain: string[],
): { value: number; tag: string } | null {
  for (const t of chain) {
    const v = tags.get(t)
    if (typeof v === 'number') return { value: v, tag: t }
  }
  return null
}

const REVENUE_TAG_EXCL_TAX = 'RevenueFromContractWithCustomerExcludingAssessedTax'
const REVENUE_TAG_TOTAL = 'Revenues'
const GROSS_PROFIT_TAG = 'GrossProfit'
const OPERATING_INCOME_TAG = 'OperatingIncomeLoss'

/**
 * 매출 태그 해석. 결함 2(ingest-hardening 과제): 같은 회계기간·같은 소스에
 * `Revenues`와 `RevenueFromContractWithCustomerExcludingAssessedTax`가 둘 다
 * bulk로 존재할 때, 기존 체인 순서(Excl 우선)는 어느 쪽이 오염됐는지와
 * 무관하게 항상 Excl을 골라 틀린 값을 낼 수 있었다(Alphabet 실사례).
 *
 * 실 DB 전수 조사(두 태그가 같은 cik·period_end·qtrs·source에 함께 존재하는
 * 747개 사례)로 확인한 것: 두 값이 다를 때 작은 쪽은 정도의 차이만 있을 뿐
 * 거의 항상 디멘션 오염(세그먼트/제품 축 슬라이스가 연결 총계 자리에 새어
 * 들어온 값)이었다 — 근접-0 값(예: GOOGL 2024-09-30 Excl=388,000,000 vs
 * Revenues=88,268,000,000, 실제 분기 매출과 일치)부터 두 자릿수~세 자릿수
 * 배율 차이까지 전부. 그리고 오염이 어느 태그에 나타나는지는 고정돼 있지
 * 않다 — 같은 회사(Alphabet)의 다른 분기(2024-06-30)에서는 정반대로
 * Revenues=106,000,000(오염)이고 Excl=48,509,000,000(더 큼)이었다. 즉
 * "Excl이 항상 맞다"도 "Revenues가 항상 맞다"도 실측과 맞지 않는다 —
 * 오염된 값은 디멘션 슬라이스이므로 정의상 진짜 연결 총계의 부분집합이라
 * 항상 작다는 점만 일관됐다. 그래서 둘 다 있으면 더 큰 값을 취한다.
 *
 * 두 태그 중 하나만 있는 회사(대다수)는 영향이 없다 — 기존 체인 순서
 * (Excl → Revenues → SalesRevenueNet → RevenueInclTax)를 그대로 따른다.
 * 두 값이 같으면(실측 747건 중 198건) 어느 쪽을 골라도 결과는 같다.
 */
function resolveRevenue(tags: Map<string, number>): { value: number; tag: string } | null {
  const candidates: { value: number; tag: string }[] = []
  const excl = tags.get(REVENUE_TAG_EXCL_TAX)
  const total = tags.get(REVENUE_TAG_TOTAL)
  if (typeof excl === 'number') candidates.push({ value: excl, tag: REVENUE_TAG_EXCL_TAX })
  if (typeof total === 'number') candidates.push({ value: total, tag: REVENUE_TAG_TOTAL })

  // 업종별 총매출 태그(유틸리티·대출업 등)도 같은 최댓값 규칙에 넣는다. 이 신고자들은
  // 위 두 태그를 아예 쓰지 않아 지금까지 매출이 통째로 비어 있었고(XEL 2019~2025),
  // 반대로 같은 태그를 부분 매출로 쓰는 신고자(LNT)에서는 총계가 더 커서 저절로 진다.
  // 근거는 tags.ts `INDUSTRY_REVENUE_TOTAL_TAGS` 주석의 실측 표.
  for (const t of INDUSTRY_REVENUE_TOTAL_TAGS) {
    const v = tags.get(t)
    if (typeof v === 'number') candidates.push({ value: v, tag: t })
  }

  // 매출 = 매출총이익 + 매출원가. 회계 항등식이므로 추정이 아니라 회사가 신고한
  // 숫자끼리의 산술이다. 매출 태그만 디멘션 오염된 기간(Astera Labs 2025 Q1:
  // 매출 태그 44.6M인데 GrossProfit 119.4M + CostOfGoodsAndServicesSold 40.0M
  // = 159.4M)에서 진짜 총계를 되살린다. 오염값은 부분집합이라 항상 작으므로
  // 아래 "가장 큰 후보" 규칙과 방향이 같다.
  const gp = tags.get(GROSS_PROFIT_TAG)
  const cost = firstOf(tags, COST_CHAIN)
  if (typeof gp === 'number' && cost) {
    candidates.push({ value: gp + cost.value, tag: `${GROSS_PROFIT_TAG}+${cost.tag}` })
  }

  if (candidates.length > 1) {
    let best = candidates[0]!
    for (const c of candidates) if (c.value > best.value) best = c
    return best
  }
  const chained = firstOf(tags, REVENUE_CHAIN)
  if (chained) return chained
  // 체인 태그를 하나도 쓰지 않고 업종 총계 태그로만 신고하는 회사(XEL·MGEE·SOFI).
  // `GrossProfit+CostOfRevenue` 후보만 있는 경우는 예전 그대로 null이다 — 매출
  // 태그가 전혀 없는 회사에 산술 합을 매출로 승격시키는 것은 이번 과제의 판단 범위가
  // 아니고, 그 조합은 매출 태그가 있을 때 오염을 이기는 용도로만 도입됐다.
  return candidates.find((c) => INDUSTRY_REVENUE_TOTAL_TAGS.includes(c.tag)) ?? null
}

/**
 * 영업이익. 1순위는 언제나 신고된 `OperatingIncomeLoss`이고, 그것이 없을 때만
 * 손익계산서의 구조로 되살린다. 두 유도식의 정확도는 실측이다 — 매출·영업이익이
 * 모두 산출되는 회사에서 결정적으로 뽑은 **200개사 표본**의 연간 기간에서,
 * `OperatingIncomeLoss`가 함께 신고된 기간만 골라 유도값과 대조했다:
 *
 * | 유도식 | 1% 이내 일치 | 표본 |
 * |---|---|---|
 * | `GrossProfit − OperatingExpenses` | **98.1%** | 938/956 |
 * | `매출 − CostsAndExpenses`         | **92.6%** | 512/553 |
 * | `매출 − OperatingExpenses`        | 32.5% | 452/1,392 |
 *
 * 세 번째는 기각했다 — `OperatingExpenses`는 정의상 매출원가를 제외한 비용이라
 * 매출에서 바로 빼면 매출총이익만큼 과대계상된다(AMD 2025: 유도 21,181M vs 신고
 * 3,694M). 첫 번째를 먼저 두는 이유는 정확도이고, `GrossProfit`은 **신고된 태그만**
 * 쓴다(우리가 `매출 − 매출원가`로 유도한 값에 다시 `OperatingExpenses`를 빼면
 * 매출원가를 두 번 세는 신고자가 생긴다).
 *
 * ADP가 두 번째 티어의 사례다: `OperatingIncomeLoss`도 `GrossProfit`도 신고하지
 * 않고 `Revenues`와 `CostsAndExpenses`만 쓴다(FY2025: 20,560.9M − 15,604.9M =
 * 4,956.0M, 매출의 24.1%).
 *
 * 남는 오차는 숨기지 않는다 — 두 유도식이 어긋나는 7~2%는 대개 대출업(이자비용이
 * `CostsAndExpenses` 안에 들어가 사실상 세전이익이 된다)과 영업외 항목을 비용
 * 총계에 넣는 신고자다. provenance(`source_tags`)에 유도식이 그대로 남으므로
 * 어떤 값이 신고된 것이고 어떤 값이 유도된 것인지 DB에서 구분된다.
 */
function resolveOperatingIncome(
  tags: Map<string, number>,
  revenue: { value: number; tag: string } | null,
): { value: number; tag: string } | null {
  const reported = tags.get(OPERATING_INCOME_TAG)
  if (typeof reported === 'number') return { value: reported, tag: OPERATING_INCOME_TAG }

  const gp = tags.get(GROSS_PROFIT_TAG)
  const opex = tags.get(OPERATING_EXPENSES_TAG)
  if (typeof gp === 'number' && typeof opex === 'number') {
    return { value: gp - opex, tag: `${GROSS_PROFIT_TAG}-${OPERATING_EXPENSES_TAG}` }
  }

  const costs = tags.get(OPERATING_COST_TOTAL_TAG)
  if (revenue && typeof costs === 'number') {
    return { value: revenue.value - costs, tag: `${revenue.tag}-${OPERATING_COST_TOTAL_TAG}` }
  }
  return null
}

export type ResolvedFlow = {
  revenue: number | null
  grossProfit: number | null
  operatingIncome: number | null
  netIncome: number | null
  ocf: number | null
  capex: number | null
  sbc: number | null
  rdExpense: number | null
  sharesDiluted: number | null
}

export function resolveFlow(
  tags: Map<string, number>,
): { fields: ResolvedFlow; used: Record<string, string> } {
  const used: Record<string, string> = {}

  const rev = resolveRevenue(tags)
  if (rev) used.revenue = rev.tag

  let grossProfit: number | null = null
  const gp = tags.get(GROSS_PROFIT_TAG)
  if (typeof gp === 'number') {
    grossProfit = gp
    used.grossProfit = GROSS_PROFIT_TAG
  } else if (rev) {
    const cost = firstOf(tags, COST_CHAIN)
    if (cost) {
      grossProfit = rev.value - cost.value
      used.grossProfit = `${rev.tag}-${cost.tag}`
    }
  }

  const simple = (field: string, tag: string): number | null => {
    const v = tags.get(tag)
    if (typeof v !== 'number') return null
    used[field] = tag
    return v
  }

  const ocf = firstOf(tags, OCF_CHAIN)
  if (ocf) used.ocf = ocf.tag
  const capex = firstOf(tags, CAPEX_CHAIN)
  if (capex) used.capex = capex.tag
  const opInc = resolveOperatingIncome(tags, rev)
  if (opInc) used.operatingIncome = opInc.tag

  return {
    fields: {
      revenue: rev?.value ?? null,
      grossProfit,
      operatingIncome: opInc?.value ?? null,
      netIncome: simple('netIncome', 'NetIncomeLoss'),
      ocf: ocf?.value ?? null,
      capex: capex?.value ?? null,
      sbc: simple('sbc', 'ShareBasedCompensation'),
      rdExpense: simple('rdExpense', 'ResearchAndDevelopmentExpense'),
      sharesDiluted: simple(
        'sharesDiluted',
        'WeightedAverageNumberOfDilutedSharesOutstanding',
      ),
    },
    used,
  }
}

type Resolved = { value: number; tag: string }

/**
 * 한 상품 계열의 잔액. 총계 태그와 (비유동+유동) 합이 둘 다 있으면 **큰 쪽**을 쓴다 —
 * 어느 쪽이 디멘션 슬라이스로 오염될지 고정돼 있지 않고, 오염값은 정의상 진짜 총계의
 * 부분집합이라 항상 작다(tags.ts의 실측 근거, `resolveRevenue`와 같은 규칙).
 */
function familyBalance(tags: Map<string, number>, family: DebtFamily): Resolved | null {
  const candidates: Resolved[] = []
  const total = firstOf(tags, [...family.total])
  if (total) candidates.push(total)

  const noncurrent = firstOf(tags, [...family.noncurrent])
  const current = firstOf(tags, [...family.current])
  if (noncurrent || current) {
    candidates.push({
      value: (noncurrent?.value ?? 0) + (current?.value ?? 0),
      tag: [noncurrent?.tag, current?.tag].filter(Boolean).join('+'),
    })
  }

  if (candidates.length === 0) return null
  let best = candidates[0]!
  for (const c of candidates) if (c.value > best.value) best = c
  return best
}

export type InstantContext = {
  /** 태그 → 그 값이 찍힌 대차대조표 일자 */
  dates: ReadonlyMap<string, string>
  /** 일자 → 그 일자에 없다고 신고자가 단언한 태그(FactIndex.absent) */
  absent: ReadonlyMap<string, ReadonlySet<string>>
  /** 일자 → 그 일자의 태그 → 값. 별칭(같은 줄을 두 이름으로 태깅) 판정에 쓴다. */
  instant: ReadonlyMap<string, ReadonlyMap<string, number>>
}

/**
 * **가산 그룹의 날짜 정합성 — "다시 태깅되지 않았다"와 "사라졌다"를 가른다.**
 *
 * `pickInstant`는 태그마다 독립적으로 "asOf 이전 최근값"을 400일까지 소급해 찾는다.
 * 그 규칙을 서로 더해지는 대차대조표 구성요소에 그대로 적용하면 어느 대차대조표에도
 * 실재한 적 없는 합계가 만들어진다(실측: 두 구성요소가 모두 있는 289개사 중 35개사가
 * 서로 다른 일자에서 왔고 21개사는 100일 넘게 벌어져 있었다).
 *
 * 직전 구현은 이를 **"그룹 안에서 가장 최근 일자 하나로 고정하고 나머지는 버린다"**로
 * 풀었는데, 그 규칙은 *모든 구성요소가 매 대차대조표마다 다시 태깅된다*는 전제를 깔고
 * 있었다. 그 전제는 틀렸다 — 많은 신고자가 `LongTermDebtNoncurrent`를 10-K에서만
 * 태깅하고 10-Q에서는 `DebtCurrent`만 태깅한다. 그 회사들에서는 앵커가 분기 쪽에
 * 잡히면서 **장기차입금이 통째로 삭제됐다**(QCOM 2,489,000,000 · NXPI 750,000,000 ·
 * MTCH 0 — 실제 3,551,878,000).
 *
 * 그래서 규칙을 뒤집는다: **낡은 구성요소는 기본적으로 이월한다. 버리는 것은
 * 그것이 사라졌다는 증거가 있을 때뿐이다.** 증거는 네 가지이며 모두 신고서가
 * 실제로 주장하는 내용에서 나온다.
 *
 *  1. **같은 구역 재측정(REPLACED).** 앵커 일자에 같은 계열·겹치는 구역의 태그가
 *     있으면 그 구역은 다시 측정됐다 — 낡은 값은 그 값의 이전 상태일 뿐이다.
 *     (QCOM 2026-06-28: 앵커에 `LongTermDebt`가 있으므로 2025-09-28의
 *     `LongTermDebtNoncurrent` 14,811,000,000은 버린다.) 반대로 `DebtCurrent`만
 *     있는 앵커는 **유동 구역만** 재측정한 것이라 비유동 잔액을 반박하지 못한다
 *     (NXPI 2026-03-29: 10-Q 원문에도 `Long-term debt`가 그대로 있다).
 *  2. **별칭(ALIASED).** 낡은 태그가 자기 일자에서 앵커에 있는 다른 태그와 값이
 *     같았다면 두 이름이 같은 줄을 가리킨다 — 새 이름이 그 줄을 대표한다.
 *     (LPTH 2025-09-30: `LongTermDebtNoncurrent` = `LongTermLoansPayable` =
 *     4,867,298. IONS 2025-12-31: `LongTermDebtCurrent` 432,120 ≈
 *     `ConvertibleDebtCurrent` 431,948.)
 *  3. **부재 단언(ASSERTED ABSENT).** 앵커 일자를 신고한 바로 그 신고서가 같은
 *     개념을 **다른 일자에는** 태깅했다면, 앵커에서의 부재는 진술이다
 *     (CVV FY2025 10-K — `FactIndex.absent` 주석 참고).
 *  4. **낡은 롤업(SPANNING-STALE).** 유동+비유동을 한 숫자로 잰 태그는 앵커에서
 *     유동 구역이 다시 측정된 순간 합계로서 무효다 — 그 안의 유동 부분이 이미
 *     바뀌었기 때문이다.
 *
 * 이월된 값은 "이 구성요소를 마지막으로 신고한 대차대조표의 잔액"이며, 빠뜨리면
 * 그 금액 **전부**를 잃지만 이월하면 그동안 변한 만큼만 틀린다.
 */
function carryForwardGroup(
  tags: Map<string, number>,
  ctx: InstantContext | undefined,
  shapes: ReadonlyMap<string, DebtTagShape>,
  /**
   * 구역(유동/비유동)이 **상품 계열을 가로질러** 같은 것을 재는 그룹에서만 켠다.
   * 부채는 그렇다 — 어느 상품이든 유동/비유동 두 줄로 나뉘어 대차대조표에 오른다.
   * 현금 그룹은 아니다 — 현금성자산과 단기투자자산은 둘 다 유동이지만 서로 다른 줄이라
   * 한쪽이 다시 측정됐다고 다른 쪽이 그 안에 들어가지 않는다.
   */
  crossFamilyRegions = false,
): Map<string, number> {
  if (ctx === undefined) return tags
  const { dates, absent, instant } = ctx
  let anchor: string | null = null
  for (const [tag, date] of dates) {
    if (!shapes.has(tag) || !tags.has(tag)) continue
    if (anchor === null || date > anchor) anchor = date
  }
  if (anchor === null) return tags

  const anchorShapes: DebtTagShape[] = []
  for (const [tag, date] of dates) {
    if (date !== anchor || !tags.has(tag)) continue
    const shape = shapes.get(tag)
    if (shape) anchorShapes.push(shape)
  }
  const anchorAbsent = absent.get(anchor)
  // 앵커에서 **구역이 명시적으로 다시 측정됐는지**. 계열을 가리지 않고 본다 — 앵커
  // 대차대조표가 비유동·유동 두 줄을 모두 새로 적었다면, 낡은 신고서에서 온 "한
  // 상품의 전체 잔액"은 이미 그 두 줄 안에 반영돼 있다. spanning 태그는 여기 세지
  // 않는다: 어떤 상품의 총액 하나만 있는 앵커(SNWV 2026-06-30의 `LineOfCredit`
  // 655,000)는 다른 상품의 잔액에 대해 아무 말도 하지 않기 때문이다. 실측으로 이
  // 규칙이 가르는 두 사례 — LPTH 2026-03-31은 앵커에 `LongTermLoansPayable`(비유동)과
  // `LoansPayableCurrent`(유동)가 모두 있고 신고서 대차대조표에 전환사채 줄이 없다
  // (전환 완료), SNWV 2026-06-30은 앵커에 리볼버 총액 하나뿐이고 담보 대출
  // 12,922,000 + 5,599,000이 대차대조표에 그대로 있다.
  const anchorMeasured = new Set<DebtTagShape['region']>()
  for (const s of anchorShapes) if (s.region !== 'spanning') anchorMeasured.add(s.region)

  const overlaps = (a: DebtTagShape, b: DebtTagShape): boolean => {
    // 'general' 계열의 총계 개념은 계열을 가리지 않는다 — `DebtCurrent`는 모든 계열의
    // 유동 부분을, `DebtLongtermAndShorttermCombinedAmount`는 전부를 덮는다.
    if (a.family !== b.family && a.family !== 'general' && b.family !== 'general') return false
    return a.region === 'spanning' || b.region === 'spanning' || a.region === b.region
  }

  const out = new Map<string, number>()
  for (const [tag, value] of tags) {
    const shape = shapes.get(tag)
    if (!shape) continue
    const date = dates.get(tag)
    if (date === undefined || date === anchor) { out.set(tag, value); continue }

    // 4번(낡은 롤업)은 1번에 흡수된다 — spanning 태그는 같은 계열(혹은 general)의
    // 어떤 구역과도 겹치므로, 앵커가 유동 구역을 다시 측정한 순간 1번이 이미 버린다.
    if (anchorShapes.some((s) => overlaps(s, shape))) continue          // 1
    if (anchorAbsent?.has(tag)) continue                                // 3
    if (crossFamilyRegions && (shape.region === 'spanning'
      ? anchorMeasured.has('noncurrent') && anchorMeasured.has('current')
      : anchorMeasured.has(shape.region))) continue                     // 5
    const atOwnDate = instant.get(date)
    if (atOwnDate !== undefined) {
      let aliased = false
      for (const [other, otherDate] of dates) {
        if (otherDate !== anchor || other === tag) continue
        // **별칭 증거는 우리가 구역·계열을 확정한 태그에서만 나온다.** `dates`는
        // pickInstant가 고른 *모든* 태그를 담고 있어서, 이 필터가 없으면 shapes에
        // 없는 태그까지 "같은 줄의 새 이름"으로 인정된다. 리스 포함 롤업
        // (`…AndCapitalLeaseObligations`)이 정확히 그 함정이다 — 그것은 리스 없는
        // 구성요소와 **같은 줄이 아니라 그 줄 + 금융리스**이고, 어느 한 일자에
        // 값이 같은 것은 그날 금융리스가 0이었다는 뜻일 뿐 앞으로도 그 개념을
        // 대표한다는 뜻이 아니다. 실측(NXPI 2026-03-29): 10-Q가 2025-12-31에
        // `LongTermDebtAndCapitalLeaseObligations` 10,972,000,000을 태깅하는데 이는
        // 같은 일자의 `LongTermDebtNoncurrent` 10,972,000,000과 값이 같다. 이것을
        // 별칭으로 인정하면 리스 없는 비유동 잔액이 버려지고 총부채가 리스를 품은
        // 11,724,000,000이 된다(기준선 11,722,000,000). 문서화된 별칭 실사례
        // (LPTH `LongTermLoansPayable`, IONS `ConvertibleDebtCurrent`)는 전부
        // shapes 안의 태그라 이 필터에 걸리지 않는다.
        if (!shapes.has(other)) continue
        const v = atOwnDate.get(other)
        if (v !== undefined && sameNumber(v, value)) { aliased = true; break }
      }
      if (aliased) continue                                             // 2
    }
    out.set(tag, value)
  }
  return out
}

/**
 * 유동 차입금 부분. `DebtCurrent`는 정의상 유동 만기분·단기차입금·유동 어음을
 * 모두 포함하는 **총계**이고, `LongTermDebtCurrent`+단기차입금은 그 **구성요소**다.
 * 어느 쪽이 디멘션 오염될지는 고정돼 있지 않고 오염값은 정의상 진짜 총계의
 * 부분집합이라 항상 작으므로, 둘 다 있으면 큰 쪽을 쓴다 — `resolveRevenue`·
 * `familyBalance`가 이미 쓰는 규칙과 같다.
 *
 * **단기차입금을 언제 더하는가.** tags.ts:92가 정한 규칙("단기차입금은
 * 장기차입금에 포함될 수 없으므로 언제나 더한다", XEL 실사례)은 지금까지 티어 4
 * 에서만 적용됐다. 실측(티어 1이 발동하는 16,027개 시점): `ShortTermBorrowings`가
 * 존재하는데 통째로 버려진 경우 1,677건, `DebtCurrent`가 있는데 유동 부분이
 * 아예 반영되지 않은 경우 842건이다. 최신 TTM 대차대조표 일자 기준으로
 * NFLX(2026-06-30, `ShortTermBorrowings` 2,483,758,000 누락 = −17%),
 * CEG(−21%), GEHC(−16%)가 전부 여기에 해당한다.
 *
 * **무조건 더하면 안 되는 이유.** `ShortTermBorrowings`가 `LongTermDebtCurrent`를
 * **품고 있는** 신고자가 있다. 두 태그가 함께 있는 763개 시점 중 171건(22%)은
 * 값이 **정확히 같고**(AMAT 2026-04-26 둘 다 1,199,000,000, LITE 2025-12-27 둘 다
 * 3,240,200,000), 그 바로 옆에는 "유동 만기분 + 아주 작은 기타 단기차입"인
 * 집단이 붙어 있다 — GEHC(GE HealthCare)는 2024-03부터 2026-03까지 **모든 분기**
 * 에서 `ShortTermBorrowings`가 `LongTermDebtCurrent`보다 2~7백만 달러만 크고
 * (1,003/1,008 · 1,500/1,502 · 2,002/2,005 · 502/508), 회사가 함께 신고한 장기차입금
 * 롤업 `LongTermDebt`는 정확히 `LongTermDebtNoncurrent + ShortTermBorrowings`와
 * 일치한다(2025-09-30: 8,277 + 2,005 = 10,282). 즉 GEHC의 단기차입금은 별도
 * 항목이 아니라 유동 부분 그 자체다 — 최종 리뷰가 이 회사를 "−16% 과소계상"의
 * 사례로 든 것은 반대로 $2.0B 이중계상이 된다.
 *
 * 그래서 두 값의 상대차가 DEBT_OVERLAP_REL_TOLERANCE 이내면 **더하지 않고 큰 쪽을
 * 쓴다**(포함관계로 본다). 이 창 밖이면 서로 다른 항목으로 보고 더한다 — CEG
 * 2026-06-30은 유동만기 363M에 기업어음 5,226M(14배)로 명백히 별개다. 실측
 * 상대차 분포: 0%가 171건, (0,0.5%] 22건, (0.5,2%] 14건, (2,5%] 15건, (5,10%]
 * 18건, 그 위로 523건. 2%는 완전일치 스파이크와 그에 붙은 "몇 백만 달러 차이"
 * 집단까지 덮으면서, 자릿수가 다른 별개 항목과는 충분히 멀다. 판정이 틀렸을 때의
 * 손해도 비대칭이다 — 포함인데 더하면 최대 2배 과대, 별개인데 큰 쪽만 쓰면 최대
 * 절반 과소다.
 *
 * **그러나 상대 허용오차는 포함관계를 표현할 수 있는 도구가 아니다.** 실측으로 양쪽
 * 방향의 오판이 확인됐다(둘 다 신고서 원문 확인):
 *  - GEHC 2026-03-31: `LongTermDebtCurrent` 2,000,000 vs `ShortTermBorrowings`
 *    7,000,000 — 상대차 71%라 "별개"로 판정돼 더해졌지만, 회사의 차입금 주석은
 *    *"Short-term borrowings … includes $2 million … related to the current portion of
 *    our long-term borrowings"*라고 적고 총차입금을 10,134로 마감한다. 금액이 작아지면
 *    상대차는 포함관계와 아무 상관이 없어진다.
 *  - WWD 2025-09-30: `LongTermDebtCurrent` 122,934,000 vs `ShortTermBorrowings`
 *    122,300,000 — 상대차 0.52%라 "포함"으로 판정돼 122,300,000이 통째로 사라졌지만,
 *    FY2025 10-K 대차대조표는 `Short-term debt 122,300` / `Current portion of long-term
 *    debt 122,934` / `Long-term debt, less current portion 456,968`을 **세 줄로 따로**
 *    적는다. 진짜 총부채는 702,202,000이다.
 *
 * 그래서 판정 근거를 **신고자 자신이 함께 신고한 롤업 항등식**으로 바꾼다. 네 태그가
 * 함께 있을 때 어느 항등식이 **정확히** 성립하는지가 구조를 그대로 말해준다:
 *
 *   `LongTermDebt = LongTermDebtNoncurrent + ShortTermBorrowings`
 *        → 단기차입금이 곧 유동 만기분이다(포함).       GEHC: 10,127 + 7 = 10,134 ✔
 *   `LongTermDebt = LongTermDebtNoncurrent + LongTermDebtCurrent`
 *        → 롤업은 유동 만기분에서 끝난다. 단기차입금은 그 밖이다(별개).
 *                                                      WWD: 456,968 + 122,934 = 579,902 ✔
 *
 * 두 항등식이 모두 성립하면 두 유동 태그가 같은 줄을 두 이름으로 부른 것이므로 포함이다.
 * 항등식을 세울 태그가 없으면(다수) 마지막으로 **두 값이 같은 숫자인지**만 본다 —
 * 실측 763개 시점 중 171건(22%)이 값이 정확히 같고(AMAT 2026-04-26 둘 다
 * 1,199,000,000, LITE 2025-12-27 둘 다 3,240,200,000), 같은 숫자를 두 번 적는 것은
 * 중복 태깅의 직접 증거다. 근사 구간(0.5~2%)은 더 이상 포함으로 보지 않는다 — WWD가
 * 정확히 그 구간에서 틀렸다.
 */

/**
 * 유동 차입금 부분과, 그중 **장기차입금 계열 총계 안에 이미 들어 있는 금액**.
 * 후자는 계열 총계에 유동 부분을 다시 더해 이중계상하는 것을 막는다.
 */
type CurrentPortion = Resolved & { insideLongTermFamily: number }

function currentDebtPortion(tags: Map<string, number>): CurrentPortion | null {
  const ltCur = tags.get(LONG_TERM_DEBT_CURRENT_TAG)
  const shortTerm = firstOf(tags, [...SHORT_TERM_BORROWING_TAGS])
  const ltNon = tags.get(LONG_TERM_DEBT_NONCURRENT_TAG)
  const ltTotal = tags.get(LONG_TERM_DEBT_TOTAL_TAG)

  const candidates: CurrentPortion[] = []

  const rollup = tags.get(DEBT_CURRENT_TOTAL_TAG)
  if (typeof rollup === 'number') {
    candidates.push({
      value: rollup,
      tag: DEBT_CURRENT_TOTAL_TAG,
      insideLongTermFamily: typeof ltCur === 'number' ? Math.min(ltCur, rollup) : 0,
    })
  }

  if (typeof ltCur === 'number' && shortTerm !== null) {
    // 신고자 자신의 롤업 항등식이 정확히 성립하는지 본다(위 주석).
    const exact = (a: number, b: number) => a === b
    const stIsCurrentPortion = typeof ltNon === 'number' && typeof ltTotal === 'number'
      && exact(ltTotal, ltNon + shortTerm.value)
    const stIsSeparate = typeof ltNon === 'number' && typeof ltTotal === 'number'
      && exact(ltTotal, ltNon + ltCur)
    const contained = stIsCurrentPortion || (!stIsSeparate && sameNumber(ltCur, shortTerm.value))
    candidates.push(contained
      ? (ltCur >= shortTerm.value
        ? { value: ltCur, tag: LONG_TERM_DEBT_CURRENT_TAG, insideLongTermFamily: ltCur }
        : { ...shortTerm, insideLongTermFamily: shortTerm.value })
      : {
        value: ltCur + shortTerm.value,
        tag: `${LONG_TERM_DEBT_CURRENT_TAG}+${shortTerm.tag}`,
        insideLongTermFamily: ltCur,
      })
  } else if (typeof ltCur === 'number') {
    candidates.push({ value: ltCur, tag: LONG_TERM_DEBT_CURRENT_TAG, insideLongTermFamily: ltCur })
  } else if (shortTerm !== null) {
    candidates.push({ ...shortTerm, insideLongTermFamily: 0 })
  }

  if (candidates.length === 0) return null
  let best = candidates[0]!
  for (const c of candidates) if (c.value > best.value) best = c
  return best
}

/**
 * **총부채 0은 언제나 null이다.** 0은 "부채가 없다"가 아니라 "이 태그들로는 부채를
 * 못 봤다"이다 — 진짜 무차입 기업은 애초에 차입금 개념을 태깅하지 않아 여기까지 오지
 * 않는다. 반면 부분적인 태그 하나가 0으로 들어오면(유동 총계만 0, 리볼버 미인출 0 등)
 * 확신에 찬 틀린 0이 만들어진다. 실측 두 가지:
 *  - CDNS 2024-12-31: 대차대조표에 선순위채 약 $2.5B이 있는데 그 기간에 추적 가능한
 *    부채 태그가 없고 400일 소급으로 2023-12-31의 `LinesOfCreditCurrent`=0만 딸려
 *    들어와 총부채가 0으로 확정됐다.
 *  - MTCH 2026-06-30: `LongTermDebtCurrent`=0 하나만 앵커에 남아 총부채가 **0**으로
 *    저장됐다 — 실제 장기차입금은 3,551,878,000이다. 이 가드가 티어 4에만 있었기
 *    때문에 벌어진 일이라 이제 모든 티어에 적용한다.
 * 확신에 찬 틀린 0은 정직한 null보다 나쁘다.
 */
function nonZero(r: Resolved): Resolved | null {
  return r.value === 0 ? null : r
}

/**
 * 두 태그의 값이 **같은 대차대조표 일자**에서 왔는지. 롤업에서 리스를 빼는 것은
 * 뺄셈이라, 서로 다른 일자의 잔액을 섞으면 어느 대차대조표에도 없던 숫자가 된다.
 * `ctx`가 없으면(단위 테스트처럼 한 시점만 다루는 호출) 검사할 것이 없다.
 */
function sameInstantAs(
  ctx: InstantContext | undefined, a: string, b: string,
): boolean {
  if (ctx === undefined) return true
  const da = ctx.dates.get(a)
  const db = ctx.dates.get(b)
  if (da === undefined || db === undefined) return true
  return da === db
}

/** 같은 일자에 있는 금융리스 잔액(구역별 첫 후보). 없으면 0 — 뺄 것이 없다는 뜻이다. */
function financeLeaseAt(
  allTags: Map<string, number>,
  ctx: InstantContext | undefined,
  anchorTag: string,
  region: DebtRegion,
): Resolved | null {
  for (const tag of FINANCE_LEASE_BY_REGION[region]) {
    const v = allTags.get(tag)
    if (typeof v === 'number' && sameInstantAs(ctx, anchorTag, tag)) return { value: v, tag }
  }
  return null
}

/**
 * 리스 포함 롤업에서 같은 구역의 금융리스를 뺀 **이자부 차입금**. 근거와 반례는
 * tags.ts의 `LEASE_INCLUSIVE_DEBT_TAGS` 주석 참고.
 *
 * 뺀 결과가 0 이하면 버린다. 롤업이 리스보다 작다는 것은 둘이 같은 대차대조표
 * 줄을 재고 있지 않다는 뜻이라(실측 PRPO 2025-12-31: 롤업 77,000 < 리스 960,000),
 * 그 차분에는 의미가 없다. ASYS처럼 롤업 = 금융리스 비유동(둘 다 162,000)이라
 * 차분이 정확히 0인 경우도 여기서 걸러진다 — "차입금 없음"은 `nonZero`가 이미
 * null로 다루는 것과 같은 판단이다.
 */
function leaseFreeRollup(
  allTags: Map<string, number>,
  ctx: InstantContext | undefined,
  rollupTag: string,
  region: DebtRegion,
): Resolved | null {
  const gross = allTags.get(rollupTag)
  if (typeof gross !== 'number') return null
  const lease = financeLeaseAt(allTags, ctx, rollupTag, region)
  const net = gross - (lease?.value ?? 0)
  if (net <= 0) return null
  return { value: net, tag: lease === null ? rollupTag : `${rollupTag}-${lease.tag}` }
}

/** 상품별 계열의 합. 계열끼리는 서로 다른 상품이라 겹치지 않으므로 더한다. */
function specificFamilySum(tags: Map<string, number>): Resolved | null {
  let specific: Resolved | null = null
  for (const family of SPECIFIC_DEBT_FAMILIES) {
    const balance = familyBalance(tags, family)
    if (!balance) continue
    specific = specific === null
      ? balance
      : { value: specific.value + balance.value, tag: `${specific.tag}+${balance.tag}` }
  }
  return specific
}

/** provenance 문자열. 같은 태그가 두 조각에 나타나도 한 번만 적는다. */
function joinTags(parts: readonly string[]): string {
  const seen = new Set<string>()
  for (const part of parts) {
    for (const t of part.split('+')) if (t !== '') seen.add(t)
  }
  return [...seen].join('+')
}

/**
 * 총부채(이자부 차입금) 해석. 티어 순서이며 아래 티어는 위 티어가 아무 값도 내지
 * 못할 때만 작동한다. 태그 선정과 계열 간 최댓값 규칙의 실측 근거는 tags.ts 주석과
 * debt-coverage-report.md 1절 참고.
 */
export function resolveTotalDebt(
  allTags: Map<string, number>,
  ctx?: InstantContext,
): Resolved | null {
  // 합산에 참여하는 부채 태그의 일자 정합(F4) — 낡은 구성요소는 사라졌다는 증거가
  // 있을 때만 버린다.
  const tags = carryForwardGroup(allTags, ctx, DEBT_TAG_SHAPES, true)

  // 티어 1 — 장·단기를 하나로 합쳐 신고한 총계 태그. **정의상 총부채 그 자체**이므로
  // 다른 조립보다 우선한다. 실측(VRSK 2025-12-31): `DebtLongtermAndShorttermCombinedAmount`
  // 4,737,200,000이 회사의 총차입금이고, 같은 일자의 `LongTermDebt` 4,773,500,000은
  // 발행총액(할인·발행비 차감 전)이라 `DebtCurrent` 1,508,900,000과 더하면 1.5B 이중계상이
  // 된다. 다른 신고자(SWKS 2025-10-03)에서는 combined 995,800,000 = `LongTermDebt`
  // 496,400,000 + `DebtCurrent` 499,400,000으로 조립과 정확히 일치한다 — 즉 combined는
  // 두 관행 어느 쪽에서도 옳고, 조립은 그렇지 않다.
  const combined = tags.get(DEBT_COMBINED_TOTAL_TAG)
  if (typeof combined === 'number') {
    return nonZero({ value: combined, tag: DEBT_COMBINED_TOTAL_TAG })
  }

  // 티어 2 — 대차대조표의 **총계 개념**으로 신고한 경우(가장 흔한 형태).
  //   총부채 = 비유동 장기차입금 + (계열 밖) 유동 차입금
  // 옛 코드는 티어 1(비유동/유동 분리)과 티어 2(`DebtCurrent`)를 따로 두고 둘 다
  // 조기 반환했는데, 그 구조가 F2의 결함이었다 — 유동 부분을 어느 태그로 읽든
  // 단기차입금은 같은 방식으로 합쳐져야 하고, `LongTermDebt` 롤업에도 닿아야 한다.
  //
  // **`LongTermDebt`를 어떻게 읽는가.** 두 관행이 실재하며, 신고자가 같은 일자에
  // `LongTermDebtNoncurrent`를 함께 태깅했는지가 그 관행을 가른다:
  //  (a) 비유동 태그가 **있으면** `LongTermDebt`는 유동 만기분을 포함한 계열 총계다
  //      (tags.ts 실측: 셋이 함께 있는 781개 시점에서 ltd / (nc+cur) 중앙값 1.000,
  //      0.99~1.01 구간 671건). 그래서 계열 총계 = max(ltd, nc+cur)이고, 유동 차입금
  //      중 **계열 밖 부분만** 더한다.
  //  (b) 비유동 태그가 **없으면** `LongTermDebt`는 대차대조표의 `Long-term debt` 줄,
  //      즉 유동분을 뺀 비유동 잔액이다. 신고서 원문으로 확인: QCOM 2026-06-28
  //      (`Short-term debt 2,489` + `Long-term debt 12,781`), TSLA 2026-06-30
  //      (1,340 + 7,721), ADBE 2026-05-29 (1,843 + 4,802), XRX 2026-06-30 (70 + 4,153),
  //      MTCH 2026-06-30 (`Current maturities … 0` + `Long-term debt, net 3,551,878`),
  //      SWKS 2025-10-03(combined 995.8 = 496.4 + 499.4). 그래서 유동 부분을 그대로
  //      더한다.
  const ltNon = tags.get(LONG_TERM_DEBT_NONCURRENT_TAG)
  const ltCur = tags.get(LONG_TERM_DEBT_CURRENT_TAG)
  const ltTotal = tags.get(LONG_TERM_DEBT_TOTAL_TAG)
  const debtCurrent = tags.get(DEBT_CURRENT_TOTAL_TAG)
  const hasTier2 = typeof ltNon === 'number' || typeof ltCur === 'number'
    || typeof ltTotal === 'number' || typeof debtCurrent === 'number'
  // 상품별 계열 합. 장기차입금 롤업이 디멘션 슬라이스로 오염됐을 때 진짜 총계는
  // 이쪽이다(tags.ts SND 실사례) — 롤업과는 **더하지 않고 큰 쪽**을 쓴다.
  const specific = specificFamilySum(tags)

  // 티어 2b — 리스 포함 롤업밖에 없는 대차대조표.
  //
  // **발동 조건이 이 티어의 안전장치 전부다.** 리스 없는 총계 개념
  // (`DebtLongtermAndShorttermCombinedAmount` · `LongTermDebt` ·
  // `LongTermDebtNoncurrent`)이 이월 후에도 하나도 없을 때만 본다. 그 셋 중 하나라도
  // 있으면 위 티어가 이미 리스 없는 답을 내고 있고, 그 답을 이 티어가 건드리면 안
  // 된다 — tags.ts가 기록한 반례(GOOGL의 롤업 = `LongTermDebtNoncurrent`, NXPI의
  // 롤업이 어느 쪽과도 안 맞는 경우)가 전부 이 조건에서 걸러진다.
  //
  // 실측 확인(유니버스 1,200개사, 최신 TTM 대차대조표): 이 조건 때문에 값이
  // 그대로인 회사 — GOOGL 100,164,000,000, NXPI 11,722,000,000, VRSK 4,475,600,000,
  // XEL 39,457,000,000, LRCX, AMPH. 값이 바뀌는 회사 — MU 582M→, CELU 6.3M→,
  // EBAY·FISV·VSAT·PODD·LNTH·QDEL·CNDT·DRS·FELE·FCEL·TECH·NSIT·RXRX·PLAB·AVR.
  //
  // `ltCur`(`LongTermDebtCurrent`)와 `debtCurrent`는 조건에 넣지 않는다. 둘 다
  // **유동 구역만** 재는 태그라 비유동 차입금에 대해 아무 말도 하지 않는다 —
  // 이 티어가 채우려는 것이 정확히 그 비유동 구역이다(MU·CELU 둘 다 이 경우다).
  // (`DebtLongtermAndShorttermCombinedAmount`는 티어 1이 이미 반환했으므로 여기 없다.)
  if (ltNon === undefined && ltTotal === undefined) {
    // 스패닝 롤업은 유동까지 이미 덮으므로 유동 부분을 다시 더하지 않는다.
    //
    // **상품별 계열 합이 더 크면 이 티어는 물러난다.** 롤업과 상품합 사이에서 큰
    // 쪽을 쓰는 것은 이 파일이 이미 쓰는 규칙이고(오염값은 정의상 총계보다 작다),
    // 상품합이 이긴다는 것은 롤업이 최선의 증거가 아니라는 뜻이다 — 그때는 아래
    // 기존 티어가 상품합을 자기 규칙대로 조립하게 둔다(실측 TECH 2026-03-31:
    // `LinesOfCreditCurrent` 346,000,000 > 롤업 200,000,000).
    const beatsSpecific = (r: Resolved): boolean => specific === null || r.value >= specific.value

    const spanning = leaseFreeRollup(allTags, ctx, DEBT_WITH_LEASES_SPANNING_TAG, 'spanning')
    if (spanning !== null && beatsSpecific(spanning)) {
      // 스패닝 롤업은 유동까지 이미 덮으므로 유동 부분을 다시 더하지 않는다.
      return nonZero(spanning)
    }
    const noncurrent = leaseFreeRollup(allTags, ctx, DEBT_WITH_LEASES_NONCURRENT_TAG, 'noncurrent')
    if (noncurrent !== null && beatsSpecific(noncurrent)) {
      // 비유동 롤업이므로 유동 차입금을 더한다. 다만 `DebtCurrent`는 공식 정의가
      // "short-term debt and current maturity of long-term debt **and capital lease
      // obligations**"라 그 자체로 리스를 품는다 — 리스를 뺀 비유동에 리스를 품은
      // 유동을 더하면 절반만 뺀 셈이 된다. 그래서 유동 쪽에서도 같은 구역의
      // 금융리스를 뺀다(실측 MU 2026-05-28: `DebtCurrent` 582,000,000 =
      // `FinanceLeaseLiabilityCurrent` 582,000,000 — 유동 차입금은 실제로 0이다).
      const raw = currentDebtPortion(tags)
      let current: Resolved | null = raw
      if (raw !== null && raw.tag.includes(DEBT_CURRENT_TOTAL_TAG)) {
        const lease = financeLeaseAt(allTags, ctx, DEBT_CURRENT_TOTAL_TAG, 'current')
        if (lease !== null) {
          const netted = Math.max(0, raw.value - lease.value)
          current = netted === 0 ? null : { value: netted, tag: `${raw.tag}-${lease.tag}` }
        }
      }
      return nonZero({
        value: noncurrent.value + (current?.value ?? 0),
        tag: joinTags(current === null ? [noncurrent.tag] : [noncurrent.tag, current.tag]),
      })
    }
  }

  if (hasTier2) {
    const current = currentDebtPortion(tags)
    if (typeof ltNon === 'number') {
      const componentSum = ltNon + (ltCur ?? 0)
      const familyValue = Math.max(ltTotal ?? 0, componentSum)
      const familyTag = (ltTotal ?? 0) > componentSum
        ? [LONG_TERM_DEBT_TOTAL_TAG]
        : [LONG_TERM_DEBT_NONCURRENT_TAG, ...(typeof ltCur === 'number' ? [LONG_TERM_DEBT_CURRENT_TAG] : [])]
      // 비유동 태그를 명시한 신고자는 대차대조표의 총계 개념을 쓰고 있으므로 상품별
      // 계열은 그 안에 이미 들어 있다고 본다(부채 태그 확장 과제의 가산성 보장) —
      // 상품합과의 최댓값 비교는 롤업이 오염될 수 있는 (b)·(c) 경로에서만 한다.
      const core = { value: familyValue, tag: familyTag }
      const outside = current === null
        ? 0
        : Math.max(0, current.value - current.insideLongTermFamily)
      return nonZero({
        value: core.value + outside,
        tag: joinTags(outside > 0 && current !== null ? [...core.tag, current.tag] : core.tag),
      })
    }
    if (typeof ltTotal === 'number') {
      const core = specific !== null && specific.value > ltTotal
        ? specific
        : { value: ltTotal, tag: LONG_TERM_DEBT_TOTAL_TAG }
      return nonZero({
        value: core.value + (current?.value ?? 0),
        tag: joinTags([core.tag, ...(current ? [current.tag] : [])]),
      })
    }
    if (current !== null) {
      return nonZero(specific !== null && specific.value > current.value
        ? specific
        : { value: current.value, tag: current.tag })
    }
  }

  // 티어 3 — 상품별 이름으로만 태깅한 발행사. 상품별 계열은 서로 다른 상품이라
  // 합산한다. 단기차입금은 장기차입금에 포함될 수 없으므로 언제나 더한다.
  // (tags.ts의 TLS·SND·XEL 실사례 참고)
  const shortTerm = firstOf(tags, [...SHORT_TERM_BORROWING_TAGS])
  if (specific === null && shortTerm === null) return null

  return nonZero({
    value: (specific?.value ?? 0) + (shortTerm?.value ?? 0),
    tag: [specific?.tag, shortTerm?.tag].filter(Boolean).join('+'),
  })
}

export type ResolvedStock = {
  cash: number | null
  totalDebt: number | null
  equity: number | null
  sharesOutstanding: number | null
}

export function resolveStock(
  allTags: Map<string, number>,
  ctx?: InstantContext,
): { fields: ResolvedStock; used: Record<string, string> } {
  const used: Record<string, string> = {}
  // 현금성자산 + 단기투자자산도 서로 더해지므로 같은 규칙을 쓴다(F4). 두 태그는
  // 대차대조표의 서로 다른 줄이라 한쪽의 존재가 다른 쪽의 부재를 증언하지 못한다 —
  // 신고자가 같은 신고서에서 부재를 단언했을 때만 버린다.
  const tags = carryForwardGroup(allTags, ctx, CASH_TAG_SHAPES)

  let cash: number | null = null
  const cce = tags.get('CashAndCashEquivalentsAtCarryingValue')
  if (typeof cce === 'number') {
    const sti = tags.get('ShortTermInvestments')
    if (typeof sti === 'number') {
      cash = cce + sti
      used.cash = 'CashAndCashEquivalentsAtCarryingValue+ShortTermInvestments'
    } else {
      cash = cce
      used.cash = 'CashAndCashEquivalentsAtCarryingValue'
    }
  }
  // When only ShortTermInvestments is present without CashAndCashEquivalentsAtCarryingValue,
  // cash remains null. Short-term investments alone is anomalous (data quality issue),
  // and treating investments as "cash" would overstate liquidity — exactly the distressed-company
  // red flag this product needs to surface. This is intentional; use a comment to avoid
  // "fixing" it by accident.
  // See test: 단기투자자산만 있고 현금성자산이 없으면 null

  const debt = resolveTotalDebt(allTags, ctx)
  const totalDebt = debt?.value ?? null
  if (debt) used.totalDebt = debt.tag

  const simple = (field: string, tag: string): number | null => {
    const v = allTags.get(tag)
    if (typeof v !== 'number') return null
    used[field] = tag
    return v
  }

  return {
    fields: {
      cash,
      totalDebt,
      equity: simple('equity', 'StockholdersEquity'),
      sharesOutstanding: simple('sharesOutstanding', 'EntityCommonStockSharesOutstanding'),
    },
    used,
  }
}
