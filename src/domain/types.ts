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
  /** TTM 계열, 최근순. [0]=현재 TTM, [4]=1년 전 TTM */
  ttm: FinancialPeriod[]
  /** 연간, 최근순 */
  annual: FinancialPeriod[]
  /** 분기, 최근순 */
  quarterly: FinancialPeriod[]
  industryStats: IndustryStats
  asOf: string
}
