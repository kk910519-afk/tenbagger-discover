import type { AppConfig } from '@/config'
import type { CompanySnapshot, RedFlag } from '@/domain/types'
import { yoy } from '@/domain/growth'
import { grossMargin, cashRunwayQuarters, debtToEbitda } from '@/domain/metrics'
import { compactMagnitude } from '@/domain/display'

const QUARTERS_PER_YEAR = 4

function flag(
  code: string,
  severity: 'CRITICAL' | 'WARNING',
  message: string,
  evidence: Record<string, number | string | null>,
): RedFlag {
  return { code, severity, message, evidence }
}

export function evaluateQuality(s: CompanySnapshot, cfg: AppConfig): RedFlag[] {
  const g = cfg.quality_gate
  const out: RedFlag[] = []
  const ttm = s.ttm[0]
  const ttmPrior = s.ttm[QUARTERS_PER_YEAR]

  // 2년 연속 연간 매출 감소
  const a = s.annual
  if (a.length >= g.revenue_decline_years + 1) {
    let declining = true
    for (let i = 0; i < g.revenue_decline_years; i++) {
      const cur = a[i]?.revenue
      const prev = a[i + 1]?.revenue
      if (typeof cur !== 'number' || typeof prev !== 'number' || cur >= prev) {
        declining = false
        break
      }
    }
    if (declining) {
      out.push(
        flag('REVENUE_DECLINE_2Y', 'CRITICAL',
          `${g.revenue_decline_years}년 연속 매출 감소`,
          { latest: a[0]?.revenue ?? null, oldest: a[g.revenue_decline_years]?.revenue ?? null }),
      )
    }
  }

  // 자본잠식 + 음의 FCF
  if (ttm && ttm.equity !== null && ttm.equity < 0 && ttm.fcf !== null && ttm.fcf < 0) {
    out.push(
      flag('NEGATIVE_EQUITY_BURN', 'CRITICAL', '자본잠식 상태에서 현금이 유출되고 있음',
        { equity: ttm.equity, fcf: ttm.fcf }),
    )
  }

  // 현금 런웨이 — CRITICAL이 발동하면 WARNING은 내지 않는다
  const runway = cashRunwayQuarters(s.ttm)
  if (runway !== null) {
    if (runway < g.runway_critical_quarters) {
      out.push(
        flag('RUNWAY_CRITICAL', 'CRITICAL',
          `현금 런웨이 ${runway.toFixed(1)}분기 — ${g.runway_critical_quarters}분기 미만`,
          { quarters: runway }),
      )
    } else if (runway < g.runway_low_quarters) {
      out.push(
        flag('RUNWAY_LOW', 'WARNING',
          `현금 런웨이 ${runway.toFixed(1)}분기 — ${g.runway_low_quarters}분기 미만`,
          { quarters: runway }),
      )
    }
  }

  // 주식 희석 — 마찬가지로 심각한 쪽만
  const dilution = yoy(ttm?.sharesDiluted ?? null, ttmPrior?.sharesDiluted ?? null)
  if (dilution !== null) {
    if (dilution > g.extreme_dilution) {
      out.push(
        flag('EXTREME_DILUTION', 'CRITICAL',
          `희석주식수 1년 ${compactMagnitude(dilution * 100, 0)}% 증가`, { ratio: dilution }),
      )
    } else if (dilution > g.dilution_warning) {
      out.push(
        flag('DILUTION', 'WARNING',
          `희석주식수 1년 ${compactMagnitude(dilution * 100, 0)}% 증가`, { ratio: dilution }),
      )
    }
  }

  // 매출총이익률 급락
  const gmNow = grossMargin(ttm)
  const gmPrior = grossMargin(ttmPrior)
  if (gmNow !== null && gmPrior !== null) {
    const dropBps = (gmPrior - gmNow) * 10_000
    if (dropBps > g.gm_collapse_bps) {
      out.push(
        flag('GM_COLLAPSE', 'WARNING',
          `매출총이익률 1년 ${dropBps.toFixed(0)}bp 하락`,
          { now: gmNow, prior: gmPrior, dropBps }),
      )
    }
  }

  // 주식보상비용 과다
  if (ttm && ttm.sbc !== null && ttm.revenue !== null && ttm.revenue > 0) {
    const ratio = ttm.sbc / ttm.revenue
    if (ratio > g.sbc_of_revenue) {
      out.push(
        flag('SBC_EXCESSIVE', 'WARNING',
          `주식보상비용이 매출의 ${compactMagnitude(ratio * 100, 0)}%`, { ratio }),
      )
    }
  }

  // 레버리지 과다
  const leverage = debtToEbitda(ttm)
  if (leverage !== null && leverage > g.debt_to_ebitda) {
    out.push(
      flag('LEVERAGE_HIGH', 'WARNING',
        `부채/영업이익 ${leverage.toFixed(1)}배`, { ratio: leverage }),
    )
  }

  return out
}

export function hasCritical(flags: RedFlag[]): boolean {
  return flags.some((f) => f.severity === 'CRITICAL')
}

export function hasWarning(flags: RedFlag[]): boolean {
  return flags.some((f) => f.severity === 'WARNING')
}
