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
