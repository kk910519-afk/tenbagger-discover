import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { createCompanyFactsProvider, parseCompanyFacts } from '@/providers/fundamental/sec-companyfacts'
import { TRACKED_TAGS } from '@/providers/fundamental/tags'
import { HttpError, type HttpClient } from '@/providers/http/client'

const raw = JSON.parse(readFileSync('tests/fixtures/companyfacts-mini.json', 'utf8'))
const facts = parseCompanyFacts(raw, TRACKED_TAGS)

describe('parseCompanyFacts', () => {
  it('추적 태그만 남긴다', () => {
    expect(facts.some((f) => f.tag === 'SomeUntrackedTag')).toBe(false)
  })

  it('us-gaap과 dei 네임스페이스를 모두 읽는다', () => {
    expect(facts.some((f) => f.tag === 'Revenues')).toBe(true)
    expect(facts.some((f) => f.tag === 'EntityCommonStockSharesOutstanding')).toBe(true)
  })

  it('start/end로 qtrs를 유도한다', () => {
    const q = facts.find((f) => f.tag === 'Revenues' && f.periodEnd === '2025-04-30')!
    expect(q.qtrs).toBe(1)
    const a = facts.find((f) => f.tag === 'Revenues' && f.periodEnd === '2025-01-26')!
    expect(a.qtrs).toBe(4)
  })

  it('start가 없는 시점 값은 qtrs=0', () => {
    const s = facts.find((f) => f.tag === 'EntityCommonStockSharesOutstanding')!
    expect(s.qtrs).toBe(0)
    expect(s.unit).toBe('shares')
  })

  it('cik·form·filed·accession을 보존하고 source는 api', () => {
    const q = facts.find((f) => f.tag === 'Revenues' && f.periodEnd === '2025-04-30')!
    expect(q.cik).toBe(1045810)
    expect(q.form).toBe('10-Q')
    expect(q.filedDate).toBe('2025-05-28')
    expect(q.accession).toBe('0001045810-25-000123')
    expect(q.source).toBe('api')
    expect(q.periodStart).toBe('2025-02-01')
  })
})

// 결함(companyfacts-cik-report.md): SEC companyfacts는 cik를 회사에 따라 숫자로도,
// 0으로 패딩된 문자열로도 내려준다 — 실측 확인(2026-08-10, 200 OK, 883KB):
// https://data.sec.gov/api/xbrl/companyfacts/CIK0001807794.json (Credo Technology)
// → "cik": "0001807794" (문자열). 숫자만 허용하면 이 응답 전체가 조용히 버려져
// financial_facts가 비어버린다 — apiFailed가 늘지 않으므로 에러 없이 그냥 사라진다.
// 아래 fixture는 그 응답 형태를 그대로 재현한다(같은 회사 데이터, cik만 문자열).
describe('parseCompanyFacts — cik가 문자열인 응답 (결함 회귀)', () => {
  const stringCikRaw = JSON.parse(
    readFileSync('tests/fixtures/companyfacts-mini-string-cik.json', 'utf8'),
  )
  const stringCikFacts = parseCompanyFacts(stringCikRaw, TRACKED_TAGS)

  it('cik가 문자열이어도 사실을 버리지 않는다', () => {
    expect(stringCikFacts.length).toBeGreaterThan(0)
    expect(stringCikFacts.some((f) => f.tag === 'Revenues')).toBe(true)
  })

  it('추출된 cik는 숫자다', () => {
    for (const f of stringCikFacts) expect(typeof f.cik).toBe('number')
    expect(stringCikFacts[0]!.cik).toBe(1045810)
  })

  it('문자열 cik 응답과 숫자 cik 응답이 동일한 사실 집합을 만든다 (회귀 방지)', () => {
    // 두 fixture는 cik 표현만 다르고 나머지는 동일하다 — 숫자 케이스가 실수로
    // 함께 깨지지 않았는지, 문자열 케이스만 통과시키는 특수 분기가 아닌지 확인한다.
    expect(stringCikFacts.length).toBe(facts.length)
    expect(stringCikFacts.map((f) => `${f.tag}:${f.periodEnd}:${f.value}`).sort()).toEqual(
      facts.map((f) => `${f.tag}:${f.periodEnd}:${f.value}`).sort(),
    )
  })

  it('숫자 cik 응답(기존 fixture)은 여전히 정상 파싱된다 (숫자 케이스 회귀 없음)', () => {
    expect(facts.length).toBeGreaterThan(0)
    expect(facts.every((f) => typeof f.cik === 'number' && f.cik === 1045810)).toBe(true)
  })
})

// createCompanyFactsProvider는 "확인된 404(신고 이력 없음, 정상)"와 "200 응답을
// 받았지만 추적 태그가 하나도 안 남은 경우(의심스러움 — 결함 재발 신호)"를 null과
// []로 구분해서 돌려줘야 한다. 두 경우를 섞으면 ingest-fundamentals가 apiEmptyParse로
// 셀 수 없다.
describe('createCompanyFactsProvider — 404와 빈 파싱 결과를 구분한다', () => {
  function fakeHttp(getJsonImpl: HttpClient['getJson']): HttpClient {
    return {
      getJson: getJsonImpl,
      getText: async () => { throw new Error('not used') },
      getBuffer: async () => { throw new Error('not used') },
    }
  }

  it('404는 null을 반환한다 (신고 이력 없는 CIK, 정상)', async () => {
    const http = fakeHttp(async () => { throw new HttpError('Not Found', 404) })
    const provider = createCompanyFactsProvider(http)
    expect(await provider.fetchCompany(9999999)).toBeNull()
  })

  it('200이지만 추적 태그가 없으면 빈 배열을 반환한다 (null이 아니다)', async () => {
    const http = fakeHttp(async () => ({ cik: 123, facts: { 'us-gaap': {} } }) as never)
    const provider = createCompanyFactsProvider(http)
    const result = await provider.fetchCompany(123)
    expect(result).not.toBeNull()
    expect(result).toEqual([])
  })

  it('cik가 문자열인 정상 응답은 사실 배열을 반환한다', async () => {
    const stringCikRaw = JSON.parse(
      readFileSync('tests/fixtures/companyfacts-mini-string-cik.json', 'utf8'),
    )
    const http = fakeHttp(async () => stringCikRaw as never)
    const provider = createCompanyFactsProvider(http)
    const result = await provider.fetchCompany(1045810)
    expect(result).not.toBeNull()
    expect(result!.length).toBeGreaterThan(0)
    expect(result!.every((f) => f.cik === 1045810)).toBe(true)
  })

  it('404가 아닌 에러는 그대로 던진다', async () => {
    const http = fakeHttp(async () => { throw new HttpError('Server Error', 500) })
    const provider = createCompanyFactsProvider(http)
    await expect(provider.fetchCompany(1)).rejects.toThrow(HttpError)
  })
})
