import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type Database from 'better-sqlite3'
import { getRawDb, runMigrations } from '@/db/client'
import { runJob } from '@/pipeline/runner'
import * as jobs from '@/db/repositories/jobs'

/**
 * `runJob`의 두 경로 모두에서 `finishJob`(기록)의 실패가 잡의 **실제 결과**를
 * 바꿔서는 안 된다. 성공 경로의 가드가 없던 시절에는 `finishJob`이 던지면
 * 아래 셋이 한꺼번에 일어났다 — 성공한 잡이 `failed`로 기록되고, 호출자에게는
 * 잡이 던진 것처럼 보이며, stats가 사라졌다.
 */
describe('runJob — job_runs 기록 실패가 잡 결과를 바꾸지 않는다', () => {
  let raw: Database.Database

  beforeEach(() => {
    raw = getRawDb(':memory:')
    runMigrations(raw)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    raw.close()
  })

  function lastRun(): { status: string; stats: string | null; error: string | null } | undefined {
    return raw
      .prepare('SELECT status, stats, error FROM job_runs ORDER BY id DESC LIMIT 1')
      .get() as { status: string; stats: string | null; error: string | null } | undefined
  }

  it('정상 경로 — succeeded와 stats를 기록하고 stats를 돌려준다', async () => {
    const stats = await runJob(raw, 'fundamentals', async () => ({ normalized: 7 }))
    expect(stats).toEqual({ normalized: 7 })
    const row = lastRun()
    expect(row?.status).toBe('succeeded')
    expect(JSON.parse(row?.stats ?? 'null')).toEqual({ normalized: 7 })
  })

  it('성공 경로에서 finishJob이 던져도 stats를 그대로 돌려준다 (사라지지 않는다)', async () => {
    vi.spyOn(jobs, 'finishJob').mockImplementation(() => {
      throw new Error('SQLITE_BUSY: database is locked')
    })
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})

    // 가드 이전 동작: 이 호출은 SQLITE_BUSY를 던졌고 stats는 사라졌다.
    const stats = await runJob(raw, 'fundamentals', async () => ({ normalized: 7, apiFacts: 42 }))
    expect(stats).toEqual({ normalized: 7, apiFacts: 42 })

    // 조용하지 않다 — 무엇이 성공했고 무엇이 실패했는지 로그에 남는다.
    expect(errorLog).toHaveBeenCalledTimes(1)
    const message = String(errorLog.mock.calls[0]?.[0] ?? '')
    expect(message).toContain('fundamentals')
    expect(message).toContain('succeeded')
    expect(message).toContain('finishJob')
  })

  it('성공 경로에서 finishJob이 던져도 성공한 잡을 failed로 기록하지 않는다', async () => {
    vi.spyOn(jobs, 'finishJob').mockImplementation(() => {
      throw new Error('SQLITE_BUSY: database is locked')
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await runJob(raw, 'fundamentals', async () => ({ normalized: 7 }))

    // 가드 이전 동작: catch가 finishJob 에러를 받아 같은 잡을 'failed'로 다시 적었고,
    // job_runs.error에는 잡의 에러가 아니라 SQLITE_BUSY가 남았다.
    const row = lastRun()
    expect(row?.status, "성공한 잡이 'failed'로 기록됐다").not.toBe('failed')
    expect(row?.error, 'job_runs.error에 기록 계층의 에러가 새어 들어갔다').toBeNull()
  })

  it('실패 경로 — 원래 에러를 던지고 finishJob 실패가 그것을 가리지 않는다', async () => {
    vi.spyOn(jobs, 'finishJob').mockImplementation(() => {
      throw new Error('SQLITE_BUSY: database is locked')
    })
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(
      runJob(raw, 'fundamentals', async () => {
        throw new Error('정규화 실패율 임계 초과')
      }),
    ).rejects.toThrow('정규화 실패율 임계 초과')

    expect(String(errorLog.mock.calls[0]?.[0] ?? '')).toContain('failed')
  })

  it('실패 경로 — finishJob이 정상이면 failed와 원래 에러를 기록한다', async () => {
    await expect(
      runJob(raw, 'fundamentals', async () => {
        throw new Error('정규화 실패율 임계 초과')
      }),
    ).rejects.toThrow('정규화 실패율 임계 초과')

    const row = lastRun()
    expect(row?.status).toBe('failed')
    expect(row?.stats).toBeNull()
    expect(row?.error).toContain('정규화 실패율 임계 초과')
  })
})
