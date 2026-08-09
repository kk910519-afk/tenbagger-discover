import { readFileSync } from 'node:fs'
import { parse as parseYaml } from 'yaml'
import { configSchema, type AppConfig } from './schema.js'

export type { AppConfig }

export function parseConfig(raw: string): AppConfig {
  const result = configSchema.safeParse(parseYaml(raw))
  if (!result.success) {
    const detail = result.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('\n')
    throw new Error(`config.yaml 검증 실패:\n${detail}`)
  }
  return result.data
}

let cached: AppConfig | null = null

export function loadConfig(path = 'config.yaml'): AppConfig {
  if (!cached) cached = parseConfig(readFileSync(path, 'utf8'))
  return cached
}
