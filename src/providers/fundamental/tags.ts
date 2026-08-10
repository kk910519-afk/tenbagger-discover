import { createHash } from 'node:crypto'

// ── 부채(차입금) 태그 ────────────────────────────────────────────────────────
//
// 이 목록은 임의로 떠올린 것이 아니라 실측에서 골랐다. 부채가 결측인 994개사에서
// 업종(SIC 2자리)×시총 4분위로 층화한 100개사 표본을 뽑아 SEC companyfacts 원문을
// 직접 조사하고(61개 층, 100/100 응답 정상), 그 회사들의 "부채 결측 연간 기간"
// 744개의 대차대조표 일자에 실제로 존재하는 instant·USD 태그를 빈도순으로 센 결과다.
// 상세 표는 debt-coverage-report.md 1절 참고.
//
// **총계 개념과 구성요소를 섞어 더하면 이중계상이 된다.** 실측으로 관계를 확정했다:
// `LongTermDebt`와 `LongTermDebtNoncurrent`+`LongTermDebtCurrent`가 함께 존재하는
// instant 781건에서 비율 중앙값은 1.000(p10 1.000, p90 1.010)이고 0.99~1.01 구간이
// 671건(86%)이었다. 반면 `LongTermDebt`를 비유동 부분과만 비교하면 일치는 172건(22%)에
// 그쳤다. 즉 `LongTermDebt`는 **유동 만기분을 포함한 장기차입금 총계**이지 비유동
// 부분이 아니다 — 유동 만기분 태그와 함께 더하면 안 된다.
// `DebtCurrent`도 마찬가지로 정의상 유동 차입금 전체의 총계다(구성요소가 함께 있는
// 68건에서 42건이 합계와 일치, 22건은 총계 쪽이 더 컸다 — 구성요소만으로는 유동
// 차입금을 다 덮지 못한다는 뜻).
//
// **리스부채는 부채에 넣지 않는다.** 근거 두 가지:
//  1) 일관성 — 이미 부채가 산출되는 회사는 전부 차입금 태그만으로 계산돼 있다.
//     일부 회사에만 리스를 더하면 같은 유니버스 안에서 투하자본의 정의가 갈라져
//     ROIC를 고정 WACC와 비교하는 해자 판정 자체가 회사마다 다른 잣대가 된다.
//  2) DCF 이중계상 — ASC 842에서 운용리스 비용은 영업비용에 그대로 남아 영업이익과
//     FCF에서 이미 차감된다. DCF가 그 현금흐름을 이미 반영하고 있는데 기업가치에서
//     리스부채를 또 빼면 같은 의무를 두 번 세는 것이다.
// 따라서 이 제품의 `totalDebt`는 **이자부 차입금**이며, 리스만 있고 차입금이 없는
// 회사는 이 정의상 차입금 0이 맞다.

/** 모든 차입금(장·단기)의 총계를 한 태그로 신고하는 개념. 구성요소와 절대 더하지 않는다. */
export const DEBT_COMBINED_TOTAL_TAG = 'DebtLongtermAndShorttermCombinedAmount'
/** 장기차입금 총계 — 유동 만기분을 포함한다(위 실측 참고). */
export const LONG_TERM_DEBT_TOTAL_TAG = 'LongTermDebt'
export const LONG_TERM_DEBT_NONCURRENT_TAG = 'LongTermDebtNoncurrent'
export const LONG_TERM_DEBT_CURRENT_TAG = 'LongTermDebtCurrent'
/** 유동 차입금 총계 — 유동 만기분·단기차입금·유동 어음을 모두 포함하는 정의다. */
export const DEBT_CURRENT_TOTAL_TAG = 'DebtCurrent'

