import type { ReactNode } from 'react'
import { Geist, Instrument_Serif } from 'next/font/google'
import './globals.css'

/*
 * 인터페이스·표·숫자 전반의 기본 서체. next/font/google로 빌드 타임에
 * 받아 자체 호스팅한다 — Google Fonts로의 런타임 요청도, 폰트 교체로 인한
 * 레이아웃 시프트(CLS)도 없다. CSS 변수(--font-geist-sans)로 노출해
 * globals.css의 @theme에서 --font-sans 스택 맨 앞에 꽂는다.
 */
const geistSans = Geist({
  subsets: ['latin'],
  variable: '--font-geist-sans',
  display: 'swap',
})

/*
 * 회사명·주요 섹션 타이틀·투자 논지(thesis) 텍스트에만 쓰는 세리프.
 * Google Fonts 메타데이터 기준 Instrument Serif는 400(regular) 한 가지
 * 굵기만 제공한다(normal/italic 스타일은 둘 다 있음) — 그래서 이 서체가
 * 붙는 곳에는 절대 font-medium/font-semibold 등 다른 굵기 유틸리티를
 * 얹지 않는다. 실제 없는 굵기를 요청하면 브라우저가 합성(synthesize)한
 * 가짜 볼드를 그리는데, 획이 뭉개져 보인다.
 */
const instrumentSerif = Instrument_Serif({
  subsets: ['latin'],
  weight: '400',
  style: ['normal', 'italic'],
  variable: '--font-instrument-serif',
  display: 'swap',
})

export const metadata = {
  title: 'Tenbagger Discovery',
  description: '미국 성장주 조기 발견 대시보드',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko" className={`${geistSans.variable} ${instrumentSerif.variable}`}>
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
