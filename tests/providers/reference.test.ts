import { describe, it, expect } from 'vitest'
import { readFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseTickerMap, parseSubmissions, createSecReferenceProvider } from '@/providers/reference/sec-submissions'
import { createHttpClient } from '@/providers/http/client'

function tmpCache() {
  return mkdtempSync(join(tmpdir(), 'tb-ref-'))
}

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
    expect(c.stateOfIncorporation).toBe('DE')
    expect(c.stateOfIncorporationDescription).toBe('DE')
  })

  it('설립 주 정보가 빈 문자열이면(신고서에 미기재) null로 정규화한다', () => {
    const { stateOfIncorporation, stateOfIncorporationDescription, ...rest } = raw
    expect(
      parseSubmissions({ ...rest, stateOfIncorporation: '', stateOfIncorporationDescription: '' })!
        .stateOfIncorporation,
    ).toBeNull()
    expect(
      parseSubmissions({ ...rest, stateOfIncorporation: '', stateOfIncorporationDescription: '' })!
        .stateOfIncorporationDescription,
    ).toBeNull()
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

describe('createSecReferenceProvider().fetchCompany', () => {
  it('404는 상장폐지/합병 등으로 흔히 발생하므로 null을 반환하고 잡을 중단시키지 않는다', async () => {
    const http = createHttpClient({
      userAgent: 'x',
      rateLimitPerSec: 1000,
      cacheDir: tmpCache(),
      fetchImpl: async () => new Response('not found', { status: 404 }),
      sleepImpl: async () => {},
    })
    const provider = createSecReferenceProvider(http)
    await expect(provider.fetchCompany(9999999)).resolves.toBeNull()
  })

  it('404 이외의 에러(예: 500)는 그대로 다시 던진다', async () => {
    const http = createHttpClient({
      userAgent: 'x',
      rateLimitPerSec: 1000,
      cacheDir: tmpCache(),
      maxRetries: 0,
      fetchImpl: async () => new Response('boom', { status: 500 }),
      sleepImpl: async () => {},
    })
    const provider = createSecReferenceProvider(http)
    await expect(provider.fetchCompany(1045810)).rejects.toThrow(/500/)
  })
})
