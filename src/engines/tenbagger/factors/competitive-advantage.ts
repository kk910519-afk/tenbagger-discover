import { interpolate } from '@/domain/curve'
import { stdev } from '@/domain/stats'
import { grossMargin, grossMarginSeries, roic } from '@/domain/metrics'
import { scored, noData, pct, type FactorFn } from '../factor-utils.js'

const KEY = 'competitive_advantage'
const STABILITY_QUARTERS = 8
const SIGNAL_COUNT = 4

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
  const gm = grossMargin(ttm)
  const industryGm = snapshot.industryStats.medianGrossMargin
  if (
    gm !== null && industryGm !== null &&
    snapshot.industryStats.candidateCount >= cfg.scoring.min_industry_candidates
  ) {
    const delta = gm - industryGm
    signals.push({
      score: interpolate(f.signals.gm_vs_industry, delta),
      label: `산업 대비 마진 ${pct(delta)}p`,
    })
  }

  // 4. R&D 집약도 — 무형자산 축적
  if (ttm && ttm.rdExpense !== null && ttm.revenue !== null && ttm.revenue > 0) {
    const intensity = ttm.rdExpense / ttm.revenue
    signals.push({
      score: interpolate(f.signals.rd_intensity, intensity),
      label: `R&D 집약도 ${pct(intensity)}`,
    })
  }

  if (signals.length === 0) {
    return noData(KEY, f.weight, '재무 프록시 4개 신호를 하나도 계산할 수 없음')
  }

  const normalized = signals.reduce((s, x) => s + x.score, 0) / signals.length
  const coverage =
    signals.length < SIGNAL_COUNT ? ` (4개 중 ${signals.length}개 신호)` : ''

  return scored(
    KEY, f.weight, normalized, normalized,
    `${signals.map((s) => s.label).join(' · ')}${coverage}`,
  )
}
