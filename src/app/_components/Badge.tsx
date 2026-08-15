const TONES = {
  leader: 'border-[var(--color-info)] text-[var(--color-info)]',
  challenger: 'border-[var(--color-text-dim)] text-[var(--color-text-dim)]',
  emerging: 'border-[var(--color-emerging)] text-[var(--color-emerging)]',
  risk: 'border-[var(--color-risk)] bg-[var(--color-risk)] text-[#fffaf1]',
  watch: 'border-[#b57800] bg-[#f2cc63] text-[#473100]',
  neutral: 'border-[var(--color-border)] text-[var(--color-text-faint)]',
  /** Value의 positive 톤과 같은 색(--color-positive) — 밸류에이션 섹션에서 "양호"를 표시할 때 쓴다. */
  positive: 'border-[var(--color-positive)] text-[var(--color-positive)]',
} as const

export function Badge({
  children, tone = 'neutral',
}: {
  children: React.ReactNode
  tone?: keyof typeof TONES
}) {
  return (
    <span className={`inline-flex items-center justify-center border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.07em] leading-none ${TONES[tone]}`}>
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
