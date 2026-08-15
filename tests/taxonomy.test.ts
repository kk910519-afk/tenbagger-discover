import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadTaxonomy, isResidualSic } from '@/taxonomy'

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

describe('isResidualSic — 잔여 SIC 판정', () => {
  // 설명 문자열은 전부 data.sec.gov submissions API가 실제로 돌려주는 sicDescription이다.
  it('NEC 표기를 잔여로 본다', () => {
    expect(isResidualSic('3577', 'Computer Peripheral Equipment, NEC')).toBe(true)
    expect(isResidualSic('7389', 'Services-Business Services, NEC')).toBe(true)
    expect(isResidualSic('4899', 'Communications Services, NEC')).toBe(true)
  })

  it('Miscellaneous / Misc 표기를 잔여로 본다', () => {
    expect(isResidualSic('3690', 'Miscellaneous Electrical Machinery, Equipment & Supplies')).toBe(true)
    expect(isResidualSic('3590', 'Misc Industrial & Commercial Machinery & Equipment')).toBe(true)
    expect(isResidualSic('1090', 'Miscellaneous Metal Ores')).toBe(true)
  })

  it('"…, Etc."로 끝나는 그룹 헤더를 잔여로 본다', () => {
    expect(isResidualSic('7370', 'Services-Computer Programming, Data Processing, Etc.')).toBe(true)
  })

  it('2자리 대분류 헤더(xx00)는 설명과 무관하게 잔여다', () => {
    expect(isResidualSic('2800', 'Chemicals & Allied Products')).toBe(true)
    expect(isResidualSic('1400', 'Mining & Quarrying of  Nonmetallic Minerals (No Fuels)')).toBe(true)
    expect(isResidualSic('4900', 'Electric, Gas & Sanitary Services')).toBe(true)
  })

  it('설명 안의 "other"는 표지가 아니다 — 특정 업종 코드를 잔여로 오판하지 않는다', () => {
    // 3677·4931·4822는 "Other"를 품고 있지만 각각 인덕터·전기가스 겸업·전신으로 업종이 특정된다
    expect(isResidualSic('3677', 'Electronic Coils, Transformers & Other Inductors')).toBe(false)
    expect(isResidualSic('4931', 'Electric & Other Services Combined')).toBe(false)
    expect(isResidualSic('4822', 'Telegraph & Other Message Communications')).toBe(false)
  })

  it('평범한 업종 코드는 잔여가 아니다', () => {
    expect(isResidualSic('3674', 'Semiconductors & Related Devices')).toBe(false)
    expect(isResidualSic('2834', 'Pharmaceutical Preparations')).toBe(false)
    expect(isResidualSic('7372', 'Services-Prepackaged Software')).toBe(false)
  })

  it('설명이 없으면 코드 형태로만 판정한다', () => {
    expect(isResidualSic('3674', null)).toBe(false)
    expect(isResidualSic('2800', null)).toBe(true)
  })
})

describe('residual_reviewed', () => {
  it('실제 taxonomy의 residual_reviewed 항목은 전부 map에 존재한다', () => {
    for (const sic of tx.residualReviewedSics) {
      expect(tx.mappedSics.has(sic), `residual_reviewed ${sic}이 map에 없다`).toBe(true)
    }
  })

  it('defect가 된 잔여 SIC는 map에서 제거되어 유니버스에서 빠진다', () => {
    // 3577(Computer Peripheral Equipment, NEC)이 이 작업의 출발점이 된 결함이다.
    for (const sic of ['3577', '3570', '3550', '7370', '7389', '3569', '8090', '3590', '1400', '2800']) {
      expect(tx.mappedSics.has(sic), `${sic}이 아직 map에 있다`).toBe(false)
      expect(tx.unmappedSics.has(sic), `${sic}이 unmapped에 선언되어 있지 않다`).toBe(true)
      expect(tx.classify(sic, 'NOOVERRIDETICKER')).toBeNull()
    }
  })

  it('residual_reviewed에 없는 잔여 SIC는 map에 남아 있지 않다 (알려진 설명 기준)', () => {
    // sic-map.yaml에는 SIC 설명이 없으므로, 2자리 대분류 헤더 형태만으로 기계적으로
    // 검사할 수 있는 부분을 검사한다. 설명 기반 검사는 실제 SEC 설명을 가진
    // coverage.test.ts(실 DB)가 맡는다.
    for (const sic of tx.mappedSics) {
      if (!isResidualSic(sic, null)) continue
      expect(
        tx.residualReviewedSics.has(sic),
        `대분류 헤더 ${sic}이 map에 있는데 residual_reviewed에 근거가 없다`,
      ).toBe(true)
    }
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

  it('residual_reviewed에 map에 없는 SIC가 있으면 SIC 코드를 담은 메시지와 함께 던진다', () => {
    // 매핑을 지우면서 예외 목록을 안 지우면, 나중에 그 코드를 map에 되돌릴 때
    // 아무도 검토하지 않고 통과해버린다 — 로드 시점에 실패시킨다.
    const staleSicMap = `map:
  "9001": { theme: theme-a, industry: industry-a }
unmapped: []
residual_reviewed: ["9099"]
`
    const dir = writeFixtures({ sicMap: staleSicMap })
    expect(() => loadTaxonomy(dir)).toThrow('9099')
    expect(() => loadTaxonomy(dir)).toThrow('residual_reviewed')
  })

  it('residual_reviewed를 생략한 sic-map도 정상 로드된다 (기본값 빈 목록)', () => {
    const dir = writeFixtures({})
    expect(loadTaxonomy(dir).residualReviewedSics.size).toBe(0)
  })
})
