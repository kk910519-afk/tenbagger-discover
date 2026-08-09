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
  fetchCompany(cik: number): Promise<RawFact[]>
}
