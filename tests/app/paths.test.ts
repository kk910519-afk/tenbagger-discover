import { describe, it, expect, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { basePath, homePath, industryPath, industryAllPath, stockPath } from '@/app/_lib/paths'

/**
 * GitHub Pages 프로젝트 사이트는 하위 경로에서 서비스된다. next.config의 basePath는
 * `_next` 자산에만 붙고 이 앱이 쓰는 `<a href>`에는 붙지 않으므로, 링크는 전부 이
 * 헬퍼를 거쳐야 한다. 여기서 검증하는 것은 "접두사가 실제로 붙는가"와
 * "설정과 마크업이 같은 값을 쓰는가" 두 가지다.
 */
const KEY = 'NEXT_PUBLIC_BASE_PATH'

function withBase(value: string | undefined, fn: () => void): void {
  const before = process.env[KEY]
  if (value === undefined) delete process.env[KEY]
  else process.env[KEY] = value
  try {
    fn()
  } finally {
    if (before === undefined) delete process.env[KEY]
    else process.env[KEY] = before
  }
}

afterEach(() => {
  delete process.env[KEY]
})

describe('basePath 정규화', () => {
  it('설정이 없으면 빈 문자열이다 — 로컬에서 루트에 띄우는 기본값', () => {
    withBase(undefined, () => expect(basePath()).toBe(''))
  })

  it('빈 문자열과 공백만 있는 값도 루트로 본다', () => {
    withBase('', () => expect(basePath()).toBe(''))
    withBase('   ', () => expect(basePath()).toBe(''))
  })

  it('앞 슬래시가 없으면 붙인다 — 저장소 이름만 적어도 동작해야 한다', () => {
    withBase('my-repo', () => expect(basePath()).toBe('/my-repo'))
  })

  it('뒤 슬래시는 뗀다 — 경로를 이어붙일 때 //가 생기지 않도록', () => {
    withBase('/my-repo/', () => expect(basePath()).toBe('/my-repo'))
    withBase('/my-repo///', () => expect(basePath()).toBe('/my-repo'))
  })
})

describe('경로 헬퍼 — base path 없음', () => {
  it('홈은 루트이고 해시는 그대로 이어 붙는다', () => {
    withBase(undefined, () => {
      expect(homePath()).toBe('/')
      expect(homePath('#top-candidates')).toBe('/#top-candidates')
    })
  })

  it('산업·종목 경로는 슬래시로 끝난다 — trailingSlash 내보내기와 짝이다', () => {
    withBase(undefined, () => {
      expect(industryPath('pharmaceuticals')).toBe('/industry/pharmaceuticals/')
      expect(industryAllPath('pharmaceuticals')).toBe('/industry/pharmaceuticals/all/')
      expect(stockPath('AVGO')).toBe('/stock/AVGO/')
    })
  })

  it('경로에 // 가 생기지 않는다', () => {
    withBase(undefined, () => {
      for (const p of [homePath(), industryPath('x'), industryAllPath('x'), stockPath('X')]) {
        expect(p.slice(1)).not.toContain('//')
      }
    })
  })
})

describe('경로 헬퍼 — 하위 경로 배포', () => {
  it('모든 내부 링크에 접두사가 붙는다', () => {
    withBase('/tenbagger', () => {
      expect(homePath()).toBe('/tenbagger/')
      expect(homePath('#methodology')).toBe('/tenbagger/#methodology')
      expect(industryPath('ai-infrastructure')).toBe('/tenbagger/industry/ai-infrastructure/')
      expect(industryAllPath('ai-infrastructure')).toBe('/tenbagger/industry/ai-infrastructure/all/')
      expect(stockPath('NVDA')).toBe('/tenbagger/stock/NVDA/')
    })
  })

  it('접두사가 빠진 링크는 하나도 없다 — 이 누락이 브라우저에서만 드러나는 실패다', () => {
    withBase('/tenbagger', () => {
      const links = [homePath(), homePath('#x'), industryPath('a'), industryAllPath('a'), stockPath('B')]
      for (const link of links) expect(link.startsWith('/tenbagger/')).toBe(true)
    })
  })
})

/**
 * next.config.ts는 vitest의 트랜스폼(oxc)이 처리하지 못해 import할 수 없다. 대신
 * tests/architecture.test.ts와 같은 방식으로 소스를 읽어 구조를 확인한다 — 확인하려는
 * 것은 값 자체가 아니라 "설정과 마크업이 같은 함수를 읽는가"이므로 이걸로 충분하다.
 */
describe('next.config와 마크업이 같은 base path를 쓴다', () => {
  const source = readFileSync('next.config.ts', 'utf8')

  it('next.config는 마크업과 같은 basePath()를 읽는다 — 값을 따로 적지 않는다', () => {
    expect(source).toMatch(/import\s*\{\s*basePath\s*\}\s*from\s*'\.\/src\/app\/_lib\/paths'/)
    expect(source).toMatch(/basePath:\s*basePath\(\)/)
    // 접두사를 문자열 리터럴로 박아 두면 마크업과 갈라진다.
    expect(source).not.toMatch(/basePath:\s*['"]/)
  })

  it('정적 내보내기 설정이 켜져 있다', () => {
    expect(source).toMatch(/output:\s*'export'/)
    // trailingSlash가 없으면 out/stock/AAPL.html이 나오고, 확장자 없는 URL을 풀어 주는
    // 것은 GitHub Pages의 동작이지 정적 파일의 성질이 아니다 — 로컬 정적 서버에서 깨진다.
    expect(source).toMatch(/trailingSlash:\s*true/)
    // 요청 시점에 하는 일이 남아 있으면 안 된다.
    expect(source).not.toContain('force-dynamic')
  })
})
