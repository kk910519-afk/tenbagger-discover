import type { AppConfig } from '@/config'
import type { CompanySnapshot, FinancialPeriod } from '@/domain/types'
import { roic } from '@/domain/metrics'

export type MoatSignal = 'WIDE' | 'NARROW' | 'NONE' | 'INSUFFICIENT_DATA'

export type MoatResult = {
  signal: MoatSignal
  periodsEvaluated: number
  periodsClearing: number
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
  for (const p of periods) {
    const r = roic(p, cfg.scoring.tax_rate)
    if (r !== null) spreads.push(r - wacc)
  }

  if (spreads.length < m.min_periods_required) {
    return {
      signal: 'INSUFFICIENT_DATA',
      periodsEvaluated: spreads.length,
      periodsClearing: 0,
      evidence: [
        `ROIC를 산출할 수 있는 연간 기간이 ${spreads.length}개뿐 — 최소 ${m.min_periods_required}개 필요`,
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

  return { signal, periodsEvaluated: spreads.length, periodsClearing: clearing.length, evidence }
}
