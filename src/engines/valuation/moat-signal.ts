import type { AppConfig } from '@/config'
import type { CompanySnapshot, FinancialPeriod } from '@/domain/types'
import { roic, roicGap, type RoicGap } from '@/domain/metrics'

export type MoatSignal = 'WIDE' | 'NARROW' | 'NONE' | 'INSUFFICIENT_DATA'

/**
 * signal이 INSUFFICIENT_DATA일 때 "왜"를 구분한다. 세 원인은 서로 다른 이야기다:
 *   - TOO_FEW_PERIODS: 연간 실적 자체가 lookback 최소 요건보다 적게 보고됐다(신규 상장 등).
 *     데이터를 더 모아도 지금 당장은 판정할 수 없다는 뜻 — 진짜 "모른다".
 *   - MISSING_FINANCIALS: 결측 기간을 전부 낙관적으로(=계산 가능했다고) 되돌려도 여전히
 *     최소 요건에 못 미치지 않는 경우 — 즉 "그 데이터가 있었다면 결론이 달라질 수
 *     있었다"는 가능성을 배제할 수 없다. 이것도 "모른다".
 *   - NOT_APPLICABLE: 결측 기간을 전부 낙관적으로 되돌려도 여전히 최소 요건에 못 미치고
 *     (그러니 결측 자체는 결론을 바꿀 수 없었다), 실패한 기간 중 하나 이상이 투하자본
 *     (부채+자본−현금) 0 이하 때문이다. 이건 결측이 아니다 — 보유 현금이 투입 자본보다
 *     많은 회사(초기 성장·현금부자 기업)에는 ROIC라는 지표 자체가 정의되지 않는다는,
 *     데이터를 더 모아도 바뀌지 않는 완결된 사실이다.
 */
export type MoatInsufficientReason = 'TOO_FEW_PERIODS' | 'MISSING_FINANCIALS' | 'NOT_APPLICABLE'

export type MoatResult = {
  signal: MoatSignal
  periodsEvaluated: number
  periodsClearing: number
  /** signal이 INSUFFICIENT_DATA일 때만 값이 있다 — WIDE/NARROW/NONE에는 해당 없음(null). */
  insufficientReason: MoatInsufficientReason | null
  /** 측정한 것만 말한다 — 전환비용/네트워크효과 같은 원천은 절대 이름 붙이지 않는다. */
  evidence: string[]
}

/**
 * 다섯 가지 고전적 해자 원천(전환비용, 네트워크효과, 무형자산, 원가우위, 효율적 규모)은
 * XBRL 재무데이터로는 관측할 수 없다 — 그 태그가 없다. 대신 해자의 "경제적 결과", 즉
 * ROIC가 자본비용을 지속적으로 상회하는지를 측정한다. 마진이나 성장률만으로는 WIDE를
 * 주지 않는다(제품 오너 지시) — 지속성이 한 해 좋은 실적과 해자를 가르는 기준이다.
 *
 * 연간(annual) 기간을 쓴다: TTM은 분기마다 겹치므로 "몇 개의 뚜렷한 해(年)"를 셌다고
 * 말할 수 없다. 최근 lookback_periods개 연간 기간 중 ROIC를 계산할 수 있는 기간이
 * min_periods_required개 미만이면 무엇도 주장하지 않고 INSUFFICIENT_DATA를 반환한다.
 */
