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
    cik?: number | string
    facts?: Record<string, Record<string, { units?: Record<string, FactEntry[]> }>>
  }
  // SEC의 companyfacts는 cik를 회사에 따라 숫자로도, 0으로 패딩된 문자열로도 내려준다
  // (실측: CIK0001807794 Credo Technology → "cik": "0001807794", 문자열). 숫자만
  // 받아들이면 문자열 cik를 가진 응답 전체가 조용히 버려져 그 회사의 사실이 통째로
  // 사라진다 — 결함 리포트(companyfacts-cik-report.md) 참고. sec-submissions.ts의
  // parseSubmissions와 동일한 Number(String(...)) 패턴으로 두 형태를 모두 받아들인다.
  const cikRaw = root.cik
  const cik = cikRaw === undefined || cikRaw === null ? NaN : Number(String(cikRaw))
  if (!Number.isFinite(cik) || !root.facts) return []

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
        // null(확인된 404·신고 이력 없음)과 []( 응답은 200으로 왔지만 추적 태그가 하나도
        // 안 남은 경우)을 구분해서 반환한다 — 후자는 정상적으로는 거의 일어나지 않아야
        // 하므로 ingest-fundamentals가 이를 의심 신호로 잡 통계에 남긴다.
        if (e instanceof HttpError && e.status === 404) return null
        throw e
      }
    },
  }
}
