import { resolveFlow, type FactIndex, type ResolvedFlow } from './resolve.js'

/**
 * 누적 기간(qtrs=1/2/3/4) 차분으로 분기 시계열을 재구성한다.
 *
 * SEC XBRL은 같은 회계연도에 대해 1분기·반기·9개월·연간 누적을 모두 신고한다.
 * 이 누적들은 서로 독립적으로 오염될 수 있으므로(디멘션 슬라이스가 연결 총계
 * 자리에 새어 들어오는 문제 — period-reconciliation-report.md 2절) 단순히
 * 차분하면 오염이 그대로 전파된다. 그래서 이 모듈은
 *
 *   1) 누적 사실 전체를 "연속한 분기 구간의 합"이라는 선형 제약으로 바꾸고,
 *   2) 서로 모순되면 **가장 적은 수의 사실만 버려서** 모순을 없애는 부분집합을
 *      찾고,
 *   3) 남은 제약으로 분기값을 확정한다.
 *
 * 이렇게 하면 기존 `normalizer.ts`의 "연간 − q1 − q2 − q3" Q4 재구성은 이
 * 일반 규칙의 한 특수 사례(span=4 제약에서 나머지 3분기를 뺀 것)로 흡수된다.
 */

export const FLOW_FIELDS = [
  'revenue', 'grossProfit', 'operatingIncome', 'netIncome', 'ocf', 'capex', 'sbc', 'rdExpense',
] as const
export type FlowField = (typeof FLOW_FIELDS)[number]

const DAY_MS = 86_400_000

// 분기 그리드 인접 판정. normalizer.ts의 Q4 재구성이 쓰던 값과 같은 창이다
// (52/53주 회계달력과 bulk의 월말 반올림을 함께 흡수하는 2~4개월).
const QUARTER_GAP_MIN_DAYS = 60
const QUARTER_GAP_MAX_DAYS = 120

const MAX_SPAN = 4

// 같은 값인지 판정할 때의 허용오차. 같은 수치가 신고서마다 백만/천 단위로 다르게
// 반올림돼 들어오는 경우가 많다(실측: NVIDIA는 28건의 "충돌" 중 대부분이
// 1,000,000 단위 반올림 차이였고, 상대오차는 최대 0.08%였다). 0.5%는 그 반올림
// 잡음을 흡수하면서, 실제 디멘션 오염(수 배~수백 배 차이)과는 자릿수가 다르다.
//
// 기준 크기는 비교하는 두 값이 아니라 **그 회계연도 그룹에서 가장 큰 값**이다.
// 반올림 오차는 신고서에 적힌 숫자의 자릿수에서 발생하므로, 우연히 0 근처가 된
// 누계(예: 손익분기 부근의 영업이익 누계)에까지 "0.5%"를 적용하면 사실상 완전
// 일치를 요구하게 되어 반올림 잡음이 전부 충돌로 잡힌다.
const REL_TOLERANCE = 5e-3

// 한 분기의 길이(365.25/4). 누적 사실이 실제로 그만큼의 기간을 덮는지 검증한다.
const QUARTER_DAYS = 91.31
// 덮는 구간 길이 검증의 허용오차. 52/53주 회계달력(±7일)과 bulk의 월말 반올림
// (±4일)을 함께 흡수하되, 전혀 다른 개수의 분기를 덮는 해석(±91일)과는 멀다.
const SPAN_TOLERANCE_DAYS = 20

// 모순 해소 탐색의 상한. 한 회계연도 그룹의 제약은 보통 7개(누적 2/3/4 + 분기
// 1~4)다. 이보다 훨씬 큰 그룹은 회계연도 경계가 무너진 비정상 데이터이므로
// 탐색하지 않고 보수적 대안(분기 우선 그리디)으로 넘긴다.
const MAX_SEARCH_CONSTRAINTS = 12

function daysBetween(a: string, b: string): number {
  return Math.abs(Date.parse(a) - Date.parse(b)) / DAY_MS
}

