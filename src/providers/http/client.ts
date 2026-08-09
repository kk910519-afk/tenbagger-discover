import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'

export type FetchOpts = { cache?: boolean }

/**
 * HTTP 실패를 나타내는 에러. 메시지 문자열(한국어 포함)은 다른 모듈이 정규식으로
 * 파싱하기 쉬우므로, 상태코드로 분기해야 하는 호출자는 메시지 대신 `status`를 봐야 한다.
 */
export class HttpError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'HttpError'
    this.status = status
  }
}

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
          try {
            writeFileSync(tmpPath, buf)
            renameSync(tmpPath, path)
          } catch (e) {
            // Clean up temp file on write/rename failure to avoid orphans
            try {
              if (existsSync(tmpPath)) unlinkSync(tmpPath)
            } catch {}
            // Rethrow cache error
            throw e
          }
        }
        return buf
      }
      if (!RETRYABLE.has(res.status)) {
        throw new HttpError(`HTTP ${res.status} (재시도 불가): ${url}`, res.status)
      }
      lastError = new HttpError(`HTTP ${res.status}: ${url}`, res.status)
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
