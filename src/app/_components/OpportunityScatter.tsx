'use client'

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import type { OpportunityMark } from '../_queries/opportunity-scatter'
import { assignThemeColors } from '../_lib/theme-colors'
import { niceTicks, sqrtRadius, linear } from '../_lib/scale'
import { formatPct, formatScore, formatUsd } from '../_lib/format'

const WIDTH = 760
const HEIGHT = 400
const MARGIN = { top: 28, right: 24, bottom: 44, left: 52 }
const PLOT_LEFT = MARGIN.left
const PLOT_RIGHT = WIDTH - MARGIN.right
const PLOT_TOP = MARGIN.top
const PLOT_BOTTOM = HEIGHT - MARGIN.bottom
/** 마크 반지름(면적 비례 sqrt 스케일)의 표시 범위 */
const MIN_R = 6
const MAX_R = 26
/** 마크의 클릭/포커스 히트 영역 반지름 — 시각적 반지름과 무관하게 항상
 *  지름 24px 이상을 보장한다(dataviz: "8px 점을 정확히 클릭해야 하는" 문제 회피). */
const HIT_R = 14
const TOOLTIP_WIDTH = 220

function fmtGrowthTick(v: number): string {
  const sign = v > 0 ? '+' : ''
  return `${sign}${Math.round(v * 100)}%`
}

/**
 * Opportunity Map — 홈 화면 산점도. x=매출성장 중앙값, y=Tenbagger 점수 중앙값,
 * 크기=시가총액 중앙값, 색=테마. 마크는 "산업"이다(회사 1,200개는 다 찍으면 읽을 수
 * 없고, 산업 top-10은 실제 데이터에서 이미 6개 테마 중 3개를 자연스럽게 대표한다 —
 * 자세한 근거는 panels-report.md).
 *
 * 색은 최대 3개 테마만 실제 색을 받고 나머지는 회색 "기타"로 접힌다 —
 * dataviz 색 검증(all-pairs, ΔE 하한)을 6개 테마 전부에서 통과시킬 방법이 없다
 * (_lib/theme-colors.ts 주석 참고). 신원 확인은 색 하나에 기대지 않는다: 마크마다
 * 상시 텍스트 라벨을 붙이고, hover/focus 둘 다에서 같은 정보를 tooltip으로 보여주며,
 * 표 보기(<details>)로도 전부 다시 노출한다.
 */