function approxEqual(a: number, b: number, scale: number): boolean {
  return Math.abs(a - b) <= REL_TOLERANCE * Math.max(Math.abs(a), Math.abs(b), scale)
}

/** 하나의 누적 사실 = "그리드 인덱스 from..to 분기의 합 = value" */
type Constraint = { from: number; to: number; value: number; span: number; endIndex: number }

export type CumulativeQuarter = {
  /** 확정값. null이면 "오염으로 판정했지만 대체값을 유도할 수 없음"(정직한 결측) */
  value: number | null
  /** 신고된 분기값(qtrs=1)이 아니라 누적 차분으로 얻은 값인가 */
  derived: boolean
}

export type CumulativeResult = {
  /** periodEnd → field → 분기 확정값 */
  quarters: Map<string, Map<FlowField, CumulativeQuarter>>
  /** `${span}:${periodEnd}` → 오염으로 판정해 버린 누적 사실의 필드들 */
  rejected: Map<string, Set<FlowField>>
}

/** offset 을 가진 union-find. 노드 = 분기 경계(누적 합의 기준점). */
class OffsetUnion {
  private parent = new Map<number, number>()
  private offset = new Map<number, number>()

  constructor(private readonly scale: number) {}

  find(x: number): { root: number; off: number } {
    if (!this.parent.has(x)) {
      this.parent.set(x, x)
      this.offset.set(x, 0)
      return { root: x, off: 0 }
    }
    let cur = x
    let acc = 0
    while (this.parent.get(cur)! !== cur) {
      acc += this.offset.get(cur)!
      cur = this.parent.get(cur)!
    }
    return { root: cur, off: acc }
  }

  /** value(to) - value(from) = weight. 이미 관계가 있고 모순이면 false. */
  union(from: number, to: number, weight: number): boolean {
    const a = this.find(from)
    const b = this.find(to)
    if (a.root === b.root) return approxEqual(b.off - a.off, weight, this.scale)
    this.parent.set(b.root, a.root)
    this.offset.set(b.root, a.off + weight - b.off)
    return true
  }

  /** 두 노드의 차(value(to) - value(from))가 확정돼 있으면 반환 */
  delta(from: number, to: number): number | null {
    const a = this.find(from)
    const b = this.find(to)
    if (a.root !== b.root) return null
    return b.off - a.off
  }
}

function scaleOf(cs: Constraint[]): number {
  let s = 0
  for (const c of cs) s = Math.max(s, Math.abs(c.value))
  return s
}

/** 제약 집합이 서로 모순되지 않으면 확정된 분기값 맵을 돌려준다. */
function solveConstraints(
  cs: Constraint[],
  lo: number,
  hi: number,
  scale: number,
): Map<number, number> | null {
  const uf = new OffsetUnion(scale)
  for (const c of cs) {
    if (!uf.union(c.from - 1, c.to, c.value)) return null
  }
  const out = new Map<number, number>()
  for (let i = lo; i <= hi; i++) {
    const d = uf.delta(i - 1, i)
    if (d !== null) out.set(i, d)
  }
  return out
}

/** pool 에서 k개를 고르는 모든 조합 */
function combinations(pool: number[], k: number): number[][] {
  const out: number[][] = []
  const cur: number[] = []
  const walk = (start: number): void => {
    if (cur.length === k) { out.push([...cur]); return }
    for (let i = start; i < pool.length; i++) {
      cur.push(pool[i]!)
      walk(i + 1)
      cur.pop()
    }
  }
  walk(0)
  return out
}

