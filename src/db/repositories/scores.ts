import type Database from 'better-sqlite3'
import type { Category, FactorResult, RedFlag } from '@/domain/types'

export type ScoreWrite = {
  cik: number
  asOf: string
  tenbagger: number | null
  completeness: number
  category: Category | null
  engineVersion: string
  factors: FactorResult[]
  percentiles: Record<string, number | null>
  flags: RedFlag[]
}

export function writeScores(raw: Database.Database, rows: ScoreWrite[]): void {
  const insScore = raw.prepare(
    `INSERT OR REPLACE INTO scores
       (cik, as_of, tenbagger, completeness, category, engine_version)
     VALUES (@cik, @asOf, @tenbagger, @completeness, @category, @engineVersion)`,
  )
  // score_factors와 red_flags는 회사당 여러 행을 가질 수 있어 INSERT OR REPLACE만으로는
  // 부족하다 — 이전 실행에서 있었지만 이번 실행에서 더 이상 나오지 않는 행(예: 이번엔
  // 해소된 Red Flag)이 PK 불일치로 그대로 남아버린다. 같은 (cik, as_of)를 다시 쓸 때
  // 진짜 "교체"가 되도록 먼저 지우고 다시 넣는다.
  const delFactors = raw.prepare(
    `DELETE FROM score_factors WHERE cik = @cik AND as_of = @asOf AND engine = 'tenbagger'`,
  )
  const delFlags = raw.prepare(`DELETE FROM red_flags WHERE cik = @cik AND as_of = @asOf`)
  const insFactor = raw.prepare(
    `INSERT OR REPLACE INTO score_factors
       (cik, as_of, engine, factor_key, raw, points, weight, status, percentile, detail)
     VALUES (@cik, @asOf, 'tenbagger', @key, @raw, @points, @weight, @status, @percentile, @detail)`,
  )
  const insFlag = raw.prepare(
    `INSERT OR REPLACE INTO red_flags (cik, as_of, code, severity, message, evidence)
     VALUES (@cik, @asOf, @code, @severity, @message, @evidence)`,
  )

  raw.transaction(() => {
    for (const r of rows) {
      delFactors.run({ cik: r.cik, asOf: r.asOf })
      delFlags.run({ cik: r.cik, asOf: r.asOf })
      insScore.run({
        cik: r.cik, asOf: r.asOf, tenbagger: r.tenbagger,
        completeness: r.completeness, category: r.category,
        engineVersion: r.engineVersion,
      })
      for (const f of r.factors) {
        insFactor.run({
          cik: r.cik, asOf: r.asOf, key: f.key, raw: f.raw, points: f.points,
          weight: f.weight, status: f.status,
          percentile: r.percentiles[f.key] ?? null, detail: f.detail,
        })
      }
      for (const flag of r.flags) {
        insFlag.run({
          cik: r.cik, asOf: r.asOf, code: flag.code, severity: flag.severity,
          message: flag.message, evidence: JSON.stringify(flag.evidence),
        })
      }
    }
  })()
}
