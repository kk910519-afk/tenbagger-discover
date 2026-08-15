import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * Tailwind v4는 자기 유틸리티를 전부 @layer utilities 안에 넣는다. 레이어가 없는
 * (unlayered) CSS는 명시도와 무관하게 항상 레이어가 있는 CSS를 이기므로, 표
 * 기본 스타일(table/th/td/a)이 레이어 밖에 있으면 th.text-right 같은 Tailwind
 * 유틸리티가 절대 이길 수 없다 — th가 항상 text-align: left로 계산되는 버그.
 *
 * jsdom은 실제 CSS 캐스케이드를 계산하지 않으므로(스타일시트를 로드·평가하지
 * 않음) 이 버그는 브라우저에서만 관측 가능하다. 대신 이 테스트는 소스 수준의
 * 회귀 가드다: 나중에 누군가 이 규칙들을 다시 @layer base 밖으로 꺼내면 이
 * 테스트가 실패한다.
 */
describe('globals.css — cascade layer 회귀 가드', () => {
  const css = readFileSync('src/app/globals.css', 'utf8')
  const layerStart = css.indexOf('@layer base {')

  it('@layer base 블록이 존재한다', () => {
    expect(layerStart).toBeGreaterThan(-1)
  })

  const before = css.slice(0, layerStart)
  const after = css.slice(layerStart)

  const barePatterns: [string, RegExp][] = [
    ['table', /(^|\s)table\s*\{/],
    ['th', /(^|\s)th\s*\{/],
    ['th, td', /th,\s*td\s*\{/],
    ['tbody tr:hover', /tbody tr:hover\s*\{/],
    ['a', /(^|\s)a\s*\{/],
    ['a:hover', /a:hover\s*\{/],
  ]

  for (const [name, pattern] of barePatterns) {
    it(`${name} 규칙은 @layer base 앞(레이어 밖)에 나타나지 않는다`, () => {
      expect(pattern.test(before)).toBe(false)
    })

    it(`${name} 규칙은 @layer base 블록 안에 존재한다`, () => {
      expect(pattern.test(after)).toBe(true)
    })
  }
})

/**
 * 한글 표에서 폭이 모자랄 때의 실패 양상은 "잘림"이 아니라 "세로쓰기"다 — 줄바꿈
 * 기회가 공백뿐이라 브라우저가 글자 단위로 끊어 "평균 점수"를 평/균/점/수로 쌓는다.
 * 이 두 선언이 그 경로를 막는다. jsdom은 캐스케이드를 계산하지 않으므로 소스 수준의
 * 회귀 가드로 둔다(위 레이어 테스트와 같은 이유).
 */
describe('globals.css — 좁은 칸에서 한글이 글자 단위로 쪼개지지 않는다', () => {
  const css = readFileSync('src/app/globals.css', 'utf8')
  const thBlock = css.slice(css.indexOf('  th {'), css.indexOf('  thead {'))

  it('th는 줄바꿈하지 않는다', () => {
    expect(thBlock).toMatch(/th\s*\{[^}]*white-space:\s*nowrap/s)
  })

  it('th/td는 어절 안에서 끊지 않는다(word-break: keep-all)', () => {
    expect(thBlock).toMatch(/th,\s*td\s*\{[^}]*word-break:\s*keep-all/s)
  })
})
