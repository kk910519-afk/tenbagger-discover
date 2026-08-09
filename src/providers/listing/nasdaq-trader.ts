import type { HttpClient } from '../http/client.js'
import type { Listing, ListingProvider } from '../types.js'

const URL = 'https://www.nasdaqtrader.com/dynamic/symdir/nasdaqtraded.txt'

/** 파이프 구분 파일. 첫 줄은 헤더, 마지막 줄은 "File Creation Time" 푸터. */
export function parseNasdaqTraded(raw: string): Listing[] {
  const out: Listing[] = []
  const lines = raw.split(/\r?\n/)
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!
    if (!line.trim()) continue
    if (line.startsWith('File Creation Time')) continue
    const f = line.split('|')
    if (f.length < 9) continue
    const roundLot = Number(f[6])
    out.push({
      ticker: f[1]!.trim(),
      exchange: f[3]!.trim(),
      securityName: f[2]!.trim(),
      isEtf: f[5]!.trim() === 'Y',
      isTestIssue: f[7]!.trim() === 'Y',
      financialStatus: f[8]!.trim() === '' ? null : f[8]!.trim(),
      roundLot: Number.isFinite(roundLot) ? roundLot : null,
    })
  }
  return out
}

export function createNasdaqTraderProvider(http: HttpClient): ListingProvider {
  return {
    async fetchListings() {
      return parseNasdaqTraded(await http.getText(URL, { cache: true }))
    },
  }
}
