import { describe, it, expect } from 'vitest'
import { loadTaxonomy } from '@/taxonomy'

const tx = loadTaxonomy()

describe('loadTaxonomy', () => {
  it('Theme 6개를 로드한다', () => {
    expect(tx.themes).toHaveLength(6)
    expect(tx.themes.map((t) => t.slug)).toContain('emerging-tech')
  })

  it('Theme은 display_order 순으로 정렬된다', () => {
    expect(tx.themes[0]!.slug).toBe('ai-software-semi')
    expect(tx.themes[5]!.slug).toBe('emerging-tech')
  })

  it('Industry 49개를 로드한다', () => {
    expect(tx.industries.size).toBe(49)
  })

  it('모든 Industry의 theme이 실재하는 Theme을 가리킨다', () => {
    const slugs = new Set(tx.themes.map((t) => t.slug))
    for (const ind of tx.industries.values()) {
      expect(slugs.has(ind.themeSlug)).toBe(true)
    }
  })
})

describe('classify', () => {
  it('오버라이드가 SIC보다 우선한다', () => {
    // CRWD의 SIC 7372는 software-application이지만 오버라이드가 cybersecurity로 지정
    expect(tx.classify('7372', 'CRWD')).toEqual({
      themeSlug: 'ai-software-semi',
      industrySlug: 'cybersecurity',
      source: 'override',
    })
  })

  it('오버라이드가 없으면 SIC 기본 Industry를 쓴다', () => {
    expect(tx.classify('7372', 'UNKNOWNTICKER')).toEqual({
      themeSlug: 'ai-software-semi',
      industrySlug: 'software-application',
      source: 'sic',
    })
  })

  it('오버라이드가 Theme까지 바꾼다', () => {
    // OKLO의 SIC 4911은 grid-infrastructure(energy-next)이지만 nuclear로 이동
    const r = tx.classify('4911', 'OKLO')
    expect(r?.industrySlug).toBe('nuclear')
    expect(r?.themeSlug).toBe('energy-next')
  })

  it('티커 대소문자를 구분하지 않는다', () => {
    expect(tx.classify('7372', 'crwd')?.industrySlug).toBe('cybersecurity')
  })

  it('매핑되지 않은 SIC는 null (유니버스 제외)', () => {
    expect(tx.classify('6022', 'JPM')).toBeNull()
    expect(tx.classify('9999', 'WHATEVER')).toBeNull()
  })

  it('오버라이드가 있으면 SIC가 미매핑이어도 분류된다', () => {
    expect(tx.classify('6770', 'IONQ')?.industrySlug).toBe('quantum-computing')
    expect(tx.classify('6770', 'IONQ')?.source).toBe('override')
  })
})
