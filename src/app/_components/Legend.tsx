export type LegendItem = { label: string; help: string }

/**
 * 표/지표 블록 위에 항상 보이는 범례의 공통 레이아웃. "이 숫자가 뭔지"만 짧게 답한다 —
 * "어떻게 해석할지"는 헤더 툴팁이 맡는다. 블록당 한 번만 렌더링한다.
 *
 * 항목은 좌우 두 열로 나뉘고, 홀수면 왼쪽 열이 하나 더 가져간다(7개 → 좌 4 / 우 3).
 * grid-flow-col + grid-rows-N이라야 열 우선으로 채워진다 — 기본 행 우선이면 항목이
 * 좌우로 번갈아 들어가 읽는 순서가 끊긴다. auto-cols-fr로 두 열 폭을 같게 고정하고,
 * dt를 고정폭으로 잡아 설명 시작 지점을 세로로 맞춘다.
 */
const ROWS_CLASS: Record<number, string> = {
  1: 'sm:grid-rows-1',
  2: 'sm:grid-rows-2',
  3: 'sm:grid-rows-3',
  4: 'sm:grid-rows-4',
  5: 'sm:grid-rows-5',
  6: 'sm:grid-rows-6',
}

export function Legend({
  items,
  labelWidth = 'w-24',
  className = 'mb-4',
}: {
  items: LegendItem[]
  /** 라벨이 긴 범례는 호출부에서 넓혀 잡는다 (예: 'w-44'). */
  labelWidth?: string
  className?: string
}) {
  if (items.length === 0) return null
  const rows = ROWS_CLASS[Math.ceil(items.length / 2)] ?? 'sm:grid-rows-6'

  return (
    <dl
      className={`${className} grid gap-x-12 gap-y-3 text-[0.82rem] leading-6 text-[var(--color-text-dim)] sm:auto-cols-fr sm:grid-flow-col ${rows}`}
    >
      {items.map((item) => (
        <div key={item.label} className="flex gap-2">
          <dt className={`${labelWidth} shrink-0 text-[var(--color-risk)]`}>
            {item.label}
          </dt>
          <dd>{item.help}</dd>
        </div>
      ))}
    </dl>
  )
}
