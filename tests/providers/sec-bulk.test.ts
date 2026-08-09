import { describe, it, expect } from 'vitest'
import { zipSync, strToU8 } from 'fflate'
import {
  parseSubLine,
  parseNumLine,
  extractFactsFromZip,
} from '@/providers/fundamental/sec-bulk'

const SUB_HEADER = ['adsh', 'cik', 'name', 'sic', 'form', 'period', 'fy', 'fp', 'filed']
const NUM_HEADER = ['adsh', 'tag', 'version', 'coreg', 'ddate', 'qtrs', 'uom', 'value', 'footnote']

describe('parseSubLine', () => {
  it('adsh·cik·form·filed를 뽑는다', () => {
    const line = '0001045810-25-000123\t1045810\tNVIDIA CORP\t3674\t10-Q\t20250430\t2026\tQ1\t20250528'
    expect(parseSubLine(line, SUB_HEADER)).toEqual({
      adsh: '0001045810-25-000123',
      cik: 1045810,
      form: '10-Q',
      filed: '2025-05-28',
    })
  })

  it('cik이 숫자가 아니면 null', () => {
    expect(parseSubLine('a\tzz\tn\t1\t10-K\t1\t1\tFY\t20250101', SUB_HEADER)).toBeNull()
  })
})

describe('parseNumLine', () => {
  it('수치 행을 파싱한다', () => {
    const line = '0001045810-25-000123\tRevenues\tus-gaap/2024\t\t20250430\t1\tUSD\t44060000000\t'
    expect(parseNumLine(line, NUM_HEADER)).toEqual({
      adsh: '0001045810-25-000123',
      tag: 'Revenues',
      ddate: '20250430',
      qtrs: 1,
      uom: 'USD',
      value: 44060000000,
      coreg: '',
    })
  })

  it('value가 비어 있으면 null', () => {
    const line = '0001045810-25-000123\tRevenues\tus-gaap/2024\t\t20250430\t1\tUSD\t\t'
    expect(parseNumLine(line, NUM_HEADER)).toBeNull()
  })
})

describe('extractFactsFromZip', () => {
  const sub = [
    SUB_HEADER.join('\t'),
    '0001045810-25-000123\t1045810\tNVIDIA CORP\t3674\t10-Q\t20250430\t2026\tQ1\t20250528',
    '0000000099-25-000001\t99\tOTHER CORP\t6022\t10-Q\t20250331\t2025\tQ1\t20250501',
  ].join('\n')

  const num = [
    NUM_HEADER.join('\t'),
    // 대상 CIK · 추적 태그 · 연결기준 → 채택
    '0001045810-25-000123\tRevenues\tus-gaap/2024\t\t20250430\t1\tUSD\t44060000000\t',
    // coreg가 있으면 자회사 단위이므로 제외
    '0001045810-25-000123\tRevenues\tus-gaap/2024\tSUBSID\t20250430\t1\tUSD\t1000\t',
    // 추적 대상이 아닌 태그는 제외
    '0001045810-25-000123\tSomeOtherTag\tus-gaap/2024\t\t20250430\t1\tUSD\t5\t',
    // USD가 아닌 단위(주식수 제외)는 제외
    '0001045810-25-000123\tGrossProfit\tus-gaap/2024\t\t20250430\t1\tEUR\t9\t',
    // 유니버스 밖 CIK는 제외
    '0000000099-25-000001\tRevenues\tus-gaap/2024\t\t20250331\t1\tUSD\t777\t',
    // 주식수는 shares 단위 허용
    '0001045810-25-000123\tWeightedAverageNumberOfDilutedSharesOutstanding\tus-gaap/2024\t\t20250430\t1\tshares\t24600000000\t',
  ].join('\n')

  const zip = Buffer.from(
    zipSync({ 'sub.txt': strToU8(sub), 'num.txt': strToU8(num) }),
  )

  it('유니버스 CIK와 추적 태그만 남긴다', async () => {
    const facts = await extractFactsFromZip(zip, new Set([1045810]))
    const keys = facts.map((f) => `${f.tag}:${f.unit}`)
    expect(keys).toContain('Revenues:USD')
    expect(keys).toContain('WeightedAverageNumberOfDilutedSharesOutstanding:shares')
    expect(keys).not.toContain('SomeOtherTag:USD')
    expect(keys).not.toContain('GrossProfit:EUR')
    expect(facts).toHaveLength(2)
  })

  it('sub.txt에서 form과 filed를 결합한다', async () => {
    const facts = await extractFactsFromZip(zip, new Set([1045810]))
    const rev = facts.find((f) => f.tag === 'Revenues')!
    expect(rev.cik).toBe(1045810)
    expect(rev.form).toBe('10-Q')
    expect(rev.filedDate).toBe('2025-05-28')
    expect(rev.periodEnd).toBe('2025-04-30')
    expect(rev.qtrs).toBe(1)
    expect(rev.value).toBe(44060000000)
    expect(rev.source).toBe('bulk')
    expect(rev.periodStart).toBeNull()
  })
})
