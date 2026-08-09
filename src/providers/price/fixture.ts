import { readFileSync } from 'node:fs'
import type { PriceProvider } from '../types.js'

export function createFixtureProvider(path: string): PriceProvider {
  const data = JSON.parse(readFileSync(path, 'utf8')) as {
    date: string
    prices: Record<string, number>
  }
  return {
    name: 'fixture',
    async fetchQuote(ticker) {
      const price = data.prices[ticker.toUpperCase()]
      return typeof price === 'number' ? { price, date: data.date } : null
    },
  }
}
