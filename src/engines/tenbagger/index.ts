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

/**
 * 팩터 구성이나 정규화 규칙을 바꾸면 반드시 올린다. scores.engine_version에 기록된다.
 * 계산 규칙이 그대로여도 **입력의 정의**가 바뀌면 같은 회사의 점수가 달라지므로 그때도
 * 올린다 — valuation 엔진이 채택한 규칙과 같다.
 *
 * 1.1.0 — 경쟁우위 커버리지 감쇠(최소 2개 신호) + 매출 규모에 따른 성장 팩터 감쇠.
 *
 * 1.2.0 — 세 가지가 함께 들어간다.
 *   · `resolveTotalDebt`의 태그 확장(commit 866623e)으로 `totalDebt`의 **정의**가 바뀌었다.
 *     순수하게 null → 값이라 기존 값은 하나도 변하지 않지만, roic·netCashToMarketCap·
 *     debtToEbitda가 새로 계산 가능해지면서 balance_sheet이 NO_DATA → SCORED로 옮겨간다.
 *     그것은 scoredWeight, 즉 총점의 정규화 분모와 completeness를 움직이고, 나아가
 *     min_completeness 통과 여부까지 바꾼다. 1.1.0에서 올렸어야 했던 버전이다.
 *   · balance_sheet에 커버리지 감쇠 적용(리뷰 Finding 3).
 *   · market_cap_opportunity: TTM 매출이 null이면 게이트를 평가할 수 없으므로 만점이
 *     아니라 NO_DATA(리뷰 Finding 5).
 *   · ROIC 분모에 투하자본 규모 하한 도입(리뷰 Finding 2) — competitive_advantage의
 *     roic_spread 신호가 일부 기업에서 사라진다.
 */
export const ENGINE_VERSION = 'tenbagger-1.2.0'

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
