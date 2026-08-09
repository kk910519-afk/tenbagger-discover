import type { FactorView } from '../_queries/stock'
import { formatPct, formatUsd } from '../_lib/format'
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
  return `${sign}${(v * 100).toFixed(1)}%p`
}

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
  return `${sign}${v.toFixed(2)}`
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

/** 매핑에 없는(향후 추가될) 팩터 키는 부호 있는 순수 숫자로 안전하게 대체한다. */
function formatFactorRaw(key: string, raw: number | null): string {
  const fmt = RAW_FORMATTERS[key] ?? formatAmbiguousUnit
  return fmt(raw)
}

/**
 * "왜 이 점수인가"에 답하지 못하는 점수는 투자 판단에 쓸 수 없다.
 * 각 팩터의 배점·원시 지표·설명·산업 백분위를 함께 보여준다.
 * 계산할 데이터가 없었던 팩터(NO_DATA)와 아직 구현되지 않은 팩터(NOT_IMPLEMENTED)는
 * 서로 다른 사실이므로 다른 배지로 구분한다.
 */
export function FactorBreakdown({ factors }: { factors: FactorView[] }) {
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
            <span className="num text-[var(--color-text)]">{formatFactorRaw(f.key, f.raw)}</span>
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
 */
export function StrengthWeakness({ factors }: { factors: FactorView[] }) {
  const scored = factors
    .filter((f) => f.status === 'SCORED' && f.points !== null && f.weight > 0)
    .map((f) => ({ ...f, fill: f.points! / f.weight }))
    .sort((a, b) => b.fill - a.fill)

  if (scored.length === 0) return null
  const top = scored.slice(0, 3)
  const bottom = scored.slice(-3).reverse()

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
