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
  /** 잔여 SIC 중 등록기업 증거로 매핑을 정당화해 map에 남긴 코드 */
  residualReviewedSics: Set<string>
  classify(sic: string, ticker: string): Classification | null
}

/** SEC 공식 설명이 "그룹의 나머지 전부"를 뜻한다는 표지 */
const RESIDUAL_MARKERS: RegExp[] = [
  /\bNEC\b/, // "Special Industry Machinery, NEC" — 대문자 약어만 표지로 본다
  /not elsewhere classified/i,
  /\bmisc(ellaneous)?\b/i, // "Miscellaneous Metal Ores", "Misc Industrial & ..."
  /,\s*etc\.?\s*$/i, // "Services-Computer Programming, Data Processing, Etc."
]

/** 2자리 대분류 헤더(xx00) — 한 division 전체를 덮는다 */
const MAJOR_GROUP_HEADER = /^\d{2}00$/

/**
 * 잔여(residual) SIC인가 — 즉 이 코드가 **업종이 아니라 범위**를 가리키는가.
 *
 * 두 가지 표지를 본다.
 *  1. SEC 공식 설명이 "나머지 전부"를 말한다 — NEC / Not Elsewhere Classified /
 *     Miscellaneous·Misc / "…, Etc."
 *  2. 코드가 2자리 대분류 헤더(xx00)다 — SEC는 한 division 전체에 걸친 filer에게 이걸 준다.
 *
 * 잔여 SIC를 특정 산업 하나에 매핑하면 그 산업의 중앙값(tam_industry_growth 대체값,
 * competitive_advantage의 산업 대비 마진)이 그 업종과 무관한 회사들로 만들어진다.
 * 그래서 잔여 SIC는 매핑하지 않는 것이 기본값이고, 등록기업 증거로 정당화한 예외만
 * sic-map.yaml의 residual_reviewed에 적는다.
 *
 * 주의: "& Other Inductors"(3677)나 "& Other Services Combined"(4931)처럼 설명 안에
 * "other"가 들어가는 특정 업종 코드가 있으므로 "other"는 표지로 쓰지 않는다.
 */
export function isResidualSic(sic: string, description: string | null | undefined): boolean {
  if (MAJOR_GROUP_HEADER.test(sic)) return true
  if (!description) return false
  return RESIDUAL_MARKERS.some((re) => re.test(description))
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

  // residual_reviewed는 "map에 남긴 잔여 SIC"의 목록이므로 map에 없는 코드가 적혀 있으면
  // 그 항목은 죽은 예외다 — 나중에 map에 다시 넣을 때 아무도 검토하지 않고 통과해버린다.
  for (const sic of sicMap.residual_reviewed) {
    if (!(sic in sicMap.map)) {
      throw new Error(
        `sic-map.yaml: residual_reviewed의 SIC ${sic}이 map에 없습니다 — ` +
          `매핑을 제거했다면 residual_reviewed에서도 지워야 합니다`,
      )
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
    residualReviewedSics: new Set(sicMap.residual_reviewed),

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