/**
 * 신고된 분기값(qtrs=1)까지 버려가며 재구성해도 되는 필드인가.
 *
 * `revenue`만 해당한다. 오염값은 디멘션 슬라이스, 즉 진짜 연결 총계의
 * 부분집합이고 매출은 음수가 없는 가산량이므로 **오염은 반드시 과소 신고로
 * 나타난다** — 어느 쪽이 오염됐는지 판정할 수 있는 근거가 있다
 * (ingest-hardening-report.md 결함 2, 747개 실사례).
 *
 * 다른 필드에는 그 보장이 없다. 흑자 사업부문의 영업이익은 연결 총계보다 클 수
 * 있고(Alphabet의 Other Bets 손실이 정확히 그 반대 방향 사례다), 매출총이익도
 * 부문별로 부호가 갈린다. 어느 쪽이 틀렸는지 가릴 근거가 없으므로 회사가
 * 신고한 분기값은 그대로 두고, 누적 차분은 **빈 분기를 채우는 용도로만** 쓴다.
 */
function canOverrideReported(field: FlowField): boolean {
  return field === 'revenue'
}

// 유도값이 "그 회계연도의 신고 분기들과 같은 세계의 숫자가 아니다"라고 판정하는
// 배수. 아래 실측 표에서 오염 사례와 진짜 급변 사례를 가르는 지점이 2배 근처였다.
const IMPLAUSIBLE_RATIO = 2

/**
 * 유도된(=회사가 그 분기 값으로 직접 신고한 적 없는) 값의 신뢰성 검사.
 *
 * 배경: Alphabet의 2025 연간 영업이익은 bulk에 -16,760M으로 들어와 있는데
 * 9개월 누계는 +93,105M이다. 차분하면 4분기 영업이익이 -109,865M이 되고,
 * 그 정체는 Other Bets 부문 손익이다.
 *
 * 처음에는 "연초 누계의 부호가 뒤집히면 거부"라는 단순한 규칙을 썼는데, 실 DB
 * 전수 조사에서 **그 규칙이 진짜 신호를 절반 가까이 지운다**는 것이 드러났다
 * (최신 TTM 영업이익 64개사, 매출총이익 44개사 소실). 손익분기 부근 기업은
 * 누계 부호가 정상적으로 뒤집힌다 — ON Semiconductor(분기 -573.7 / +193.4 /
 * +264.4 → 연간 +84.2), Bruker(+31.8 / +11.9 / -51.8 → 연간 +156.5)는 전부
 * 실제 실적이다.
 *
 * 오염 사례와 진짜 급변 사례를 실제로 가르는 것은 부호 그 자체가 아니라
 * **그 해의 신고 분기들이 이미 한 방향으로 안정돼 있는지**였다:
 *
 *  거부되어야 할 것(오염) — 신고 분기 부호가 모두 같고 유도값만 반대·거대:
 *    GOOGL 영업이익 +30,606/+31,271/+31,228 → 유도 Q4 -109,865 (3.5배)
 *    GNTX  영업이익 +113.0/+118.5/+122.3    → 유도 Q4   -379.0 (3.1배)
 *    ALGN  영업이익 +131.1/+163.0/+96.3     → 유도 Q4 -1,185.5 (7.3배)
 *    TENX  영업이익  -11.3/-11.8/-16.8      → 유도 Q4   +212.3 (12.6배)
 *    GILD  매출총이익 +5,127/+5,581/+6,200  → 유도 Q4 -17,282 (2.8배)
 *  남아야 할 것(진짜) — 신고 분기 부호가 이미 섞여 있음:
 *    ON, BRKR, RIOT, VCEL, SCOR, XRAY, IDN, PI, ATNI, CSPI, SYPR
 *
 * 그래서 조건을 세 개 모두 만족할 때만 거부한다. 신고된 분기값은 이 규칙으로
 * 절대 지우지 않는다 — 원가 이하로 파는 초기 기업의 진짜 신호는 전부 신고값이다.
 */
function isImplausibleDerived(value: number, reportedSiblings: number[]): boolean {
  if (reportedSiblings.length < 2) return false
  const sign = Math.sign(reportedSiblings[0]!)
  if (sign === 0) return false
  if (!reportedSiblings.every((v) => Math.sign(v) === sign)) return false
  if (Math.sign(value) === sign || value === 0) return false
  const largest = Math.max(...reportedSiblings.map((v) => Math.abs(v)))
  return Math.abs(value) > IMPLAUSIBLE_RATIO * largest
}

