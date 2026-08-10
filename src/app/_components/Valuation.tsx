import type { ValuationView } from '@/app/_queries/stock'
import { formatPct } from '@/app/_lib/format'
import {
  fairValueReasonLabel,
  moatInsufficientReasonLabel,
  priceToFairValueUnavailableReason,
  MOAT_SIGNAL_LABELS,
  UNCERTAINTY_DRIVER_LABELS,
  UNCERTAINTY_LEVEL_LABELS,
  moatTone,
  valuationStatusTone,
  uncertaintyTone,
} from '@/app/_lib/valuation'
import { Value, SignedValue } from './Value'
import { Badge } from './Badge'
import { Tooltip } from './Tooltip'

const DASH = '—'

/**
 * "어떻게 해석할지"를 담는 5종 툴팁. "무엇인지"는 이 컴포넌트 상단의 상시 도입 설명문이
 * 답한다 — ColumnLegend/헤더 툴팁과 같은 역할 분담(브리프 §도입 설명문).
 */
const TOOLTIPS = {
  moat:
    'ROIC가 최근 연간 실적에서 자본비용(WACC)을 얼마나 꾸준히 웃돌았는지를 봅니다. PERSISTENT는 대부분의 ' +
    '해에서, INTERMITTENT는 일부 해에서 넘었다는 뜻이고, ABSENT는 따져봤지만 이어지는 초과 수익이 없었다는 ' +
    '뜻입니다. 평가할 연간 데이터가 부족하거나 ROIC 자체가 정의되지 않는 기업이면(예: 현금이 투입 자본보다 ' +
    '많은 초기 성장 단계) 판정하지 않고 그 이유를 따로 밝힙니다 — "없었다"와 "따져볼 수 없었다"는 다른 ' +
    '이야기이므로 절대 같은 칸에 넣지 않습니다. 마진이나 성장률만으로는 주지 않습니다 — 지속성이 기준입니다.',
  fairValue:
    '미래 잉여현금흐름을 예측해 오늘 가치로 할인한 주당 내재가치입니다. 매출이 없거나, 성장률을 추정할 이력이 ' +
    '없거나, 현금을 만들어내지 못하거나, 주식수·현금·부채 정보가 없으면 계산하지 않고 이유를 밝힙니다. ' +
    '예측이 끝나는 해의 매출이 지금의 몇 배가 되어야 하는지도 함께 보고, 그 배수가 너무 크면 역시 계산하지 ' +
    '않습니다 — 그만큼의 확대를 전제한 값은 회사에 대한 측정이 아니라 우리가 고른 가정이기 때문입니다.',
  priceToFairValue:
    '현재가를 Fair Value로 나눈 비율입니다. 1보다 작으면 시장가가 내재가치보다 낮다는 뜻이고, 1보다 크면 그 ' +
    '반대입니다. Fair Value가 없으면 이 비율도 없습니다.',
  marginOfSafety:
    '(Fair Value − 현재가) / Fair Value입니다. 양수면 안전마진이 있다는 뜻(저평가 방향)이고, 음수면 프리미엄이 ' +
    '붙어 있다는 뜻입니다. 절대적인 매수 신호가 아니라 비교의 크기를 보여줄 뿐입니다.',
  uncertainty:
    '이 내재가치 추정을 얼마나 확신할 수 있는지를 나타냅니다 — 주가 변동성이 아닙니다. 매출 예측가능성· ' +
    '영업 레버리지·재무 레버리지·데이터 완전성 네 가지를 측정해 평균 낸 값이고, 사업 집중도는 이번 단계에서 ' +
    '측정하지 않습니다. MINIMAL → MODERATE → ELEVATED → SEVERE 순으로 확신이 낮아집니다.',
} as const

function formatPerShare(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return DASH
  return `$${v.toFixed(2)}`
}

function formatRatio(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return DASH
  return `${v.toFixed(2)}x`
}

/**
 * 종목 상세의 밸류에이션 섹션 — Moat Signal → Fair Value → Price/Fair Value+Margin of
 * Safety → Uncertainty 순서를 반드시 지킨다(브리프 §표시 순서, 사용자가 정한 순서다).
 * Tenbagger Score와는 끝까지 분리된 축이라 이 컴포넌트는 tenbagger/factors를 전혀
 * 참조하지 않는다 — 두 축을 하나의 값으로 합치는 코드 경로 자체가 없다.
 */
