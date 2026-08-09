import type { ReactNode } from 'react'
import { Badge } from './Badge'
import { TOP_NAV, SIDE_NAV, type NavItem } from './nav-items'

const TOPBAR_H = 'h-14'
const SIDEBAR_W = 'w-56'

/**
 * 앱 전체를 감싸는 셸: 고정 상단 바 + 고정 좌측 사이드바 + 스크롤되는 본문.
 * 지금 이 앱에 실재하는 라우트는 "/" 하나뿐이라(Industry·Stock 상세는 거기서
 * 드릴다운으로 도달), 상단 바의 "Discovery"와 사이드바의 "Overview"만 활성
 * 링크다. 나머지는 전부 `disabled` 버튼 + "PHASE n" 배지로 보여준다 — 없는
 * 기능을 링크로 위장하지 않는다.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <>
      <TopBar />
      <Sidebar />
      <div className={`${SIDEBAR_W.replace('w-', 'pl-')} ${TOPBAR_H.replace('h-', 'pt-')}`}>
        <main className="px-8 py-6">{children}</main>
      </div>
    </>
  )
}

function TopBar() {
  return (
    <header
      className={`fixed inset-x-0 top-0 z-40 ${TOPBAR_H} flex items-center gap-8 border-b border-[var(--color-border)] bg-[var(--color-bg)] px-6`}
    >
      <a href="/" className="flex shrink-0 items-center gap-2 text-sm tracking-wide">
        <span
          aria-hidden="true"
          className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--color-accent)]"
        />
        TENBAGGER <span className="text-[var(--color-text-dim)]">DISCOVERY</span>
      </a>
      <nav aria-label="주요 섹션">
        <ul className="flex items-center gap-1">
          {TOP_NAV.map((item) => (
            <li key={item.key}>
              <TopNavEntry item={item} />
            </li>
          ))}
        </ul>
      </nav>
    </header>
  )
}

function TopNavEntry({ item }: { item: NavItem }) {
  if (item.phase === null) {
    // 이 앱의 유일한 활성 최상위 섹션. Industry·Stock 상세도 개념적으로 이
    // 섹션에 속하므로(§docs 11.1~11.3) 페이지별 분기 없이 항상 활성으로 표시한다.
    return (
      <a
        href={item.href}
        aria-current="page"
        className="rounded px-3 py-1.5 text-sm text-[var(--color-text)] border-b-2 border-[var(--color-accent)]"
      >
        {item.label}
      </a>
    )
  }
  return (
    <button
      type="button"
      disabled
      aria-disabled="true"
      aria-label={`${item.label} — Phase ${item.phase}에서 제공 예정`}
      className="flex items-center gap-1.5 rounded px-3 py-1.5 text-sm text-[var(--color-text-faint)] disabled:cursor-not-allowed"
    >
      {item.label}
      <Badge>PHASE {item.phase}</Badge>
    </button>
  )
}

function Sidebar() {
  return (
    <aside
      className={`fixed bottom-0 left-0 top-14 z-30 ${SIDEBAR_W} overflow-y-auto border-r border-[var(--color-border)] bg-[var(--color-bg)] py-4`}
    >
      <nav aria-label="세부 기능">
        <ul className="space-y-0.5 px-2">
          {SIDE_NAV.map((item) => (
            <li key={item.key}>
              <SideNavEntry item={item} />
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  )
}

function MonogramTile({ code, active }: { code: string; active: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={
        'num inline-flex h-6 w-10 shrink-0 items-center justify-center rounded border text-[10px] tracking-wide ' +
        (active
          ? 'border-[var(--color-accent)] text-[var(--color-accent)]'
          : 'border-dashed border-[var(--color-border)] text-[var(--color-text-faint)]')
      }
    >
      {code}
    </span>
  )
}

function SideNavEntry({ item }: { item: NavItem & { code: string } }) {
  if (item.phase === null) {
    return (
      <a
        href={item.href}
        aria-current="page"
        className="flex items-center gap-2.5 rounded px-1.5 py-1.5 text-sm text-[var(--color-text)]"
      >
        <MonogramTile code={item.code} active />
        {item.label}
      </a>
    )
  }
  return (
    <button
      type="button"
      disabled
      aria-disabled="true"
      aria-label={`${item.label} — Phase ${item.phase}에서 제공 예정`}
      className="flex w-full items-center gap-2.5 rounded px-1.5 py-1.5 text-left text-sm text-[var(--color-text-faint)] disabled:cursor-not-allowed"
    >
      <MonogramTile code={item.code} active={false} />
      <span className="flex-1">{item.label}</span>
      <Badge>P{item.phase}</Badge>
    </button>
  )
}
