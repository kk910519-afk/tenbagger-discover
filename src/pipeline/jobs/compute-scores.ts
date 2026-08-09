import { createHash } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { AppConfig } from '@/config'
import type { Taxonomy } from '@/taxonomy'
import { percentileOf } from '@/domain/stats'
import { evaluateQuality } from '@/engines/quality'
import { scoreTenbagger, ENGINE_VERSION } from '@/engines/tenbagger'
import { classifyAll } from '@/engines/classify'
import {
  computeFairValue,
  computePriceToFairValue,
  computeMoatSignal,
  computeUncertainty,
  ENGINE_VERSION as VALUATION_ENGINE_VERSION,
} from '@/engines/valuation'
import { buildSnapshots } from '@/pipeline/snapshot'
import { writeScores, type ScoreWrite } from '@/db/repositories/scores'
import { writeValuations, type ValuationWrite } from '@/db/repositories/valuations'
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

// valuation 엔진은 tenbagger와 완전히 다른 축(가격이 싼가)을 채점하므로 별도의 버전
// 이력을 갖는다 — tenbagger의 곡선을 조정해도 valuation의 engine_version은 바뀌지
// 않아야 하고, 그 반대도 마찬가지다. 두 엔진을 하나의 해시로 묶으면 "성장 채점 규칙이
// 바뀌었다"와 "밸류에이션 가정이 바뀌었다"를 구분할 수 없게 된다.
export function valuationConfigHash(cfg: AppConfig): string {
  return createHash('sha256').update(JSON.stringify(cfg.valuation)).digest('hex').slice(0, 8)
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
    const valuationEngineVersion = `${VALUATION_ENGINE_VERSION}+${valuationConfigHash(cfg)}`

    const rows: ScoreWrite[] = []
    const valuationRows: ValuationWrite[] = []
    let redFlagged = 0
    let insufficient = 0
    let fairValued = 0

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

      // Tenbagger 엔진("이 회사가 얼마나 성장할 잠재력을 가졌는가")과는 완전히 다른
      // 축("지금 이 가격이 매력적인가")이다 — 두 축은 절대 하나의 숫자로 합치지 않는다.
      const fairValue = computeFairValue(s, cfg)
      const priceToFairValue = computePriceToFairValue(fairValue, s.price, cfg)
      const moat = computeMoatSignal(s, cfg)
      const uncertainty = computeUncertainty(s, cfg)

      if (fairValue.status === 'OK') fairValued++

      valuationRows.push({
        cik: s.cik, asOf, fairValue, priceToFairValue, moat, uncertainty,
        engineVersion: valuationEngineVersion,
      })
    }

    writeScores(raw, rows)
    writeValuations(raw, valuationRows)

    return {
      scored: rows.length,
      redFlagged,
      insufficient,
      fairValued,
      engineVersion,
      valuationEngineVersion,
    }
  })
}
