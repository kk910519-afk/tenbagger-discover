import type Database from 'better-sqlite3'
import { startJob, finishJob, type JobStats } from '@/db/repositories/jobs'

export type { JobStats }

/** 잡 실행을 job_runs에 기록한다. 예외는 기록 후 다시 던진다. */
export async function runJob(
  raw: Database.Database,
  name: string,
  fn: () => Promise<JobStats>,
): Promise<JobStats> {
  const id = startJob(raw, name)
  try {
    const stats = await fn()
    finishJob(raw, id, 'succeeded', stats, null)
    return stats
  } catch (e) {
    finishJob(raw, id, 'failed', null, e instanceof Error ? e.stack ?? e.message : String(e))
    throw e
  }
}
