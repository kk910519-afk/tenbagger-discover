import { DERIVED_SOURCE_TAG, type FieldRejection, type FinancialPeriod, type PeriodType } from '@/domain/types'
import { sumTTM } from '@/domain/growth'
import { validatePeriod } from '@/domain/validate'
import type { RawFact } from '../types.js'
import {
  indexFacts, resolveFlow, resolveStock,
  type FactIndex, type ResolvedFlow, type ResolvedStock,
} from './resolve.js'
import { resolveCumulative, FLOW_FIELDS } from './cumulative.js'
import { BASIC_SHARES_CHAIN } from './tags.js'

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
const DERIVED_MARKER = DERIVED_SOURCE_TAG

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

/**
 * asOf 이전(포함) 중, 태그별로 가장 최근 시점 값을 독립적으로 찾는다.
 *
 * 각 값이 **어느 일자에서 왔는지**도 함께 돌려준다. 태그별 소급은 표지
 * 발행주식수에는 반드시 필요하지만 서로 더해지는 대차대조표 구성요소에
 * 적용되면 어느 대차대조표에도 없던 합계를 만든다 — resolve.ts의
 * `coherentGroup`이 이 일자를 보고 가산 그룹을 하나의 대차대조표로 고정한다.
 */
function pickInstant(idx: FactIndex, asOf: string): {
  values: Map<string, number>
  dates: Map<string, string>
} {
  const values = new Map<string, number>()
  const dates = new Map<string, string>()
  for (const [date, tags] of idx.instant) {
    if (date > asOf) continue
    if (daysBetween(date, asOf) > INSTANT_STALENESS_LIMIT_DAYS) continue
    for (const [tag, value] of tags) {
      const bestDate = dates.get(tag)
      if (bestDate === undefined || date > bestDate) {
        dates.set(tag, date)
        values.set(tag, value)
      }
    }
  }
  return { values, dates }
}

function fcfOf(ocf: number | null, capex: number | null): number | null {
  return ocf === null || capex === null ? null : ocf - capex
}

/**
 * 표지 발행주식수가 회사 전체 지분을 덮지 못한다고 판정하는 하한.
 * 근거는 `applyShareCoverageGuard` 주석의 실측 분포 참고.
 */
const COVER_SHARES_MIN_FRACTION_OF_BASIC = 0.4

/**
 * 두 주식수가 이 배율 이상 벌어지면 종류주 문제가 아니라 **단위 스케일 오류**로 본다
 * (신고자가 천 주 단위로 적은 값이 그대로 들어온 경우). 실측: 회사 자신의 같은
 * 측정치 이력 중앙값 대비 배율이 500배를 넘는 사실이 표지 75건·희석 860건 있고,
 * 값은 정확히 1000배 근처에 뭉쳐 있다(예: VERI 2026-03-31 희석 92,899,169,000 —
 * 직전 분기 63,316,000). 그런 쌍은 어느 쪽이 깨졌는지 이 함수만으로는 알 수 없으므로
 * 판정을 포기하고 기존 값을 그대로 둔다 — 지금 동작과 같다.
 */
const SHARES_SCALE_ERROR_FACTOR = 100

