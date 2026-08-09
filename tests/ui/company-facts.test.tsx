// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { CompanyFacts, type CompanyFactsData } from '@/app/_components/CompanyFacts'
import { formatFiscalYearEnd, formatSicLabel, edgarFilingsUrl } from '@/app/_lib/company-facts'

afterEach(() => cleanup())

describe('formatFiscalYearEnd', () => {
  it('MMDD를 "M월 D일"로 변환한다', () => {
    expect(formatFiscalYearEnd('0131')).toBe('1월 31일')
    expect(formatFiscalYearEnd('1231')).toBe('12월 31일')
    expect(formatFiscalYearEnd('0630')).toBe('6월 30일')
  })

  it('null이면 em dash', () => {
    expect(formatFiscalYearEnd(null)).toBe('—')
  })

  it('자릿수가 4가 아니거나 범위를 벗어나면 em dash로 안전하게 대체한다', () => {
    expect(formatFiscalYearEnd('131')).toBe('—')
    expect(formatFiscalYearEnd('1301')).toBe('—') // 13월은 없다
    expect(formatFiscalYearEnd('0132')).toBe('—') // 32일은 없다
    expect(formatFiscalYearEnd('')).toBe('—')
  })
})

describe('formatSicLabel', () => {
  it('설명과 코드가 모두 있으면 "설명 (SIC 코드)" 형태다', () => {
    expect(formatSicLabel('3674', 'Semiconductors & Related Devices')).toBe(
      'Semiconductors & Related Devices (SIC 3674)',
    )
  })

  it('둘 다 없으면 em dash', () => {
    expect(formatSicLabel(null, null)).toBe('—')
  })
})

describe('edgarFilingsUrl', () => {
  it('CIK를 10자리로 0-padding한다', () => {
    expect(edgarFilingsUrl(1045810)).toBe(
      'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0001045810&type=10-K&dateb=&owner=include&count=10',
    )
  })

  it('이미 10자리인 CIK도 그대로 유지한다(자르지 않는다)', () => {
    expect(edgarFilingsUrl(1234567890)).toContain('CIK=1234567890')
  })

  it('한 자리 CIK도 9개의 0으로 채운다', () => {
    expect(edgarFilingsUrl(1)).toContain('CIK=0000000001')
  })
})

const FULL: CompanyFactsData = {
  cik: 1045810,
  sic: '3674',
  sicDescription: 'Semiconductors & Related Devices',
  exchange: 'Nasdaq',
  fiscalYearEnd: '0131',
  stateOfIncorporationDescription: 'DE',
}

describe('CompanyFacts — 필드 렌더링', () => {
  it('다섯 개 필드를 모두 렌더링한다', () => {
    const { container } = render(<CompanyFacts d={FULL} />)
    expect(container.textContent).toContain('Semiconductors & Related Devices (SIC 3674)')
    expect(container.textContent).toContain('Nasdaq')
    expect(container.textContent).toContain('1월 31일')
    expect(container.textContent).toContain('DE')
    expect(container.textContent).toContain('10-K')
  })

  it('설립 주 정보가 없으면 em dash를 렌더링한다(빈칸이나 0이 아니다)', () => {
    const { container } = render(
      <CompanyFacts d={{ ...FULL, stateOfIncorporationDescription: null }} />,
    )
    const dt = Array.from(container.querySelectorAll('dt')).find(
      (el) => el.textContent === '설립 주(州)',
    )!
    const dd = dt.nextElementSibling as HTMLElement
    expect(dd.textContent).toBe('—')
  })

  it('SEC EDGAR 링크는 CIK로 zero-padding된 URL을 새 탭에서 연다', () => {
    const { container } = render(<CompanyFacts d={FULL} />)
    const link = container.querySelector('a') as HTMLAnchorElement
    expect(link.getAttribute('href')).toBe(
      'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0001045810&type=10-K&dateb=&owner=include&count=10',
    )
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
  })
})
