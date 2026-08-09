import { interpolate } from '@/domain/curve'
import { cashRunwayQuarters, debtToEbitda, netCashToMarketCap } from '@/domain/metrics'
import { scored, noData, pct, type FactorFn } from '../factor-utils.js'

const KEY = 'balance_sheet'

export const balanceSheetFactor: FactorFn = ({ snapshot, cfg }) => {
  const f = cfg.scoring.factors.balance_sheet
  const ttm = snapshot.ttm[0]

  // 적자 기업: 런웨이가 유일하게 의미 있는 지표
  const runway = cashRunwayQuarters(snapshot.ttm)
  if (runway !== null) {
    return scored(
      KEY, f.weight, runway, interpolate(f.runway_curve, runway),
      `현금 런웨이 ${runway.toFixed(1)}분기 (FCF 적자)`,
    )
  }

  // 흑자 기업: 순현금 포지션 + 레버리지
  const netCash = netCashToMarketCap(ttm, snapshot.marketCap)
  const leverage = debtToEbitda(ttm)
  if (netCash === null && leverage === null) {
    return noData(KEY, f.weight, '현금·부채 데이터 없음')
  }

  if (netCash !== null && leverage !== null) {
    const normalized =
      f.profitable_blend.net_cash * interpolate(f.net_cash_curve, netCash) +
      f.profitable_blend.leverage * interpolate(f.leverage_curve, leverage)
    return scored(
      KEY, f.weight, netCash, normalized,
      `순현금 시총 대비 ${pct(netCash)} · 부채/영업이익 ${leverage.toFixed(1)}배`,
    )
  }
  if (netCash !== null) {
    return scored(
      KEY, f.weight, netCash, interpolate(f.net_cash_curve, netCash),
      `순현금 시총 대비 ${pct(netCash)} · 레버리지 산출 불가`,
    )
  }
  return scored(
    KEY, f.weight, leverage, interpolate(f.leverage_curve, leverage!),
    `부채/영업이익 ${leverage!.toFixed(1)}배 · 순현금 산출 불가`,
  )
}
