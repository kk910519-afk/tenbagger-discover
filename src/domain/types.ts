export type PeriodType = 'Q' | 'A' | 'TTM'

export type FinancialPeriod = {
  periodEnd: string            // ISO date (YYYY-MM-DD)
  periodType: PeriodType
  revenue: number | null
  grossProfit: number | null
  operatingIncome: number | null
  netIncome: number | null
  ocf: number | null
  capex: number | null
  fcf: number | null
  cash: number | null
  totalDebt: number | null
  equity: number | null
  /** 기간 가중평균 희석주식수 — EPS 계산용 */
  sharesDiluted: number | null
  /** 표지 기준 발행주식수 (dei 태그) — 시가총액 계산용 */
  sharesOutstanding: number | null
  sbc: number | null
  rdExpense: number | null
}

/**
 * financials로 나가기 전 물리적으로 불가능한 값을 null로 거부한 기록.
 * 집계용(잡 통계)이며 DB 컬럼에는 저장하지 않는다 — 무엇을, 왜 거부했는지
 * "셀 수 있게" 만드는 것이 목적이다(ingest-hardening 과제 3).
 */
export type FieldRejection = {
  cik: number
  periodEnd: string
  periodType: PeriodType
  field: 'revenue' | 'grossProfit'
  reason: string
  value: number
}

export type IndustryMeta = {
  slug: string
  name: string
  themeSlug: string
  tamUsd: number | null
  tamCagr: number | null
  tamSource: string | null
  tamAsOf: string | null
}

export type IndustryStats = {
  candidateCount: number
  /** 경쟁우위 팩터의 "산업 대비 GM" 신호에 쓰인다 */
  medianGrossMargin: number | null
  /** TAM CAGR이 큐레이션되지 않은 산업의 성장률 대체값 */
  medianRevenueGrowth: number | null
  /** 지표 키 → 값 배열. percentileOf()로 백분위 표시용 (입력 순서 무관) */
  distributions: Record<string, number[]>
}

export type FactorStatus = 'SCORED' | 'NO_DATA' | 'NOT_IMPLEMENTED'

export type FactorResult = {
  key: string
  weight: number
  points: number | null
  raw: number | null
  status: FactorStatus
  detail: string
}

export type RedFlagSeverity = 'CRITICAL' | 'WARNING'

export type RedFlag = {
  code: string
  severity: RedFlagSeverity
  message: string
  evidence: Record<string, number | string | null>
}

export type Category = 'LEADER' | 'CHALLENGER' | 'EMERGING'

/**
 * 시가총액에 쓰인 발행주식수의 출처. 표지 발행주식수(EntityCommonStockSharesOutstanding,
 * 신고서 표지의 특정 시점 값)를 최우선으로 쓰고('reported'), 그게 없는 회사는 희석
 * 가중평균주식수(WeightedAverageNumberOfDilutedSharesOutstanding, 기간 평균값)로
 * 대체한다('diluted_fallback'). 둘 다 회사가 직접 보고한 숫자이므로 조작은 아니지만,
 * 시점 값과 기간 평균값은 서로 다른 측정이라 그 차이로 나온 시가총액은 근사치다 —
 * 어느 쪽을 썼는지 나중에 역추정하지 않도록 계산 시점에 함께 기록해 보존한다.
 */
export type SharesBasis = 'reported' | 'diluted_fallback'

export type CompanySnapshot = {
  cik: number
  ticker: string
  name: string
  themeSlug: string
  industrySlug: string
  industry: IndustryMeta
  classificationSource: 'sic' | 'override'
  marketCap: number | null
  price: number | null
  priceDate: string | null
  sharesOutstanding: number | null
  /** marketCap이 null이면 이것도 null이다 — 어느 주식수를 썼는지는 시가총액이 있을 때만 의미가 있다. */
  sharesBasis: SharesBasis | null
  /** TTM 계열, 최근순. [0]=현재 TTM, [4]=1년 전 TTM */
  ttm: FinancialPeriod[]
  /** 연간, 최근순 */
  annual: FinancialPeriod[]
  /** 분기, 최근순 */
  quarterly: FinancialPeriod[]
  industryStats: IndustryStats
  asOf: string
}
