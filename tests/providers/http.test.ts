import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHttpClient } from '@/providers/http/client'

function tmpCache() {
  return mkdtempSync(join(tmpdir(), 'tb-http-'))
}

function okResponse(body: string) {
  return new Response(body, { status: 200 })
}

describe('createHttpClient', () => {
  it('User-Agent 헤더를 붙인다', async () => {
    let seenUa: string | null = null
    const client = createHttpClient({
      userAgent: 'TestAgent/1.0',
      rateLimitPerSec: 1000,
      cacheDir: tmpCache(),
      fetchImpl: async (_url, init) => {
        seenUa = new Headers(init?.headers).get('user-agent')
        return okResponse('hi')
      },
    })
    await client.getText('https://example.com/a')
    expect(seenUa).toBe('TestAgent/1.0')
  })

  it('rate limit 간격만큼 sleep을 호출한다', async () => {
    const sleeps: number[] = []
    const client = createHttpClient({
      userAgent: 'x',
      rateLimitPerSec: 10, // 최소 간격 100ms
      cacheDir: tmpCache(),
      fetchImpl: async () => okResponse('ok'),
      sleepImpl: async (ms) => { sleeps.push(ms) },
    })
    await client.getText('https://example.com/1')
    await client.getText('https://example.com/2')
    // 두 번째 호출은 간격을 채우기 위해 sleep해야 한다
    expect(sleeps.length).toBeGreaterThanOrEqual(1)
    expect(sleeps.some((s) => s > 0 && s <= 100)).toBe(true)
  })

  it('concurrent requests는 rate limit을 지킨다 (nextSlotAt 예약)', async () => {
    const sleeps: number[] = []
    const client = createHttpClient({
      userAgent: 'x',
      rateLimitPerSec: 10, // 100ms 간격
      cacheDir: tmpCache(),
      fetchImpl: async () => okResponse('ok'),
      sleepImpl: async (ms) => { sleeps.push(ms) },
    })
    // 5개의 요청을 동시에 시작
    await Promise.all([
      client.getText('https://example.com/1'),
      client.getText('https://example.com/2'),
      client.getText('https://example.com/3'),
      client.getText('https://example.com/4'),
      client.getText('https://example.com/5'),
    ])
    // 5번 요청했으므로, 4개의 slot 예약이 필요 (첫 번째는 wait=0)
    // sleep은 대략 [0 또는 없음, ~100, ~100, ~100]이어야 한다
    expect(sleeps.length).toBeGreaterThanOrEqual(3)
    // 모든 sleep이 같은 값이면 안 됨 (concurrent bug의 증상)
    const uniqueSleeps = new Set(sleeps)
    expect(uniqueSleeps.size).toBeGreaterThan(1) // 다양한 대기 시간이 있어야 함
  })

  it('429를 만나면 재시도하고 성공하면 값을 반환한다', async () => {
    let calls = 0
    const client = createHttpClient({
      userAgent: 'x',
      rateLimitPerSec: 1000,
      cacheDir: tmpCache(),
      maxRetries: 3,
      fetchImpl: async () => {
        calls++
        return calls < 3 ? new Response('slow down', { status: 429 }) : okResponse('done')
      },
      sleepImpl: async () => {},
    })
    expect(await client.getText('https://example.com/r')).toBe('done')
    expect(calls).toBe(3)
  })

  it('재시도를 소진하면 에러를 던진다', async () => {
    const client = createHttpClient({
      userAgent: 'x',
      rateLimitPerSec: 1000,
      cacheDir: tmpCache(),
      maxRetries: 2,
      fetchImpl: async () => new Response('boom', { status: 503 }),
      sleepImpl: async () => {},
    })
    await expect(client.getText('https://example.com/f')).rejects.toThrow(/503/)
  })

  it('404는 재시도하지 않고 즉시 던진다', async () => {
    let calls = 0
    const client = createHttpClient({
      userAgent: 'x',
      rateLimitPerSec: 1000,
      cacheDir: tmpCache(),
      maxRetries: 5,
      fetchImpl: async () => { calls++; return new Response('nope', { status: 404 }) },
      sleepImpl: async () => {},
    })
    await expect(client.getText('https://example.com/n')).rejects.toThrow(/404/)
    expect(calls).toBe(1)
  })

  it('cache: true면 두 번째 호출에서 네트워크를 타지 않는다', async () => {
    let calls = 0
    const client = createHttpClient({
      userAgent: 'x',
      rateLimitPerSec: 1000,
      cacheDir: tmpCache(),
      fetchImpl: async () => { calls++; return okResponse('cached-body') },
    })
    const url = 'https://example.com/c'
    expect(await client.getText(url, { cache: true })).toBe('cached-body')
    expect(await client.getText(url, { cache: true })).toBe('cached-body')
    expect(calls).toBe(1)
  })

  it('getJson은 파싱된 객체를 반환한다', async () => {
    const client = createHttpClient({
      userAgent: 'x',
      rateLimitPerSec: 1000,
      cacheDir: tmpCache(),
      fetchImpl: async () => okResponse('{"a":1}'),
    })
    expect(await client.getJson<{ a: number }>('https://example.com/j')).toEqual({ a: 1 })
  })

  it('getJson은 파싱 실패 시 URL을 포함한 에러를 던진다', async () => {
    const client = createHttpClient({
      userAgent: 'x',
      rateLimitPerSec: 1000,
      cacheDir: tmpCache(),
      fetchImpl: async () => okResponse('<html>error</html>'),
    })
    await expect(client.getJson('https://example.com/bad')).rejects.toThrow(/example\.com\/bad/)
    await expect(client.getJson('https://example.com/bad')).rejects.toThrow(/body:/)
  })

  it('cache 파일은 원자적으로 기록된다 (tmp → rename)', async () => {
    const cacheDir = tmpCache()
    const client = createHttpClient({
      userAgent: 'x',
      rateLimitPerSec: 1000,
      cacheDir,
      fetchImpl: async () => okResponse('cached'),
    })
    const url = 'https://example.com/atomic'
    await client.getText(url, { cache: true })

    // 캐시 디렉토리에는 .bin 파일만 있고 .tmp 파일은 없어야 한다
    const fs = require('node:fs')
    const files = fs.readdirSync(cacheDir)
    const tmpFiles = files.filter((f: string) => f.endsWith('.tmp'))
    const binFiles = files.filter((f: string) => f.endsWith('.bin'))
    expect(tmpFiles).toHaveLength(0)
    expect(binFiles.length).toBeGreaterThan(0)
  })
})
