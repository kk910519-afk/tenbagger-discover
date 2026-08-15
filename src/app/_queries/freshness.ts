import type Database from 'better-sqlite3'

/**
 * 유니버스 전체의 "데이터가 언제 것인가". 잡을 언제 돌렸는지(job_runs)가 아니라
 * 저장된 데이터 자체의 시점을 읽는다 — 스코어 잡을 오늘 다시 돌려도 그 점수를 떠받치는
 * 주가는 며칠 전 것일 수 있고, 화면이 감춰선 안 되는 사실이 바로 그 격차다.
 */
export type DataFreshness = {
  /** 가장 최근 시세일(market_data.date). YYYY-MM-DD */
  priceDate: string | null
  /** 가장 최근 재무 정규화 시각(financials.computed_at). ISO 타임스탬프 */
  financialsAt: string | null
  /** 가장 최근 스코어 기준일(scores.as_of). YYYY-MM-DD */
  scoreAsOf: string | null
}

export function getDataFreshness(raw: Database.Database): DataFreshness {
  const one = (sql: string): string | null => {
    const row = raw.prepare(sql).get() as { v: string | null } | undefined
    return row?.v ?? null
  }

  return {
    priceDate: one('SELECT MAX(date) AS v FROM market_data'),
    financialsAt: one('SELECT MAX(computed_at) AS v FROM financials'),
    scoreAsOf: one('SELECT MAX(as_of) AS v FROM scores'),
  }
}
