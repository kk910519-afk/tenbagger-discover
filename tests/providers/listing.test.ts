import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseNasdaqTraded } from '@/providers/listing/nasdaq-trader'

const raw = readFileSync('tests/fixtures/nasdaqtraded.txt', 'utf8')

describe('parseNasdaqTraded', () => {
  const rows = parseNasdaqTraded(raw)

  it('헤더와 파일 생성시각 푸터를 건너뛴다', () => {
    expect(rows).toHaveLength(7)
    expect(rows.some((r) => r.ticker.startsWith('File Creation'))).toBe(false)
  })

  it('ETF 플래그를 읽는다', () => {
    expect(rows.find((r) => r.ticker === 'SPY')!.isEtf).toBe(true)
    expect(rows.find((r) => r.ticker === 'NVDA')!.isEtf).toBe(false)
  })

  it('Test Issue 플래그를 읽는다', () => {
    expect(rows.find((r) => r.ticker === 'ZTEST')!.isTestIssue).toBe(true)
  })

  it('빈 Financial Status는 null로 만든다', () => {
    expect(rows.find((r) => r.ticker === 'SPY')!.financialStatus).toBeNull()
    expect(rows.find((r) => r.ticker === 'BADCO')!.financialStatus).toBe('D')
  })

  it('거래소 코드와 종목명을 보존한다', () => {
    const nvda = rows.find((r) => r.ticker === 'NVDA')!
    expect(nvda.exchange).toBe('Q')
    expect(nvda.securityName).toContain('Common Stock')
    expect(nvda.roundLot).toBe(100)
  })
})
