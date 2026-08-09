import { HttpError, type HttpClient } from '../http/client.js'
import type { CompanyFactsProvider, RawFact } from '../types.js'
import { TRACKED_TAGS } from './tags.js'

function factsUrl(cik: number): string {
  return `https://data.sec.gov/api/xbrl/companyfacts/CIK${String(cik).padStart(10, '0')}.json`
}

const DAY_MS = 86_400_000

/** start~end 일수로 기간 길이(분기 수)를 유도한다. start가 없으면 시점 값(0). */
function deriveQtrs(start: string | undefined, end: string): number {
  if (!start) return 0
  const days = (Date.parse(end) - Date.parse(start)) / DAY_MS
  if (!Number.isFinite(days) || days <= 0) return 0
  return Math.max(1, Math.round(days / 91.31))
}

type FactEntry = {
  start?: string; end?: string; val?: number
  form?: string; filed?: string; accn?: string
}

export function parseCompanyFacts(raw: unknown, tags: Set<string>): RawFact[] {
  const root = raw as {
    cik?: number
    facts?: Record<string, Record<string, { units?: Record<string, FactEntry[]> }>>
  }
  const cik = root.cik
  if (typeof cik !== 'number' || !root.facts) return []

  const out: RawFact[] = []
  for (const namespace of Object.values(root.facts)) {
    for (const [tag, concept] of Object.entries(namespace)) {
      if (!tags.has(tag)) continue
      for (const [unit, entries] of Object.entries(concept.units ?? {})) {
        for (const e of entries) {
          if (typeof e.val !== 'number' || !e.end || !e.form || !e.filed || !e.accn) continue
          out.push({
            cik,
            tag,
            unit,
            periodStart: e.start ?? null,
            periodEnd: e.end,
            qtrs: deriveQtrs(e.start, e.end),
            value: e.val,
            form: e.form,
            filedDate: e.filed,
            accession: e.accn,
            source: 'api',
          })
        }
      }
    }
  }
  return out
}

export function createCompanyFactsProvider(http: HttpClient): CompanyFactsProvider {
  return {
    async fetchCompany(cik) {
      try {
        return parseCompanyFacts(await http.getJson(factsUrl(cik), { cache: false }), TRACKED_TAGS)
      } catch (e) {
        // XBRL 신고 이력이 없는 CIK는 404. 잡 전체를 중단시키지 않는다.
        // 메시지 문자열이 아니라 HttpError.status로 판정한다 (sec-submissions.ts와 동일한 패턴).
        if (e instanceof HttpError && e.status === 404) return []
        throw e
      }
    },
  }
}
