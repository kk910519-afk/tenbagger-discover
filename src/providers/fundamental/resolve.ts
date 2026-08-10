import type { RawFact } from '../types.js'
import {
  DEBT_COMBINED_TOTAL_TAG, DEBT_CURRENT_TOTAL_TAG, DEBT_TAGS,
  LONG_TERM_DEBT_CURRENT_TAG, LONG_TERM_DEBT_FAMILY, LONG_TERM_DEBT_NONCURRENT_TAG,
  SHORT_TERM_BORROWING_TAGS, SPECIFIC_DEBT_FAMILIES, type DebtFamily,
} from './tags.js'

export type FactIndex = {
  /** qtrs → periodEnd → tag → value */
  duration: Map<number, Map<string, Map<string, number>>>
  /** periodEnd → tag → value */
  instant: Map<string, Map<string, number>>
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

type FactEntry = { value: number; filedDate: string }

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
    let overlap = 0
    for (const [key, va] of ta) {
      const vb = tb.get(key)
      if (vb === undefined) continue
      if (!sameNumber(va, vb)) return false
      overlap++
    }
    return overlap > 0
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
  for (const f of facts) {
    if (f.source !== 'api') continue
    const axis = axisOf(f.qtrs)
    const canonical = apiCanonical[axis].get(f.periodEnd) ?? f.periodEnd
    if (!gridSet[axis].has(canonical)) {
      gridSet[axis].add(canonical)
      grid[axis].push(canonical)
    }
  }
  grid.instant.sort()
  grid.duration.sort()

  const bulkCache = new Map<string, string>()

  return (f: RawFact): string => {
    const axis = axisOf(f.qtrs)
    if (f.source === 'api') return apiCanonical[axis].get(f.periodEnd) ?? f.periodEnd
    const key = `${axis}|${f.periodEnd}`
    const cached = bulkCache.get(key)
    if (cached !== undefined) return cached
    let resolved = f.periodEnd
    if (!gridSet[axis].has(f.periodEnd)) {
      let best: string | null = null
      let bestDiff = Infinity
      for (const apiEnd of grid[axis]) {
        const diff = daysBetween(f.periodEnd, apiEnd)
        if (diff <= CROSS_SOURCE_TOLERANCE_DAYS && diff < bestDiff) {
          best = apiEnd
          bestDiff = diff
        }
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

  for (const f of facts) {
    const periodEnd = canonicalOf(f)
    let bySource = chosen.get(f.qtrs)
    if (!bySource) { bySource = { api: new Map(), bulk: new Map() }; chosen.set(f.qtrs, bySource) }
    const byPeriod = bySource[f.source]
    let byTag = byPeriod.get(periodEnd)
    if (!byTag) { byTag = new Map(); byPeriod.set(periodEnd, byTag) }
    const prev = byTag.get(f.tag)
    // 동률(같은 filedDate)이면 먼저 만난 값을 쓴다 — 원래 chosenAt 로직과 동일.
    if (prev !== undefined && prev.filedDate >= f.filedDate) continue
    byTag.set(f.tag, { value: f.value, filedDate: f.filedDate })
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

  return { duration, instant }
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
  return firstOf(tags, REVENUE_CHAIN)
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

  return {
    fields: {
      revenue: rev?.value ?? null,
      grossProfit,
      operatingIncome: simple('operatingIncome', 'OperatingIncomeLoss'),
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

/**
 * **가산 그룹의 날짜 정합성.** `pickInstant`는 태그마다 독립적으로 "asOf 이전
 * 최근값"을 400일까지 소급해 찾는다. 표지 발행주식수처럼 대차대조표 일자와
 * 무관한 날짜에 찍히는 값에는 그 규칙이 꼭 필요하지만, **서로 더해지는
 * 대차대조표 구성요소에까지 적용되면 어느 대차대조표에도 실재한 적 없는 합계가
 * 만들어진다.** 실측(최신 TTM 기준, 두 구성요소가 모두 있는 289개사):
 * `LongTermDebtNoncurrent`와 `LongTermDebtCurrent`가 서로 다른 대차대조표
 * 일자에서 온 회사가 35개(12%), 그중 100일 넘게 벌어진 회사가 21개(7%)였다.
 *
 * 그래서 **합산에 참여하는 태그 집합은 그 집합 안에서 가장 최근인 일자 하나로
 * 고정하고, 그 일자에 없는 구성요소는 버린다**(→ null, 0으로 채우지 않는다).
 * 그룹 안에서 앵커를 잡으므로 커버리지는 줄지 않는다 — 그룹 전체가 한 분기
 * 늦은 대차대조표에서 오면 그 대차대조표를 통째로 쓴다.
 *
 * 더 엄격한 대안(현금·부채·자본을 통틀어 하나의 대차대조표 일자로 고정)은
 * 채택하지 않았다. 실측하면 720개사 중 92개사(13%)가 `total_debt`를 통째로
 * 잃는다 — 최신 시점 일자에 부채 태그가 없고 중앙값 181일 전 대차대조표에만
 * 있는 회사들이다. 검증된 결함(둘을 더해 만든 가짜 합계)을 넘어서는 커버리지
 * 손실이라 이번 범위에서는 제외했다.
 */
function coherentGroup(
  tags: Map<string, number>,
  dates: ReadonlyMap<string, string> | undefined,
  group: ReadonlySet<string>,
): Map<string, number> {
  if (dates === undefined) return tags
  let anchor: string | null = null
  for (const [tag, date] of dates) {
    if (!group.has(tag) || !tags.has(tag)) continue
    if (anchor === null || date > anchor) anchor = date
  }
  if (anchor === null) return tags
  const out = new Map<string, number>()
  for (const [tag, value] of tags) {
    if (!group.has(tag) || dates.get(tag) === anchor) out.set(tag, value)
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
 */
const DEBT_OVERLAP_REL_TOLERANCE = 0.02

function overlapping(a: number, b: number): boolean {
  const scale = Math.max(Math.abs(a), Math.abs(b))
  return scale === 0 || Math.abs(a - b) / scale <= DEBT_OVERLAP_REL_TOLERANCE
}

function currentDebtPortion(tags: Map<string, number>): Resolved | null {
  const candidates: Resolved[] = []

  const rollup = tags.get(DEBT_CURRENT_TOTAL_TAG)
  if (typeof rollup === 'number') {
    candidates.push({ value: rollup, tag: DEBT_CURRENT_TOTAL_TAG })
  }

  const ltCur = tags.get(LONG_TERM_DEBT_CURRENT_TAG)
  const shortTerm = firstOf(tags, [...SHORT_TERM_BORROWING_TAGS])
  if (typeof ltCur === 'number' && shortTerm !== null) {
    candidates.push(
      overlapping(ltCur, shortTerm.value)
        ? (ltCur >= shortTerm.value
          ? { value: ltCur, tag: LONG_TERM_DEBT_CURRENT_TAG }
          : shortTerm)
        : {
          value: ltCur + shortTerm.value,
          tag: `${LONG_TERM_DEBT_CURRENT_TAG}+${shortTerm.tag}`,
        },
    )
  } else if (typeof ltCur === 'number') {
    candidates.push({ value: ltCur, tag: LONG_TERM_DEBT_CURRENT_TAG })
  } else if (shortTerm !== null) {
    candidates.push(shortTerm)
  }

  if (candidates.length === 0) return null
  let best = candidates[0]!
  for (const c of candidates) if (c.value > best.value) best = c
  return best
}

/**
 * 총부채(이자부 차입금) 해석. 티어 순서이며 아래 티어는 위 티어가 아무 값도 내지
 * 못할 때만 작동한다. 태그 선정과 계열 간 최댓값 규칙의 실측 근거는 tags.ts 주석과
 * debt-coverage-report.md 1절 참고.
 */
export function resolveTotalDebt(
  allTags: Map<string, number>,
  dates?: ReadonlyMap<string, string>,
): Resolved | null {
  // 합산에 참여하는 부채 태그는 모두 같은 대차대조표에서 와야 한다(F4).
  const tags = coherentGroup(allTags, dates, DEBT_TAGS)

  // 티어 1·2 — 대차대조표의 **총계 개념**으로 신고한 경우(가장 흔한 형태).
  //   총부채 = 비유동 장기차입금 + 유동 차입금 부분
  // 옛 코드는 티어 1(비유동/유동 분리)과 티어 2(`DebtCurrent`)를 따로 두고 둘 다
  // 조기 반환했는데, 그 구조가 곧 F2의 결함이었다 — 유동 부분을 어느 태그로
  // 읽든 단기차입금은 같은 방식으로 합쳐져야 한다.
  const ltNon = tags.get(LONG_TERM_DEBT_NONCURRENT_TAG)
  const ltCur = tags.get(LONG_TERM_DEBT_CURRENT_TAG)
  const debtCurrent = tags.get(DEBT_CURRENT_TOTAL_TAG)
  if (typeof ltNon === 'number' || typeof ltCur === 'number' || typeof debtCurrent === 'number') {
    const current = currentDebtPortion(tags)
    return {
      value: (ltNon ?? 0) + (current?.value ?? 0),
      tag: [
        typeof ltNon === 'number' ? LONG_TERM_DEBT_NONCURRENT_TAG : null,
        current?.tag,
      ].filter(Boolean).join('+'),
    }
  }

  // 티어 3 — 장·단기를 하나로 합쳐 신고한 총계 태그. 정의상 단기차입금을 이미
  // 포함하므로 더하지 않는다.
  const combined = tags.get(DEBT_COMBINED_TOTAL_TAG)
  if (typeof combined === 'number') {
    return { value: combined, tag: DEBT_COMBINED_TOTAL_TAG }
  }

  // 티어 4 — 상품별 이름으로만 태깅한 발행사. 상품별 계열은 서로 다른 상품이라
  // 합산하고, 그 합과 `LongTermDebt`(같은 부채를 품고 있을 수 있는 롤업) 사이에서만
  // 큰 쪽을 고른다. 단기차입금은 장기차입금에 포함될 수 없으므로 언제나 더한다.
  // (tags.ts의 TLS·SND·XEL 실사례 참고)
  const rollup = familyBalance(tags, LONG_TERM_DEBT_FAMILY)
  let specific: Resolved | null = null
  for (const family of SPECIFIC_DEBT_FAMILIES) {
    const balance = familyBalance(tags, family)
    if (!balance) continue
    specific = specific === null
      ? balance
      : { value: specific.value + balance.value, tag: `${specific.tag}+${balance.tag}` }
  }
  let core: Resolved | null = null
  for (const candidate of [rollup, specific]) {
    if (candidate && (core === null || candidate.value > core.value)) core = candidate
  }

  const shortTerm = firstOf(tags, [...SHORT_TERM_BORROWING_TAGS])
  if (core === null && shortTerm === null) return null

  const value = (core?.value ?? 0) + (shortTerm?.value ?? 0)

  // 티어 4가 0을 내면 그것은 "부채가 없다"가 아니라 "이 상품들이 비어 있다"이다.
  // 티어 1~3의 태그는 대차대조표의 총계 개념이라 0이 곧 신고된 사실이지만, 티어 4가
  // 보는 것은 상품 단위 잔액이라 정의상 부분적이다 — 다른 이름으로 신고된 부채가
  // 남아 있어도 알 수 없다. 실측(CDNS, Cadence Design Systems): 2024-12-31 대차대조표에
  // 선순위채 약 $2.5B이 있는데 그 기간에는 추적 가능한 부채 태그가 하나도 없고,
  // 400일 소급으로 2023-12-31의 `LinesOfCreditCurrent`=0(리볼버 미인출)만 딸려 들어와
  // 총부채가 0으로 확정됐다. 확신에 찬 틀린 0은 정직한 null보다 나쁘다.
  if (value === 0) return null

  return {
    value,
    tag: [core?.tag, shortTerm?.tag].filter(Boolean).join('+'),
  }
}

export type ResolvedStock = {
  cash: number | null
  totalDebt: number | null
  equity: number | null
  sharesOutstanding: number | null
}

/** 현금성자산 합산 그룹 — 서로 더해지므로 같은 대차대조표에서 와야 한다(F4). */
const CASH_TAGS: ReadonlySet<string> = new Set([
  'CashAndCashEquivalentsAtCarryingValue',
  'ShortTermInvestments',
])

export function resolveStock(
  allTags: Map<string, number>,
  dates?: ReadonlyMap<string, string>,
): { fields: ResolvedStock; used: Record<string, string> } {
  const used: Record<string, string> = {}
  const tags = coherentGroup(allTags, dates, CASH_TAGS)

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

  const debt = resolveTotalDebt(allTags, dates)
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
