import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHttpClient } from '@/providers/http/client'
import { parseFinnhubQuote, createFinnhubProvider } from '@/providers/price/finnhub'
import { createFixtureProvider } from '@/providers/price/fixture'
import { getPriceProvider } from '@/providers/price'

const cacheDir = () => mkdtempSync(join(tmpdir(), 'tb-price-'))

describe('parseFinnhubQuote', () => {
  it('현재가와 타임스탬프를 읽는다', () => {
    // t=1786132800은 2026-08-07 20:00 UTC = 미 동부 16:00, 즉 금요일 정규장 마감
    // 시각이다(실제 Finnhub 응답에서 채취). 파서는 UTC 달력 날짜로 버킷팅하므로
    // 결과는 '2026-08-07'이다 — '08-09'(일요일)가 아니다.
    expect(parseFinnhubQuote({ c: 223.96, h: 1, l: 1, o: 1, pc: 1, t: 1786132800 }))
      .toEqual({ price: 223.96, date: '2026-08-07' })
  })

  it('c가 0이면 null — 알 수 없는 심볼', () => {
    expect(parseFinnhubQuote({ c: 0, t: 1786132800 })).toBeNull()
  })

  it('형식이 다르면 null', () => {
    expect(parseFinnhubQuote({})).toBeNull()
    expect(parseFinnhubQuote(null)).toBeNull()
  })
})

describe('createFinnhubProvider', () => {
  it('토큰을 쿼리에 붙이고 시세를 반환한다', async () => {
    let seenUrl = ''
    const http = createHttpClient({
      userAgent: 'x', rateLimitPerSec: 1000, cacheDir: cacheDir(),
      fetchImpl: async (url) => {
        seenUrl = String(url)
        return new Response(JSON.stringify({ c: 50, t: 1786132800 }), { status: 200 })
      },
    })
    const p = createFinnhubProvider(http, 'KEY123')
    // t=1786132800: 금요일(2026-08-07) 16:00 ET 마감 — 위 parseFinnhubQuote 테스트 참고.
    expect(await p.fetchQuote('NVDA')).toEqual({ price: 50, date: '2026-08-07' })
    expect(seenUrl).toContain('symbol=NVDA')
    expect(seenUrl).toContain('token=KEY123')
  })
})

describe('createFixtureProvider', () => {
  const p = createFixtureProvider('tests/fixtures/prices.json')

  it('픽스처 가격을 반환한다', async () => {
    expect(await p.fetchQuote('NVDA')).toEqual({ price: 223.96, date: '2026-08-08' })
  })

  it('없는 티커는 null', async () => {
    expect(await p.fetchQuote('NOPE')).toBeNull()
  })
})

describe('getPriceProvider', () => {
  const http = createHttpClient({
    userAgent: 'x', rateLimitPerSec: 1000, cacheDir: cacheDir(),
    fetchImpl: async () => new Response('{}', { status: 200 }),
  })

  it('PRICE_PROVIDER=fixture면 픽스처를 쓴다', () => {
    expect(getPriceProvider(http, { PRICE_PROVIDER: 'fixture' }).name).toBe('fixture')
  })

  it('PRICE_PROVIDER=finnhub이고 키가 있으면 finnhub', () => {
    expect(
      getPriceProvider(http, { PRICE_PROVIDER: 'finnhub', FINNHUB_API_KEY: 'k' }).name,
    ).toBe('finnhub')
  })

  it('finnhub인데 키가 없으면 명확한 에러를 던진다', () => {
    expect(() => getPriceProvider(http, { PRICE_PROVIDER: 'finnhub' }))
      .toThrow(/FINNHUB_API_KEY/)
  })

  it('알 수 없는 값이면 에러', () => {
    expect(() => getPriceProvider(http, { PRICE_PROVIDER: 'yahoo' })).toThrow(/yahoo/)
  })
})
