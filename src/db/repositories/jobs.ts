import type Database from 'better-sqlite3'

export type JobStats = Record<string, number | string | string[]>

export function startJob(raw: Database.Database, job: string): number {
  const info = raw
    .prepare("INSERT INTO job_runs (job, started_at, status) VALUES (?, ?, 'running')")
    .run(job, new Date().toISOString())
  return Number(info.lastInsertRowid)
}

export function finishJob(
  raw: Database.Database,
  id: number,
  status: 'succeeded' | 'failed',
  stats: JobStats | null,
  error: string | null,
): void {
  raw
    .prepare('UPDATE job_runs SET finished_at = ?, status = ?, stats = ?, error = ? WHERE id = ?')
    .run(new Date().toISOString(), status, stats ? JSON.stringify(stats) : null, error, id)
}
