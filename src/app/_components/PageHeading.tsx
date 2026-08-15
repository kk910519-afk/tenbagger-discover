/**
 * 페이지/섹션 제목 줄의 공통 골격. 왼쪽은 제목과 그에 딸린 사실(브레드크럼·집계 수치),
 * 오른쪽은 "이게 뭔지" 한 줄 설명이다. 설명을 우측 정렬로 반대편에 붙여야 제목 아래
 * 사실 줄과 섞이지 않는다. note가 없으면 오른쪽 칸 자체를 렌더링하지 않는다 —
 * 빈 자리를 남기지 않는다.
 */
export function PageHeading({
  note,
  children,
}: {
  note?: string | null
  children: React.ReactNode
}) {
  return (
    <div className="editorial-section-heading flex flex-wrap items-end justify-between gap-x-10 gap-y-3">
      <div>{children}</div>
      {note && (
        <p className="max-w-xl text-[0.95rem] leading-8 text-[var(--color-text-dim)] sm:text-right">
          {note}
        </p>
      )}
    </div>
  )
}
