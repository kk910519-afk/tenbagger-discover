import { interpolate } from '@/domain/curve'
import { cashRunwayQuarters, debtToEbitda, netCashToMarketCap } from '@/domain/metrics'
import { scored, noData, pct, type FactorFn } from '../factor-utils.js'

const KEY = 'balance_sheet'
const SIGNAL_COUNT = 2

/**
 * 흑자 기업은 순현금 포지션과 레버리지 두 신호를 blend로 섞고, **커버리지 감쇠**를 곱한다
 * (competitive_advantage와 같은 규칙 — 설계문서 §8.5의 템플릿).
 *
 * 감쇠가 없으면 계산된 신호만 평균 내는 꼴이 되어 증거가 적을수록 점수가 높아진다.
 * debtToEbitda는 영업이익이 0 이하면 null이므로, 현금·부채·시총이 다 있는데 레버리지만
 * 빠지는 조건은 정확히 "그 회사가 영업 적자"라는 뜻이다 — 그걸 분모에서 빼주면 적자라는
 * 이유로 레버리지 감점을 면제받는다(CLFD: 영업손실 −$0.4M인데 순현금 하나로 5/5 만점,
 * 같은 순현금에 부채/영업이익 2.0배인 흑자 기업은 4.20점).
 *
 * 감쇠 분모는 결측의 원인으로 나뉜다.
 *  - **회사 사유**(분모에 포함): 현금·총부채 결측, 영업이익 결측 또는 0 이하.
 *  - **우리 데이터 사유**(분모에서 제외): 시가총액이 없어 순현금 비율을 못 구하는 경우.
 *    주가·발행주식수를 우리가 못 채운 것이지 회사의 결함이 아니다.
 *
 * 적자(FCF < 0) 기업의 런웨이 경로는 감쇠 대상이 아니다 — 현금을 태우는 기업에 대해
 * 런웨이는 보조 신호가 아니라 그 자체로 완결된 지표이며, 순현금·레버리지는 애초에 물어야
 * 할 질문이 아니다.
 */
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

  // 시가총액이 없으면 순현금 신호는 평가 가능했어야 할 신호가 아니다(우리 쪽 사정).
  const netCashComparable = snapshot.marketCap !== null && snapshot.marketCap > 0
  const applicable = netCashComparable ? SIGNAL_COUNT : SIGNAL_COUNT - 1

  const signals: { weight: number; score: number; label: string }[] = []
  if (netCash !== null) {
    signals.push({
      weight: f.profitable_blend.net_cash,
      score: interpolate(f.net_cash_curve, netCash),
      label: `순현금 시총 대비 ${pct(netCash)}`,
    })
  }
  if (leverage !== null) {
    signals.push({
      weight: f.profitable_blend.leverage,
      score: interpolate(f.leverage_curve, leverage),
      label: `부채/영업이익 ${leverage.toFixed(1)}배`,
    })
  }

  if (signals.length < f.min_signals) {
    return noData(KEY, f.weight, '현금·부채 데이터 없음')
  }

  // 신호가 둘 다 있으면 profitable_blend 그대로, 하나뿐이면 그 신호 자체가 평균이다.
  const totalWeight = signals.reduce((s, x) => s + x.weight, 0)
  const mean = signals.reduce((s, x) => s + x.weight * x.score, 0) / totalWeight
  const coverage = signals.length / applicable
  const damping = interpolate(f.coverage_curve, coverage)
  const normalized = mean * damping

  const parts = [signals.map((s) => s.label).join(' · ')]
  if (netCash === null && netCashComparable) parts.push('순현금 산출 불가')
  if (leverage === null) parts.push('레버리지 산출 불가')
  if (!netCashComparable) parts.push('시가총액 없음 — 순현금은 평가 불가로 분모에서 제외')
  parts.push(
    damping < 1
      ? `평가 가능 ${applicable}개 중 ${signals.length}개 신호 · 커버리지 감쇠 ×${damping.toFixed(2)}`
      : `평가 가능 ${applicable}개 신호 전부 · 감쇠 없음`,
  )

  // raw는 원시 지표(§8.1) — 순현금 비율을 우선하고, 없으면 레버리지 배수를 남긴다.
  const raw = netCash !== null ? netCash : leverage
  return scored(KEY, f.weight, raw, normalized, parts.join(' · '))
}