export function computeMoatSignal(snapshot: CompanySnapshot, cfg: AppConfig): MoatResult {
  const m = cfg.valuation.moat
  const wacc = cfg.scoring.wacc_assumption
  const periods: FinancialPeriod[] = snapshot.annual.slice(0, m.lookback_periods)

  const spreads: number[] = []
  const gaps: RoicGap[] = []
  for (const p of periods) {
    const r = roic(p, cfg.scoring.tax_rate)
    if (r !== null) {
      spreads.push(r - wacc)
    } else {
      const gap = roicGap(p)
      if (gap !== null) gaps.push(gap)
    }
  }

  if (spreads.length < m.min_periods_required) {
    // 연간 실적 자체가 lookback 창이 요구하는 최소치보다 적게 보고됐으면, 개별 기간의
    // 결측·투하자본 사정과 무관하게 애초에 채울 수 없다 — 가장 근본적인 원인이므로
    // 최우선으로 보고한다(신규 상장 등).
    if (snapshot.annual.length < m.min_periods_required) {
      return {
        signal: 'INSUFFICIENT_DATA',
        periodsEvaluated: spreads.length,
        periodsClearing: 0,
        insufficientReason: 'TOO_FEW_PERIODS',
        evidence: [
          `보고된 연간 실적이 ${snapshot.annual.length}개뿐 — 판정에 필요한 최소 ${m.min_periods_required}개에 못 미침`,
        ],
      }
    }

    // 실패 원인이 섞여 있을 수 있다(일부 기간은 결측, 일부는 투하자본 0 이하) — "최선의
    // 경우" 감도 분석으로 어느 쪽이 진짜 병목인지 가른다. 결측 기간이 전부 계산 가능했다고
    // 낙관적으로 되돌렸을 때 최소 요건을 채울 수 있었는가?
    //   - 채울 수 있었다면(spreads.length + missingCount >= min_periods_required):
    //     그 데이터가 있었다면 결론이 달라질 수 있었다는 뜻이므로 "모른다"고 말한다
    //     (MISSING_FINANCIALS) — 투하자본 미달 기간이 섞여 있어도 마찬가지다, 결측만
    //     해소돼도 문턱을 넘었을 것이기 때문이다.
    //   - 채울 수 없었다면(결측을 다 되돌려도 여전히 미달): 결측은 애초에 결론을 바꿀 수
    //     없었던 것이므로 무죄다. 이때 투하자본 0 이하 기간이 하나라도 있으면 그게 진짜
    //     병목이었다는 뜻이므로 NOT_APPLICABLE로 확정한다.
    const missingCount = gaps.filter((g) => g === 'MISSING_FIELDS').length
    const nonPositiveCount = gaps.filter((g) => g === 'NON_POSITIVE_INVESTED_CAPITAL').length
    const missingCouldHaveClearedThreshold =
      spreads.length + missingCount >= m.min_periods_required

    if (nonPositiveCount === 0 || missingCouldHaveClearedThreshold) {
      return {
        signal: 'INSUFFICIENT_DATA',
        periodsEvaluated: spreads.length,
        periodsClearing: 0,
        insufficientReason: 'MISSING_FINANCIALS',
        evidence: [
          `ROIC 계산에 필요한 재무 항목(영업이익·부채·자본·현금)이 일부 연간 기간에 보고되지 않음 — ` +
            `유효 기간 ${spreads.length}개, 최소 ${m.min_periods_required}개 필요`,
        ],
      }
    }

    return {
      signal: 'INSUFFICIENT_DATA',
      periodsEvaluated: spreads.length,
      periodsClearing: 0,
      insufficientReason: 'NOT_APPLICABLE',
      evidence: [
        `보유 현금이 부채와 자본을 합친 금액보다 많아 ROIC를 정의할 수 없는 연간 기간이 있음 — ` +
          `데이터 부족이 아니라 이 지표가 적용되지 않는 경우 (유효 기간 ${spreads.length}개, 최소 ${m.min_periods_required}개 필요)`,
      ],
    }
  }

  const clearing = spreads.filter((s) => s > 0)
  const ratio = clearing.length / spreads.length
  const avgClearSpread =
    clearing.length > 0 ? clearing.reduce((a, b) => a + b, 0) / clearing.length : null

  const signal: MoatSignal =
    ratio >= m.wide_clear_ratio ? 'WIDE' : ratio >= m.narrow_clear_ratio ? 'NARROW' : 'NONE'

  const evidence = [
    `최근 연간 ${spreads.length}개 기간 중 ${clearing.length}개에서 ROIC가 자본비용(WACC ${(wacc * 100).toFixed(1)}%)을 상회`,
  ]
  evidence.push(
    avgClearSpread !== null
      ? `상회한 기간의 평균 스프레드 +${(avgClearSpread * 100).toFixed(1)}%p`
      : '자본비용을 상회한 기간 없음',
  )

  return {
    signal,
    periodsEvaluated: spreads.length,
    periodsClearing: clearing.length,
    insufficientReason: null,
    evidence,
  }
}