/**
 * 상품별 차입금 계열. `total`은 그 상품의 유동·비유동을 합친 총계 태그이고
 * `noncurrent`/`current`는 나눠 신고할 때 쓰는 태그다(각 배열 안은 같은 것을
 * 부르는 이름 변형이라 처음 발견된 하나만 쓴다).
 *
 * 계열 간 관계는 **하나의 롤업과 여러 상품**이다. `LongTermDebt`는 장기차입금 전체의
 * 롤업이라 아래 상품별 계열을 이미 품고 있을 수 있고, 상품별 계열끼리는 서로 다른
 * 상품 유형이라 겹치지 않는다. 그래서 상품별 계열은 **서로 더하되**, 그 합과 롤업은
 * **더하지 않고 큰 쪽을 쓴다**. 실측이 이 구조를 그대로 보여준다:
 *  - TLS 2012-12-31: `LongTermDebt`=18,934,000인데 `LinesOfCreditCurrent+
 *    NotesPayableCurrent+LongTermLineOfCredit`도 정확히 18,934,000 — 같은 부채를
 *    두 이름으로 태깅했다. 더하면 2배가 된다.
 *  - SND 2016-12-31: `LongTermDebt`=570,000(디멘션 슬라이스로 오염)인데
 *    `NotesPayableCurrent`(6,052,000)+`LongTermLineOfCredit`(50,000,000)=56,052,000이
 *    진짜 총계다. 서로 다른 상품이므로 이 둘은 더하는 것이 맞다.
 * 어느 쪽이 오염될지는 고정돼 있지 않고 오염값은 정의상 부분집합이라 항상 작다 —
 * resolve.ts의 `resolveRevenue`가 같은 이유로 이미 쓰고 있는 "둘 다 있으면 큰 쪽"
 * 규칙을 롤업 대 상품합에도 그대로 적용한다. 실측 70건의 `상품별 계열 합 /
 * LongTermDebt` 중앙값이 0.833이라, 무턱대고 더하면 전형적으로 부채가 거의 두 배가 된다.
 */
export type DebtFamily = {
  readonly total: readonly string[]
  readonly noncurrent: readonly string[]
  readonly current: readonly string[]
}

export const LONG_TERM_DEBT_FAMILY: DebtFamily = {
  total: [LONG_TERM_DEBT_TOTAL_TAG],
  noncurrent: [LONG_TERM_DEBT_NONCURRENT_TAG],
  current: [LONG_TERM_DEBT_CURRENT_TAG],
}

/**
 * 상품별 계열. 서로 다른 상품 유형이라 **계열끼리는 합산**하고, 그 합과
 * `LONG_TERM_DEBT_FAMILY`(롤업) 사이에서만 큰 쪽을 고른다.
 */
export const SPECIFIC_DEBT_FAMILIES: readonly DebtFamily[] = [
  { total: ['LineOfCredit'], noncurrent: ['LongTermLineOfCredit'], current: ['LinesOfCreditCurrent'] },
  { total: ['NotesPayable'], noncurrent: ['NotesPayableNoncurrent'], current: ['NotesPayableCurrent'] },
  { total: [], noncurrent: ['LongTermLoansPayable'], current: ['LoansPayableCurrent'] },
  {
    total: ['ConvertibleNotesPayable'],
    noncurrent: ['ConvertibleDebtNoncurrent', 'ConvertibleNotesPayableNoncurrent'],
    current: ['ConvertibleDebtCurrent', 'ConvertibleNotesPayableCurrent'],
  },
  {
    total: ['OtherLongTermDebt'],
    noncurrent: ['OtherLongTermDebtNoncurrent'],
    current: ['OtherLongTermDebtCurrent'],
  },
]

/**
 * 단기차입금. 정의상 장기차입금에 포함될 수 없으므로 위 계열들과 달리 **더한다**.
 * 실측 확인: XEL은 매년 `LongTermDebt`(16~32B)와 `ShortTermBorrowings`(0.6~1.6B)를
 * 나란히 신고한다 — 최댓값을 취하면 단기차입금이 통째로 사라진다.
 */
export const SHORT_TERM_BORROWING_TAGS: readonly string[] = [
  'ShortTermBorrowings',
  'OtherShortTermBorrowings',
]

