import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseConfig } from '@/config'
import { parseNasdaqTraded } from '@/providers/listing/nasdaq-trader'
import { passesListingFilter } from '@/pipeline/universe-filter'
import type { Listing } from '@/providers/types'

const cfg = parseConfig(readFileSync('config.yaml', 'utf8'))
const rows = parseNasdaqTraded(readFileSync('tests/fixtures/nasdaqtraded.txt', 'utf8'))
const byTicker = (t: string) => rows.find((r) => r.ticker === t)!

/** 부분 문자열 오탐 회귀 테스트용. NVDA 행을 기반으로 종목명만 바꾼다. */
const withName = (name: string): Listing => ({ ...byTicker('NVDA'), securityName: name })

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

  it('제외 키워드가 회사명 일부에 우연히 들어간 보통주는 통과한다 (부분 문자열 오탐 방지)', () => {
    // "Unit"이 UnitedHealth/Unity/United/Uniti 안에, "Right"가 Rightside 안에 들어있다.
    // 종목명 전체가 아니라 " - " 뒤의 증권 종류 접미사만 보고 판정해야 한다.
    expect(passesListingFilter(withName('UnitedHealth Group Incorporated - Common Stock'), cfg).pass).toBe(true)
    expect(passesListingFilter(withName('Unity Software Inc. - Common Stock'), cfg).pass).toBe(true)
    expect(passesListingFilter(withName('United Rentals, Inc. - Common Stock'), cfg).pass).toBe(true)
    expect(passesListingFilter(withName('Uniti Group Inc. - Common Stock'), cfg).pass).toBe(true)
    expect(passesListingFilter(withName('Rightside Group, Ltd. - Common Stock'), cfg).pass).toBe(true)
  })

  it('실제 우선주/워런트는 여전히 제외한다 (회귀 확인)', () => {
    expect(passesListingFilter(byTicker('PFDX'), cfg).pass).toBe(false)
    expect(passesListingFilter(byTicker('WRNTW'), cfg).pass).toBe(false)
  })

  it('" - " 구분자가 없어 증권 종류를 알 수 없는 종목명은 별도 사유로 제외한다', () => {
    const r = passesListingFilter(withName('Some Weird Name With No Separator'), cfg)
    expect(r.pass).toBe(false)
    expect(r.reason).toBe('UNKNOWN_SECURITY_TYPE')
  })
})
