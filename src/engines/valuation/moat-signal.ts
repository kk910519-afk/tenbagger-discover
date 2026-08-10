import type { AppConfig } from '@/config'
import type { CompanySnapshot, FinancialPeriod } from '@/domain/types'
import { roicVerdict, type RoicGap } from '@/domain/metrics'

/**
 * 이 척도가 실제로 재는 것은 "초과수익이 얼마나 오래 이어졌는가"뿐이다 — 등급 이름도
 * 그 사실만 말한다. Morningstar가 published tier로 쓰는 어휘(Wide / Narrow / None)는
 * 쓰지 않는다: 프레이밍은 Morningstar-Inspired로 남기되 등급 이름을 그대로 가져오면
 * 우리 측정을 그들의 등급인 것처럼 읽히게 만든다(제품 오너 상시 규칙).
 *
 *   - PERSISTENT   : 유효 기간의 wide→persistent 비율 이상에서 ROIC > 자본비용 — 초과수익이 지속됐다
 *   - INTERMITTENT : 그 아래 intermittent 비율까지 — 상회한 해와 못 넘은 해가 섞여 있다
 *   - ABSENT       : **측정했고**, 지속적 초과수익이 발견되지 않았다. 데이터는 충분했다.
 *   - INSUFFICIENT_DATA : 측정 자체를 못 했다. 이유는 insufficientReason이 셋으로 나눈다.
 *
 * ABSENT와 INSUFFICIENT_DATA를 절대 섞지 않는다 — 앞은 회사에 대한 결론이고 뒤는 우리
 * 자신에 대한 진술이다. 임계값과 판정 규칙은 이름이 바뀌어도 그대로다.
 */
export type MoatSignal = 'PERSISTENT' | 'INTERMITTENT' | 'ABSENT' | 'INSUFFICIENT_DATA'

/**
 * signal이 INSUFFICIENT_DATA일 때 "왜"를 구분한다. 세 원인은 서로 다른 이야기다:
 *   - TOO_FEW_PERIODS: 연간 실적 자체가 lookback 최소 요건보다 적게 보고됐다(신규 상장 등).
 *     데이터를 더 모아도 지금 당장은 판정할 수 없다는 뜻 — 진짜 "모른다".
 *   - MISSING_FINANCIALS: 결측 기간을 전부 낙관적으로(=계산 가능했다고) 되돌려도 여전히
 *     최소 요건에 못 미치지 않는 경우 — 즉 "그 데이터가 있었다면 결론이 달라질 수
 *     있었다"는 가능성을 배제할 수 없다. 이것도 "모른다".
 *   - NOT_APPLICABLE: 결측 기간을 전부 낙관적으로 되돌려도 여전히 최소 요건에 못 미치고
 *     (그러니 결측 자체는 결론을 바꿀 수 없었다), 실패한 기간 중 하나 이상이 투하자본
 *     (부채+자본−현금)이 0 이하이거나 총액 대비 무시할 만큼 작기 때문이다. 이건 결측이
 *     아니다 — 보유 현금이 투입 자본보다 많은 회사(초기 성장·현금부자 기업)나 자사주
 *     매입으로 자본이 음수가 된 회사에는 ROIC라는 지표 자체가 정의되지 않는다는,
 *     데이터를 더 모아도 바뀌지 않는 완결된 사실이다.
 */
export type MoatInsufficientReason = 'TOO_FEW_PERIODS' | 'MISSING_FINANCIALS' | 'NOT_APPLICABLE'

export type MoatResult = {
  signal: MoatSignal
  periodsEvaluated: number
  periodsClearing: number
  /** signal이 INSUFFICIENT_DATA일 때만 값이 있다 — PERSISTENT/INTERMITTENT/ABSENT에는 해당 없음(null). */
  insufficientReason: MoatInsufficientReason | null
  /** 측정한 것만 말한다 — 전환비용/네트워크효과 같은 원천은 절대 이름 붙이지 않는다. */
  evidence: string[]
}

