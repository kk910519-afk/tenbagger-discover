import type Database from 'better-sqlite3'
import { startJob, finishJob, type JobStats } from '@/db/repositories/jobs'

export type { JobStats }

/**
 * `job_runs` 기록이 실패했을 때 남기는 로그. **잡 자체의 결과와 기록의 실패를
 * 절대 뒤섞지 않는다** — 어느 쪽이 실패했는지 메시지에서 바로 읽히게 한다.
 */
function logFinishFailure(
  name: string,
  outcome: 'succeeded' | 'failed',
  detail: string,
  finishError: unknown,
): void {
  console.error(
    `runJob: job "${name}" ${outcome} but finishJob() threw while recording it — ` +
    `job_runs row left unfinished. Job outcome (${detail}) is authoritative.`,
    finishError,
  )
}

/**
 * 잡 실행을 job_runs에 기록한다. 예외는 기록 후 다시 던진다.
 *
 * **두 경로 모두에서 `finishJob`은 부수적이다.** 잡이 실제로 무엇을 했는지가
 * 권위 있는 결과이고, 그것을 `job_runs`에 적는 일은 기록일 뿐이다. 기록이
 * 실패했다고 결과를 바꿔 보고하면 조용히 틀린 값을 내보내는 것과 같다 —
 * 방향만 다를 뿐 두 경로에서 똑같이 그렇다.
 *
 *  - 실패 경로: 기록 실패가 **원래 에러를 가려서는** 안 된다.
 *  - 성공 경로: 기록 실패가 **성공한 잡을 실패로 둔갑시키고 그 stats를 지워서는**
 *    안 된다. 가드가 없던 시절의 동작이 정확히 그랬다 — `finishJob`이 던지면
 *    아래 catch가 그 에러를 받아 같은 잡을 `status='failed'`로 다시 적고(성공한
 *    실행이 실패로 기록된다), 호출자에게는 잡이 던진 것처럼 보이며(파이프라인이
 *    비정상 종료한다), 반환됐어야 할 stats는 사라진다. 게다가 `job_runs.error`에
 *    남는 것은 잡의 에러가 아니라 SQLITE_BUSY 같은 **기록 계층의 에러**라서,
 *    나중에 원인을 추적하는 사람은 존재하지도 않은 잡 실패를 쫓게 된다.
 *
 * 그래서 두 경로 모두 기록 실패는 삼키되 **조용하지 않게**(원인과 잡 결과를 함께
 * 로그로) 남기고, 잡의 실제 결과를 그대로 내보낸다.
 */
export async function runJob(
  raw: Database.Database,
  name: string,
  fn: () => Promise<JobStats>,
): Promise<JobStats> {
  const id = startJob(raw, name)
  let stats: JobStats
  try {
    stats = await fn()
  } catch (e) {
    // The original error `e` is the one that matters — it's what actually broke the
    // job. Recording it in job_runs is best-effort: if finishJob itself throws (e.g.
    // SQLITE_BUSY, a locked db, a disk error), that secondary failure must not replace
    // `e`. Swallow it (logged, not silent) and rethrow the original regardless.
    try {
      finishJob(raw, id, 'failed', null, e instanceof Error ? e.stack ?? e.message : String(e))
    } catch (finishError) {
      logFinishFailure(name, 'failed', e instanceof Error ? e.message : String(e), finishError)
    }
    throw e
  }
  // 성공 경로도 같은 규칙을 따른다 — 여기서 던지면 위 catch가 받아 성공을 실패로
  // 바꿔 기록하던 것이 이 함수의 알려진 결함이었다. try 블록 밖에서 호출해야
  // 그 되먹임 자체가 구조적으로 불가능해진다.
  try {
    finishJob(raw, id, 'succeeded', stats, null)
  } catch (finishError) {
    logFinishFailure(name, 'succeeded', JSON.stringify(stats), finishError)
  }
  return stats
}