/**
 * 기본(희석 전) 가중평균 발행주식수. `resolveStock`이 표지 발행주식수
 * (`EntityCommonStockSharesOutstanding`)의 **주식 종류 커버리지**를 검증하는 데
 * 쓴다 — 근거는 normalizer.ts의 `applyShareCoverageGuard` 주석 참고.
 *
 * 희석주식수가 아니라 기본주식수를 쓰는 이유: 기본 가중평균은 정의상 그 기간에
 * 실제로 발행돼 있던 보통주(전 종류)의 시간가중 평균이라 표지 발행주식수와 같은
 * 것을 세지만, 희석주식수는 전환우선주·워런트·옵션까지 포함해 실제 발행주식수보다
 * 훨씬 클 수 있다. 실측(TENX, Tenax Therapeutics 2025-09-30): 표지 4,562,500주에
 * 희석 39,741,404주 — 전환우선주 때문이지 종류주 누락이 아니다. 희석주식수로
 * 판정했다면 이 회사를 잘못 걸러냈을 것이다.
 *
 * 두 번째 태그는 기본과 희석이 같을 때(반희석 상황) 하나로 신고하는 변형이다.
 */
export const BASIC_SHARES_CHAIN: readonly string[] = [
  'WeightedAverageNumberOfSharesOutstandingBasic',
  'WeightedAverageNumberOfShareOutstandingBasicAndDiluted',
]

/**
 * 차입금 개념 전체. "이 회사가 차입금이라는 개념을 이력 어디에서든 태깅한 적이
 * 있는가"를 판정하는 데 쓴다(무차입 추론 자격 — normalizer.ts 참고).
 */
export const DEBT_TAGS: ReadonlySet<string> = new Set<string>([
  DEBT_COMBINED_TOTAL_TAG,
  DEBT_CURRENT_TOTAL_TAG,
  ...LONG_TERM_DEBT_FAMILY.total,
  ...LONG_TERM_DEBT_FAMILY.noncurrent,
  ...LONG_TERM_DEBT_FAMILY.current,
  ...SPECIFIC_DEBT_FAMILIES.flatMap((f) => [...f.total, ...f.noncurrent, ...f.current]),
  ...SHORT_TERM_BORROWING_TAGS,
])

/**
 * **대차대조표에서 이 태그가 덮는 구역**. 낡은 구성요소가 "다시 태깅되지 않은 것"인지
 * "사라진 것"인지를 가르는 데 쓴다(resolve.ts `carryForwardGroup`).
 *
 *  - `noncurrent` : 비유동 구역만 잰다.
 *  - `current`    : 유동 구역만 잰다.
 *  - `spanning`   : 유동+비유동을 한 숫자로 잰다(계열 총계·롤업).
 *
 * 핵심은 **한 태그는 자기가 덮는 구역에 대해서만 증언한다**는 점이다. 어떤 분기에
 * `DebtCurrent`(유동 총계)만 신고됐다고 해서 비유동 차입금이 사라졌다는 뜻이 아니다 —
 * 유동 구역을 잰 숫자는 비유동 구역에 대해 아무 말도 하지 않는다. 실측(NXPI, 2026-03-29):
 * 10-Q는 `DebtCurrent` 750,000,000만 태깅하지만 같은 대차대조표의 장기차입금
 * 10,972,000,000(직전 10-K)은 그대로 남아 있다 — 10-Q 신고서 원문에도 `Long-term debt`가
 * 그대로 있다. 반대로 QCOM 2026-06-28은 앵커 일자에 `LongTermDebt`(spanning)가 있으므로
 * 낡은 `LongTermDebtNoncurrent`는 이미 다시 측정된 값이라 버려야 한다.
 */
export type DebtRegion = 'noncurrent' | 'current' | 'spanning'

/** 태그가 속한 상품 계열 식별자. 계열이 다르면 서로의 구역을 대체하지 않는다. */
export type DebtFamilyId =
  | 'general' | 'longterm' | 'loc' | 'notes' | 'loans' | 'convertible' | 'other'
  | 'cash' | 'shortTermInvestments'

