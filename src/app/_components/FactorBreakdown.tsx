import type { AppConfig } from '@/config'
import type { FactorView } from '../_queries/stock'
import { formatPct, formatUsd, compactMagnitude } from '../_lib/format'
import { factorsByFillRatio, splitStrengthWeakness } from '../_lib/strengths'
import { ScoreBar } from './ScoreBar'
import { Badge } from './Badge'

const LABELS: Record<string, string> = {
  revenue_growth: '매출 성장',
  revenue_acceleration: '매출 가속도',
  tam_industry_growth: 'TAM / 산업 성장',
  gross_margin: '매출총이익률',
  operating_leverage: '영업 레버리지',
  market_cap_opportunity: '시가총액 기회',
  competitive_advantage: '경쟁우위 (재무 프록시)',
  balance_sheet: '재무 안정성',
  institutional_insider: '기관 / 내부자',
}

const labelOf = (key: string) => LABELS[key] ?? key

/** percentile은 0~1의 "하위 비율"이다. 화면에는 투자자가 곧바로 쓰는 "상위 몇%"로 뒤집어 보여준다. */
function industryRankLabel(percentile: number): string {
  return `산업 상위 ${Math.round((1 - percentile) * 100)}%`
}

/** revenue_acceleration의 raw는 YoY 성장률 자체의 변화량 — 비율(%)이 아니라 퍼센트포인트(%p)다. */
function formatPctPoints(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return '—'
  const sign = v > 0 ? '+' : ''
  return `${sign}${compactMagnitude(v * 100, 1)}%p`
}

/**
 * 기저효과로 비율이 정보를 잃은 raw 값의 표기.
 *
 * raw 칸은 숫자 하나짜리 자리라 "그 비율을 만든 두 값"을 적을 수 없다 — 그 설명은 바로
 * 옆의 detail 문자열이 이미 하고 있다(엔진이 기저 금액을 거기에 적는다). 그래서 이 칸은
 * 숫자를 지어내거나 조용히 깎는 대신 **한계를 넘었다는 사실만** 말하고 판단 근거는
 * detail로 넘긴다. 성장률만은 예외로 배수를 그대로 쓸 수 있어(1 + 성장률) 손실 없이 적는다.
 */
const EXTREME_LABEL = '극단값'

/**
 * competitive_advantage의 raw는 실측 재무 지표가 아니다 — ROIC 스프레드·마진 안정성·
 * 산업 대비 마진·R&D 집약도, 4개 신호를 커브로 정규화해 평균낸 0~1 합성 점수 그 자체다
 * (engines/tenbagger/factors/competitive-advantage.ts: `scored(KEY, f.weight, normalized, normalized, ...)`).
 * 델타가 아니므로 부호 없는 백분율로 보여준다.
 */
function formatCompositeScore(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return '—'
  return `${Math.round(v * 100)}%`
}

/**
 * operating_leverage와 balance_sheet는 raw 한 칸에 서로 다른 스케일의 지표가 들어갈 수 있다.
 * operating_leverage: 영업이익률 변화(퍼센트포인트, 예: 3.5) 또는 매출-비용 증가율 격차
 * (비율, 예: 0.05) 중 계산 가능한 쪽이 raw가 된다 — 저장된 숫자만 봐서는 어느 쪽인지 구분할
 * 방법이 없다(engines/tenbagger/factors/operating-leverage.ts 주석 "raw는 실제로 채점에
 * 쓰인 값을 담는다" 참고). balance_sheet도 마찬가지로 현금 런웨이(분기 수)·순현금/시총 비율·
 * 부채/영업이익 배수 중 하나가 raw로 들어간다. 잘못된 단위(%나 배)를 단정해서 보여주는 것이
 * 실제 값보다 더 위험하므로, 부호 있는 순수 숫자로만 보여준다 — 정확한 단위와 값은 옆의
 * detail 문자열에 있다.
 */
function formatAmbiguousUnit(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return '—'
  const sign = v > 0 ? '+' : ''
  return `${sign}${compactMagnitude(v, 2)}`
}

const RAW_FORMATTERS: Record<string, (v: number | null) => string> = {
  revenue_growth: formatPct,
  revenue_acceleration: formatPctPoints,
  tam_industry_growth: formatPct,
  gross_margin: formatPct,
  operating_leverage: formatAmbiguousUnit,
  market_cap_opportunity: formatUsd,
  competitive_advantage: formatCompositeScore,
  balance_sheet: formatAmbiguousUnit,
}

export type ExtremeDisplay = AppConfig['scoring']['extreme_display']

/**
 * 매핑에 없는(향후 추가될) 팩터 키는 부호 있는 순수 숫자로 안전하게 대체한다.
 *
 * 표기 한계(config.yaml scoring.extreme_display)를 넘는 세 팩터는 detail이 이미 기저
 * 금액으로 다시 쓰여 있으므로 raw 칸도 그에 맞춘다. operating_leverage의 raw는
 * 영업이익률 변화(%p)일 수도 매출-비용 격차(비율)일 수도 있는데, 둘 다 %p 한계로
 * 재면 격차 쪽은 실질적으로 걸리지 않는다(격차 100 = +10,000%p).
 */
