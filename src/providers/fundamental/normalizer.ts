import type { FinancialPeriod, PeriodType } from '@/domain/types'
import { sumTTM } from '@/domain/growth'
import type { RawFact } from '../types.js'
import { indexFacts, resolveFlow, resolveStock, type FactIndex } from './resolve.js'

export type NormalizeResult = {
  quarterly: FinancialPeriod[]
  annual: FinancialPeriod[]
  ttm: FinancialPeriod[]
  /** `${periodType}:${periodEnd}` → { field → tag } */
  sourceTags: Record<string, Record<string, string>>
}

const DAY_MS = 86_400_000
const FLOW_FIELDS = [
  'revenue', 'grossProfit', 'operatingIncome', 'netIncome', 'ocf', 'capex', 'sbc', 'rdExpense',
] as const

// Q4 재구성: 연간 종료일 이전 400일 이내에서 후보 분기를 모으고, 그 중 정확히 3개가
// 서로 인접(52/53주 회계달력을 포함해 약 2~4개월 간격)해야만 유도한다.
// 이 창을 벗어나면 SEC 데이터에 흔한 "전년 비교기간 재태깅"을 실수로 끌어들일 수 있다.
const Q4_LOOKBACK_DAYS = 400
const Q4_GAP_MIN_DAYS = 60
const Q4_GAP_MAX_DAYS = 120

// TTM: 4개 분기 창의 처음과 끝 간격이 대략 3개 분기(약 9개월)여야 연속한 창으로 인정한다.
const TTM_SPAN_MIN_DAYS = 240
const TTM_SPAN_MAX_DAYS = 310

function daysBetween(a: string, b: string): number {
  return Math.abs(Date.parse(a) - Date.parse(b)) / DAY_MS
}

// 시점(instant) 값 조회 시 태그마다 별도로 "asOf 이전 최근값"을 찾되, 너무 오래된
// 값은 버린다. 재무상태표 항목(현금/부채/자본)은 항상 회계기간 종료일에 찍히지만
// 표지 발행주식수(EntityCommonStockSharesOutstanding)는 그 신고서 제출일 근처의
// 별도 날짜에 찍힌다 — 두 항목이 같은 날짜를 공유한다고 가정하면 발행주식수가
// 통째로 사라진다(실측: 1,086개사 중 847개사 miss). 태그별 최근값을 독립적으로
// 찾아야 한다.
//
// 다만 무제한으로 과거를 뒤지면 수년 전 폐지/재상장 등으로 남은 낡은 값이 전혀
// 무관한 최근 기간에 되살아날 수 있다. 이 파일은 이미 Q4 유도에 "400일" 창을
// 회계연도 상한으로 쓰고 있으므로(Q4_LOOKBACK_DAYS) 같은 상수를 시점 조회의
// 최대 소급 기간으로도 재사용한다: 분기 신고 주기(~90일)를 감안하면 최대 한 번의
// 누락된 분기 신고까지는 메워주면서, 그보다 오래된 값은 null로 남겨 이전에 고쳤던
// "결측을 0/구식값으로 채우지 않는다" 원칙을 지킨다.
const INSTANT_STALENESS_LIMIT_DAYS = Q4_LOOKBACK_DAYS

/** asOf 이전(포함) 중, 태그별로 가장 최근 시점 값을 독립적으로 찾는다. */
function pickInstant(idx: FactIndex, asOf: string): Map<string, number> {
  const result = new Map<string, number>()
  const bestDateOf = new Map<string, string>()
  for (const [date, tags] of idx.instant) {
    if (date > asOf) continue
    if (daysBetween(date, asOf) > INSTANT_STALENESS_LIMIT_DAYS) continue
    for (const [tag, value] of tags) {
      const bestDate = bestDateOf.get(tag)
      if (bestDate === undefined || date > bestDate) {
        bestDateOf.set(tag, date)
        result.set(tag, value)
      }
    }
  }
  return result
}

function fcfOf(ocf: number | null, capex: number | null): number | null {
  return ocf === null || capex === null ? null : ocf - capex
}

function emptyPeriod(periodEnd: string, periodType: PeriodType): FinancialPeriod {
  return {
    periodEnd, periodType,
    revenue: null, grossProfit: null, operatingIncome: null, netIncome: null,
    ocf: null, capex: null, fcf: null,
    cash: null, totalDebt: null, equity: null,
    sharesDiluted: null, sharesOutstanding: null, sbc: null, rdExpense: null,
  }
}

function buildPeriod(
  idx: FactIndex,
  periodEnd: string,
  periodType: PeriodType,
  tags: Map<string, number>,
  sourceTags: Record<string, Record<string, string>>,
): FinancialPeriod {
  const flow = resolveFlow(tags)
  const stock = resolveStock(pickInstant(idx, periodEnd))
  sourceTags[`${periodType}:${periodEnd}`] = { ...flow.used, ...stock.used }
  return {
    periodEnd,
    periodType,
    ...flow.fields,
    fcf: fcfOf(flow.fields.ocf, flow.fields.capex),
    cash: stock.fields.cash,
    totalDebt: stock.fields.totalDebt,
    equity: stock.fields.equity,
    sharesOutstanding: stock.fields.sharesOutstanding,
  }
}

