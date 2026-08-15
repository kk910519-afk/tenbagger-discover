import type { ReactNode } from 'react'
import './globals.css'
import { DataAsOf } from './_components/DataAsOf'
import { homePath } from './_lib/paths'

export const metadata = {
  title: 'Tenbagger Discovery',
  description: '미국 성장주를 테마와 산업에서 출발해 탐색하는 리서치 대시보드',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <div className="site-shell">
          <header className="site-header">
            <a href={homePath()} className="site-brand" aria-label="Tenbagger Discovery 홈">
              <span>TENBAGGER</span>
              <em>Discovery</em>
            </a>
            <nav className="site-nav" aria-label="주요 탐색">
              <a href={homePath('#top-candidates')}>핵심 후보</a>
              <a href={homePath('#opportunity-map')}>성장 테마</a>
              <a href={homePath('#methodology')}>평가 방법</a>
            </nav>
            <div className="site-edition">
              <span>RESEARCH EDITION</span>
              <small>US GROWTH EQUITIES</small>
            </div>
          </header>
          {/* 헤더 바로 아래, 본문보다 먼저 읽히는 자리 — 어느 페이지로 들어오든 이 문장을
              지나야 본문에 닿는다. 정적 사이트에서 가장 놓치기 쉬운 사실이 "이 화면은
              지금이 아니다"이므로 위치 자체가 안내의 일부다. */}
          <DataAsOf />
          <main className="site-main">{children}</main>
          <footer className="site-footer">
            <span>점수는 성장 잠재력 탐색을 위한 리서치 지표이며 투자 의견이 아닙니다.</span>
            <span>TENBAGGER DISCOVERY · RESEARCH EDITION</span>
          </footer>
        </div>
      </body>
    </html>
  )
}
