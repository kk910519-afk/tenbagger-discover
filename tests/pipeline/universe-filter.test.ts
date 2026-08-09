import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseConfig } from '@/config'
import { parseNasdaqTraded } from '@/providers/listing/nasdaq-trader'
import { passesListingFilter } from '@/pipeline/universe-filter'

const cfg = parseConfig(readFileSync('config.yaml', 'utf8'))
const rows = parseNasdaqTraded(readFileSync('tests/fixtures/nasdaqtraded.txt', 'utf8'))
const byTicker = (t: string) => rows.find((r) => r.ticker === t)!

describe('passesListingFilter', () => {
  it('일반 보통주는 통과한다', () => {
    expect(passesListingFilter(byTicker('NVDA'), cfg).pass).toBe(true)
    expect(passesListingFilter(byTicker('CRWD'), cfg).pass).toBe(true)
  })

  it('ETF를 제외한다', () => {
    const r = passesListingFilter(byTicker('SPY'), cfg)
    expect(r.pass).toBe(false)
    expect(r.reason).toBe('ETF')
  })

  it('Test Issue를 제외한다', () => {
    expect(passesListingFilter(byTicker('ZTEST'), cfg).reason).toBe('TEST_ISSUE')
  })

  it('상장부적격 종목을 제외한다', () => {
    expect(passesListingFilter(byTicker('BADCO'), cfg).reason).toBe('FINANCIAL_STATUS')
  })

  it('우선주를 제외한다', () => {
    expect(passesListingFilter(byTicker('PFDX'), cfg).reason).toBe('NOT_COMMON_STOCK')
  })

  it('워런트를 제외한다', () => {
    expect(passesListingFilter(byTicker('WRNTW'), cfg).reason).toBe('NOT_COMMON_STOCK')
  })

  it('허용 거래소가 아니면 제외한다', () => {
    const foreign = { ...byTicker('NVDA'), exchange: 'V' }
    expect(passesListingFilter(foreign, cfg).reason).toBe('EXCHANGE')
  })
})
