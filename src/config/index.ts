import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
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

const cache = new Map<string, AppConfig>()

export function loadConfig(path = 'config.yaml'): AppConfig {
  const key = resolve(path)
  let cfg = cache.get(key)
  if (!cfg) {
    cfg = parseConfig(readFileSync(key, 'utf8'))
    cache.set(key, cfg)
  }
  return cfg
}
