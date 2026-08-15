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
    // data-metric-grid: 같은 페이지의 Legend도 dt/dd로 같은 라벨을 쓴다. 라벨로 값 칸을
    // 찾는 쪽(테스트 포함)이 범례를 값으로 착각하지 않도록 값 그리드에 표식을 남긴다.
    <dl data-metric-grid className="grid grid-cols-2 border-y border-[var(--color-border-strong)] sm:grid-cols-3 lg:grid-cols-4">
      {items.map((i) => (
        <div key={i.label} className="min-h-24 border-b border-r border-[var(--color-border)] p-4 last:border-r-0 sm:border-b-0">
          <dt className="text-[10px] uppercase tracking-[0.08em] text-[var(--color-text-faint)]">{i.label}</dt>
          <dd className={emphasize ? 'mt-3 font-serif text-2xl' : 'mt-2 font-serif text-base'}>{i.value}</dd>
        </div>
      ))}
    </dl>
  )
}
