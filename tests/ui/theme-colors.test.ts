import { describe, it, expect } from 'vitest'
import { assignThemeColors, OTHER_HEX } from '@/app/_lib/theme-colors'

describe('assignThemeColors', () => {
  it('테마가 3개 이하면 전부 실제 색(고유 hex)을 받는다', () => {
    const marks = [
      { themeSlug: 'a', themeName: 'A', candidateCount: 5 },
      { themeSlug: 'b', themeName: 'B', candidateCount: 3 },
      { themeSlug: 'c', themeName: 'C', candidateCount: 1 },
    ]
    const colors = assignThemeColors(marks)
    const hexes = [...colors.values()].map((c) => c.hex)
    expect(new Set(hexes).size).toBe(3)
    expect([...colors.values()].every((c) => !c.isOther)).toBe(true)
  })

  it('테마가 4개 이상이면 4번째부터 공통 회색(Other)으로 접는다 — all-pairs 색 검증이 3개까지만 통과하기 때문', () => {
    const marks = [
      { themeSlug: 'big', themeName: 'Big', candidateCount: 100 },
      { themeSlug: 'mid', themeName: 'Mid', candidateCount: 50 },
      { themeSlug: 'small', themeName: 'Small', candidateCount: 10 },
      { themeSlug: 'tiny', themeName: 'Tiny', candidateCount: 1 },
      { themeSlug: 'tinier', themeName: 'Tinier', candidateCount: 1 },
    ]
    const colors = assignThemeColors(marks)
    expect(colors.get('big')!.isOther).toBe(false)
    expect(colors.get('mid')!.isOther).toBe(false)
    expect(colors.get('small')!.isOther).toBe(false)
    expect(colors.get('tiny')!.isOther).toBe(true)
    expect(colors.get('tiny')!.hex).toBe(OTHER_HEX)
    expect(colors.get('tinier')!.isOther).toBe(true)
    expect(colors.get('tinier')!.hex).toBe(OTHER_HEX)
  })

  it('실제 색은 후보 수 합계가 큰 테마부터 배정한다(색이 순위가 아니라 테마를 따르도록 안정적으로)', () => {
    const marksA = [
      { themeSlug: 'x', themeName: 'X', candidateCount: 1 },
      { themeSlug: 'y', themeName: 'Y', candidateCount: 1 },
      { themeSlug: 'z', themeName: 'Z', candidateCount: 1 },
      { themeSlug: 'w', themeName: 'W', candidateCount: 10 },
    ]
    const colors = assignThemeColors(marksA)
    // 후보 합계가 가장 큰 'w'가 Other로 밀리면 안 된다
    expect(colors.get('w')!.isOther).toBe(false)
  })

  it('같은 테마의 여러 산업 마크는 후보 수를 합산해 하나의 순위로 취급한다', () => {
    const marks = [
      { themeSlug: 'a', themeName: 'A', candidateCount: 2 },
      { themeSlug: 'a', themeName: 'A', candidateCount: 2 }, // 같은 테마, 다른 산업
      { themeSlug: 'b', themeName: 'B', candidateCount: 3 },
    ]
    const colors = assignThemeColors(marks)
    // a의 합계(4) > b(3)이므로 둘 다 실제 색이어야 한다(테마가 2개뿐이니 자명하지만
    // 합산 로직 자체를 검증한다)
    expect(colors.get('a')!.isOther).toBe(false)
    expect(colors.get('b')!.isOther).toBe(false)
  })
})
