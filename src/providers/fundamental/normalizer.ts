import type { FieldRejection, FinancialPeriod, PeriodType } from '@/domain/types'
import { sumTTM } from '@/domain/growth'
import { validatePeriod } from '@/domain/validate'
import type { RawFact } from '../types.js'
import { indexFacts, resolveFlow, resolveStock, type FactIndex, type ResolvedFlow } from './resolve.js'
import { resolveCumulative, FLOW_FIELDS } from './cumulative.js'

export type NormalizeResult = {
  quarterly: FinancialPeriod[]
  annual: FinancialPeriod[]
  ttm: FinancialPeriod[]
  /** `${periodType}:${periodEnd}` → { field → tag } */
  sourceTags: Record<string, Record<string, string>>
  /** 물리적으로 불가능해 null로 거부된 필드 기록 (ingest-hardening 결함 3) */
  rejections: FieldRejection[]
}

const DAY_MS = 86_400_000

// 시점(instant) 값을 얼마나 과거까지 소급해 찾을지의 상한. 분기 신고 주기(~90일)를
// 감안해 한 번의 누락된 분기 신고까지는 메워주되 그보다 오래된 값은 쓰지 않는다.
const INSTANT_LOOKBACK_DAYS = 400

/** 신고된 분기값이 아니라 누적 기간 차분으로 얻은 값임을 provenance에 남기는 표식 */
const DERIVED_MARKER = 'cumulative_diff'

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
// 무관한 최근 기간에 되살아날 수 있다. 그래서 회계연도 한 바퀴(400일)를 소급
// 상한으로 둔다 — 최대 한 번의 누락된 분기 신고까지는 메워주면서, 그보다 오래된
// 값은 null로 남겨 "결측을 0/구식값으로 채우지 않는다" 원칙을 지킨다.
const INSTANT_STALENESS_LIMIT_DAYS = INSTANT_LOOKBACK_DAYS

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
  adjust?: (fields: ResolvedFlow, used: Record<string, string>) => void,
): FinancialPeriod {
  const flow = resolveFlow(tags)
  const fields: ResolvedFlow = { ...flow.fields }
  const used: Record<string, string> = { ...flow.used }
  adjust?.(fields, used)
  const stock = resolveStock(pickInstant(idx, periodEnd))
  sourceTags[`${periodType}:${periodEnd}`] = { ...used, ...stock.used }
  return {
    periodEnd,
    periodType,
    ...fields,
    fcf: fcfOf(fields.ocf, fields.capex),
    cash: stock.fields.cash,
    totalDebt: stock.fields.totalDebt,
    equity: stock.fields.equity,
    sharesOutstanding: stock.fields.sharesOutstanding,
  }
}

export function normalizeFacts(facts: RawFact[]): NormalizeResult {
  const sourceTags: Record<string, Record<string, string>> = {}
  if (facts.length === 0) {
    return { quarterly: [], annual: [], ttm: [], sourceTags, rejections: [] }
  }

  const cik = facts[0]!.cik
  const rejections: FieldRejection[] = []

  // 결함 3(ingest-hardening 과제): financials로 나가는 모든 기간(신고 분기,
  // 유도된 Q4, 연간, TTM)은 push되기 전에 여기를 거쳐야 한다 — revenue<0,
  // grossProfit>revenue 같은 물리적으로 불가능한 값이 스코어링/밸류에이션
  // 엔진에 도달하지 않도록 막는다(src/domain/validate.ts 참고). Q4/TTM은
  // 이미 검증된 분기 값을 그대로 가감산하므로(부등식은 덧셈/뺄셈에서
  // 보존된다) 이중 방어이지만, 유도 과정 자체가 새로운 위반을 만들 수도
  // 있어(예: 연간에서 분기 3개를 뺀 나머지가 음수) 각 지점에서 다시 검증한다.
  const validate = (p: FinancialPeriod): FinancialPeriod => {
    const { period, rejections: r } = validatePeriod(cik, p)
    if (r.length > 0) rejections.push(...r)
    return period
  }

  const idx = indexFacts(facts)
  const desc = (a: FinancialPeriod, b: FinancialPeriod) =>
    b.periodEnd.localeCompare(a.periodEnd)

  // 누적 기간(qtrs=1/2/3/4) 차분으로 분기 시계열을 재구성한다. 기존의 Q4 재구성
  // (연간 − q1 − q2 − q3)은 이 일반 규칙의 한 특수 사례로 흡수됐다.
  const cum = resolveCumulative(idx)

  // 연간 (qtrs=4) — 누적 사다리가 오염으로 판정한 필드는 연간에서도 null이다.
  // 같은 하나의 사실이 그 오염의 출처이기 때문이다.
  const annual: FinancialPeriod[] = []
  for (const [periodEnd, tags] of idx.duration.get(4) ?? []) {
    const rejectedFields = cum.rejected.get(`4:${periodEnd}`)
    annual.push(validate(buildPeriod(idx, periodEnd, 'A', tags, sourceTags, (fields, used) => {
      if (!rejectedFields) return
      for (const field of rejectedFields) {
        fields[field] = null
        delete used[field]
      }
    })))
  }
  annual.sort(desc)

  // 분기: 신고된 qtrs=1 기간 ∪ 누적 차분으로 값이 확정된 기간
  const quarterEnds = new Set<string>()
  for (const periodEnd of idx.duration.get(1)?.keys() ?? []) quarterEnds.add(periodEnd)
  for (const periodEnd of cum.quarters.keys()) quarterEnds.add(periodEnd)

  const quarterly: FinancialPeriod[] = []
  for (const periodEnd of quarterEnds) {
    const tags = idx.duration.get(1)?.get(periodEnd) ?? new Map<string, number>()
    const resolved = cum.quarters.get(periodEnd)
    quarterly.push(validate(buildPeriod(idx, periodEnd, 'Q', tags, sourceTags, (fields, used) => {
      if (!resolved) return
      let anyDerived = false
      for (const [field, q] of resolved) {
        fields[field] = q.value
        if (!q.derived) continue
        anyDerived = true
        // 희석주식수는 기간 가중평균이라 차분할 수 없다 — 유도 분기에는 null로 남는다.
        if (q.value === null) delete used[field]
        else used[field] = DERIVED_MARKER
      }
      if (anyDerived) used.derived = DERIVED_MARKER
    })))
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
    ttm.push(validate(p))

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
    if (derivedFrom.length > 0) merged.derived = `${DERIVED_MARKER}@${derivedFrom.join(',')}`
    sourceTags[`TTM:${p.periodEnd}`] = merged
  }

  return { quarterly, annual, ttm, sourceTags, rejections }
}
