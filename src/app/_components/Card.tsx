import type { ReactNode } from 'react'

/**
 * 셸 전역에서 쓰는 카드 표면. 제목·부제(1줄)·본문 세 슬롯만 있다 — 카드 자체는
 * 장식하지 않고(그라디언트·그림자 없음) 보더와 여백으로만 구획을 나눈다.
 * `action`은 카드 우상단에 붙는 보조 요소(예: "View All" 링크) 자리다.
 */
export function Card({
  title, subtitle, action, children, id,
}: {
  title: string
  subtitle?: string
  action?: ReactNode
  children: ReactNode
  id?: string
}) {
  return (
    <section
      id={id}
      className="rounded-[var(--radius-card)] border border-[var(--color-card-border)] bg-[var(--color-card-bg)] p-5"
    >
      <div className="mb-4 flex items-start justify-between gap-3 border-b border-[var(--color-border)] pb-3">
        <div>
          <h2 className="text-sm font-medium tracking-wide text-[var(--color-text)]">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-[var(--color-text-faint)]">{subtitle}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {children}
    </section>
  )
}
