import type { HttpClient } from '../http/client.js'
import type { PriceProvider, Quote } from '../types.js'

/** Finnhub /quote 응답: c=현재가, t=유닉스 초. 알 수 없는 심볼은 c=0을 반환한다. */
export function parseFinnhubQuote(raw: unknown): Quote | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as { c?: number; t?: number }
  if (typeof r.c !== 'number' || r.c <= 0) return null
  if (typeof r.t !== 'number' || r.t <= 0) return null
  return { price: r.c, date: new Date(r.t * 1000).toISOString().slice(0, 10) }
}

export function createFinnhubProvider(http: HttpClient, apiKey: string): PriceProvider {
  return {
    name: 'finnhub',
    async fetchQuote(ticker) {
      const url =
        `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(ticker)}` +
        `&token=${encodeURIComponent(apiKey)}`
      try {
        return parseFinnhubQuote(await http.getJson(url))
      } catch {
        return null
      }
    },
  }
}
