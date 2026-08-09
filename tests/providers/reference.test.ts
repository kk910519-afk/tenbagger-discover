import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseTickerMap, parseSubmissions } from '@/providers/reference/sec-submissions'

describe('parseTickerMap', () => {
  it('객체 맵을 배열로 변환한다', () => {
    const raw = JSON.parse(readFileSync('tests/fixtures/company_tickers.json', 'utf8'))
    const rows = parseTickerMap(raw)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toEqual({ cik: 1045810, ticker: 'NVDA', title: 'NVIDIA CORP' })
  })
})

describe('parseSubmissions', () => {
  const raw = JSON.parse(readFileSync('tests/fixtures/submissions-nvda.json', 'utf8'))

  it('SIC와 메타데이터를 추출한다', () => {
    const c = parseSubmissions(raw)!
    expect(c.cik).toBe(1045810)
    expect(c.sic).toBe('3674')
    expect(c.entityType).toBe('operating')
    expect(c.exchanges).toEqual(['Nasdaq'])
    expect(c.fiscalYearEnd).toBe('0131')
    expect(c.filerCategory).toBe('Large accelerated filer')
  })

  it('CIK 문자열의 앞자리 0을 제거한다', () => {
    expect(parseSubmissions({ ...raw, cik: '0000320193' })!.cik).toBe(320193)
  })

  it('SIC가 없으면 null', () => {
    const { sic, ...rest } = raw
    expect(parseSubmissions(rest)!.sic).toBeNull()
  })

  it('cik이 없으면 null을 반환한다', () => {
    const { cik, ...rest } = raw
    expect(parseSubmissions(rest)).toBeNull()
  })
})
