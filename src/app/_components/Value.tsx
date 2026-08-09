/** 숫자 표시. 의미가 있을 때만 색을 쓴다. */
export function Value({
  children, tone = 'neutral', dim = false,
}: {
  children: React.ReactNode
  tone?: 'neutral' | 'positive' | 'risk' | 'watch'
  dim?: boolean
}) {
  const color =
    tone === 'positive' ? 'text-[var(--color-positive)]'
    : tone === 'risk' ? 'text-[var(--color-risk)]'
    : tone === 'watch' ? 'text-[var(--color-watch)]'
    : dim ? 'text-[var(--color-text-dim)]'
    : ''
  return <span className={`num ${color}`}>{children}</span>
}

/** 부호에 따라 색을 정하는 값. 0은 중립. */
export function SignedValue({ value, text }: { value: number | null; text: string }) {
  const tone = value === null ? 'neutral' : value > 0 ? 'positive' : value < 0 ? 'risk' : 'neutral'
  return <Value tone={tone}>{text}</Value>
}
