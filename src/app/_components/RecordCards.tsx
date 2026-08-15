import type { ReactNode } from 'react'

/**
 * 좁은 화면(<md)에서 표를 대신하는 카드 목록.
 *
 * 표를 그대로 두고 `overflow-x-auto`만 걸면 두 가지가 동시에 망가진다. `w-full`인 표는
 * 넘치기 전에 먼저 **줄어들어서** 열이 컨테이너 폭에 맞춰 짜부라지고, 그 결과 "평균 점수"
 * 같은 한글 헤더가 한 글자씩 세로로 쪼개진다(줄바꿈 기회가 공백뿐이라 폭이 모자라면
 * 글자 단위로 끊긴다). 그러고도 모자라면 마지막 열들이 스크롤 밖으로 밀려나는데,
 * 화면에는 잘렸다는 표시가 남지 않아 읽는 쪽은 열이 있는 줄도 모른다.
 *
 * 그래서 md 미만에서는 행을 세로로 눕힌다 — 한 행이 카드 하나가 되고, 열 헤더는
 * 값 옆의 라벨이 된다. 8~9열짜리 표를 가로로 밀며 읽게 하는 것보다, 한 기업씩 위에서
 * 아래로 읽는 편이 이 리포트의 읽는 방식("무엇부터 볼지")에도 맞는다.
 *
 * 표와 카드는 같은 데이터를 두 번 그리지만 한쪽은 항상 `display: none`이라 접근성
 * 트리에도 하나만 남는다(aria-hidden이 필요 없다).
 */
export type RecordField = {
  label: string
  value: ReactNode
  /** 두 칸을 다 쓴다. 값이 길거나(티커+점수) 다른 항목보다 먼저 읽혀야 할 때. */
  span?: boolean
}

export type RecordCardItem = {
  /** React key. 보통 티커나 slug. */
  key: string
  /** 좌상단 순번(예: '01'). 표의 # 열에 해당한다. */
  rank?: string
  title: ReactNode
  /** 제목을 감쌀 링크. 표에서 제목 셀이 링크였다면 카드에서도 링크여야 한다. */
  href?: string
  subtitle?: ReactNode
  meta?: ReactNode
  /** 우상단에 크게 뽑는 단 하나의 수치. 이 표가 무엇으로 정렬되는지를 보여준다. */
  headline?: { label: string; value: ReactNode }
  fields: RecordField[]
  /** 카드 맨 아래 한 문단 — 근거 문장이나 배지처럼 폭을 다 쓰는 내용. */
  note?: ReactNode
}

export function RecordCards({ items, className = '' }: { items: RecordCardItem[]; className?: string }) {
  if (items.length === 0) return null

  return (
    <ul data-record-cards className={`border-t border-[var(--color-border-strong)] md:hidden ${className}`}>
      {items.map((item) => (
        <li key={item.key} className="border-b border-[var(--color-border)] py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 break-keep">
              <div className="flex flex-wrap items-baseline gap-x-2">
                {item.rank && <span className="num text-xs text-[var(--color-risk)]">{item.rank}</span>}
                {item.href ? (
                  <a href={item.href} className="font-serif text-[1.05rem] font-medium">
                    {item.title}
                  </a>
                ) : (
                  <span className="font-serif text-[1.05rem] font-medium">{item.title}</span>
                )}
              </div>
              {item.subtitle && (
                <div className="mt-0.5 text-[0.88rem] leading-6 text-[var(--color-text-dim)]">{item.subtitle}</div>
              )}
              {item.meta && <div className="mt-1 text-xs text-[var(--color-text-faint)]">{item.meta}</div>}
            </div>
            {item.headline && (
              <div className="shrink-0 text-right">
                <div className="text-[0.62rem] tracking-[0.08em] text-[var(--color-text-faint)] uppercase">
                  {item.headline.label}
                </div>
                <div className="num mt-1 font-serif text-2xl leading-none">{item.headline.value}</div>
              </div>
            )}
          </div>

          {item.fields.length > 0 && (
            <dl className="mt-3 grid grid-cols-2 gap-x-5 gap-y-1.5">
              {item.fields.map((field) => (
                <div
                  key={field.label}
                  className={`flex items-baseline justify-between gap-2 border-b border-dotted border-[var(--color-border)] pb-1 ${
                    field.span ? 'col-span-2' : ''
                  }`}
                >
                  <dt className="shrink-0 break-keep text-[0.68rem] tracking-[0.05em] text-[var(--color-text-faint)] uppercase">
                    {field.label}
                  </dt>
                  <dd className="text-right text-[0.9rem]">{field.value}</dd>
                </div>
              ))}
            </dl>
          )}

          {item.note && (
            <div className="mt-3 break-keep text-[0.86rem] leading-6 text-[var(--color-text-dim)]">{item.note}</div>
          )}
        </li>
      ))}
    </ul>
  )
}