export type DebtTagShape = { readonly family: DebtFamilyId; readonly region: DebtRegion }

const SPECIFIC_FAMILY_IDS: readonly DebtFamilyId[] = ['loc', 'notes', 'loans', 'convertible', 'other']

function buildShapes(): ReadonlyMap<string, DebtTagShape> {
  const m = new Map<string, DebtTagShape>()
  const put = (tags: readonly string[], family: DebtFamilyId, region: DebtRegion) => {
    for (const t of tags) m.set(t, { family, region })
  }
  // 일반(general) 계열 — 계열을 가리지 않는 총계 개념. `LongTermDebt`도 여기 속한다:
  // 위 주석대로 이것은 **장기차입금 전체의 롤업**이라 상품별 계열을 이미 품고 있을 수
  // 있다. 실측(UTMD 2025-12-31): `LongTermDebt` 0을 신고한 분기에 직전 분기의
  // `OtherLongTermDebtNoncurrent` 241,000(실제로는 운용리스부채)을 이월하면 없는 부채가
  // 만들어진다 — 신고자가 "장기차입금 0"이라고 롤업으로 말한 이상 그 아래 상품별 잔액도
  // 함께 재측정된 것이다.
  put([DEBT_COMBINED_TOTAL_TAG], 'general', 'spanning')
  put([DEBT_CURRENT_TOTAL_TAG], 'general', 'current')
  put(SHORT_TERM_BORROWING_TAGS, 'general', 'current')
  put(LONG_TERM_DEBT_FAMILY.total, 'general', 'spanning')
  // 장기차입금 계열의 구성요소.
  put(LONG_TERM_DEBT_FAMILY.noncurrent, 'longterm', 'noncurrent')
  put(LONG_TERM_DEBT_FAMILY.current, 'longterm', 'current')
  // 상품별 계열.
  SPECIFIC_DEBT_FAMILIES.forEach((f, i) => {
    const id = SPECIFIC_FAMILY_IDS[i] ?? 'other'
    put(f.total, id, 'spanning')
    put(f.noncurrent, id, 'noncurrent')
    put(f.current, id, 'current')
  })
  return m
}

export const DEBT_TAG_SHAPES: ReadonlyMap<string, DebtTagShape> = buildShapes()

/**
 * 현금성 그룹 — 두 태그는 대차대조표의 **서로 다른 줄**이라 계열을 따로 둔다.
 * 어느 한쪽이 이번 분기에 태깅되지 않았다고 다른 쪽이 그 부재를 증언하지는 못한다.
 */
export const CASH_TAG_SHAPES: ReadonlyMap<string, DebtTagShape> = new Map<string, DebtTagShape>([
  ['CashAndCashEquivalentsAtCarryingValue', { family: 'cash', region: 'current' }],
  ['ShortTermInvestments', { family: 'shortTermInvestments', region: 'current' }],
])

/**
 * 리스부채 태그. `totalDebt`에는 **들어가지 않는다**(위 설명). 그런데도 수집하는
 * 이유는, 이것이 없으면 "이 회사는 부채가 없다"와 "이 회사의 부채를 우리가 못
 * 읽었다"를 DB만으로 구분할 수 없기 때문이다. `TRACKED_TAGS`가 파싱 시점에
 * 필터링하는 구조라, 추적하지 않는 개념은 아예 흔적이 남지 않는다 — 이번 과제가
 * 정확히 그 상황이었다(DB만 봐서는 무엇이 빠졌는지 알 수 없어 SEC 원문을 다시
 * 표본 조사해야 했다). 리스부채를 태깅한 회사는 대차대조표 부채 섹션을 실제로
 * 태깅하고 있다는 증거이므로, 차입금 개념이 하나도 없는 것이 결측인지 진짜
 * 무차입인지를 가르는 관측 가능한 신호가 된다.
 */
