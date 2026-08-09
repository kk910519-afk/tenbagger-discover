import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildDeps, runPipeline, PIPELINE_COMMANDS } from '@/pipeline/cli'
import { getRawDb } from '@/db/client'

describe('PIPELINE_COMMANDS', () => {
  it('지원 명령을 노출한다', () => {
    expect(PIPELINE_COMMANDS).toEqual(
      ['universe', 'fundamentals', 'prices', 'scores', 'all'],
    )
  })
})

describe('buildDeps', () => {
  const env = {
    PRICE_PROVIDER: 'fixture',
    DATABASE_PATH: join(mkdtempSync(join(tmpdir(), 'tb-cli-')), 'c.db'),
  }

  it('설정·분류·Provider를 묶어 반환한다', () => {
    const d = buildDeps(env, '2026-08-09')
    expect(d.cfg.universe.min_market_cap).toBe(300_000_000)
    expect(d.taxonomy.industries.size).toBe(49)
    expect(d.prices.name).toBe('fixture')
    expect(typeof d.listings.fetchListings).toBe('function')
    expect(typeof d.bulk.fetchQuarter).toBe('function')
    expect(typeof d.reference.fetchTickerMap).toBe('function')
    expect(typeof d.companyFacts.fetchCompany).toBe('function')
    d.raw.close()
  })

  it('SEC 클라이언트와 시세 클라이언트의 rate limit을 분리한다', () => {
    // 같은 클라이언트를 쓰면 SEC의 10 req/s가 Finnhub의 1 req/s를 위반한다
    const d = buildDeps(env, '2026-08-09')
    expect(d.secHttp).not.toBe(d.priceHttp)
    d.raw.close()
  })
})

describe('buildDeps — 시세 Provider는 지연 생성된다', () => {
  it('FINNHUB_API_KEY가 없어도 buildDeps 자체는 성공한다 — universe/fundamentals/scores는 시세를 쓰지 않는다', () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), 'tb-cli-')), 'c.db')
    // PRICE_PROVIDER를 명시하지 않으면 기본값 finnhub인데, 키도 주지 않는다.
    // buildDeps가 즉시 getPriceProvider를 호출한다면 여기서 던져야 정상이었다.
    const env = { DATABASE_PATH: dbPath }
    const d = buildDeps(env, '2026-08-09')
    d.raw.close()
  })

  it('하지만 prices 잡을 실제로 실행하면 키가 없다는 에러가 명확히 난다', async () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), 'tb-cli-')), 'c.db')
    const env = { DATABASE_PATH: dbPath }
    await expect(runPipeline('prices', env, '2026-08-09')).rejects.toThrow(
      /FINNHUB_API_KEY/,
    )
  })
})

describe('runPipeline', () => {
  it('알 수 없는 명령은 buildDeps를 호출하기 전에 거부한다', async () => {
    // DATABASE_PATH를 일부러 주지 않는다 — buildDeps가 호출된다면
    // getRawDb가 기본 경로(./data/tenbagger.db)를 만들려 시도할 것이므로,
    // 여기서 예외가 나면 검증이 buildDeps보다 먼저 실행되지 않았다는 뜻이다.
    const env = { PRICE_PROVIDER: 'fixture' }
    await expect(runPipeline('bogus', env, '2026-08-09')).rejects.toThrow(
      /알 수 없는 명령/,
    )
  })

  it('요청한 명령만 실행하고 성공 시에도 raw 연결을 닫는다', async () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), 'tb-cli-')), 'c.db')
    const env = { PRICE_PROVIDER: 'fixture', DATABASE_PATH: dbPath }

    // prices는 로컬 DB와 fixture Provider만 사용하므로 네트워크 없이 끝까지 실행된다.
    // universe/fundamentals가 실행됐다면 실제 SEC/NASDAQ 네트워크 호출이 발생해
    // 이 테스트가 타임아웃되거나 실패했을 것이다.
    await runPipeline('prices', env, '2026-08-09')

    // raw가 finally에서 닫히지 않았다면(WAL 모드) 같은 경로를 다시 여는 동작이
    // "database is locked" 등으로 실패할 수 있다.
    const raw2 = getRawDb(dbPath)
    expect(raw2.open).toBe(true)
    raw2.close()
  })
})
