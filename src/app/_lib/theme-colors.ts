/**
 * Opportunity Map 산점도의 테마별 색상 배정.
 *
 * dataviz 스킬의 all-pairs(산점도) 검증 규칙: 이 앱의 카드 표면(#14171c, dark)에서
 * OKLCH 명도 밴드(0.48~0.67)·채도 하한(0.10)을 만족하면서 모든 쌍이 CVD ΔE ≥ 8과
 * 상시 시야 ΔE ≥ 15를 동시에 만족하는 카테고리 색은 **최대 3개**다 — 4개부터는
 * validate_palette.js --pairs all이 항상 실패한다(문서화된 기본 팔레트로도, 임의의
 * 8색 재배열로도 불가능; 색상환을 균등분할한 사용자 정의 4~6색 후보로도 재현 검증함).
 * 이 앱의 테마는 6개이므로 전부에 실제 색을 줄 수 없다 — "3개만 실제 색, 나머지는
 * Other 회색"으로 접는다(스킬이 명시하는 해법: "fold to Other or facet").
 *
 * 이미 예약된 색도 피한다 — status/카테고리 배지가 이미 blue(LEADER)·purple(EMERGING)·
 * green(positive)·red(risk)·gold(watch/accent)를 의미색으로 쓰고 있어(globals.css),
 * 산점도 카테고리 색이 그걸 재사용하면 "이 점이 LEADER라서 파란색인가, 이 테마라서
 * 파란색인가"처럼 의미가 충돌한다. 그래서 이 앱에서 안 쓰는 hue 3개(orange·aqua·violet)
 * 를 새로 골랐다 — 다크 서피스 #14171c 기준 all-pairs 통과 확인:
 *   node scripts/validate_palette.js "#d95926,#199e70,#9085e9" --mode dark \
 *     --surface "#14171c" --pairs all
 *   → CVD ΔE 9.4 / normal-vision ΔE 24.6 (둘 다 여유 있게 통과)
 *
 * 어떤 3개 테마가 실제 색을 받는지는 "지금 그려지는 마크 집합 안에서" 후보 수 합이
 * 큰 순서로 정한다 — 산업 셀렉션(top N)과 무관하게 항상 같은 3개 슬롯 순서를 쓰되
 * (색은 순위가 아니라 테마라는 엔티티를 따른다), 그 3개가 "어떤" 테마인지는 현재
 * 렌더링되는 산업들의 실제 구성에서 도출한다. 실제 DB에서는 Healthcare/Biotech,
 * AI/Software/Semiconductor, Digital Consumer/Fintech 세 테마가 top-10 산업을 전부
 * 채우고 있어 Other 버킷은 오늘은 비어 있다 — 그러나 유니버스 구성이 바뀌어 4번째
 * 테마의 산업이 top N에 들어오면 자동으로 Other로 접힌다.
 */

const REAL_HUE_SLOTS = [
  { hex: '#d95926', name: 'orange' },
  { hex: '#199e70', name: 'aqua' },
  { hex: '#9085e9', name: 'violet' },
] as const

/** 실제 색을 배정받지 못한 테마가 공유하는 중립 회색. 채도가 낮아 세 실색과 항상
 *  구별된다(회색 vs 채도 있는 색은 CVD 여부와 무관하게 구별하기 쉽다). */
export const OTHER_HEX = '#5b6472'

export type ThemeColor = { hex: string; isOther: boolean }

/**
 * @param marks themeSlug/themeName/candidateCount만 있으면 된다(구조적 타이핑) — 실제
 *   호출은 OpportunityMark[]로 한다.
 */
export function assignThemeColors(
  marks: { themeSlug: string; themeName: string; candidateCount: number }[],
): Map<string, ThemeColor> {
  const totals = new Map<string, number>()
  for (const m of marks) {
    totals.set(m.themeSlug, (totals.get(m.themeSlug) ?? 0) + m.candidateCount)
  }
  const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1])

  const result = new Map<string, ThemeColor>()
  ranked.forEach(([slug], i) => {
    const slot = REAL_HUE_SLOTS[i]
    result.set(slug, slot ? { hex: slot.hex, isOther: false } : { hex: OTHER_HEX, isOther: true })
  })
  return result
}