/**
 * 다섯 가지 고전적 해자 원천(전환비용, 네트워크효과, 무형자산, 원가우위, 효율적 규모)은
 * XBRL 재무데이터로는 관측할 수 없다 — 그 태그가 없다. 대신 해자의 "경제적 결과", 즉
 * ROIC가 자본비용을 지속적으로 상회하는지를 측정한다. 마진이나 성장률만으로는 PERSISTENT를
 * 주지 않는다(제품 오너 지시) — 지속성이 한 해 좋은 실적과 해자를 가르는 기준이다.
 *
 * 연간(annual) 기간을 쓴다: TTM은 분기마다 겹치므로 "몇 개의 뚜렷한 해(年)"를 셌다고
 * 말할 수 없다. 최근 lookback_periods개 연간 기간 중 ROIC를 계산할 수 있는 기간이
 * min_periods_required개 미만이면 무엇도 주장하지 않고 INSUFFICIENT_DATA를 반환한다.
 */
export function computeMoatSignal(snapshot: CompanySnapshot, cfg: AppConfig): MoatResult {
  const m = cfg.valuation.moat
  const wacc = cfg.scoring.wacc_assumption
  // **매출이 없는 연간 행은 회계연도가 아니다.** bulk(num.txt)에는 API 대응이 없는
  // 디멘션 슬라이스가 연간 기간처럼 들어오는 경우가 있고(실측 284행 / 85개사), 그 행은
  // `revenue`가 NULL인 채 `gross_profit` 하나만 들고 있다 — eBay의 A 2025-09-30이
  // gross_profit 44,000,000 / revenue NULL로 정확히 그 모습이며, 2022~2025년의 9월 30일
  // 유령 연간 기간 네 개가 lookback 창을 잠식해 eBay가 유효 기간 3개로 INSUFFICIENT_DATA를
  // 받는다(QCOM도 같은 모양). 매출이 아예 없는 기간은 그 회사의 한 해를 대표하지 않으므로
  // 창에 넣지 않는다 — 오염 값을 뒤집는 규칙이 아니라 **세지 않는** 규칙이라, 신고된
  // 값을 형제 분기로 뒤집는 판단(cumulative.ts:210이 의도적으로 하지 않기로 한 것)을
  // 건드리지 않는다.
  const annual: FinancialPeriod[] = snapshot.annual.filter((p) => p.revenue !== null)
  const periods: FinancialPeriod[] = annual.slice(0, m.lookback_periods)

  const minInvested = cfg.scoring.min_invested_capital_ratio

  // 이 엔진이 각 기간에 묻는 것은 부호 하나 — "ROIC가 자본비용을 넘었는가"다. NOPAT이
  // 0 이하인 기간은 분모의 크기와 무관하게 답이 정해져 있으므로, 투하자본 규모 하한으로
  // 버리지 않고 **미달로 세어** 판정에 넣는다(roicVerdict의 주석 참고). 그래야 회사에
  // 대한 결론(ABSENT)이 우리에 대한 진술(INSUFFICIENT_DATA)로 격하되지 않고, 실패 기간만
  // 지워서 등급이 올라가는 일도 생기지 않는다.
  let periodsEvaluated = 0
  let periodsClearing = 0
  const clearSpreads: number[] = []
  const gaps: RoicGap[] = []
  for (const p of periods) {
    const v = roicVerdict(p, cfg.scoring.tax_rate, wacc, minInvested)
    if (v.kind === 'UNDEFINED') {
      gaps.push(v.gap)
      continue
    }
    periodsEvaluated++
    if (v.kind === 'MEASURED' && v.clears) {
      periodsClearing++
      clearSpreads.push(v.spread)
    }
  }

  if (periodsEvaluated < m.min_periods_required) {
    // 연간 실적 자체가 lookback 창이 요구하는 최소치보다 적게 보고됐으면, 개별 기간의
    // 결측·투하자본 사정과 무관하게 애초에 채울 수 없다 — 가장 근본적인 원인이므로
    // 최우선으로 보고한다(신규 상장 등).
    if (annual.length < m.min_periods_required) {
      return {
        signal: 'INSUFFICIENT_DATA',
        periodsEvaluated,
        periodsClearing: 0,
        insufficientReason: 'TOO_FEW_PERIODS',
        evidence: [
          `보고된 연간 실적이 ${annual.length}개뿐 — 판정에 필요한 최소 ${m.min_periods_required}개에 못 미침`,
        ],
      }
    }

    // 실패 원인이 섞여 있을 수 있다(일부 기간은 결측, 일부는 투하자본 0 이하) — "최선의
    // 경우" 감도 분석으로 어느 쪽이 진짜 병목인지 가른다. 결측 기간이 전부 계산 가능했다고
    // 낙관적으로 되돌렸을 때 최소 요건을 채울 수 있었는가?
    //   - 채울 수 있었다면(periodsEvaluated + missingCount >= min_periods_required):
    //     그 데이터가 있었다면 결론이 달라질 수 있었다는 뜻이므로 "모른다"고 말한다
    //     (MISSING_FINANCIALS) — 투하자본 미달 기간이 섞여 있어도 마찬가지다, 결측만
    //     해소돼도 문턱을 넘었을 것이기 때문이다.
    //   - 채울 수 없었다면(결측을 다 되돌려도 여전히 미달): 결측은 애초에 결론을 바꿀 수
    //     없었던 것이므로 무죄다. 이때 투하자본 0 이하 기간이 하나라도 있으면 그게 진짜
    //     병목이었다는 뜻이므로 NOT_APPLICABLE로 확정한다.
    const missingCount = gaps.filter((g) => g === 'MISSING_FIELDS').length
    // 투하자본이 0 이하인 기간과 총액 대비 무시할 만큼 작은 기간은 같은 성격이다 —
    // 둘 다 결측이 아니라 "이 회사·이 해에는 ROIC가 정의되지 않는다"는 완결된 사실이다.
    const notApplicableCount = gaps.filter(
      (g) => g === 'NON_POSITIVE_INVESTED_CAPITAL' || g === 'IMMATERIAL_INVESTED_CAPITAL',
    ).length
    const missingCouldHaveClearedThreshold =
      periodsEvaluated + missingCount >= m.min_periods_required

    if (notApplicableCount === 0 || missingCouldHaveClearedThreshold) {
      return {
        signal: 'INSUFFICIENT_DATA',
        periodsEvaluated,
        periodsClearing: 0,
        insufficientReason: 'MISSING_FINANCIALS',
        evidence: [
          `ROIC 계산에 필요한 재무 항목(영업이익·부채·자본·현금)이 일부 연간 기간에 보고되지 않음 — ` +
            `유효 기간 ${periodsEvaluated}개, 최소 ${m.min_periods_required}개 필요`,
        ],
      }
    }

    return {
      signal: 'INSUFFICIENT_DATA',
      periodsEvaluated,
      periodsClearing: 0,
      insufficientReason: 'NOT_APPLICABLE',
      evidence: [
        `투하자본(부채+자본−현금)이 0 이하이거나 그 셋을 합친 규모에 비해 무시할 만큼 작아 ` +
          `ROIC를 정의할 수 없는 연간 기간이 있음 — 데이터 부족이 아니라 이 지표가 적용되지 ` +
          `않는 경우 (유효 기간 ${periodsEvaluated}개, 최소 ${m.min_periods_required}개 필요)`,
      ],
    }
  }

  const ratio = periodsClearing / periodsEvaluated
  const avgClearSpread =
    clearSpreads.length > 0
      ? clearSpreads.reduce((a, b) => a + b, 0) / clearSpreads.length
      : null

  const signal: MoatSignal =
    ratio >= m.persistent_clear_ratio
      ? 'PERSISTENT'
      : ratio >= m.intermittent_clear_ratio
        ? 'INTERMITTENT'
        : 'ABSENT'

  const evidence = [
    `최근 연간 ${periodsEvaluated}개 기간 중 ${periodsClearing}개에서 ROIC가 자본비용(WACC ${(wacc * 100).toFixed(1)}%)을 상회`,
  ]
  evidence.push(
    avgClearSpread !== null
      ? `상회한 기간의 평균 스프레드 +${(avgClearSpread * 100).toFixed(1)}%p`
      : '자본비용을 상회한 기간 없음',
  )

  return {
    signal,
    periodsEvaluated,
    periodsClearing,
    insufficientReason: null,
    evidence,
  }
}
