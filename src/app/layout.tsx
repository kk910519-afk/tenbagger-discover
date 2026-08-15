import type { ReactNode } from 'react'
import './globals.css'

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
            <a href="/" className="site-brand" aria-label="Tenbagger Discovery 홈">
              <span>TENBAGGER</span>
              <em>Discovery</em>
            </a>
            <nav className="site-nav" aria-label="주요 탐색">
              <a href="/#top-candidates">핵심 후보</a>
              <a href="/#opportunity-map">성장 테마</a>
              <a href="/#methodology">평가 방법</a>
            </nav>
            <div className="site-edition">
              <span>RESEARCH EDITION</span>
              <small>US GROWTH EQUITIES</small>
            </div>
          </header>
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
