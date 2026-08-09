/**
 * emphasize: 이 그리드가 "KPI"(Tenbagger Score/Market Cap/Price 같은 헤드라인
 * 수치)를 담고 있을 때만 켠다. 라벨은 항상 같은 크기·색이고(다른 MetricGrid와
 * 시각 언어가 어긋나지 않도록) 값만 한 단계 커지고 굵어진다 — 값이 숫자든
 * 문자열이든 이 그리드의 항목은 전부 페이지에서 가장 먼저 읽혀야 하는
 * 수치라는 것을 명시적으로 표시한다.
 */
export function MetricGrid({
  items, emphasize = false,
}: {
  items: { label: string; value: React.ReactNode }[]
  emphasize?: boolean
}) {
  return (
    <dl className="grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-3 lg:grid-cols-4">
      {items.map((i) => (
        <div key={i.label}>
          <dt className="text-xs text-[var(--color-text-faint)]">{i.label}</dt>
          <dd className={emphasize ? 'mt-1 text-xl font-medium' : 'mt-0.5 text-sm'}>{i.value}</dd>
        </div>
      ))}
    </dl>
  )
}