type Solution = { values: Map<number, number>; dropped: Constraint[] }

/**
 * 값 충돌 시 어느 사실을 버릴지.
 *
 * 1) **가장 적은 수를 버린다.** 오염은 특정 신고 항목 하나에 나타나는 희소한
 *    사건이므로, 모순을 설명하는 최소 집합이 실제 오염 집합일 가능성이 가장
 *    높다.
 * 2) 같은 개수를 버리는 해가 여러 개면 **버린 사실들이 걸쳐 있는 신고서 수가
 *    가장 적은 해**를 고른다. 오염은 XBRL 컨텍스트 단위, 즉 한 신고서 안에서
 *    발생하므로 "서로 다른 두 신고서가 동시에 오염됐다"보다 "한 신고서가
 *    오염됐다"가 훨씬 그럴듯하다. 신고서는 period_end로 식별한다 — 분기
 *    신고서는 3개월치와 연초 누계를 **같은 종료일로 함께** 신고하기 때문이다.
 *
 *    Microsoft FY2026 실사례가 정확히 이 판정을 요구한다. 2026-01-28 신고
 *    10-Q의 매출 사실 두 개(분기 5,958M · 반기 누계 9,796M)는 서로는 정합하고
 *    1분기(77,673M)·9개월(241,832M)과만 모순인데, "1분기와 반기 누계가
 *    틀렸다"는 해석도 버리는 개수는 똑같이 2개다. 그러나 그쪽은 서로 다른 두
 *    신고서가 동시에 오염됐다고 가정해야 한다.
 *
 * 3) `revenue`는 여기서 한 번 더 갈린다: **연초 누계 벡터가 다른 모든 해 이상인
 *    해**가 있으면 그것을 쓴다. 오염값은 부분집합이라 항상 작으므로, 모든
 *    지점에서 누계가 더 큰 해석이 오염이 덜한 해석이다. 분기값이 아니라
 *    누계로 비교하는 이유는 오염이 분기 사이를 옮겨 다녀 분기값끼리는 우열이
 *    갈리지 않기 때문이다.
 *
 * 4) 그래도 갈리지 않으면 **남은 해들이 동의하는 분기값만 채택하고, 서로
 *    다르면 null**로 남긴다.
 */
function chooseSolution(
  field: FlowField,
  solutions: Solution[],
  from: number,
  to: number,
  scale: number,
): Map<number, number | null> {
  const out = new Map<number, number | null>()
  if (solutions.length === 0) return out
  if (solutions.length === 1) {
    for (const [i, v] of solutions[0]!.values) out.set(i, v)
    return out
  }

  const filings = (s: Solution): number => new Set(s.dropped.map((c) => c.endIndex)).size
  const fewest = Math.min(...solutions.map(filings))
  solutions = solutions.filter((s) => filings(s) === fewest)
  if (solutions.length === 1) {
    for (const [i, v] of solutions[0]!.values) out.set(i, v)
    return out
  }

  if (canOverrideReported(field)) {
    const prefixes = solutions.map((s) => {
      const p = new Map<number, number>()
      let running: number | null = 0
      for (let i = from; i <= to; i++) {
        const v = s.values.get(i)
        running = running === null || v === undefined ? null : running + v
        if (running !== null) p.set(i, running)
      }
      return p
    })
    const dominant = prefixes.findIndex((p, a) =>
      prefixes.every((q, b) => {
        if (a === b) return true
        if (q.size > p.size) return false
        for (const [i, v] of q) {
          const mine = p.get(i)
          if (mine === undefined || (mine < v && !approxEqual(mine, v, scale))) return false
        }
        return true
      }),
    )
    if (dominant >= 0) {
      for (const [i, v] of solutions[dominant]!.values) out.set(i, v)
      return out
    }
  }

  const indices = new Set<number>()
  for (const s of solutions) for (const i of s.values.keys()) indices.add(i)
  for (const i of indices) {
    let agreed: number | null = null
    let ok = true
    for (const s of solutions) {
      const v = s.values.get(i)
      if (v === undefined) { ok = false; break }
      if (agreed === null) agreed = v
      else if (!approxEqual(agreed, v, scale)) { ok = false; break }
    }
    out.set(i, ok ? agreed : null)
  }
  return out
}

