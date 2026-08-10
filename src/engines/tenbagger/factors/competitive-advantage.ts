import { interpolate } from '@/domain/curve'
import { stdev } from '@/domain/stats'
import { grossMargin, grossMarginSeries, roic } from '@/domain/metrics'
import { scored, noData, pct, type FactorFn } from '../factor-utils.js'

const KEY = 'competitive_advantage'
const STABILITY_QUARTERS = 8
const SIGNAL_COUNT = 4

/**
 * 재무 프록시 4개 신호(ROIC 스프레드 · 마진 안정성 · 산업 대비 마진 · R&D 집약도)의
 * 평균에 **커버리지 감쇠**를 곱한다. 설계문서 §8.5 — 이것은 Moat 분석이 아니다.
 *
 * 감쇠 분모는 4가 아니라 "그 회사에 대해 평가 가능했어야 할 신호 수"다. 결측의 원인을
 * 두 갈래로 나누기 때문이다.
 *
 *  - **회사 사유**(분모에 포함, 감쇠 대상)
 *    · ROIC 스프레드: 영업이익·부채·자본·현금이 없거나 투하자본 ≤ 0 — 그 회사의 재무
 *      데이터/재무 상태 문제다.
 *    · 마진 안정성: 분기 매출총이익 8개 분기가 없다 — 상장·보고 이력이 짧다는 그 회사의
 *      사실이다. 이력이 짧으면 안정성을 주장할 근거가 실제로 없다.
 *    · R&D 집약도: R&D를 공시하지 않거나 매출이 0 이하 — 역시 그 회사의 사실이다.
 *    · 산업 대비 마진 중 **회사의 GM이 없어서** 못 구하는 경우.
 *
 *  - **우리 taxonomy 사유**(분모에서 제외, 감쇠 없음)
 *    · 산업 대비 마진 중 산업 후보가 min_industry_candidates 미만이거나 산업 중앙값
 *      자체가 없어서 못 구하는 경우. 비교 대상을 우리가 못 만든 것이지 회사의 결함이
 *      아니다. NVIDIA가 이 경우다 — AI Infrastructure 산업 후보가 1개뿐이라 신호 3개이며,
 *      나머지 3개를 다 계산했으므로 감쇠 없이 만점이 가능해야 한다.
 */
export const competitiveAdvantageFactor: FactorFn = ({ snapshot, cfg }) => {
  const f = cfg.scoring.factors.competitive_advantage
  const ttm = snapshot.ttm[0]
  const signals: { score: number; label: string }[] = []

  // 1. ROIC 스프레드 — 자본비용을 넘는 초과수익
  const r = roic(ttm, cfg.scoring.tax_rate)
  if (r !== null) {
    const spread = r - cfg.scoring.wacc_assumption
    signals.push({
      score: interpolate(f.signals.roic_spread, spread),
      label: `ROIC ${pct(r)} (스프레드 ${pct(spread)})`,
    })
  }

  // 2. 마진 안정성 — 변동성이 낮으면 전환비용·무형자산 시사
  const series = grossMarginSeries(snapshot.quarterly, STABILITY_QUARTERS)
  if (series.length === STABILITY_QUARTERS) {
    const mean = series.reduce((a, b) => a + b, 0) / series.length
    const sd = stdev(series)
    if (sd !== null && mean > 0) {
      const stability = 1 - sd / mean
      signals.push({
        score: interpolate(f.signals.gm_stability, stability),
        label: `마진 안정성 ${stability.toFixed(3)}`,
      })
    }
  }

  // 3. 산업 대비 마진 — 후보 3개 미만 산업은 중앙값이 무의미
  const industryGm = snapshot.industryStats.medianGrossMargin
  // 비교 자체가 가능한가(우리 쪽 사정)와 그 회사의 GM이 있는가(회사 쪽 사정)를 나눈다.
  const industryComparable =
    industryGm !== null &&
    snapshot.industryStats.candidateCount >= cfg.scoring.min_industry_candidates
  const gm = grossMargin(ttm)
  if (industryComparable && gm !== null) {
    const delta = gm - industryGm
    signals.push({
      score: interpolate(f.signals.gm_vs_industry, delta),
      label: `산업 대비 마진 ${pct(delta)}p`,
    })
  }

  // 평가 가능했어야 할 신호 수 — taxonomy 한계로 빠진 신호는 분모에서 뺀다.
  const applicable = industryComparable ? SIGNAL_COUNT : SIGNAL_COUNT - 1

  // 4. R&D 집약도 — 무형자산 축적
  if (ttm && ttm.rdExpense !== null && ttm.revenue !== null && ttm.revenue > 0) {
    const intensity = ttm.rdExpense / ttm.revenue
    signals.push({
      score: interpolate(f.signals.rd_intensity, intensity),
      label: `R&D 집약도 ${pct(intensity)}`,
    })
  }

  if (signals.length < f.min_signals) {
    return noData(
      KEY, f.weight,
      `재무 프록시 신호 ${signals.length}개 — 최소 ${f.min_signals}개 필요` +
        `${signals.length === 0 ? '' : ` (${signals.map((s) => s.label).join(' · ')})`}`,
    )
  }

  const mean = signals.reduce((s, x) => s + x.score, 0) / signals.length
  const coverage = signals.length / applicable
  const damping = interpolate(f.coverage_curve, coverage)
  const normalized = mean * damping

  const parts = [signals.map((s) => s.label).join(' · ')]
  if (applicable < SIGNAL_COUNT) {
    parts.push(
      `산업 후보 ${snapshot.industryStats.candidateCount}개(최소 ${cfg.scoring.min_industry_candidates}개)` +
        ' — 산업 대비 마진은 평가 불가로 분모에서 제외',
    )
  }
  parts.push(
    damping < 1
      ? `평가 가능 ${applicable}개 중 ${signals.length}개 신호 · 커버리지 감쇠 ×${damping.toFixed(2)}`
      : `평가 가능 ${applicable}개 신호 전부 · 감쇠 없음`,
  )

  return scored(KEY, f.weight, normalized, normalized, parts.join(' · '))
}
