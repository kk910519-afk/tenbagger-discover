import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'

export type FetchOpts = { cache?: boolean }

export type HttpClient = {
  getText(url: string, o?: FetchOpts): Promise<string>
  getJson<T>(url: string, o?: FetchOpts): Promise<T>
  getBuffer(url: string, o?: FetchOpts): Promise<Buffer>
}

export type HttpClientOptions = {
  userAgent: string
  rateLimitPerSec: number
  cacheDir: string
  maxRetries?: number
  /** 테스트 전용 주입 */
  fetchImpl?: typeof fetch
  /** 테스트 전용 주입 */
  sleepImpl?: (ms: number) => Promise<void>
}

const RETRYABLE = new Set([408, 429, 500, 502, 503, 504])

export function createHttpClient(opts: HttpClientOptions): HttpClient {
  const doFetch = opts.fetchImpl ?? fetch
  const sleep = opts.sleepImpl ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))
  const maxRetries = opts.maxRetries ?? 4
  const minIntervalMs = 1000 / opts.rateLimitPerSec

  mkdirSync(opts.cacheDir, { recursive: true })
  let nextSlotAt = 0

  function cachePath(url: string): string {
    const hash = createHash('sha256').update(url).digest('hex').slice(0, 32)
    return join(opts.cacheDir, `${hash}.bin`)
  }

  async function throttle(): Promise<void> {
    const now = Date.now()
    const slot = Math.max(now, nextSlotAt)
    nextSlotAt = slot + minIntervalMs
    const wait = slot - now
    if (wait > 0) await sleep(wait)
  }

  async function fetchBuffer(url: string, o?: FetchOpts): Promise<Buffer> {
    const path = cachePath(url)
    if (o?.cache && existsSync(path)) return readFileSync(path)

    let lastError: Error | null = null
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      await throttle()
      const res = await doFetch(url, {
        headers: { 'user-agent': opts.userAgent, 'accept-encoding': 'gzip, deflate' },
      })
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer())
        if (o?.cache) {
          const tmpPath = join(opts.cacheDir, `${randomBytes(8).toString('hex')}.tmp`)
          writeFileSync(tmpPath, buf)
          renameSync(tmpPath, path)
        }
        return buf
      }
      if (!RETRYABLE.has(res.status)) {
        throw new Error(`HTTP ${res.status} (재시도 불가): ${url}`)
      }
      lastError = new Error(`HTTP ${res.status}: ${url}`)
      if (attempt < maxRetries) await sleep(Math.min(2 ** attempt * 500, 8000))
    }
    throw lastError ?? new Error(`요청 실패: ${url}`)
  }

  return {
    getBuffer: fetchBuffer,
    async getText(url, o) {
      return (await fetchBuffer(url, o)).toString('utf8')
    },
    async getJson<T>(url: string, o?: FetchOpts): Promise<T> {
      const body = (await fetchBuffer(url, o)).toString('utf8')
      try {
        return JSON.parse(body) as T
      } catch (e) {
        const prefix = body.slice(0, 100)
        throw new Error(`JSON parse failed for ${url}: ${e instanceof Error ? e.message : String(e)} (body: ${prefix})`)
      }
    },
  }
}
