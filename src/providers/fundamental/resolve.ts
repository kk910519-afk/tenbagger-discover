import type { RawFact } from '../types.js'

export type FactIndex = {
  /** qtrs → periodEnd → tag → value */
  duration: Map<number, Map<string, Map<string, number>>>
  /** periodEnd → tag → value */
  instant: Map<string, Map<string, number>>
}

export function indexFacts(facts: RawFact[]): FactIndex {
  const duration: FactIndex['duration'] = new Map()
  const instant: FactIndex['instant'] = new Map()
  // 같은 키에 값이 여럿일 때 어떤 filedDate를 채택했는지 추적
  const chosenAt = new Map<string, string>()

  for (const f of facts) {
    const key = `${f.qtrs}|${f.periodEnd}|${f.tag}`
    const prev = chosenAt.get(key)
    if (prev !== undefined && prev >= f.filedDate) continue
    chosenAt.set(key, f.filedDate)

    if (f.qtrs === 0) {
      let byTag = instant.get(f.periodEnd)
      if (!byTag) { byTag = new Map(); instant.set(f.periodEnd, byTag) }
      byTag.set(f.tag, f.value)
    } else {
      let byPeriod = duration.get(f.qtrs)
      if (!byPeriod) { byPeriod = new Map(); duration.set(f.qtrs, byPeriod) }
      let byTag = byPeriod.get(f.periodEnd)
      if (!byTag) { byTag = new Map(); byPeriod.set(f.periodEnd, byTag) }
      byTag.set(f.tag, f.value)
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

  const rev = firstOf(tags, REVENUE_CHAIN)
  if (rev) used.revenue = rev.tag

  let grossProfit: number | null = null
  const gp = tags.get('GrossProfit')
  if (typeof gp === 'number') {
    grossProfit = gp
    used.grossProfit = 'GrossProfit'
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

export type ResolvedStock = {
  cash: number | null
  totalDebt: number | null
  equity: number | null
  sharesOutstanding: number | null
}

export function resolveStock(
  tags: Map<string, number>,
): { fields: ResolvedStock; used: Record<string, string> } {
  const used: Record<string, string> = {}

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

  let totalDebt: number | null = null
  const ltNon = tags.get('LongTermDebtNoncurrent')
  const ltCur = tags.get('LongTermDebtCurrent')
  if (typeof ltNon === 'number' || typeof ltCur === 'number') {
    totalDebt = (ltNon ?? 0) + (ltCur ?? 0)
    used.totalDebt = [
      typeof ltNon === 'number' ? 'LongTermDebtNoncurrent' : null,
      typeof ltCur === 'number' ? 'LongTermDebtCurrent' : null,
    ]
      .filter(Boolean)
      .join('+')
  } else {
    const dc = tags.get('DebtCurrent')
    if (typeof dc === 'number') {
      totalDebt = dc
      used.totalDebt = 'DebtCurrent'
    }
  }

  const simple = (field: string, tag: string): number | null => {
    const v = tags.get(tag)
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
