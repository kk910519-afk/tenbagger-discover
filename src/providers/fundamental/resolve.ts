import type { RawFact } from '../types.js'
import {
  DEBT_COMBINED_TOTAL_TAG, DEBT_CURRENT_TOTAL_TAG,
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

function daysBetween(a: string, b: string): number {
  return Math.abs(Date.parse(a) - Date.parse(b)) / DAY_MS
}

type FactEntry = { value: number; filedDate: string }

/**
 * 같은 (qtrs) 버킷 안에서 API와 bulk가 같은 회계기간을 서로 다른 period_end로
 * 보고하는 문제를 해소해 canonical `periodEnd → tag → value` 맵을 만든다.
 *
 * 1) 소스별로 (periodEnd, tag) 키의 정정 공시를 먼저 반영한다 — 늦게 신고된
 *    값이 이기고, filedDate가 같으면 먼저 만난 값을 쓴다(기존 동작 유지).
 * 2) API가 보고한 period_end를 canonical 날짜로 삼는다. bulk의 period_end가
 *    그 중 하나와 CROSS_SOURCE_TOLERANCE_DAYS 이내면 같은 회계기간으로 보고
 *    그 API 날짜에 합친다. 대응하는 API 데이터가 전혀 없는 기간의 bulk
 *    사실은 자기 자신의 period_end를 그대로 canonical로 쓴다 — 대응 기간이
 *    없다고 그 기간 자체를 버리지 않는다.
 * 3) 같은 canonical 날짜·같은 태그에 API와 bulk 값이 모두 있으면 API를
 *    쓴다. bulk 쪽 날짜가 반올림된 근사치라는 점 외에도, 실측 검증(Apple
 *    CIK 320193, accession 0000320193-26-000006)에서 bulk가 세그먼트별
 *    매출 분해값(제품 축 디멘션)을 연결 재무제표 총계인 것처럼 흘려보낸
 *    사례가 확인됐다 — SEC의 num.txt coreg 필드는 "법인(자회사)" 디멘션만
 *    표시하고 제품/서비스 축 같은 다른 디멘션은 표시하지 않기 때문에,
 *    소스 코드의 `coreg !== ''` 필터를 통과해도 총계가 아닐 수 있다.
 *    같은 회계기간에 API 값이 있다면 그쪽이 항상 더 신뢰할 수 있다.
 */
function reconcilePeriods(facts: RawFact[]): Map<string, Map<string, number>> {
  const bySource: Record<'api' | 'bulk', Map<string, Map<string, FactEntry>>> = {
    api: new Map(),
    bulk: new Map(),
  }

  for (const f of facts) {
    const byPeriod = bySource[f.source]
    let byTag = byPeriod.get(f.periodEnd)
    if (!byTag) { byTag = new Map(); byPeriod.set(f.periodEnd, byTag) }
    const prev = byTag.get(f.tag)
    // 동률(같은 filedDate)이면 먼저 만난 값을 쓴다 — 원래 chosenAt 로직과 동일.
    if (prev !== undefined && prev.filedDate >= f.filedDate) continue
    byTag.set(f.tag, { value: f.value, filedDate: f.filedDate })
  }

  const apiPeriods = bySource.api
  const apiEnds = [...apiPeriods.keys()].sort()

  const canonicalOf = (periodEnd: string): string => {
    if (apiPeriods.has(periodEnd)) return periodEnd
    let best: string | null = null
    let bestDiff = Infinity
    for (const apiEnd of apiEnds) {
      const diff = daysBetween(periodEnd, apiEnd)
      if (diff <= CROSS_SOURCE_TOLERANCE_DAYS && diff < bestDiff) {
        best = apiEnd
        bestDiff = diff
      }
    }
    return best ?? periodEnd
  }

  const result = new Map<string, Map<string, number>>()

  for (const [periodEnd, tags] of apiPeriods) {
    let out = result.get(periodEnd)
    if (!out) { out = new Map(); result.set(periodEnd, out) }
    for (const [tag, entry] of tags) out.set(tag, entry.value)
  }

  for (const [periodEnd, tags] of bySource.bulk) {
    const canonical = canonicalOf(periodEnd)
    let out = result.get(canonical)
    if (!out) { out = new Map(); result.set(canonical, out) }
    for (const [tag, entry] of tags) {
      if (out.has(tag)) continue // 같은 canonical 기간에 API 값이 이미 있으면 그쪽을 우선한다
      out.set(tag, entry.value)
    }
  }

  return result
}

export function indexFacts(facts: RawFact[]): FactIndex {
  const duration: FactIndex['duration'] = new Map()
  const instant: FactIndex['instant'] = new Map()

  const byQtrs = new Map<number, RawFact[]>()
  for (const f of facts) {
    let list = byQtrs.get(f.qtrs)
    if (!list) { list = []; byQtrs.set(f.qtrs, list) }
    list.push(f)
  }

  for (const [qtrs, list] of byQtrs) {
    const reconciled = reconcilePeriods(list)
    if (qtrs === 0) {
      for (const [periodEnd, tags] of reconciled) instant.set(periodEnd, tags)
    } else {
      duration.set(qtrs, reconciled)
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
 * 총부채(이자부 차입금) 해석. 티어 순서이며 **아래 티어는 위 티어가 아무 값도 내지
 * 못할 때만 작동한다** — 즉 이번 확장은 순수하게 가산적이라, 지금 부채가 산출되는
 * 회사(NVIDIA 포함)의 값은 정의상 바뀌지 않는다. 커버리지 변화는 전부 null → 값이다.
 *
 * 티어 1·2는 확장 전 코드와 글자 그대로 같은 규칙이고, 티어 3·4가 이번에 추가됐다.
 * 태그 선정과 계열 간 최댓값 규칙의 실측 근거는 tags.ts 주석과
 * debt-coverage-report.md 1절 참고.
 */
export function resolveTotalDebt(tags: Map<string, number>): Resolved | null {
  // 티어 1 — 장기차입금을 비유동/유동으로 나눠 신고한 경우(가장 흔한 형태).
  const ltNon = tags.get(LONG_TERM_DEBT_NONCURRENT_TAG)
  const ltCur = tags.get(LONG_TERM_DEBT_CURRENT_TAG)
  if (typeof ltNon === 'number' || typeof ltCur === 'number') {
    return {
      value: (ltNon ?? 0) + (ltCur ?? 0),
      tag: [
        typeof ltNon === 'number' ? LONG_TERM_DEBT_NONCURRENT_TAG : null,
        typeof ltCur === 'number' ? LONG_TERM_DEBT_CURRENT_TAG : null,
      ].filter(Boolean).join('+'),
    }
  }

  // 티어 2 — 유동 차입금 총계만 신고한 경우. 정의상 유동 만기분·단기차입금·유동
  // 어음을 모두 포함하는 총계라 구성요소와 섞지 않는다.
  const debtCurrent = tags.get(DEBT_CURRENT_TOTAL_TAG)
  if (typeof debtCurrent === 'number') {
    return { value: debtCurrent, tag: DEBT_CURRENT_TOTAL_TAG }
  }

  // 티어 3 — 장·단기를 하나로 합쳐 신고한 총계 태그.
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
  // When only ShortTermInvestments is present without CashAndCashEquivalentsAtCarryingValue,
  // cash remains null. Short-term investments alone is anomalous (data quality issue),
  // and treating investments as "cash" would overstate liquidity — exactly the distressed-company
  // red flag this product needs to surface. This is intentional; use a comment to avoid
  // "fixing" it by accident.
  // See test: 단기투자자산만 있고 현금성자산이 없으면 null

  const debt = resolveTotalDebt(tags)
  const totalDebt = debt?.value ?? null
  if (debt) used.totalDebt = debt.tag

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
