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

/**
 * TTM 재무 값이 회사가 신고한 분기값이 아니라 누적 공시(YTD/연간) 간 차분으로 유도됐을 때
 * 값 바로 아래 붙이는 안내. 표지 발행주식수 대신 희석평균주식수를 쓴 시가총액의
 * "근사치" 캐비어트(stock/[ticker]/page.tsx)와 톤을 맞추되 문구는 다르다 — 이 값은
 * 추정이 아니라 회사가 신고한 두 누적 수치를 뺀 산술 결과이므로, "근사치"라고 하면
 * 오히려 신뢰도를 실제보다 낮게 말하는 셈이다. 어떻게 얻었는지만 사실대로 알린다.
 */
export function DerivedNote() {
  return (
    <span className="mt-1 block text-[10px] font-normal normal-case leading-snug text-[var(--color-text-faint)]">
      계산됨 — 해당 분기가 별도로 보고되지 않아 누적 공시 간 차분으로 계산했습니다.
    </span>
  )
}
