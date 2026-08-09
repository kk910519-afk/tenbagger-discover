import type { ReactNode } from 'react'
import './globals.css'
import { AppShell } from './_components/AppShell'

export const metadata = {
  title: 'Tenbagger Discovery',
  description: '미국 성장주 조기 발견 대시보드',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body className="min-h-screen">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  )
}
