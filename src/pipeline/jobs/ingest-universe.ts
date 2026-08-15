import type Database from 'better-sqlite3'
import type { AppConfig } from '@/config'
import type { Taxonomy } from '@/taxonomy'
import type { ListingProvider, ReferenceProvider } from '@/providers/types'
import { passesListingFilter } from '@/pipeline/universe-filter'
import { runJob, type JobStats } from '@/pipeline/runner'
import { isResidualSic } from '@/taxonomy'
import {
  upsertCompany,
  upsertListing,
  setCompanyIndustry,
  retireCompany,
} from '@/db/repositories/companies'

export type UniverseDeps = {
  raw: Database.Database
  cfg: AppConfig
  taxonomy: Taxonomy
  listings: ListingProvider
  reference: ReferenceProvider
}

export function seedTaxonomy(raw: Database.Database, taxonomy: Taxonomy): void {
  const insTheme = raw.prepare(
    `INSERT INTO themes (slug, name, display_order) VALUES (?, ?, ?)
     ON CONFLICT(slug) DO UPDATE SET name = excluded.name, display_order = excluded.display_order`,
  )
  const insInd = raw.prepare(
    `INSERT INTO industries (slug, theme_slug, name, tam_usd, tam_cagr, tam_source, tam_as_of)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(slug) DO UPDATE SET
       theme_slug = excluded.theme_slug, name = excluded.name,
       tam_usd = excluded.tam_usd, tam_cagr = excluded.tam_cagr,
       tam_source = excluded.tam_source, tam_as_of = excluded.tam_as_of`,
  )
  raw.transaction(() => {
    for (const t of taxonomy.themes) insTheme.run(t.slug, t.name, t.displayOrder)
    for (const i of taxonomy.industries.values()) {
      insInd.run(i.slug, i.themeSlug, i.name, i.tamUsd, i.tamCagr, i.tamSource, i.tamAsOf)
    }
  })()
}

export async function ingestUniverse(deps: UniverseDeps): Promise<JobStats> {
  const { raw, cfg, taxonomy, listings, reference } = deps

  return runJob(raw, 'universe', async () => {
    const now = new Date().toISOString()

    const allListings = await listings.fetchListings()
    raw.transaction(() => {
      for (const l of allListings) upsertListing(raw, l, now)
    })()

    const eligible = new Map<string, (typeof allListings)[number]>()
    for (const l of allListings) {
      if (passesListingFilter(l, cfg).pass) eligible.set(l.ticker.toUpperCase(), l)
    }

    const tickerMap = await reference.fetchTickerMap()
    const candidates = tickerMap.filter((t) => eligible.has(t.ticker.toUpperCase()))

    let classified = 0
    // Deliberate config exclusion (cfg.universe.exclude_sic) vs. a genuine taxonomy
    // miss (classify() found no mapping) are different situations with different
    // remediation — one means the config is working, the other means the taxonomy
    // needs a new entry. Keep them as separate counters so neither masks the other.
    let skippedExcludedSic = 0
    let skippedUnclassifiable = 0
    // 잔여 SIC(NEC/Miscellaneous/…, Etc./xx00 헤더)가 map에 남아 있는데 residual_reviewed로
    // 정당화되지 않은 경우. classify()는 산업을 돌려주지만 그 코드는 업종이 아니라 범위를
    // 가리키므로 SIC 출처 분류를 거부한다 — 오버라이드는 이 검사 앞에서 이미 통과한다.
    let skippedResidualSic = 0
    let skippedNotOperating = 0
    // A thrown fetchCompany() is transient (network/rate-limit, worth retrying); a
    // null return is permanent (SEC has no record for that CIK). Different causes,
    // different remediation — kept as separate counters.
    let failedLookupErrors = 0
    let failedLookupNotFound = 0
    let overrideCount = 0
    let sicBucketCount = 0
    const unmappedSicsSeen = new Set<string>()
    const residualSicsBlocked = new Set<string>()
    // 이번 실행에서 **확정적으로** 유니버스에서 뺀 CIK. fetchCompany 실패(일시적일 수 있다)는
    // 넣지 않는다 — 네트워크 한 번 흔들렸다고 회사를 내리면 안 된다.
    const rejected = new Set<number>()

    for (const t of candidates) {
      let ref
      try {
        ref = await reference.fetchCompany(t.cik)
      } catch {
        failedLookupErrors++
        continue
      }
      if (!ref) {
        failedLookupNotFound++
        continue
      }
      if (ref.entityType !== null && ref.entityType !== 'operating') {
        skippedNotOperating++
        rejected.add(ref.cik)
        continue
      }
      if (ref.sic && cfg.universe.exclude_sic.includes(ref.sic)) {
        skippedExcludedSic++
        rejected.add(ref.cik)
        continue
      }

      const cls = taxonomy.classify(ref.sic ?? '', t.ticker)
      if (!cls) {
        skippedUnclassifiable++
        rejected.add(ref.cik)
        if (ref.sic && !taxonomy.unmappedSics.has(ref.sic)) unmappedSicsSeen.add(ref.sic)
        continue
      }
      if (
        cls.source === 'sic' &&
        ref.sic &&
        !taxonomy.residualReviewedSics.has(ref.sic) &&
        isResidualSic(ref.sic, ref.sicDescription)
      ) {
        skippedResidualSic++
        rejected.add(ref.cik)
        residualSicsBlocked.add(ref.sic)
        continue
      }

      const listing = eligible.get(t.ticker.toUpperCase())!
      raw.transaction(() => {
        upsertCompany(
          raw,
          {
            cik: ref!.cik,
            ticker: t.ticker.toUpperCase(),
            name: ref!.name || t.title,
            sic: ref!.sic,
            sicDescription: ref!.sicDescription,
            exchange: listing.exchange,
            entityType: ref!.entityType,
            fiscalYearEnd: ref!.fiscalYearEnd,
            filerCategory: ref!.filerCategory,
            stateOfIncorporation: ref!.stateOfIncorporation,
            stateOfIncorporationDescription: ref!.stateOfIncorporationDescription,
          },
          now,
        )
        setCompanyIndustry(raw, ref!.cik, cls.industrySlug, cls.themeSlug, cls.source)
      })()

      classified++
      if (cls.source === 'override') overrideCount++
      else sicBucketCount++
    }

    // 이전 실행에서 분류되어 남아 있는데 이번에 확정적으로 탈락한 회사를 내린다.
    // 이 단계가 없으면 taxonomy를 고쳐도 예전 분류가 DB에 그대로 살아 있어 산업
    // 중앙값이 바뀌지 않는다.
    const retiredTickers: string[] = []
    raw.transaction(() => {
      for (const cik of rejected) {
        const ticker = retireCompany(raw, cik, now)
        if (ticker !== null) retiredTickers.push(ticker)
      }
    })()
    retiredTickers.sort()

    return {
      listed: allListings.length,
      afterListingFilter: eligible.size,
      matchedCik: candidates.length,
      classified,
      skippedExcludedSic,
      skippedUnclassifiable,
      skippedResidualSic,
      skippedNotOperating,
      failedLookupErrors,
      failedLookupNotFound,
      overrideCount,
      sicBucketCount,
      unmappedSicsSeen: [...unmappedSicsSeen].sort(),
      residualSicsBlocked: [...residualSicsBlocked].sort(),
      retiredFromUniverse: retiredTickers.length,
      retiredTickers,
    }
  })
}
