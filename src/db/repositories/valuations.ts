import type Database from 'better-sqlite3'
import type { FairValueResult } from '@/engines/valuation/fair-value'
import type { PriceToFairValueResult } from '@/engines/valuation/price-to-fair-value'
import type { MoatResult } from '@/engines/valuation/moat-signal'
import type { UncertaintyResult } from '@/engines/valuation/uncertainty'

export type ValuationWrite = {
  cik: number
  asOf: string
  fairValue: FairValueResult
  priceToFairValue: PriceToFairValueResult
  moat: MoatResult
  uncertainty: UncertaintyResult
  engineVersion: string
}

/**
 * (cik, as_of)당 한 행이므로 PK 충돌은 항상 정확히 이 행을 가리킨다 — 그래도 red_flags와
 * 같은 규약을 따라 먼저 지우고 다시 넣는다. INSERT OR REPLACE만으로도 동일한 결과를
 * 얻지만, 이 파일만 봐서는 그게 자명하지 않다: 명시적 DELETE는 "같은 (cik, as_of)를
 * 다시 쓸 때 이전 값의 일부가 남을 수 있다"는 걱정을 코드만 읽고도 지울 수 있게 한다.
 */
export function writeValuations(raw: Database.Database, rows: ValuationWrite[]): void {
  const del = raw.prepare(`DELETE FROM valuations WHERE cik = @cik AND as_of = @asOf`)
  const ins = raw.prepare(
    `INSERT INTO valuations (
       cik, as_of,
       fair_value_status, fair_value_reason, fair_value_per_share,
       fair_value_assumptions, fair_value_detail,
       price_to_fair_value_status, price_to_fair_value_ratio, margin_of_safety, valuation_status,
       moat_signal, moat_periods_evaluated, moat_periods_clearing, moat_evidence,
       uncertainty_level, uncertainty_score, uncertainty_drivers,
       engine_version
     ) VALUES (
       @cik, @asOf,
       @fairValueStatus, @fairValueReason, @fairValuePerShare,
       @fairValueAssumptions, @fairValueDetail,
       @priceToFairValueStatus, @priceToFairValueRatio, @marginOfSafety, @valuationStatus,
       @moatSignal, @moatPeriodsEvaluated, @moatPeriodsClearing, @moatEvidence,
       @uncertaintyLevel, @uncertaintyScore, @uncertaintyDrivers,
       @engineVersion
     )`,
  )

  raw.transaction(() => {
    for (const r of rows) {
      del.run({ cik: r.cik, asOf: r.asOf })

      const fv = r.fairValue
      const ptfv = r.priceToFairValue

      ins.run({
        cik: r.cik,
        asOf: r.asOf,
        fairValueStatus: fv.status,
        fairValueReason: fv.status === 'INSUFFICIENT_DATA' ? fv.reason : null,
        fairValuePerShare: fv.status === 'OK' ? fv.perShare : null,
        fairValueAssumptions: fv.status === 'OK' ? JSON.stringify(fv.assumptions) : null,
        fairValueDetail: fv.detail,
        priceToFairValueStatus: ptfv.status,
        priceToFairValueRatio: ptfv.status === 'OK' ? ptfv.ratio : null,
        marginOfSafety: ptfv.status === 'OK' ? ptfv.marginOfSafety : null,
        valuationStatus: ptfv.status === 'OK' ? ptfv.valuationStatus : null,
        moatSignal: r.moat.signal,
        moatPeriodsEvaluated: r.moat.periodsEvaluated,
        moatPeriodsClearing: r.moat.periodsClearing,
        moatEvidence: JSON.stringify(r.moat.evidence),
        uncertaintyLevel: r.uncertainty.level,
        uncertaintyScore: r.uncertainty.score,
        uncertaintyDrivers: JSON.stringify(r.uncertainty.drivers),
        engineVersion: r.engineVersion,
      })
    }
  })()
}
