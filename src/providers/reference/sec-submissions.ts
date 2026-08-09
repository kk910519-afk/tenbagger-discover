import type { HttpClient } from '../http/client.js'
import type { CompanyReference, ReferenceProvider, TickerMapEntry } from '../types.js'

const TICKERS_URL = 'https://www.sec.gov/files/company_tickers.json'

function submissionsUrl(cik: number): string {
  return `https://data.sec.gov/submissions/CIK${String(cik).padStart(10, '0')}.json`
}

/** company_tickers.json은 {"0": {...}, "1": {...}} 형태의 객체 맵이다. */
export function parseTickerMap(raw: unknown): TickerMapEntry[] {
  const out: TickerMapEntry[] = []
  for (const v of Object.values(raw as Record<string, unknown>)) {
    const r = v as { cik_str?: number; ticker?: string; title?: string }
    if (typeof r.cik_str !== 'number' || !r.ticker) continue
    out.push({ cik: r.cik_str, ticker: r.ticker.trim(), title: r.title ?? '' })
  }
  return out
}

export function parseSubmissions(raw: unknown): CompanyReference | null {
  const r = raw as Record<string, unknown>
  const cikRaw = r.cik
  if (cikRaw === undefined || cikRaw === null) return null
  const cik = Number(String(cikRaw).replace(/^0+/, ''))
  if (!Number.isFinite(cik)) return null

  const str = (k: string): string | null => {
    const v = r[k]
    return typeof v === 'string' && v.length > 0 ? v : null
  }

  return {
    cik,
    name: str('name') ?? '',
    sic: str('sic'),
    sicDescription: str('sicDescription'),
    exchanges: Array.isArray(r.exchanges) ? (r.exchanges as string[]) : [],
    entityType: str('entityType'),
    fiscalYearEnd: str('fiscalYearEnd'),
    filerCategory: str('category'),
  }
}

export function createSecReferenceProvider(http: HttpClient): ReferenceProvider {
  return {
    async fetchTickerMap() {
      return parseTickerMap(await http.getJson(TICKERS_URL, { cache: true }))
    },
    async fetchCompany(cik) {
      try {
        return parseSubmissions(await http.getJson(submissionsUrl(cik), { cache: true }))
      } catch (e) {
        // 상장폐지 등으로 404가 나는 CIK가 존재한다. 잡 전체를 중단시키지 않는다.
        if (e instanceof Error && /HTTP 404/.test(e.message)) return null
        throw e
      }
    },
  }
}
