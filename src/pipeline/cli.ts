import { loadConfig } from '@/config'
import { loadTaxonomy } from '@/taxonomy'
import { getRawDb, runMigrations } from '@/db/client'
import { createHttpClient } from '@/providers/http/client'
import { createNasdaqTraderProvider } from '@/providers/listing/nasdaq-trader'
import { createSecReferenceProvider } from '@/providers/reference/sec-submissions'
import { createSecBulkProvider } from '@/providers/fundamental/sec-bulk'
import { createCompanyFactsProvider } from '@/providers/fundamental/sec-companyfacts'
import { getPriceProvider } from '@/providers/price'
import { ingestUniverse, seedTaxonomy } from './jobs/ingest-universe.js'
import { ingestFundamentals } from './jobs/ingest-fundamentals.js'
import { refreshPrices } from './jobs/refresh-prices.js'
import { computeScores } from './jobs/compute-scores.js'

export const PIPELINE_COMMANDS = [
  'universe', 'fundamentals', 'prices', 'scores', 'all',
] as const

export type PipelineCommand = (typeof PIPELINE_COMMANDS)[number]

export function buildDeps(env: NodeJS.ProcessEnv, asOf: string) {
  const cfg = loadConfig()
  const taxonomy = loadTaxonomy()
  const raw = getRawDb(env.DATABASE_PATH)
  runMigrations(raw)

  // SEC는 초당 10요청, Finnhub 무료 티어는 초당 1요청.
  // 하나의 클라이언트를 공유하면 느슨한 쪽 제한이 엄격한 쪽을 위반한다.
  const secHttp = createHttpClient({
    userAgent: cfg.ingest.sec_user_agent,
    rateLimitPerSec: cfg.ingest.sec_rate_limit_per_sec,
    cacheDir: cfg.ingest.cache_dir,
  })
  const priceHttp = createHttpClient({
    userAgent: cfg.ingest.sec_user_agent,
    rateLimitPerSec: cfg.ingest.finnhub_rate_limit_per_sec,
    cacheDir: cfg.ingest.cache_dir,
  })

  return {
    cfg, taxonomy, raw, asOf, secHttp, priceHttp,
    listings: createNasdaqTraderProvider(secHttp),
    reference: createSecReferenceProvider(secHttp),
    bulk: createSecBulkProvider(secHttp),
    companyFacts: createCompanyFactsProvider(secHttp),
    prices: getPriceProvider(priceHttp, env),
  }
}

function report(name: string, stats: Record<string, unknown>): void {
  console.log(`\n[${name}]`)
  for (const [k, v] of Object.entries(stats)) {
    console.log(`  ${k}: ${Array.isArray(v) ? `${v.length}건` : v}`)
  }
}

export async function runPipeline(
  command: string,
  env: NodeJS.ProcessEnv,
  asOf: string,
): Promise<void> {
  if (!(PIPELINE_COMMANDS as readonly string[]).includes(command)) {
    throw new Error(
      `알 수 없는 명령: ${command} (${PIPELINE_COMMANDS.join(' | ')})`,
    )
  }
  const d = buildDeps(env, asOf)
  const run = new Set(command === 'all' ? PIPELINE_COMMANDS.slice(0, 4) : [command])

  try {
    if (run.has('universe')) {
      seedTaxonomy(d.raw, d.taxonomy)
      report('universe', await ingestUniverse({
        raw: d.raw, cfg: d.cfg, taxonomy: d.taxonomy,
        listings: d.listings, reference: d.reference,
      }))
    }
    if (run.has('fundamentals')) {
      report('fundamentals', await ingestFundamentals({
        raw: d.raw, cfg: d.cfg, bulk: d.bulk,
        companyFacts: d.companyFacts, asOf: d.asOf,
      }))
    }
    if (run.has('prices')) {
      report('prices', await refreshPrices({ raw: d.raw, prices: d.prices }))
    }
    if (run.has('scores')) {
      report('scores', await computeScores({
        raw: d.raw, cfg: d.cfg, taxonomy: d.taxonomy, asOf: d.asOf,
      }))
    }
  } finally {
    d.raw.close()
  }
}

// tsx로 직접 실행될 때만 동작한다
if (process.argv[1]?.endsWith('cli.ts')) {
  const command = process.argv[2] ?? 'all'
  const asOf = process.argv[3] ?? new Date().toISOString().slice(0, 10)
  runPipeline(command, process.env, asOf).catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
