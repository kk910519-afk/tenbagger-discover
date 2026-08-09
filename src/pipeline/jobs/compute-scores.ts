import { createHash } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { AppConfig } from '@/config'
import type { Taxonomy } from '@/taxonomy'
import { percentileOf } from '@/domain/stats'
import { evaluateQuality } from '@/engines/quality'
import { scoreTenbagger, ENGINE_VERSION } from '@/engines/tenbagger'
import { classifyAll } from '@/engines/classify'
import { buildSnapshots } from '@/pipeline/snapshot'
import { writeScores, type ScoreWrite } from '@/db/repositories/scores'
import { runJob, type JobStats } from '@/pipeline/runner'

/** 팩터 키 → IndustryStats.distributions 키. 없는 팩터는 백분위를 저장하지 않는다. */
const PERCENTILE_SOURCE: Record<string, string> = {
  revenue_growth: 'revenue_growth',
  revenue_acceleration: 'revenue_acceleration',
  gross_margin: 'gross_margin',
  market_cap_opportunity: 'market_cap',
}

// engine_version은 "회사가 바뀌었나"와 "채점 규칙이 바뀌었나"를 구분하기 위한 필드다.
// scoring/classification 밖의 설정(ingest, universe, staleness 등)이 바뀌어도 점수 산출
// 로직 자체는 그대로이므로, 그런 변경까지 해시에 섞으면 "규칙이 바뀌었다"는 잘못된
// 신호를 점수 이력에 남기게 된다. category는 classification에서 나오므로 함께 포함한다.
export function configHash(cfg: AppConfig): string {
  const scored = { scoring: cfg.scoring, classification: cfg.classification }
  return createHash('sha256').update(JSON.stringify(scored)).digest('hex').slice(0, 8)
}

export type ScoreDeps = {
  raw: Database.Database
  cfg: AppConfig
  taxonomy: Taxonomy
  asOf: string
}

export async function computeScores(deps: ScoreDeps): Promise<JobStats> {
  const { raw, cfg, taxonomy, asOf } = deps

  return runJob(raw, 'scores', async () => {
    const snapshots = buildSnapshots({ raw, taxonomy, cfg, asOf })
    const categories = classifyAll(snapshots, cfg)
    const engineVersion = `${ENGINE_VERSION}+${configHash(cfg)}`

    const rows: ScoreWrite[] = []
    let redFlagged = 0
    let insufficient = 0

    for (const s of snapshots) {
      // 순서 고정: Quality Gate 먼저, Tenbagger 엔진 나중. market_cap_opportunity 팩터가
      // WARNING 등급 Red Flag를 게이트 배수 산정에 참조하므로 뒤집으면 게이트가 조용히
      // 사라진다.
      const flags = evaluateQuality(s, cfg)
      const result = scoreTenbagger(s, cfg, flags)

      const percentiles: Record<string, number | null> = {}
      for (const f of result.factors) {
        const key = PERCENTILE_SOURCE[f.key]
        if (!key || f.raw === null) continue
        const dist = s.industryStats.distributions[key]
        if (!dist || dist.length < cfg.scoring.min_industry_candidates) continue
        percentiles[f.key] = percentileOf(dist, f.raw)
      }

      if (flags.some((f) => f.severity === 'CRITICAL')) redFlagged++
      if (result.completeness < cfg.scoring.min_completeness) insufficient++

      rows.push({
        cik: s.cik, asOf, tenbagger: result.score,
        completeness: result.completeness,
        category: categories.get(s.cik) ?? null,
        engineVersion, factors: result.factors, percentiles, flags,
      })
    }

    writeScores(raw, rows)

    return {
      scored: rows.length,
      redFlagged,
      insufficient,
      engineVersion,
    }
  })
}