/**
 * **표지 발행주식수의 주식 종류 커버리지 검증(F3).**
 *
 * 최종 리뷰는 이 결함의 원인을 `financial_facts`의
 * UNIQUE(cik, tag, period_end, qtrs, form) 충돌 — 종류주마다 한 행씩 들어와 첫
 * 행만 살아남는 것 — 으로 지목했다. **실측으로 그 기전은 성립하지 않는다:**
 *  - 라이브 DB의 `EntityCommonStockSharesOutstanding` 44,207건은 전부
 *    `source='api'`다. SEC bulk(num.txt)는 이 dei 개념을 아예 싣지 않으므로
 *    bulk 쪽에서 종류주 행이 충돌할 여지가 없다.
 *  - companyfacts는 (end, accn, form) 하나당 항목을 **한 개만** 내보낸다(확인:
 *    AAPL·NVDA·CRWD·LYFT·MBLY 등, 중복 그룹 0건). 종류주 축(StatementClassOfStockAxis)
 *    으로 태깅된 사실은 companyfacts가 디멘션을 제거하며 **통째로 빼버리기**
 *    때문에, GOOGL·META·PLTR·COIN·DASH·ZM·ZG·DDOG는 이 개념 자체가 404다.
 *
 * 즉 충돌해서 버려지는 것이 아니라, **다종류주 발행사에서는 companyfacts가
 * 종류 하나만(혹은 아무것도) 내보낸다.** MBLY(Mobileye)가 정확히 전자다 —
 * 표지값은 Class A만이고(2026-04-15 244,415,099주), Class B 약 574M주는 API에
 * 존재하지 않는다. 그 결과 시가총액이 $2.13B로 저장돼 실제 ~$7.1B의 1/3.3이 됐다.
 *
 * 검증 수단은 **같은 기간의 기본 가중평균 발행주식수**다(tags.ts
 * `BASIC_SHARES_CHAIN`). 기본 가중평균은 정의상 그 기간에 실제로 발행돼 있던
 * 보통주 전 종류의 시간가중 평균이므로 표지값과 같은 것을 센다. 표지값이 그보다
 * 크게 작으면 세는 대상이 다르다는 뜻 — 종류주 누락이다.
 *
 * 하한 0.4의 근거 — 표본 238개사(라이브 DB에서 `표지 < 0.9 × 희석`인 회사 전수 +
 * 무작위 160개)에 대해 SEC companyconcept로 기본가중평균을 직접 받아 계산한
 * `표지 / 기본가중평균` 분포(유효 234건):
 *
 *   <0.4  0.4–0.5  0.5–0.6  0.6–0.7  0.7–0.8  0.8–0.9  0.9–1.1  1.1–1.5  >=1.5
 *     11        1        9       10       15       27      145        8       8
 *
 * 몸통은 0.9~1.1(62%)이고 p25=0.852다. 아래 꼬리를 값 순으로 늘어놓으면
 * … IBIO 0.289, **MBLY 0.299**, CELZ 0.338 | PTN 0.453, INAB 0.506 … 로
 * 0.338과 0.453 사이가 표본에서 가장 넓은 빈 구간이라 0.4를 그 사이에 둔다.
 * 0.6·0.5로 올리면 전환우선주·워런트가 많은 소형주(TENX 0.521, STEX 0.560 등)가
 * 함께 걸리는데, 그 회사들의 표지값은 실제 발행 보통주로 맞는 값이다.
 *
 * 희석주식수가 아니라 기본가중평균으로 판정하는 이유는 tags.ts
 * `BASIC_SHARES_CHAIN` 주석 참고.
 *
 * 걸러낸 뒤에는 값을 추정하지 않고 **null로 남긴다**. `refresh-prices`의
 * `pickShares`가 이미 표지값이 없는 회사(=GOOGL·META처럼 이 개념이 아예 없는
 * 다종류주 발행사)를 희석주식수로 대체하는 경로를 갖고 있으므로, 같은 종류의
 * 회사가 같은 경로를 타게 된다. MBLY는 이 경로에서 818,000,000주가 되어
 * 시가총액이 $2.13B → $7.14B가 된다(2026-08-07 종가 8.73).
 */
/**
 * asOf 이전(포함) 중 가장 최근의 기본 가중평균 발행주식수. 모든 누적 길이(qtrs)를
 * 함께 본다 — 커버리지 판정은 자릿수 비교라 분기 평균이든 연간 평균이든 무방하다.
 *
 * 기간별 태그 맵만 보면 안 되는 이유: 누적 차분으로 **유도된** 분기에는 그 기간에
 * 직접 신고된 태그가 하나도 없다. 실측(MBLY)에서 회계연도 말 유도 분기
 * 2025-12-27이 정확히 그 상태라, 그 행만 가드를 통과해 Class A 단독 주식수
 * 216,005,938이 살아남았고 `refresh-prices`가 최신 비결측 행으로 그것을 골랐다.
 * 시점 값과 같은 소급 상한(400일)을 쓴다.
 */
function basicSharesAsOf(idx: FactIndex, asOf: string): number | null {
  let best: { date: string; value: number } | null = null
  for (const byPeriod of idx.duration.values()) {
    for (const [date, tags] of byPeriod) {
      if (date > asOf) continue
      if (daysBetween(date, asOf) > INSTANT_STALENESS_LIMIT_DAYS) continue
      if (best !== null && date < best.date) continue
      for (const tag of BASIC_SHARES_CHAIN) {
        const v = tags.get(tag)
        if (typeof v !== 'number') continue
        if (best === null || date > best.date || v > best.value) best = { date, value: v }
        break
      }
    }
  }
  return best?.value ?? null
}

function applyShareCoverageGuard(
  fields: ResolvedStock,
  used: Record<string, string>,
  basicShares: number | null,
): void {
  const cover = fields.sharesOutstanding
  if (cover === null || cover <= 0 || basicShares === null || basicShares <= 0) return
  if (cover >= COVER_SHARES_MIN_FRACTION_OF_BASIC * basicShares) return
  if (basicShares > SHARES_SCALE_ERROR_FACTOR * cover) return
  fields.sharesOutstanding = null
  delete used.sharesOutstanding
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
  const instant = pickInstant(idx, periodEnd)
  const stock = resolveStock(instant.values, {
    dates: instant.dates,
    absent: idx.absent,
    instant: idx.instant,
  })
  applyShareCoverageGuard(stock.fields, stock.used, basicSharesAsOf(idx, periodEnd))
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