export function ValuationSection({
  valuation, price,
}: {
  valuation: ValuationView | null
  price: number | null
}) {
  return (
    <section>
      <div className="mb-1 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h2 className="text-sm">Valuation</h2>
        <span className="text-[10px] uppercase tracking-wide text-[var(--color-text-faint)]">
          Morningstar-Inspired · Intrinsic Value Framework
        </span>
      </div>
      <p className="mb-4 max-w-3xl text-xs text-[var(--color-text-faint)]">
        네 지표는 저평가 여부를 사람이 직접 판단할 수 있도록 근거를 보여주는 데 목적이 있습니다. Moat
        Signal은 이 회사가 꾸준히 자본비용을 웃도는 수익을 내는지를 보고, 그 위에서 Fair Value는 미래
        현금흐름을 오늘 가치로 환산한 값을 냅니다. Price to Fair Value와 Margin of Safety는 현재가를 그
        값과 비교하고, Uncertainty는 이 비교를 얼마나 확신할 수 있는지를 마지막에 밝힙니다.
      </p>

      {valuation === null ? (
        <p className="text-xs text-[var(--color-text-faint)]">
          밸류에이션 미실행 — 파이프라인이 아직 이 종목을 평가하지 않았습니다
        </p>
      ) : (
        <div className="space-y-4">
          {/* 1. Moat Signal — "Economic Moat"라는 라벨은 절대 쓰지 않는다(브리프 §명칭과 프레이밍). */}
          <div className="border-b border-[var(--color-border)] pb-4">
            <div className="flex items-center gap-2">
              <span className="w-44 shrink-0 text-xs text-[var(--color-text-dim)]">
                <Tooltip text={TOOLTIPS.moat}>Moat Signal</Tooltip>
              </span>
              {valuation.moatSignal === 'INSUFFICIENT_DATA' ? (
                <Value dim>{DASH}</Value>
              ) : (
                <Badge tone={moatTone(valuation.moatSignal)}>{valuation.moatSignal}</Badge>
              )}
            </div>
            {/* 등급 이름은 영문 코드다 — 프레임워크를 모르는 사람이 읽을 한국어 한 줄을
                반드시 함께 낸다. INSUFFICIENT_DATA는 등급 설명이 아니라 "왜 판정하지
                않았는지"를 세 사유로 나눠 말한다(그 구분이 이 섹션의 핵심이다). */}
            <p className="mt-1 pl-44 text-xs text-[var(--color-text-dim)]">
              {valuation.moatSignal === 'INSUFFICIENT_DATA'
                ? moatInsufficientReasonLabel(valuation.moatInsufficientReason)
                : `${MOAT_SIGNAL_LABELS[valuation.moatSignal]} — ${valuation.moatEvidence.join(' · ')}`}
            </p>
          </div>

          {/* 2. Fair Value */}
          <div className="border-b border-[var(--color-border)] pb-4">
            <div className="flex items-center gap-2">
              <span className="w-44 shrink-0 text-xs text-[var(--color-text-dim)]">
                <Tooltip text={TOOLTIPS.fairValue}>Fair Value</Tooltip>
              </span>
              <Value>{formatPerShare(valuation.fairValuePerShare)}</Value>
            </div>
            <p className="mt-1 pl-44 text-xs text-[var(--color-text-dim)]">
              {valuation.fairValueStatus === 'OK'
                ? valuation.fairValueDetail
                : fairValueReasonLabel(valuation.fairValueReason)}
            </p>
          </div>

          {/* 3. Price / Fair Value + Margin of Safety — Fair Value가 없으면 이 둘도 없다(연쇄). */}
          <div className="border-b border-[var(--color-border)] pb-4">
            <div className="flex flex-wrap items-center gap-x-8 gap-y-2">
              <div className="flex items-center gap-2">
                <span className="w-44 shrink-0 text-xs text-[var(--color-text-dim)]">
                  <Tooltip text={TOOLTIPS.priceToFairValue}>Price / Fair Value</Tooltip>
                </span>
                <Value tone={valuationStatusTone(valuation.valuationStatus)}>
                  {formatRatio(valuation.priceToFairValueRatio)}
                </Value>
                {valuation.valuationStatus !== null && (
                  <Badge tone={valuationStatusTone(valuation.valuationStatus)}>
                    {valuation.valuationStatus}
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-[var(--color-text-dim)]">
                  <Tooltip text={TOOLTIPS.marginOfSafety}>Margin of Safety</Tooltip>
                </span>
                <SignedValue value={valuation.marginOfSafety} text={formatPct(valuation.marginOfSafety)} />
              </div>
            </div>
            {valuation.priceToFairValueStatus === 'UNAVAILABLE' && (
              <p className="mt-1 pl-44 text-xs text-[var(--color-text-dim)]">
                {priceToFairValueUnavailableReason(
                  valuation.fairValueStatus,
                  valuation.fairValuePerShare,
                  price,
                )}
              </p>
            )}
          </div>

          {/* 4. Uncertainty */}
          <div>
            <div className="flex items-center gap-2">
              <span className="w-44 shrink-0 text-xs text-[var(--color-text-dim)]">
                <Tooltip text={TOOLTIPS.uncertainty}>Uncertainty</Tooltip>
              </span>
              <Badge tone={uncertaintyTone(valuation.uncertaintyLevel)}>{valuation.uncertaintyLevel}</Badge>
              <Value dim>{Math.round(valuation.uncertaintyScore * 100)}%</Value>
            </div>
            <p className="mt-1 pl-44 text-xs text-[var(--color-text-dim)]">
              {UNCERTAINTY_LEVEL_LABELS[valuation.uncertaintyLevel]}
            </p>
            <ul className="mt-1 space-y-0.5 pl-44 text-xs text-[var(--color-text-dim)]">
              {valuation.uncertaintyDrivers.map((dr) => (
                <li key={dr.key} className="flex flex-wrap items-baseline gap-x-2">
                  <span className="w-28 shrink-0 text-[var(--color-text-faint)]">
                    {UNCERTAINTY_DRIVER_LABELS[dr.key]}
                  </span>
                  <span>{dr.detail}</span>
                  {dr.status === 'UNAVAILABLE' && <Badge tone="watch">NO DATA</Badge>}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </section>
  )
}
