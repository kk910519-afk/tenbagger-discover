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
// 그러므로 해시가 덮어야 할 범위는 "그 엔진이 실제로 읽는 설정 전부"이고, 그 밖은
// 하나도 포함하면 안 된다. 빠뜨리면 잣대가 바뀌었는데 버전이 그대로여서 점수 이력이
// 그 변화를 회사 탓으로 돌리고, 넘치면 무관한 설정 변경이 "규칙이 바뀌었다"는 잘못된
// 신호를 남긴다.
//
// tenbagger가 읽는 것: scoring(모든 팩터 곡선·가중치·공용 상수), classification(category가
// 여기서 나온다), 그리고 quality_gate — market_cap_opportunity의 게이트 배수가
// evaluateQuality가 만든 WARNING 등급 Red Flag를 참조하므로, dilution_warning 같은
// 임계값 하나가 그 팩터의 점수를 절반으로 만든다. ingest·universe·staleness는 점수 산출
// 로직에 들어가지 않으므로 제외한다.
export function configHash(cfg: AppConfig): string {
  const scored = {
    scoring: cfg.scoring,
    classification: cfg.classification,
    quality_gate: cfg.quality_gate,
  }
  return createHash('sha256').update(JSON.stringify(scored)).digest('hex').slice(0, 8)
}

// valuation 엔진은 tenbagger와 완전히 다른 축(가격이 싼가)을 채점하므로 별도의 버전
// 이력을 갖는다 — tenbagger의 곡선을 조정해도 valuation의 engine_version은 바뀌지
// 않아야 하고, 그 반대도 마찬가지다. 두 엔진을 하나의 해시로 묶으면 "성장 채점 규칙이
// 바뀌었다"와 "밸류에이션 가정이 바뀌었다"를 구분할 수 없게 된다.
//
// 다만 valuation 엔진은 cfg.valuation만 읽지 않는다. 아래 다섯 값은 scoring 아래에 있지만
// 이 엔진이 직접 읽으며, 하나만 바뀌어도 모든 fair_value_per_share·valuation_status·
// moat_signal·uncertainty_score가 움직인다. 그래서 scoring 전체가 아니라 **실제로 읽는
// 부분집합**을 해시에 넣는다 — gross_margin 곡선을 손봤다고 밸류에이션 버전이 올라가면
// 축 분리가 무너진다.
export function valuationConfigHash(cfg: AppConfig): string {
  const s = cfg.scoring
  const read = {
    valuation: cfg.valuation,
    // DCF 할인율이자 Moat의 자본비용 문턱
    wacc_assumption: s.wacc_assumption,
    // ROIC의 NOPAT 세율이자 nopat_proxy 마진의 세율
    tax_rate: s.tax_rate,
    // ROIC 분모의 유효성 하한 (Moat)
    min_invested_capital_ratio: s.min_invested_capital_ratio,
    // 모든 예측의 초기 성장률 혼합 비중
    revenue_growth_blend: s.factors.revenue_growth.blend,
    // financial_leverage 불확실성 드라이버가 그대로 재사용하는 곡선
    balance_sheet_leverage_curve: s.factors.balance_sheet.leverage_curve,
  }
  return createHash('sha256').update(JSON.stringify(read)).digest('hex').slice(0, 8)
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