export const LEASE_DEBT_TAGS: ReadonlySet<string> = new Set<string>([
  'FinanceLeaseLiability',
  'FinanceLeaseLiabilityCurrent',
  'FinanceLeaseLiabilityNoncurrent',
  'CapitalLeaseObligations',
  'CapitalLeaseObligationsCurrent',
  'CapitalLeaseObligationsNoncurrent',
  'OperatingLeaseLiability',
  'OperatingLeaseLiabilityCurrent',
  'OperatingLeaseLiabilityNoncurrent',
])

/**
 * 대차대조표 부채 섹션이 실제로 해석됐음을 증명하는 앵커 태그. 리스부채 태그와
 * 같은 이유로 수집한다 — `totalDebt` 계산에는 쓰지 않지만, 부채 섹션 자체가
 * 안 들어온 회사와 부채가 정말 없는 회사를 DB에서 구분할 수 있게 해준다.
 */
export const LIABILITIES_ANCHOR_TAGS: readonly string[] = ['Liabilities', 'LiabilitiesCurrent']

// ── 업종별 매출 총계 태그 ───────────────────────────────────────────────────
//
// 부채 태그와 같은 방법으로 골랐다: 최신 연간 매출이 결측인 **178개사 전수**의
// companyfacts 원문(178/178 응답 정상)에서 결측 연간 기간 923개에 실제로 존재하는
// USD·연간(330~400일) 개념을 세고, 이미 추적 중인 매출 태그와 **겹치는 기간의 비율**로
// 총계인지 구성요소인지를 판정했다. 상세 표는 coverage-closeout-report.md 2절.
//
// **채택한 둘은 그 신고자에게 손익계산서 맨 윗줄이다.**
//  - `RegulatedAndUnregulatedOperatingRevenue` — 규제 유틸리티. XEL은 2017·2018년에
//    `Revenues`와 이 태그를 **같은 값**으로 나란히 신고했고(11,404,000,000 =
//    11,404,000,000, 11,537,000,000 = 11,537,000,000) 2019년부터 `Revenues`를 버렸다.
//    같은 것의 다른 이름이라는 증명이며, 그래서 XEL의 2019~2025년 매출(11.5B~15.3B)이
//    통째로 비어 있었다. MGEE는 2008년 이후 전 기간을 이 태그로만 신고한다.
//  - `RevenuesNetOfInterestExpense` — 이자수익이 매출인 대출·핀테크 신고자의 총매출
//    줄이다(SOFI 2025-12-31 3,613,354,000 = 실제 순매출; 추적 태그로는 계약매출
//    619,353,000만 잡혀 6분의 1로 축소돼 있었다).
//
// **기각한 것 — 전부 구성요소로 실측됐다.** 이름이 그럴듯하다고 넣지 않는다:
//  - `InterestAndDividendIncomeOperating`(결측 기간의 2.8%, 최다 후보) — 추적 태그와
//    겹치는 25개 기간에서 비율 중앙값 **0.051**, 1% 이내 일치 **0건**. 은행의
//    이자·배당수익만이라 비이자수익이 빠진다(CASS 2025: 97,566,000 vs 총매출
//    190,750,000).
//  - `NoninterestIncome`(2.3%) — 위의 나머지 반쪽.
//  - `RevenuesExcludingInterestAndDividends`(0.4%, 중앙값 0.818),
//    `SalesRevenueGoodsNet`(0.2%, 0.793), `SalesRevenueServicesNet`(0.245),
//    `ContractsRevenue`(0.719), `ElectricUtilityRevenue`(0.335),
//    `RegulatedOperatingRevenue`(0.375), `OilAndGasRevenue`(0.043),
//    `HealthCareOrganizationRevenue`(0.084) — 이름 그대로 매출의 한 갈래다.
//
// 채택한 둘도 항상 총계인 것은 아니다: LNT(Alliant Energy)는
// `RegulatedAndUnregulatedOperatingRevenue`를 142,000,000(비규제 부분)으로 쓰면서
// `Revenues` 4.2B을 따로 신고한다. 그래서 이 태그들은 순서 체인이 아니라
// **`resolveRevenue`의 최댓값 후보**로 들어간다 — 오염·부분 값은 정의상 총계보다
// 작다는, 이 코드베이스가 이미 쓰고 있는 같은 규칙이다.
export const INDUSTRY_REVENUE_TOTAL_TAGS: readonly string[] = [
  'RegulatedAndUnregulatedOperatingRevenue',
  'RevenuesNetOfInterestExpense',
]