/** 큰 그룹용 보수적 대안: span이 짧은(=신고 분기에 가까운) 제약부터 넣고 충돌은 버린다. */
function greedySolve(cs: Constraint[], lo: number, hi: number, scale: number): Solution {
  const sorted = [...cs].sort((a, b) => a.span - b.span || a.endIndex - b.endIndex)
  const kept: Constraint[] = []
  const dropped: Constraint[] = []
  const uf = new OffsetUnion(scale)
  for (const c of sorted) {
    if (uf.union(c.from - 1, c.to, c.value)) kept.push(c)
    else dropped.push(c)
  }
  return { values: solveConstraints(kept, lo, hi, scale) ?? new Map(), dropped }
}

export function resolveCumulative(idx: FactIndex): CumulativeResult {
  const quarters = new Map<string, Map<FlowField, CumulativeQuarter>>()
  const rejected = new Map<string, Set<FlowField>>()

  const ends = new Set<string>()
  for (const [span, byEnd] of idx.duration) {
    if (span < 1 || span > MAX_SPAN) continue
    for (const e of byEnd.keys()) ends.add(e)
  }
  const grid = [...ends].sort()
  if (grid.length === 0) return { quarters, rejected }

  const pos = new Map(grid.map((d, i) => [d, i]))
  // adjacent[i] = grid[i-1] → grid[i] 가 정확히 한 분기 간격인가
  const adjacent = grid.map((_, i) =>
    i === 0 ? false : daysBetween(grid[i - 1]!, grid[i]!) >= QUARTER_GAP_MIN_DAYS
      && daysBetween(grid[i - 1]!, grid[i]!) <= QUARTER_GAP_MAX_DAYS,
  )

  // (span, periodEnd) → 해석된 필드값
  const flowBySpan = new Map<number, Map<string, ResolvedFlow>>()
  for (const [span, byEnd] of idx.duration) {
    if (span < 1 || span > MAX_SPAN) continue
    const m = new Map<string, ResolvedFlow>()
    for (const [end, tags] of byEnd) m.set(end, resolveFlow(tags).fields)
    flowBySpan.set(span, m)
  }

  const setQuarter = (end: string, field: FlowField, q: CumulativeQuarter): void => {
    let m = quarters.get(end)
    if (!m) { m = new Map(); quarters.set(end, m) }
    m.set(field, q)
  }
  const markRejected = (c: Constraint, field: FlowField): void => {
    const key = `${c.span}:${grid[c.endIndex]!}`
    let s = rejected.get(key)
    if (!s) { s = new Set(); rejected.set(key, s) }
    s.add(field)
  }

  for (const field of FLOW_FIELDS) {
    // 1) 제약 만들기 — 구간 안의 모든 인접 간격이 분기여야 한다.
    //    (span, endIndex)가 회계연도 정렬을 그대로 결정한다: span=k 사실은
    //    "그 종료일에서 뒤로 k개 분기"를 덮으므로, 회계연도 시작일을 따로 알
    //    필요가 없다. 6월 결산 회사의 qtrs=2 @12-31은 자동으로 그 회사
    //    회계연도의 상반기를 가리킨다.
    const constraints: Constraint[] = []
    for (const [span, byEnd] of flowBySpan) {
      for (const [end, flow] of byEnd) {
        const value = flow[field]
        if (value === null) continue
        const i = pos.get(end)!
        const from = i - span + 1
        if (from < 0) continue
        let contiguous = true
        for (let t = from + 1; t <= i; t++) if (!adjacent[t]) { contiguous = false; break }
        if (!contiguous) continue
        // 덮는 구간이 실제로 span개 분기만큼의 기간인지 확인한다. 인접 간격만
        // 보면 61일짜리 "분기"가 4개 이어져도 1년으로 인정돼 버린다.
        if (span >= 2) {
          const elapsed = daysBetween(grid[from]!, grid[i]!)
          if (Math.abs(elapsed - (span - 1) * QUARTER_DAYS) > SPAN_TOLERANCE_DAYS) continue
        }
        constraints.push({ from, to: i, value, span, endIndex: i })
      }
    }
    if (constraints.length === 0) continue

    // 2) 그룹 나누기 — span>=2 제약을 구간 겹침으로 묶으면 그 덩어리가 곧
    //    회계연도가 된다(FY2025의 반기/9개월/연간은 서로 겹치지만 FY2026의
    //    반기와는 겹치지 않는다). 그 안에 들어오는 신고 분기(span=1)를 붙인다.
    const multi = constraints.filter((c) => c.span >= 2).sort((a, b) => a.from - b.from || a.to - b.to)
    const ranges: { from: number; to: number }[] = []
    for (const c of multi) {
      const last = ranges[ranges.length - 1]
      if (last && c.from <= last.to) last.to = Math.max(last.to, c.to)
      else ranges.push({ from: c.from, to: c.to })
    }

    for (const range of ranges) {
      const group = constraints.filter((c) => c.from >= range.from && c.to <= range.to)

      const scale = scaleOf(group)
      let solutions: Solution[] = []
      const full = solveConstraints(group, range.from, range.to, scale)
      if (full) {
        solutions = [{ values: full, dropped: [] }]
      } else if (group.length > MAX_SEARCH_CONSTRAINTS) {
        solutions = [greedySolve(group, range.from, range.to, scale)]
      } else {
        const droppable: number[] = []
        group.forEach((c, i) => {
          if (c.span >= 2 || canOverrideReported(field)) droppable.push(i)
        })
        for (let dropCount = 1; dropCount <= droppable.length && solutions.length === 0; dropCount++) {
          for (const combo of combinations(droppable, dropCount)) {
            const drop = new Set(combo)
            const kept = group.filter((_, i) => !drop.has(i))
            const values = solveConstraints(kept, range.from, range.to, scale)
            if (values) solutions.push({ values, dropped: combo.map((i) => group[i]!) })
          }
        }
      }

      const chosen = chooseSolution(field, solutions, range.from, range.to, scale)

      // 버려진 사실 기록 — 모든 해가 공통으로 버린 것만 "오염"으로 단정한다.
      if (solutions.length > 0) {
        for (const c of solutions[0]!.dropped) {
          if (solutions.every((s) => s.dropped.includes(c))) markRejected(c, field)
        }
      }

      // 3) 유도값 신뢰성 검사 (아래 isImplausibleDerived 참고).
      const reportedAt = (i: number): number | null => {
        const flow = flowBySpan.get(1)?.get(grid[i]!)
        return flow ? flow[field] : null
      }

      for (const [i, value] of chosen) {
        const end = grid[i]!
        const reported = reportedAt(i)
        const derived = value === null ? true : reported === null || !approxEqual(reported, value, scale)
        if (value !== null && derived) {
          const siblings: number[] = []
          for (const [j, v] of chosen) {
            if (j !== i && v !== null && reportedAt(j) !== null) siblings.push(v)
          }
          if (isImplausibleDerived(value, siblings)) {
            setQuarter(end, field, { value: null, derived: true })
            for (const c of group) {
              if (c.to === i && c.span >= 2) markRejected(c, field)
            }
            continue
          }
        }
        if (value === null && reported === null) continue
        setQuarter(end, field, { value, derived })
      }
    }
    // 그룹에 속하지 않은 단독 신고 분기(span>=2 누적이 하나도 없는 기간)는
    // 교차검증할 재료가 없으므로 손대지 않는다 — normalizer가 신고값을 그대로 쓴다.
  }

  return { quarters, rejected }
}
