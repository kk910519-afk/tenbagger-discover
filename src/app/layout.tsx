import type { ReactNode } from 'react'
import './globals.css'

export const metadata = {
  title: 'Tenbagger Discovery',
  description: '미국 성장주 조기 발견 대시보드',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body className="min-h-screen">
        <header className="border-b border-[var(--color-border)] px-6 py-3">
          <a href="/" className="text-sm tracking-wide">
            TENBAGGER <span className="text-[var(--color-text-dim)]">DISCOVERY</span>
          </a>
        </header>
        <main className="px-6 py-5">{children}</main>
      </body>
    </html>
  )
}