/**
 * 영업이익을 신고하지 않는 신고자를 위한 **손익계산서 구조 태그**.
 * `OperatingIncomeLoss`가 없을 때 `resolveFlow`가 이 둘로 되살린다(근거는
 * resolve.ts `resolveOperatingIncome` 주석의 실측 일치율).
 */
export const OPERATING_COST_TOTAL_TAG = 'CostsAndExpenses'
export const OPERATING_EXPENSES_TAG = 'OperatingExpenses'

/**
 * 수집 대상 XBRL 태그. 폴백 체인의 모든 후보를 포함한다.
 * 정규화(Task 9)가 이 중 어떤 태그를 실제로 쓸지 결정한다.
 */
export const TRACKED_TAGS = new Set<string>([
  // 매출
  'RevenueFromContractWithCustomerExcludingAssessedTax',
  'RevenueFromContractWithCustomerIncludingAssessedTax',
  'Revenues',
  'SalesRevenueNet',
  ...INDUSTRY_REVENUE_TOTAL_TAGS,
  // 매출총이익 / 매출원가
  'GrossProfit',
  'CostOfRevenue',
  'CostOfGoodsAndServicesSold',
  // 손익
  'OperatingIncomeLoss',
  OPERATING_COST_TOTAL_TAG,
  OPERATING_EXPENSES_TAG,
  'NetIncomeLoss',
  'ResearchAndDevelopmentExpense',
  'ShareBasedCompensation',
  // 현금흐름
  'NetCashProvidedByUsedInOperatingActivities',
  'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations',
  'PaymentsToAcquirePropertyPlantAndEquipment',
  'PaymentsToAcquireProductiveAssets',
  // 재무상태
  'CashAndCashEquivalentsAtCarryingValue',
  'ShortTermInvestments',
  'StockholdersEquity',
  // 부채 — 차입금(위 실측 근거 참고)
  ...DEBT_TAGS,
  // 부채 — 리스(totalDebt에는 안 들어가고 무차입 추론 자격 판정에만 쓴다)
  ...LEASE_DEBT_TAGS,
  // 대차대조표 부채 섹션 해석 여부를 증명하는 앵커
  ...LIABILITIES_ANCHOR_TAGS,
  // 주식수
  'WeightedAverageNumberOfDilutedSharesOutstanding',
  ...BASIC_SHARES_CHAIN,
  'EntityCommonStockSharesOutstanding',
])

/**
 * 추적 태그 집합의 지문. **파싱 시점에 태그를 거르기 때문에**, 이 집합이 바뀌면
 * 이미 수집된 회사의 저장된 사실에는 새 태그가 영원히 들어오지 않는다 —
 * `selectStaleCiks`(신고일 기준)도 `selectThinCoverageCiks`(사실 수 기준)도 이
 * 회사들을 재조회 대상으로 고르지 않기 때문이다(둘 다 "최신이고 두껍다"고 본다).
 * `ingest_tag_state`에 회사별로 이 지문을 남겨, 지문이 달라진 회사를 재조회
 * 대상으로 뽑는다(financials.ts `selectTagSetStaleCiks`). 앞으로 태그를 추가할
 * 때마다 조용히 무효가 되는 일을 구조로 막는다.
 */
export const TRACKED_TAGS_FINGERPRINT = createHash('sha256')
  .update([...TRACKED_TAGS].sort().join('\n'))
  .digest('hex')
  .slice(0, 16)
