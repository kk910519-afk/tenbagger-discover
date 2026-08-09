import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadEnvFile } from '@/config/env'

function envFile(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'tb-env-'))
  const path = join(dir, '.env')
  writeFileSync(path, content, 'utf8')
  return path
}

// process.env를 직접 건드리면 테스트 간에 값이 새어 나가므로, 매 테스트마다
// 독립된 target 객체를 만들어 그 안에서만 병합 결과를 확인한다.
describe('loadEnvFile', () => {
  it('파일의 값을 target에 채운다', () => {
    const path = envFile('FOO=bar\nBAZ=qux\n')
    const target: Record<string, string | undefined> = {}
    loadEnvFile(path, target)
    expect(target).toEqual({ FOO: 'bar', BAZ: 'qux' })
  })

  it('target에 이미 있는 값은 덮어쓰지 않는다 — 실제 환경변수가 .env 파일보다 우선한다', () => {
    const path = envFile('FOO=fromfile\nBAR=barfromfile\n')
    const target: Record<string, string | undefined> = { FOO: 'fromenv' }
    loadEnvFile(path, target)
    expect(target.FOO).toBe('fromenv') // 이미 있던 값 유지
    expect(target.BAR).toBe('barfromfile') // 없던 값은 채워짐
  })

  it('파일이 없으면 조용히 무시한다 — .env는 선택 사항이다', () => {
    const target: Record<string, string | undefined> = { KEEP: 'me' }
    expect(() =>
      loadEnvFile(join(tmpdir(), 'tb-env-does-not-exist', '.env'), target),
    ).not.toThrow()
    expect(target).toEqual({ KEEP: 'me' })
  })
})
