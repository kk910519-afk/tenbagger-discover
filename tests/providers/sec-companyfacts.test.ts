import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseCompanyFacts } from '@/providers/fundamental/sec-companyfacts'
import { TRACKED_TAGS } from '@/providers/fundamental/tags'

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
