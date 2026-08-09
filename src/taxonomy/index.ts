import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import type { ZodType } from 'zod'
import type { IndustryMeta } from '@/domain/types'
import { themesSchema, industriesSchema, sicMapSchema, overridesSchema } from './schema.js'

export type ThemeMeta = { slug: string; name: string; displayOrder: number }

export type Classification = {
  themeSlug: string
  industrySlug: string
  source: 'sic' | 'override'
}

export type Taxonomy = {
  themes: ThemeMeta[]
  industries: Map<string, IndustryMeta>
  unmappedSics: Set<string>
  mappedSics: Set<string>
  classify(sic: string, ticker: string): Classification | null
}

function readYaml(dir: string, file: string): unknown {
  return parseYaml(readFileSync(join(dir, file), 'utf8'))
}

function parseFile<T>(schema: ZodType<T>, dir: string, file: string): T {
  const result = schema.safeParse(readYaml(dir, file))
  if (!result.success) {
    const detail = result.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('\n')
    throw new Error(`${file} 검증 실패:\n${detail}`)
  }
  return result.data
}

export function loadTaxonomy(dir = 'taxonomy'): Taxonomy {
  const themesRaw = parseFile(themesSchema, dir, 'themes.yaml')
  const industriesRaw = parseFile(industriesSchema, dir, 'industries.yaml')
  const sicMap = parseFile(sicMapSchema, dir, 'sic-map.yaml')
  const overrides = parseFile(overridesSchema, dir, 'company-overrides.yaml')

  const industries = new Map<string, IndustryMeta>()
  for (const r of industriesRaw) {
    industries.set(r.slug, {
      slug: r.slug,
      name: r.name,
      themeSlug: r.theme,
      tamUsd: r.tam_usd,
      tamCagr: r.tam_cagr,
      tamSource: r.tam_source,
      tamAsOf: r.tam_as_of,
    })
  }

  // 참조 무결성 검증 — 로드 시점에 실패시켜 파이프라인이 잘못된 분류로 돌지 않게 한다
  const themeSlugs = new Set(themesRaw.map((t) => t.slug))
  for (const ind of industries.values()) {
    if (!themeSlugs.has(ind.themeSlug)) {
      throw new Error(`industries.yaml: ${ind.slug}의 theme "${ind.themeSlug}"이 존재하지 않습니다`)
    }
  }
  for (const [sic, v] of Object.entries(sicMap.map)) {
    if (!industries.has(v.industry)) {
      throw new Error(`sic-map.yaml: SIC ${sic}의 industry "${v.industry}"가 존재하지 않습니다`)
    }
    if (!themeSlugs.has(v.theme)) {
      throw new Error(`sic-map.yaml: SIC ${sic}의 theme "${v.theme}"이 존재하지 않습니다`)
    }
  }
  for (const [ticker, v] of Object.entries(overrides)) {
    if (v.industry && !industries.has(v.industry)) {
      throw new Error(`company-overrides.yaml: ${ticker}의 industry "${v.industry}"가 존재하지 않습니다`)
    }
    if (v.theme && !themeSlugs.has(v.theme)) {
      throw new Error(`company-overrides.yaml: ${ticker}의 theme "${v.theme}"이 존재하지 않습니다`)
    }
  }

  const upperOverrides = new Map(
    Object.entries(overrides).map(([k, v]) => [k.toUpperCase(), v]),
  )

  return {
    themes: themesRaw
      .map((t) => ({ slug: t.slug, name: t.name, displayOrder: t.display_order }))
      .sort((a, b) => a.displayOrder - b.displayOrder),
    industries,
    unmappedSics: new Set(sicMap.unmapped),
    mappedSics: new Set(Object.keys(sicMap.map)),

    classify(sic: string, ticker: string): Classification | null {
      const ov = upperOverrides.get(ticker.toUpperCase())
      if (ov?.industry) {
        const ind = industries.get(ov.industry)
        if (!ind) {
          throw new Error(`company-overrides.yaml: ${ticker}의 industry "${ov.industry}"가 존재하지 않습니다`)
        }
        return {
          themeSlug: ov.theme ?? ind.themeSlug,
          industrySlug: ov.industry,
          source: 'override',
        }
      }
      const m = sicMap.map[sic]
      if (!m) return null
      return { themeSlug: m.theme, industrySlug: m.industry, source: 'sic' }
    },
  }
}
