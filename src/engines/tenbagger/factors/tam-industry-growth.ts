import { interpolate } from '@/domain/curve'
import { scored, noData, pct, type FactorFn } from '../factor-utils.js'

const KEY = 'tam_industry_growth'

export const tamIndustryGrowthFactor: FactorFn = ({ snapshot, cfg }) => {
  const f = cfg.scoring.factors.tam_industry_growth
  const { industry, industryStats } = snapshot

  // TAM CAGR이 큐레이션되어 있으면 우선, 없으면 산업 구성기업 매출성장률 중앙값으로 대체.
  // 단, 대체값은 채점 대상 기업 자신도 포함해 계산되므로 산업 후보가 너무 적으면
  // 자기참조가 되어버린다 (후보 1개면 대체값 = 자기 자신의 revenue_growth 그대로).
  // min_industry_candidates 미만이면 대체하지 않고 NO_DATA로 빠진다.
  const curated = industry.tamCagr
  let growth: number | null
  let growthSource: string
  if (curated !== null) {
    growth = curated
    growthSource = `TAM CAGR ${pct(curated)} (출처: ${industry.tamSource ?? '미기재'})`
  } else if (industryStats.candidateCount < cfg.scoring.min_industry_candidates) {
    return noData(
      KEY, f.weight,
      `TAM CAGR 미큐레이션 · 산업 후보 ${industryStats.candidateCount}개 ` +
        `(최소 ${cfg.scoring.min_industry_candidates}개 필요) — 대체값이 자기참조가 되어 보류`,
    )
  } else {
    const fallback = industryStats.medianRevenueGrowth
    if (fallback === null) {
      return noData(KEY, f.weight, 'TAM CAGR 미큐레이션 · 산업 성장률 대체값도 없음')
    }
    growth = fallback
    growthSource = `산업 매출성장률 중앙값 ${pct(fallback)}로 대체 — TAM 미큐레이션`
  }

  const cagrScore = interpolate(f.cagr_curve, growth)

  // 침투율: TAM 대비 매출 비중이 높을수록 남은 성장 여지가 작다
  const revenue = snapshot.ttm[0]?.revenue ?? null
  if (industry.tamUsd === null || revenue === null || industry.tamUsd <= 0) {
    return scored(KEY, f.weight, growth, cagrScore, `${growthSource} · 침투율 미산출`)
  }
  const penetration = revenue / industry.tamUsd
  const normalized =
    f.blend.tam_cagr * cagrScore +
    f.blend.penetration * interpolate(f.penetration_curve, penetration)

  return scored(
    KEY, f.weight, growth, normalized,
    `${growthSource} · TAM 침투율 ${pct(penetration)}`,
  )
}
