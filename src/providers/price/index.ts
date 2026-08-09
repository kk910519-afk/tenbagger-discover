import type { HttpClient } from '../http/client.js'
import type { PriceProvider } from '../types.js'
import { createFinnhubProvider } from './finnhub.js'
import { createFixtureProvider } from './fixture.js'

const FIXTURE_PATH = 'tests/fixtures/prices.json'

export function getPriceProvider(
  http: HttpClient,
  env: Partial<NodeJS.ProcessEnv>,
): PriceProvider {
  const kind = env.PRICE_PROVIDER ?? 'finnhub'
  if (kind === 'fixture') return createFixtureProvider(FIXTURE_PATH)
  if (kind === 'finnhub') {
    const key = env.FINNHUB_API_KEY
    if (!key) {
      throw new Error(
        'FINNHUB_API_KEY가 없습니다. https://finnhub.io 에서 무료 키를 발급받아 .env에 넣거나 ' +
          'PRICE_PROVIDER=fixture로 실행하세요.',
      )
    }
    return createFinnhubProvider(http, key)
  }
  throw new Error(`알 수 없는 PRICE_PROVIDER: ${kind} (finnhub | fixture)`)
}

export { createFinnhubProvider, createFixtureProvider }