function formatFactorRaw(key: string, raw: number | null, extreme: ExtremeDisplay): string {
  if (raw !== null && Number.isFinite(raw)) {
    const abs = Math.abs(raw)
    // 성장률은 배수(1 + 성장률)로 손실 없이 옮겨 적을 수 있다.
    if (key === 'revenue_growth' && abs >= extreme.growth_ratio) {
      return `${(1 + raw).toFixed(0)}배`
    }
    if (key === 'revenue_acceleration' && abs >= extreme.growth_ratio) return EXTREME_LABEL
    if (key === 'operating_leverage' && abs >= extreme.margin_delta_points) return EXTREME_LABEL
  }
  const fmt = RAW_FORMATTERS[key] ?? formatAmbiguousUnit
  return fmt(raw)
}

/**
 * "왜 이 점수인가"에 답하지 못하는 점수는 투자 판단에 쓸 수 없다.
 * 각 팩터의 배점·원시 지표·설명·산업 백분위를 함께 보여준다.
 * 계산할 데이터가 없었던 팩터(NO_DATA)와 아직 구현되지 않은 팩터(NOT_IMPLEMENTED)는
 * 서로 다른 사실이므로 다른 배지로 구분한다.
 */
export function FactorBreakdown({
  factors,
  extreme,
}: {
  factors: FactorView[]
  /** cfg.scoring.extreme_display — 표기 한계는 코드가 아니라 config.yaml에 산다. */
  extreme: ExtremeDisplay
}) {
  return (
    <div className="space-y-3">
      {factors.map((f) => (
        <div key={f.key} className="border-b border-[var(--color-border)] pb-3 last:border-0">
          <div className="flex items-baseline gap-2">
            <ScoreBar value={f.points} max={f.weight} label={labelOf(f.key)} />
            <span className="num shrink-0 text-xs text-[var(--color-text-faint)]">
              /{f.weight}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 pl-44 text-xs text-[var(--color-text-dim)]">
            <span className="num text-[var(--color-text)]">
              {formatFactorRaw(f.key, f.raw, extreme)}
            </span>
            <span>{f.detail}</span>
            {f.status === 'NO_DATA' && <Badge tone="watch">NO DATA</Badge>}
            {f.status === 'NOT_IMPLEMENTED' && <Badge>PHASE 4</Badge>}
            {f.percentile !== null && (
              <span className="text-[var(--color-text-faint)]">{industryRankLabel(f.percentile)}</span>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * 강점/약점은 배점(절대 점수)이 아니라 배점 대비 획득 비율(fill ratio)로 가른다.
 * 5점 만점에 5점을 받은 팩터가 20점 만점에 12점을 받은 팩터보다 더 큰 강점이다.
 * 계산되지 않은 팩터(NO_DATA/NOT_IMPLEMENTED)는 비교 대상이 아니므로 제외한다.
 *
 * 상위/하위를 고르는 규칙은 splitStrengthWeakness에 있다 — 채점된 팩터가 6개 미만이면
 * 같은 팩터가 두 칸에 동시에 뜨지 않도록 칸마다 최대 floor(n/2)개만 채우고, 비교할
 * 상대가 없으면(0~1개) 패널 자체를 렌더링하지 않는다.
 */
export function StrengthWeakness({ factors }: { factors: FactorView[] }) {
  const scored = factorsByFillRatio(factors)
  const { top, bottom } = splitStrengthWeakness(scored)

  // splitStrengthWeakness는 채점된 팩터가 0~1개면(비교 상대가 없음) 두 칸 모두 비운다.
  // 예전에는 이때 패널을 통째로 렌더링하지 않아 왜 없는지 설명이 없었다 — 이 코드베이스는
  // 데이터가 빠졌을 때 그냥 침묵하지 않고 이유를 한 줄로 말하는 스타일이다(예: "스코어링
  // 미실행 —", "밸류에이션 미실행 —"). 카드나 패널 구조를 새로 만들지 않고 같은 자리에
  // 문장 한 줄만 놓는다.
  if (top.length === 0) {
    return (
      <p className="text-xs text-[var(--color-text-faint)]">
        비교할 팩터 부족 — 스코어링된 팩터가 {scored.length}개뿐이라 강점/약점을 가릴 수 없습니다
      </p>
    )
  }

  return (
    <div className="grid gap-6 sm:grid-cols-2">
      <div>
        <h3 className="mb-1 text-xs text-[var(--color-text-dim)]">Strength</h3>
        <ul className="space-y-0.5 text-sm">
          {top.map((f) => (
            <li key={f.key} className="flex items-center justify-between gap-2">
              <span>{labelOf(f.key)}</span>
              <span className="num text-xs text-[var(--color-text-faint)]">
                {Math.round(f.fill * 100)}%
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h3 className="mb-1 text-xs text-[var(--color-text-dim)]">Weakness</h3>
        <ul className="space-y-0.5 text-sm">
          {bottom.map((f) => (
            <li key={f.key} className="flex items-center justify-between gap-2">
              <span>{labelOf(f.key)}</span>
              <span className="num text-xs text-[var(--color-text-faint)]">
                {Math.round(f.fill * 100)}%
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
