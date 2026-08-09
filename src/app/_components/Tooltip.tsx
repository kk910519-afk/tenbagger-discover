'use client'

import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'

const VIEWPORT_MARGIN = 8
const PANEL_WIDTH = 260

/**
 * 헤더/라벨 옆에 붙는 설명 툴팁. 호버 전용 툴팁은 키보드·스크린리더 사용자에게는
 * 아예 보이지 않는다 — 이 패턴에서 가장 흔한 접근성 결함이라, 마우스 hover·키보드
 * focus·모바일 터치 세 경로 모두에서 열리도록 만들었다(WAI-ARIA APG의 tooltip 패턴).
 *
 * - 트리거는 tabIndex=0으로 Tab 이동 가능하고, aria-describedby로 패널과 연결된다.
 * - Escape로 닫힌다.
 * - 패널은 position: fixed로 뷰포트 기준 배치한다 — 테이블은 overflow-x-auto라
 *   absolute 배치를 쓰면 스크롤 컨테이너 안에서 잘리거나 가로 스크롤폭을
 *   넓혀버린다. fixed는 그 컨테이너 바깥으로 나가므로 둘 다 피한다.
 * - 우측 뷰포트 경계를 넘지 않도록 left 좌표를 클램프한다.
 * - 터치: 터치 기기에는 hover가 없으므로 탭을 열기/닫기 토글로 쓴다. onTouchEnd에서
 *   preventDefault()해 브라우저가 뒤이어 합성 mouseenter/click 이벤트를 쏘는 것을
 *   막는다 — 안 그러면 탭 한 번에 (touchend 토글) → (합성 click/hover) 이중 토글이
 *   일어나 열리자마자 닫힐 수 있다. 이미 열린 상태에서 패널 바깥을 탭하면 닫히도록
 *   document의 touchstart를 듣는다. 이 추가는 기존 mouseEnter/focus 리스너를
 *   건드리지 않으므로 CandidateTable의 기존 hover/focus 동작은 그대로다.
 */
export function Tooltip({ text, children }: { text: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const [style, setStyle] = useState<CSSProperties>({})
  const containerRef = useRef<HTMLSpanElement>(null)
  const triggerRef = useRef<HTMLSpanElement>(null)
  const id = useId()

  useLayoutEffect(() => {
    if (!open) return
    const trigger = triggerRef.current
    if (!trigger) return
    const rect = trigger.getBoundingClientRect()
    const maxLeft = window.innerWidth - PANEL_WIDTH - VIEWPORT_MARGIN
    const left = Math.max(VIEWPORT_MARGIN, Math.min(rect.left, maxLeft))
    setStyle({ position: 'fixed', top: rect.bottom + 6, left, width: PANEL_WIDTH })
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onTouchStartOutside = (e: TouchEvent) => {
      const container = containerRef.current
      if (container && e.target instanceof Node && !container.contains(e.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('touchstart', onTouchStartOutside)
    return () => document.removeEventListener('touchstart', onTouchStartOutside)
  }, [open])

  return (
    <span ref={containerRef} className="relative inline-block">
      <span
        ref={triggerRef}
        tabIndex={0}
        aria-describedby={id}
        className="cursor-help border-b border-dotted border-[var(--color-text-faint)] outline-none focus-visible:border-[var(--color-info)] focus-visible:text-[var(--color-info)]"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onTouchEnd={(e) => {
          e.preventDefault()
          setOpen((o) => !o)
        }}
      >
        {children}
      </span>
      {open && (
        <div
          role="tooltip"
          id={id}
          style={style}
          className="z-50 whitespace-pre-line rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] p-2.5 text-xs font-normal normal-case leading-relaxed text-[var(--color-text)] shadow-lg"
        >
          {text}
        </div>
      )}
    </span>
  )
}
