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

function daysBetween(a: string, b: string): number {
  return Math.abs(Date.parse(a) - Date.parse(b)) / DAY_MS
}

/** asOf 이전(포함) 중 가장 최근 시점 값 */
function pickInstant(idx: FactIndex, asOf: string): Map<string, number> {
  let best: string | null = null
  for (const d of idx.instant.keys()) {
    if (d <= asOf && (best === null || d > best)) best = d
  }
  return best === null ? new Map() : idx.instant.get(best)!
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

  // Q4 재구성: 연간 종료일에 분기 값이 없고 직전 3개 분기가 있으면 차감으로 유도
  for (const a of annual) {
    if (reportedQuarterEnds.has(a.periodEnd)) continue
    const inYear = quarterly.filter(
      (q) => q.periodEnd < a.periodEnd && daysBetween(q.periodEnd, a.periodEnd) < 400,
    )
    if (inYear.length !== 3) continue

    const q4 = emptyPeriod(a.periodEnd, 'Q')
    for (const field of FLOW_FIELDS) {
      const annualValue = a[field]
      if (annualValue === null) continue
      const parts = inYear.map((q) => q[field])
      if (parts.some((p) => p === null)) continue
      q4[field] = annualValue - (parts as number[]).reduce((s, v) => s + v, 0)
    }
    q4.fcf = fcfOf(q4.ocf, q4.capex)
    // 희석주식수는 차감이 무의미하므로 연간 값을 그대로 쓴다
    q4.sharesDiluted = a.sharesDiluted
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
    if (span < 240 || span > 310) continue

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
    sourceTags[`TTM:${p.periodEnd}`] = sourceTags[`Q:${p.periodEnd}`] ?? {}
  }

  return { quarterly, annual, ttm, sourceTags }
}
