import { readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'

/**
 * .env 파일을 읽어 target(기본값 process.env)에 병합한다.
 *
 * - target에 이미 값이 있는 키는 덮어쓰지 않는다: 실제로 export된 환경변수가
 *   .env 파일보다 우선해야 한다.
 * - 파일이 없으면 조용히 무시한다: .env는 선택 사항이다 — 사용자가 실제
 *   환경변수를 직접 설정했을 수도 있고, PRICE_PROVIDER=fixture로 실행한다면
 *   애초에 키 자체가 필요 없다.
 */
export function loadEnvFile(
  path = '.env',
  target: Record<string, string | undefined> = process.env,
): void {
  let content: string
  try {
    content = readFileSync(path, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return
    throw err
  }
  const parsed = parseEnv(content)
  for (const [key, value] of Object.entries(parsed)) {
    if (target[key] === undefined) target[key] = value
  }
}
