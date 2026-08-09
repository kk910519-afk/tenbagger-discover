import { HttpError, type HttpClient } from '../http/client.js'
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
  // Number()는 "0001045810" 같은 선행 0이 붙은 문자열도 그대로 1045810으로 파싱한다
  // (10진수 문자열 변환이라 8진수 리터럴 규칙이 적용되지 않는다) — 별도 strip이 불필요하다.
  const cik = Number(String(cikRaw))
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
        // 메시지 문자열이 아니라 HttpError.status로 판정한다 — client.ts의 메시지 문구가
        // 바뀌어도(예: 한국어 텍스트 리워딩) 이 분기가 조용히 깨지지 않도록 하기 위함.
        if (e instanceof HttpError && e.status === 404) return null
        throw e
      }
    },
  }
}
