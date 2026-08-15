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
 *
 * 1.3.0 — 두 팩터의 판정이 바뀐다(검증 리뷰 재작업).
 *   · `market_cap_opportunity`: 최신 TTM 매출이 null이어도 최근 TTM 구간·최근 연간
 *     기간에서 매출을 찾아 게이트를 평가한다. 확보하고 있는 사실을 버리고 NO_DATA로
 *     돌리던 것을 고친 것이며(274개 NO_DATA 중 최소 89개가 그런 경우였다) SCORED 수와
 *     completeness가 함께 움직인다.
 *   · `balance_sheet`: 커버리지를 신호 **개수**가 아니라 **blend 가중치**로 세고
 *     coverage_curve를 항등으로 바꾼다. 순현금 비율이 아주 낮은 기업이 현금을 보고하지
 *     않는 편으로 점수가 높아지던 비단조성을 없앤다(GEN 실사례).
 *
 * 1.4.0 — 매출 규모 감쇠가 보는 기간이 바뀌고, 감쇠 대상에 operating_leverage가 들어온다.
 *   · `revenue_scale_damping`은 이제 최신 TTM 매출이 아니라 **그 비율의 분모가 된 기간**을
 *     본다(revenue_growth: 1년 전·3년 전 TTM, revenue_acceleration: 1년 전 4개 분기 합계).
 *     SEPN은 최신 TTM 매출 $98.88M으로 감쇠를 빠져나갔지만 +13,520%의 분모는 $726K였다.
 *     기저와 현재 중 감쇠가 센 쪽을 채택하므로 어떤 회사의 점수도 올라가지 않는다.
 *   · `operating_leverage`에 같은 감쇠를 적용한다. 이 팩터의 두 신호는 모두 1년 전 TTM
 *     매출을 분모로 갖는데 감쇠 대상이 아니었고, 성장 팩터가 감쇠된 뒤 바로 그 회사들의
 *     최대 득점원이 되었다(검증 리뷰 finding #6의 "direction currently benign"이 뒤집혔다).
 *   · detail 문자열 표기 변경(점수와 무관) — 표기 한계를 넘는 비율은 퍼센트 대신 그 비율을
 *     만든 두 금액으로 적는다.
 */
export const ENGINE_VERSION = 'tenbagger-1.4.0'

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
