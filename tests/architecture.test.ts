import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { globSync } from 'node:fs'

/**
 * engines/는 순수 함수여야 한다. DB나 Provider를 import하면
 * 네트워크 없이 테스트할 수 없고 Provider 교체 시 엔진까지 고쳐야 한다.
 */
describe('아키텍처 경계', () => {
  it('engines는 db와 providers를 import하지 않는다', () => {
    const files = globSync('src/engines/**/*.ts')
    const violations: string[] = []
    for (const file of files) {
      const src = readFileSync(file, 'utf8')
      for (const m of src.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
        const spec = m[1]!
        if (/(^|\/)(@\/)?(db|providers)(\/|$)/.test(spec)) {
          violations.push(`${file} → ${spec}`)
        }
      }
    }
    expect(violations).toEqual([])
  })

  it('engines 파일이 실제로 존재한다 (테스트가 공허하지 않음을 보장)', () => {
    expect(globSync('src/engines/**/*.ts').length).toBeGreaterThan(0)
  })
})
