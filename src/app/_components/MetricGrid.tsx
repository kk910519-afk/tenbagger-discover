export function MetricGrid({
  items,
}: {
  items: { label: string; value: React.ReactNode }[]
}) {
  return (
    <dl className="grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-3 lg:grid-cols-4">
      {items.map((i) => (
        <div key={i.label}>
          <dt className="text-xs text-[var(--color-text-dim)]">{i.label}</dt>
          <dd className="mt-0.5 text-sm">{i.value}</dd>
        </div>
      ))}
    </dl>
  )
}
