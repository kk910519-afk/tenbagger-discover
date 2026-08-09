import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

describe('참조 무결성 검증', () => {
  // 최소한의 유효한 taxonomy 4파일 세트. 각 테스트는 이 중 하나를 깨뜨린 버전으로
  // 덮어써서 loadTaxonomy()가 로드 시점에 던지는지 확인한다.
  // 실제 taxonomy/ 데이터와 섞이지 않도록 매 테스트마다 mkdtempSync로 격리된
  // 임시 디렉터리에 fixture를 쓴다.
  const validThemes = `- { slug: theme-a, name: "Theme A", display_order: 1 }
- { slug: theme-b, name: "Theme B", display_order: 2 }
`
  const validIndustries = `- { slug: industry-a, theme: theme-a, name: "Industry A", tam_usd: null, tam_cagr: null, tam_source: null, tam_as_of: null }
- { slug: industry-b, theme: theme-b, name: "Industry B", tam_usd: null, tam_cagr: null, tam_source: null, tam_as_of: null }
`
  const validSicMap = `map:
  "9001": { theme: theme-a, industry: industry-a }
unmapped: []
`
  const validOverrides = `{}\n`

  const createdDirs: string[] = []

  afterEach(() => {
    for (const dir of createdDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  function writeFixtures(overrideFiles: {
    themes?: string
    industries?: string
    sicMap?: string
    overrides?: string
  }): string {
    const dir = mkdtempSync(join(tmpdir(), 'taxonomy-fixture-'))
    createdDirs.push(dir)
    writeFileSync(join(dir, 'themes.yaml'), overrideFiles.themes ?? validThemes)
    writeFileSync(join(dir, 'industries.yaml'), overrideFiles.industries ?? validIndustries)
    writeFileSync(join(dir, 'sic-map.yaml'), overrideFiles.sicMap ?? validSicMap)
    writeFileSync(join(dir, 'company-overrides.yaml'), overrideFiles.overrides ?? validOverrides)
    return dir
  }

  it('유효한 최소 fixture는 정상적으로 로드된다 (테스트 자체의 대조군)', () => {
    const dir = writeFixtures({})
    expect(() => loadTaxonomy(dir)).not.toThrow()
  })

  it('industry의 theme이 themes.yaml에 없으면 슬러그를 담은 메시지와 함께 던진다', () => {
    const brokenIndustries = `- { slug: industry-a, theme: theme-missing, name: "Industry A", tam_usd: null, tam_cagr: null, tam_source: null, tam_as_of: null }
- { slug: industry-b, theme: theme-b, name: "Industry B", tam_usd: null, tam_cagr: null, tam_source: null, tam_as_of: null }
`
    const dir = writeFixtures({ industries: brokenIndustries })
    expect(() => loadTaxonomy(dir)).toThrow('industry-a')
    expect(() => loadTaxonomy(dir)).toThrow('theme-missing')
  })

  it('sic-map 항목의 industry가 industries.yaml에 없으면 SIC 코드를 담은 메시지와 함께 던진다', () => {
    const brokenSicMap = `map:
  "9002": { theme: theme-a, industry: industry-missing }
unmapped: []
`
    const dir = writeFixtures({ sicMap: brokenSicMap })
    expect(() => loadTaxonomy(dir)).toThrow('9002')
    expect(() => loadTaxonomy(dir)).toThrow('industry-missing')
  })

  it('sic-map 항목의 theme이 themes.yaml에 없으면 SIC 코드를 담은 메시지와 함께 던진다', () => {
    const brokenSicMap = `map:
  "9003": { theme: theme-missing, industry: industry-a }
unmapped: []
`
    const dir = writeFixtures({ sicMap: brokenSicMap })
    expect(() => loadTaxonomy(dir)).toThrow('9003')
    expect(() => loadTaxonomy(dir)).toThrow('theme-missing')
  })

  it('override의 industry가 industries.yaml에 없으면 티커를 담은 메시지와 함께 던진다', () => {
    const brokenOverrides = `ZZZZ: { industry: industry-missing }\n`
    const dir = writeFixtures({ overrides: brokenOverrides })
    expect(() => loadTaxonomy(dir)).toThrow('ZZZZ')
    expect(() => loadTaxonomy(dir)).toThrow('industry-missing')
  })

  it('override의 theme이 themes.yaml에 없으면 티커를 담은 메시지와 함께 던진다', () => {
    const brokenOverrides = `ZZZZ: { theme: theme-missing, industry: industry-a }\n`
    const dir = writeFixtures({ overrides: brokenOverrides })
    expect(() => loadTaxonomy(dir)).toThrow('ZZZZ')
    expect(() => loadTaxonomy(dir)).toThrow('theme-missing')
  })
})