export function OpportunityScatter({ marks }: { marks: OpportunityMark[] }) {
  const [activeSlug, setActiveSlug] = useState<string | null>(null)
  const [tooltipStyle, setTooltipStyle] = useState<CSSProperties>({})
  // JSX 타입상 <a>는 항상 HTMLAnchorElement로 추론된다(React 타입 정의가 정적이라
  // <svg> 안에 있어도 문맥을 보지 않는다) — 실제 런타임 노드는 SVG 네임스페이스로
  // 만들어지지만 getBoundingClientRect는 둘 다 지원하므로 문제 없다.
  const refs = useRef(new Map<string, HTMLAnchorElement>())

  const colorBySlug = assignThemeColors(marks)

  const growthValues = marks.map((m) => m.medianRevenueGrowth).filter((v): v is number => v !== null)
  const scoreValues = marks.map((m) => m.medianTenbagger).filter((v): v is number => v !== null)
  const capValues = marks.map((m) => m.medianMarketCap).filter((v): v is number => v !== null)
  const capMax = capValues.length ? Math.max(...capValues) : 0
  const capMin = capValues.length ? Math.min(...capValues) : 0

  // 0% 매출성장은 실제 의미가 있는 기준점이라(중앙값 분할 같은 임의 값이 아니다)
  // 항상 도메인에 포함시킨다 — 그래야 "성장이 있었는가"가 그리드에서 바로 읽힌다.
  const xTicks = niceTicks(Math.min(0, ...(growthValues.length ? growthValues : [0])), Math.max(0, ...(growthValues.length ? growthValues : [0])), 5)
  const yTicks = niceTicks(Math.min(...(scoreValues.length ? scoreValues : [0])), Math.max(...(scoreValues.length ? scoreValues : [0])), 5)
  const xMin = xTicks[0]!
  const xMax = xTicks[xTicks.length - 1]!
  const yMin = yTicks[0]!
  const yMax = yTicks[yTicks.length - 1]!

  const xPos = (v: number) => linear(v, xMin, xMax, PLOT_LEFT, PLOT_RIGHT)
  const yPos = (v: number) => linear(v, yMin, yMax, PLOT_BOTTOM, PLOT_TOP)

  useLayoutEffect(() => {
    if (!activeSlug) return
    const el = refs.current.get(activeSlug)
    if (!el) return
    const rect = el.getBoundingClientRect()
    const maxLeft = window.innerWidth - TOOLTIP_WIDTH - 8
    const left = Math.max(8, Math.min(rect.left + rect.width / 2 - TOOLTIP_WIDTH / 2, maxLeft))
    setTooltipStyle({
      position: 'fixed',
      left,
      top: Math.max(8, rect.top - 8),
      transform: 'translateY(-100%)',
      width: TOOLTIP_WIDTH,
    })
  }, [activeSlug])

  useEffect(() => {
    if (!activeSlug) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setActiveSlug(null)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [activeSlug])

  if (marks.length === 0) {
    return (
      <p className="text-xs text-[var(--color-text-faint)]">
        완전성 기준을 통과한 후보를 가진 산업이 아직 없습니다.
      </p>
    )
  }

  const legend = [...colorBySlug.entries()]
    .map(([slug, c]) => ({ slug, name: marks.find((m) => m.themeSlug === slug)!.themeName, ...c }))
    .sort((a, b) => Number(a.isOther) - Number(b.isOther))

  const activeMark = marks.find((m) => m.slug === activeSlug) ?? null

  // 실제 데이터에는 성장률·점수가 거의 같은 산업(예: Medical Devices/Biotechnology)이
  // 있어, 모든 라벨을 마크 "위"에만 두면 겹친다 — dataviz 스킬의 권고("겹치면 쌓지
  // 말고 위치를 바꾸거나 리더라인/범례로 넘겨라")를 따라, 반지름이 큰(=더 눈에 띄는)
  // 마크부터 순서대로 위/아래 중 이미 배치된 라벨과 안 겹치는 쪽을 그리디하게 고른다.
  // 폭은 getBBox 없이(서버 렌더링이라 DOM이 없다) 글자 수로 근사한다 — 라벨은 9px
  // 모노스페이스가 아닌 sans라 대략 한 글자당 5.4px.
  const labelWidth = (name: string) => Math.max(24, name.length * 5.4)
  const labelY = new Map<string, number>()
  const placedBoxes: { x1: number; x2: number; y1: number; y2: number }[] = []
  const withXY = marks
    .filter((m) => m.medianRevenueGrowth !== null && m.medianTenbagger !== null)
    .map((m) => {
      const cx = xPos(m.medianRevenueGrowth!)
      const cy = yPos(m.medianTenbagger!)
      const r = m.medianMarketCap !== null ? sqrtRadius(m.medianMarketCap, capMax, MIN_R, MAX_R) : MIN_R
      return { m, cx, cy, r }
    })
  for (const { m, cx, cy, r } of [...withXY].sort((a, b) => b.r - a.r)) {
    const w = labelWidth(m.name)
    // 후보 4개(가까운 위/아래 → 먼 위/아래)를 순서대로 시도한다 — 마크 여러 개가
    // 한 자리에 몰린 실제 데이터(예: Software Infrastructure/Networking/Fintech/
    // Cloud Computing이 서로 지척)에서는 위/아래 2개뿐이면 슬롯이 모자란다.
    const candidates = [cy - r - 5, cy + r + 12, cy - r - 16, cy + r + 23].filter(
      (y) => y >= PLOT_TOP + 6 && y <= PLOT_BOTTOM - 2,
    )
    if (candidates.length === 0) candidates.push(cy - r - 5)
    let chosen = candidates[0]!
    for (const y of candidates) {
      const box = { x1: cx - w / 2, x2: cx + w / 2, y1: y - 9, y2: y + 2 }
      const collides = placedBoxes.some((b) => box.x1 < b.x2 && box.x2 > b.x1 && box.y1 < b.y2 && box.y2 > b.y1)
      chosen = y
      if (!collides) break
    }
    placedBoxes.push({ x1: cx - w / 2, x2: cx + w / 2, y1: chosen - 9, y2: chosen + 2 })
    labelY.set(m.slug, chosen)
  }

  return (
    <div>
      <div className="w-full max-w-3xl overflow-x-auto">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          role="img"
          aria-label="산업별 매출성장 대 Tenbagger 점수 산점도. 마크 크기는 시가총액 중앙값, 색은 성장 테마를 나타낸다."
          className="h-auto w-full"
        >
          {yTicks.map((t) => (
            <line key={`gy${t}`} x1={PLOT_LEFT} x2={PLOT_RIGHT} y1={yPos(t)} y2={yPos(t)} stroke="var(--color-border)" strokeWidth={1} />
          ))}
          {xTicks.map((t) => (
            <line key={`gx${t}`} x1={xPos(t)} x2={xPos(t)} y1={PLOT_TOP} y2={PLOT_BOTTOM} stroke="var(--color-border)" strokeWidth={1} />
          ))}

          {yTicks.map((t) => (
            <text key={`ylab${t}`} x={PLOT_LEFT - 8} y={yPos(t)} textAnchor="end" dominantBaseline="middle" className="num" fontSize={10} fill="var(--color-text-dim)">
              {Math.round(t)}
            </text>
          ))}
          {xTicks.map((t) => (
            <text key={`xlab${t}`} x={xPos(t)} y={PLOT_BOTTOM + 16} textAnchor="middle" className="num" fontSize={10} fill="var(--color-text-dim)">
              {fmtGrowthTick(t)}
            </text>
          ))}

          <text x={(PLOT_LEFT + PLOT_RIGHT) / 2} y={HEIGHT - 6} textAnchor="middle" fontSize={11} fill="var(--color-text-faint)">
            매출성장 (산업 후보 중앙값)
          </text>
          <text
            x={14}
            y={(PLOT_TOP + PLOT_BOTTOM) / 2}
            textAnchor="middle"
            fontSize={11}
            fill="var(--color-text-faint)"
            transform={`rotate(-90, 14, ${(PLOT_TOP + PLOT_BOTTOM) / 2})`}
          >
            Tenbagger Score (산업 후보 중앙값)
          </text>

          {/* 사분면 힌트 — 실제 구획선은 긋지 않는다(임의의 분할선을 실제 기준처럼
              보이게 하지 않기 위해). 텍스트만으로 "이 방향이 좋다"를 알려준다. */}
          <text x={PLOT_RIGHT - 6} y={PLOT_TOP + 12} textAnchor="end" fontSize={9} fill="var(--color-text-faint)">고성장 · 고점수</text>
          <text x={PLOT_LEFT + 6} y={PLOT_TOP + 12} textAnchor="start" fontSize={9} fill="var(--color-text-faint)">저성장 · 고점수</text>
          <text x={PLOT_RIGHT - 6} y={PLOT_BOTTOM - 6} textAnchor="end" fontSize={9} fill="var(--color-text-faint)">고성장 · 저점수</text>
          <text x={PLOT_LEFT + 6} y={PLOT_BOTTOM - 6} textAnchor="start" fontSize={9} fill="var(--color-text-faint)">저성장 · 저점수</text>

          {marks.map((m) => {
            if (m.medianRevenueGrowth === null || m.medianTenbagger === null) return null
            const cx = xPos(m.medianRevenueGrowth)
            const cy = yPos(m.medianTenbagger)
            const color = colorBySlug.get(m.themeSlug)!.hex
            const hasSize = m.medianMarketCap !== null
            const r = hasSize ? sqrtRadius(m.medianMarketCap!, capMax, MIN_R, MAX_R) : MIN_R
            const capLabel = hasSize ? formatUsd(m.medianMarketCap) : '시가총액 데이터 없음'
            const ariaLabel =
              `${m.name} (${m.themeName} 테마) — 매출성장 ${formatPct(m.medianRevenueGrowth)}, ` +
              `Tenbagger 중앙값 ${formatScore(m.medianTenbagger)}, ${capLabel}, 후보 ${m.candidateCount}개. ` +
              '산업 상세 페이지로 이동'
            return (
              <a
                key={m.slug}
                href={`/industry/${m.slug}`}
                aria-label={ariaLabel}
                ref={(el) => {
                  if (el) refs.current.set(m.slug, el)
                  else refs.current.delete(m.slug)
                }}
                onMouseEnter={() => setActiveSlug(m.slug)}
                onMouseLeave={() => setActiveSlug((cur) => (cur === m.slug ? null : cur))}
                onFocus={() => setActiveSlug(m.slug)}
                onBlur={() => setActiveSlug((cur) => (cur === m.slug ? null : cur))}
              >
                <circle cx={cx} cy={cy} r={HIT_R} fill="transparent" />
                {hasSize ? (
                  <circle cx={cx} cy={cy} r={r} fill={color} stroke="var(--color-surface)" strokeWidth={2} />
                ) : (
                  // 시가총액 데이터가 없는 산업 — 크기를 매길 수 없으니 채워 그리지 않고
                  // 점선 테두리 최소 크기로 표시한다(ScoreBar의 null-vs-값 표기 관례와 동일).
                  <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={1.5} strokeDasharray="2,2" />
                )}
                <text
                  x={cx}
                  y={labelY.get(m.slug) ?? cy - r - 5}
                  textAnchor="middle"
                  fontSize={9}
                  fill="var(--color-text-dim)"
                >
                  {m.name}
                </text>
              </a>
            )
          })}
        </svg>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] text-[var(--color-text-dim)]">
        <div className="flex flex-wrap items-center gap-3">
          {legend.map((l) => (
            <span key={l.slug} className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: l.hex }} />
              {l.isOther ? '기타 테마' : l.name}
            </span>
          ))}
        </div>
        {capValues.length > 0 && (
          <div className="flex items-center gap-2">
            <span>마크 크기 = 산업 후보 시가총액 중앙값</span>
            <span className="inline-flex items-center gap-1">
              <svg width={14} height={14} aria-hidden="true"><circle cx={7} cy={7} r={5} fill="none" stroke="var(--color-text-faint)" /></svg>
              {formatUsd(capMin)}
            </span>
            <span className="inline-flex items-center gap-1">
              <svg width={30} height={30} aria-hidden="true"><circle cx={15} cy={15} r={14} fill="none" stroke="var(--color-text-faint)" /></svg>
              {formatUsd(capMax)}
            </span>
          </div>
        )}
      </div>

      {activeMark && (
        <div
          role="tooltip"
          style={tooltipStyle}
          className="z-50 rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] p-2.5 text-xs text-[var(--color-text)] shadow-lg"
        >
          <p className="font-medium">{activeMark.name}</p>
          <p className="text-[var(--color-text-faint)]">{activeMark.themeName}</p>
          <dl className="num mt-1.5 space-y-0.5">
            <div className="flex justify-between gap-3">
              <dt className="text-[var(--color-text-dim)]">매출성장</dt>
              <dd>{formatPct(activeMark.medianRevenueGrowth)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-[var(--color-text-dim)]">Tenbagger</dt>
              <dd>{formatScore(activeMark.medianTenbagger)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-[var(--color-text-dim)]">시가총액</dt>
              <dd>{activeMark.medianMarketCap !== null ? formatUsd(activeMark.medianMarketCap) : '데이터 없음'}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-[var(--color-text-dim)]">후보 수</dt>
              <dd>{activeMark.candidateCount}</dd>
            </div>
          </dl>
        </div>
      )}

      <details className="mt-3 text-xs text-[var(--color-text-dim)]">
        <summary className="cursor-pointer select-none">표로 보기 ({marks.length}개 산업)</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr>
                <th>산업</th>
                <th>테마</th>
                <th className="text-right">후보</th>
                <th className="text-right">매출성장 중앙값</th>
                <th className="text-right">Tenbagger 중앙값</th>
                <th className="text-right">시가총액 중앙값</th>
              </tr>
            </thead>
            <tbody>
              {marks.map((m) => (
                <tr key={m.slug}>
                  <td>
                    <a href={`/industry/${m.slug}`}>{m.name}</a>
                  </td>
                  <td>{m.themeName}</td>
                  <td className="text-right">
                    <span className="num">{m.candidateCount}</span>
                  </td>
                  <td className="text-right">
                    <span className="num">{formatPct(m.medianRevenueGrowth)}</span>
                  </td>
                  <td className="text-right">
                    <span className="num">{formatScore(m.medianTenbagger)}</span>
                  </td>
                  <td className="text-right">
                    <span className="num">{m.medianMarketCap !== null ? formatUsd(m.medianMarketCap) : '—'}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  )
}
