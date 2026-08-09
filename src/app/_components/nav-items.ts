/**
 * 셸 내비게이션 데이터. 이 앱에 실재하는 라우트는 정확히 하나다 — 홈("/"),
 * Industry·Stock 상세는 홈에서 드릴다운으로만 도달하는 개별 페이지라 고정
 * 내비게이션 항목이 아니다(§docs/superpowers/specs 11.1~11.3). 그래서 두
 * 목록 모두 활성 항목은 "Discovery/Overview" 하나뿐이고, 나머지는 전부
 * `docs/superpowers/specs/2026-08-09-tenbagger-discovery-dashboard-design.md`
 * §2·§17의 Phase 로드맵에서 그대로 가져온 phase 라벨을 달고 비활성 상태로 나열된다.
 *
 * 없는 기능을 숨기지 않는다 — 언젠가 올 기능이라고 정직하게 보여주는 쪽을 택한다.
 */

export type NavItem = {
  key: string
  label: string
  /** null이면 Phase 1(현재) — 활성 링크. 그 외는 비활성이며 배지에 "PHASE n"으로 표시된다. */
  phase: 2 | 3 | 4 | null
  href?: string
}

/** 상단 바 — 제품의 6개 큰 영역. */
export const TOP_NAV: NavItem[] = [
  { key: 'discovery', label: 'Discovery', phase: null, href: '/' },
  { key: 'screener', label: 'Screener', phase: 2 },
  { key: 'watchlists', label: 'Watchlists', phase: 2 },
  { key: 'research', label: 'Research', phase: 3 },
  { key: 'portfolio', label: 'Portfolio', phase: 4 },
  { key: 'alerts', label: 'Alerts', phase: 4 },
]

/**
 * 좌측 사이드바 — 10개 세부 기능. 각 항목의 3글자 코드는 Bloomberg 단말기의
 * function key(HP, DES, GP...) 관행을 그대로 빌려온 것이다 — 이 제품의 정체성이
 * "리서치 단말기"이니 아이콘 대신 그 세계의 표기법을 쓰는 편이 아이콘 팩 없이도
 * 더 정직하고 더 그 자체답다.
 */
export const SIDE_NAV: (NavItem & { code: string })[] = [
  { key: 'overview', code: 'OVR', label: 'Overview', phase: null, href: '/' },
  { key: 'screener', code: 'SCR', label: 'Screener', phase: 2 },
  { key: 'watchlists', code: 'WLT', label: 'Watchlists', phase: 2 },
  { key: 'quality', code: 'QUA', label: 'Quality Score', phase: 2 },
  { key: 'comparisons', code: 'CMP', label: 'Comparisons', phase: 2 },
  { key: 'valuation', code: 'VAL', label: 'Valuation', phase: 3 },
  { key: 'moat', code: 'MOA', label: 'Moat Analysis', phase: 3 },
  { key: 'portfolio', code: 'PFL', label: 'Portfolio', phase: 4 },
  { key: 'alerts', code: 'ALR', label: 'Alerts', phase: 4 },
  { key: 'filings', code: 'FIL', label: 'Filings & News', phase: 4 },
]
