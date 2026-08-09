const TONES = {
  leader: 'border-[var(--color-info)] text-[var(--color-info)]',
  challenger: 'border-[var(--color-text-dim)] text-[var(--color-text-dim)]',
  emerging: 'border-[var(--color-emerging)] text-[var(--color-emerging)]',
  risk: 'border-[var(--color-risk)] text-[var(--color-risk)]',
  watch: 'border-[var(--color-watch)] text-[var(--color-watch)]',
  neutral: 'border-[var(--color-border)] text-[var(--color-text-faint)]',
} as const

export function Badge({
  children, tone = 'neutral',
}: {
  children: React.ReactNode
  tone?: keyof typeof TONES
}) {
  return (
    <span className={`inline-block rounded border px-1.5 py-0.5 text-[11px] leading-none ${TONES[tone]}`}>
      {children}
    </span>
  )
}

export function CategoryBadge({ category }: { category: string | null }) {
  if (!category) return null
  const tone =
    category === 'LEADER' ? 'leader'
    : category === 'EMERGING' ? 'emerging'
    : 'challenger'
  return <Badge tone={tone}>{category}</Badge>
}
