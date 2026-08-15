import { formatScore } from '../_lib/format'

/**
 * 점수는 위치와 굵기로 먼저 구분하고 색은 보조로만 쓴다.
 * 막대 길이가 주된 신호다.
 *
 * null(미평가)과 0(실제 0점)은 다른 사실이므로 트랙 자체를 다르게 그린다:
 * null은 채움 막대 없이 점선 트랙만, 0은 실선 트랙에 길이 0인 채움(=시각적으로 안 보임)이다.
 * 색이 아니라 트랙의 선 스타일(점선 vs 실선)로 구분하므로 색각 이상에서도 구분된다.
 */
export function ScoreBar({
  value, max = 100, label,
}: {
  value: number | null
  max?: number
  label?: string
}) {
  const isUnknown = value === null
  const pctWidth = isUnknown ? 0 : Math.max(0, Math.min(100, (value / max) * 100))
  return (
    <div className="flex items-center gap-2">
      {/* 라벨 폭이 11rem으로 고정되면 390px 화면에서는 막대에 남는 자리가 거의 없다
          (라벨 176 + 막대 최소 96 + 숫자 40 + 여백 > 화면 폭). 좁은 화면에서만 라벨을
          줄여 막대가 실제로 길이를 신호로 쓸 수 있게 한다. */}
      {label && <span className="w-28 shrink-0 break-keep text-xs text-[var(--color-text-dim)] sm:w-44">{label}</span>}
      <div
        data-score-state={isUnknown ? 'unknown' : 'value'}
        className={
          isUnknown
            ? 'h-1 w-full min-w-24 border border-dashed border-[var(--color-text-faint)]'
            : 'h-1 w-full min-w-24 bg-[var(--color-surface-2)]'
        }
      >
        {!isUnknown && <div className="h-full bg-[var(--color-risk)]" style={{ width: `${pctWidth}%` }} />}
      </div>
      <span className="num w-10 shrink-0 text-right text-xs">
        {isUnknown ? '—' : formatScore(value)}
      </span>
    </div>
  )
}