export function normalizeFacts(facts: RawFact[]): NormalizeResult {
  const sourceTags: Record<string, Record<string, string>> = {}
  if (facts.length === 0) return { quarterly: [], annual: [], ttm: [], sourceTags }

  const idx = indexFacts(facts)
  const desc = (a: FinancialPeriod, b: FinancialPeriod) =>
    b.periodEnd.localeCompare(a.periodEnd)

  // 연간 (qtrs=4)
  const annual: FinancialPeriod[] = []
  for (const [periodEnd, tags] of idx.duration.get(4) ?? []) {
    annual.push(buildPeriod(idx, periodEnd, 'A', tags, sourceTags))
  }
  annual.sort(desc)

  // 분기 (qtrs=1)
  const quarterly: FinancialPeriod[] = []
  const reportedQuarterEnds = new Set<string>()
  for (const [periodEnd, tags] of idx.duration.get(1) ?? []) {
    reportedQuarterEnds.add(periodEnd)
    quarterly.push(buildPeriod(idx, periodEnd, 'Q', tags, sourceTags))
  }

  // Q4 재구성: 연간 종료일에 분기 값이 없고 직전 3개 분기가 인접하게 있으면 차감으로 유도
  for (const a of annual) {
    if (reportedQuarterEnds.has(a.periodEnd)) continue
    const inYear = quarterly.filter(
      (q) => q.periodEnd < a.periodEnd && daysBetween(q.periodEnd, a.periodEnd) < Q4_LOOKBACK_DAYS,
    )
    if (inYear.length !== 3) continue

    // 개수만으로는 부족하다 — SEC 데이터에는 전년도 비교기간이 같은 400일 창에
    // 섞여 들어올 수 있다. 최신순으로 정렬해 연간 종료일→q1→q2→q3 간격이 모두
    // 60~120일(약 2~4개월) 안에 들어야 실제로 회계연도를 3등분한 분기로 간주한다.
    const sorted = [...inYear].sort((x, y) => y.periodEnd.localeCompare(x.periodEnd))
    const q1 = sorted[0]!
    const q2 = sorted[1]!
    const q3 = sorted[2]!
    const gaps = [
      daysBetween(q1.periodEnd, a.periodEnd),
      daysBetween(q2.periodEnd, q1.periodEnd),
      daysBetween(q3.periodEnd, q2.periodEnd),
    ]
    const contiguous = gaps.every((g) => g >= Q4_GAP_MIN_DAYS && g <= Q4_GAP_MAX_DAYS)
    if (!contiguous) continue

    const q4 = emptyPeriod(a.periodEnd, 'Q')
    for (const field of FLOW_FIELDS) {
      const annualValue = a[field]
      if (annualValue === null) continue
      const parts = inYear.map((q) => q[field])
      if (parts.some((p) => p === null)) continue
      q4[field] = annualValue - (parts as number[]).reduce((s, v) => s + v, 0)
    }
    q4.fcf = fcfOf(q4.ocf, q4.capex)
    // 희석주식수는 기간 가중평균이라 연간 값도, 분기 차감도 대체값이 될 수 없다.
    // 알 수 없는 값은 null — 그럴듯한 대체값(연간 평균)을 넣지 않는다.
    q4.sharesDiluted = null
    const stock = resolveStock(pickInstant(idx, a.periodEnd))
    q4.cash = stock.fields.cash
    q4.totalDebt = stock.fields.totalDebt
    q4.equity = stock.fields.equity
    q4.sharesOutstanding = stock.fields.sharesOutstanding

    quarterly.push(q4)
    sourceTags[`Q:${a.periodEnd}`] = { ...stock.used, derived: 'Q4_from_annual' }
  }
  quarterly.sort(desc)

  // TTM: 연속한 4개 분기. 최신 종료일과 4번째 종료일 간격이 약 3분기여야 한다.
  const ttm: FinancialPeriod[] = []
  for (let i = 0; i + 3 < quarterly.length; i++) {
    const window = quarterly.slice(i, i + 4)
    const span = daysBetween(window[3]!.periodEnd, window[0]!.periodEnd)
    if (span < TTM_SPAN_MIN_DAYS || span > TTM_SPAN_MAX_DAYS) continue

    const p = emptyPeriod(window[0]!.periodEnd, 'TTM')
    for (const field of FLOW_FIELDS) {
      p[field] = sumTTM(window.map((q) => q[field]))
    }
    p.fcf = fcfOf(p.ocf, p.capex)
    p.sharesDiluted = window[0]!.sharesDiluted   // 가중평균이므로 합산하지 않는다
    p.cash = window[0]!.cash
    p.totalDebt = window[0]!.totalDebt
    p.equity = window[0]!.equity
    p.sharesOutstanding = window[0]!.sharesOutstanding
    ttm.push(p)

    // 출처 기록은 anchor(최신 분기) 것을 우선하되, 창 안 어딘가에 유도된 Q4가
    // 있으면 그 사실이 anchor 항목에만 있지 않도록 병합한다 — TTM 합계가
    // 추정치를 포함한다는 신호가 provenance에서 사라지면 안 된다.
    const merged: Record<string, string> = {}
    const derivedFrom: string[] = []
    for (const q of window) {
      const qTags = sourceTags[`Q:${q.periodEnd}`]
      if (!qTags) continue
      for (const [field, tag] of Object.entries(qTags)) {
        if (field === 'derived') {
          derivedFrom.push(q.periodEnd)
        } else if (!(field in merged)) {
          merged[field] = tag
        }
      }
    }
    if (derivedFrom.length > 0) merged.derived = `Q4_from_annual@${derivedFrom.join(',')}`
    sourceTags[`TTM:${p.periodEnd}`] = merged
  }

  return { quarterly, annual, ttm, sourceTags }
}
