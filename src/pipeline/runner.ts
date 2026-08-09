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
    // The original error `e` is the one that matters — it's what actually broke the
    // job. Recording it in job_runs is best-effort: if finishJob itself throws (e.g.
    // SQLITE_BUSY, a locked db, a disk error), that secondary failure must not replace
    // `e`. Swallow it (logged, not silent) and rethrow the original regardless.
    try {
      finishJob(raw, id, 'failed', null, e instanceof Error ? e.stack ?? e.message : String(e))
    } catch (finishError) {
      console.error(`runJob: job "${name}" failed and finishJob() also failed while recording it`, finishError)
    }
    throw e
  }
}
