import type { AppConfig } from '@/config'
import type { CompanySnapshot, FactorResult, RedFlag } from '@/domain/types'
import type { FactorContext, FactorFn } from './factor-utils.js'
import { revenueGrowthFactor } from './factors/revenue-growth.js'
import { revenueAccelerationFactor } from './factors/revenue-acceleration.js'
import { tamIndustryGrowthFactor } from './factors/tam-industry-growth.js'
import { grossMarginFactor } from './factors/gross-margin.js'
import { operatingLeverageFactor } from './factors/operating-leverage.js'
import { marketCapOpportunityFactor } from './factors/market-cap-opportunity.js'
import { competitiveAdvantageFactor } from './factors/competitive-advantage.js'
import { balanceSheetFactor } from './factors/balance-sheet.js'
import { institutionalInsiderFactor } from './factors/institutional-insider.js'

/** 팩터 구성이나 정규화 규칙을 바꾸면 반드시 올린다. scores.engine_version에 기록된다. */
export const ENGINE_VERSION = 'tenbagger-1.0.0'

const FACTORS: FactorFn[] = [
  revenueGrowthFactor,
  revenueAccelerationFactor,
  tamIndustryGrowthFactor,
  grossMarginFactor,
  operatingLeverageFactor,
  marketCapOpportunityFactor,
  competitiveAdvantageFactor,
  balanceSheetFactor,
  institutionalInsiderFactor,
]

export type TenbaggerResult = {
  score: number | null
  completeness: number
  factors: FactorResult[]
}

export function scoreTenbagger(
  snapshot: CompanySnapshot,
  cfg: AppConfig,
  flags: RedFlag[],
): TenbaggerResult {
  const ctx: FactorContext = { snapshot, cfg, flags }
  const factors = FACTORS.map((fn) => fn(ctx))

  let scoredPoints = 0
  let scoredWeight = 0
  let implementedWeight = 0

  for (const f of factors) {
    if (f.status !== 'NOT_IMPLEMENTED') implementedWeight += f.weight
    if (f.status === 'SCORED') {
      scoredPoints += f.points ?? 0
      scoredWeight += f.weight
    }
  }

  return {
    score: scoredWeight === 0 ? null : (100 * scoredPoints) / scoredWeight,
    completeness: implementedWeight === 0 ? 0 : scoredWeight / implementedWeight,
    factors,
  }
}
