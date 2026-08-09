import { formatScore } from '../_lib/format'

/**
 * 점수는 위치와 굵기로 먼저 구분하고 색은 보조로만 쓴다.
 * 막대 길이가 주된 신호다.
 */
export function ScoreBar({
  value, max = 100, label,
}: {
  value: number | null
  max?: number
  label?: string
}) {
  const pctWidth = value === null ? 0 : Math.max(0, Math.min(100, (value / max) * 100))
  return (
    <div className="flex items-center gap-2">
      {label && <span className="w-44 shrink-0 text-xs text-[var(--color-text-dim)]">{label}</span>}
      <div className="h-1.5 w-full min-w-24 bg-[var(--color-surface-2)]">
        <div className="h-full bg-[var(--color-text)]" style={{ width: `${pctWidth}%` }} />
      </div>
      <span className="num w-10 shrink-0 text-right text-xs">
        {value === null ? '—' : formatScore(value)}
      </span>
    </div>
  )
}
