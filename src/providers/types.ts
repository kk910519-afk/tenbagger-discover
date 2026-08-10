export type Listing = {
  ticker: string
  exchange: string
  securityName: string
  isEtf: boolean
  isTestIssue: boolean
  financialStatus: string | null
  roundLot: number | null
}

export type ListingProvider = {
  fetchListings(): Promise<Listing[]>
}

export type TickerMapEntry = { cik: number; ticker: string; title: string }

export type CompanyReference = {
  cik: number
  name: string
  sic: string | null
  sicDescription: string | null
  exchanges: string[]
  entityType: string | null
  fiscalYearEnd: string | null
  filerCategory: string | null
  stateOfIncorporation: string | null
  stateOfIncorporationDescription: string | null
}

export type ReferenceProvider = {
  fetchTickerMap(): Promise<TickerMapEntry[]>
  fetchCompany(cik: number): Promise<CompanyReference | null>
}

export type RawFact = {
  cik: number
  tag: string
  unit: string
  periodStart: string | null
  periodEnd: string
  qtrs: number
  value: number
  form: string
  filedDate: string
  accession: string
  source: 'bulk' | 'api'
}

export type BulkFundamentalProvider = {
  fetchQuarter(year: number, quarter: number, ciks: Set<number>): Promise<RawFact[]>
}

export type CompanyFactsProvider = {
  // null = 확인된 404(XBRL 신고 이력 없음, 정상). []는 응답을 받았지만(200) 추적
  // 태그가 하나도 안 남은 경우 — 정상적으로는 거의 없어야 하므로 호출자가 구분해서
  // 다뤄야 한다 (ingest-fundamentals의 apiEmptyParse 참고).
  fetchCompany(cik: number): Promise<RawFact[] | null>
}

export type Quote = { price: number; date: string }

export type PriceProvider = {
  name: string
  fetchQuote(ticker: string): Promise<Quote | null>
}
