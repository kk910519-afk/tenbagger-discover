import type Database from 'better-sqlite3'
import type { AppConfig } from '@/config'
import type { Taxonomy } from '@/taxonomy'
import type { ListingProvider, ReferenceProvider } from '@/providers/types'
import { passesListingFilter } from '@/pipeline/universe-filter'
import { runJob, type JobStats } from '@/pipeline/runner'
import {
  upsertCompany,
  upsertListing,
  setCompanyIndustry,
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
    let skippedNotOperating = 0
    // A thrown fetchCompany() is transient (network/rate-limit, worth retrying); a
    // null return is permanent (SEC has no record for that CIK). Different causes,
    // different remediation — kept as separate counters.
    let failedLookupErrors = 0
    let failedLookupNotFound = 0
    let overrideCount = 0
    let sicBucketCount = 0
    const unmappedSicsSeen = new Set<string>()

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
        continue
      }
      if (ref.sic && cfg.universe.exclude_sic.includes(ref.sic)) {
        skippedExcludedSic++
        continue
      }

      const cls = taxonomy.classify(ref.sic ?? '', t.ticker)
      if (!cls) {
        skippedUnclassifiable++
        if (ref.sic && !taxonomy.unmappedSics.has(ref.sic)) unmappedSicsSeen.add(ref.sic)
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

    return {
      listed: allListings.length,
      afterListingFilter: eligible.size,
      matchedCik: candidates.length,
      classified,
      skippedExcludedSic,
      skippedUnclassifiable,
      skippedNotOperating,
      failedLookupErrors,
      failedLookupNotFound,
      overrideCount,
      sicBucketCount,
      unmappedSicsSeen: [...unmappedSicsSeen].sort(),
    }
  })
}
