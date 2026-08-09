import type { FactorView } from '../_queries/stock'
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
