import { describe, it, expect } from 'vitest'
import { zipSync, strToU8 } from 'fflate'
import {
  parseSubLine,
  parseNumLine,
  requireColumns,
  extractFactsFromZip,
} from '@/providers/fundamental/sec-bulk'

const SUB_HEADER = ['adsh', 'cik', 'name', 'sic', 'form', 'period', 'fy', 'fp', 'filed']
// 실제 num.txt의 컬럼 순서 그대로다(2026q1 아카이브에서 확인):
// adsh, tag, version, ddate, qtrs, uom, segments, coreg, value, footnote
const NUM_HEADER = [
  'adsh', 'tag', 'version', 'ddate', 'qtrs', 'uom', 'segments', 'coreg', 'value', 'footnote',
]

describe('parseSubLine', () => {
  it('adsh·cik·form·filed를 뽑는다', () => {
    const line = '0001045810-25-000123\t1045810\tNVIDIA CORP\t3674\t10-Q\t20250430\t2026\tQ1\t20250528'
    expect(parseSubLine(line, SUB_HEADER)).toEqual({
      adsh: '0001045810-25-000123',
      cik: 1045810,
      form: '10-Q',
      filed: '2025-05-28',
    })
  })

  it('cik이 숫자가 아니면 null', () => {
    expect(parseSubLine('a\tzz\tn\t1\t10-K\t1\t1\tFY\t20250101', SUB_HEADER)).toBeNull()
  })

  it('cik 셀이 비어 있으면 null — Number("")=0을 CIK 0으로 통과시키지 않는다', () => {
    expect(parseSubLine('a\t\tn\t1\t10-K\t1\t1\tFY\t20250101', SUB_HEADER)).toBeNull()
  })
})

describe('헤더 검증 — 컬럼 부재는 빈 문자열이 아니다', () => {
  it('cik 컬럼이 없으면 던진다 (Number("")=0이라 조용히 CIK 0이 된다)', () => {
    const header = SUB_HEADER.filter((c) => c !== 'cik')
    expect(() => requireColumns('sub.txt', header, ['adsh', 'cik', 'form', 'filed']))
      .toThrow(/cik/)
    // 행 파서도 스스로 방어한다 — 헤더에 없는 이름을 ''로 읽지 않는다.
    expect(() => parseSubLine('0001045810-25-000123\tNVIDIA CORP\t3674\t10-Q\t20250430\t2026\tQ1\t20250528', header))
      .toThrow(/cik/)
  })

  it('segments 컬럼이 없으면 던진다 — 없으면 모든 디멘션 슬라이스가 연결 총계로 통과한다', () => {
    const header = NUM_HEADER.filter((c) => c !== 'segments')
    expect(() => requireColumns('num.txt', header, ['adsh', 'tag', 'ddate', 'qtrs', 'uom', 'value', 'coreg', 'segments']))
      .toThrow(/segments/)
    expect(() => parseNumLine('a\tRevenues\tus-gaap/2024\t20250430\t1\tUSD\t\t44060000000\t', header))
      .toThrow(/segments/)
  })

  it('에러 메시지에 없는 컬럼과 실제 헤더가 모두 담긴다 (귀속 가능하게)', () => {
    expect(() => requireColumns('num.txt', ['adsh', 'tag'], ['adsh', 'tag', 'coreg', 'segments']))
      .toThrow(/필수 컬럼 없음 \[coreg, segments\].*실제 헤더: \[adsh, tag\]/)
  })

  it('빈 셀은 정상 데이터다 — 컬럼이 있으면 던지지 않는다', () => {
    expect(() => requireColumns('num.txt', NUM_HEADER, ['segments', 'coreg'])).not.toThrow()
    expect(parseNumLine(
      '0001045810-25-000123\tRevenues\tus-gaap/2024\t20250430\t1\tUSD\t\t\t44060000000\t',
      NUM_HEADER,
    )?.segments).toBe('')
  })

  it('extractFactsFromZip이 sub.txt 헤더 결손에서 던진다 (조용한 0건이 아니다)', async () => {
    const badSub = [
      SUB_HEADER.filter((c) => c !== 'cik').join('\t'),
      '0001045810-25-000123\tNVIDIA CORP\t3674\t10-Q\t20250430\t2026\tQ1\t20250528',
    ].join('\n')
    const num = [
      NUM_HEADER.join('\t'),
      '0001045810-25-000123\tRevenues\tus-gaap/2024\t20250430\t1\tUSD\t\t\t44060000000\t',
    ].join('\n')
    const zip = Buffer.from(zipSync({ 'sub.txt': strToU8(badSub), 'num.txt': strToU8(num) }))
    await expect(extractFactsFromZip(zip, new Set([1045810]))).rejects.toThrow(/sub\.txt.*cik/)
  })

  it('extractFactsFromZip이 num.txt의 segments 결손에서 던진다 — 이전에는 슬라이스가 총계로 저장됐다', async () => {
    const sub = [
      SUB_HEADER.join('\t'),
      '0000072903-26-000009\t72903\tXCEL ENERGY INC\t4931\t10-K\t20251231\t2025\tFY\t20260225',
    ].join('\n')
    // 실측 XEL 행에서 segments 컬럼만 빠진 형태. 이전 구현에서는 자본변동표 슬라이스
    // −53,000,000이 `segments=''`(연결 총계)로 읽혀 그대로 저장됐다.
    const badNum = [
      NUM_HEADER.filter((c) => c !== 'segments').join('\t'),
      '0000072903-26-000009\tStockholdersEquity\tus-gaap/2025\t20231231\t0\tUSD\t\t-53000000\t',
    ].join('\n')
    const zip = Buffer.from(zipSync({ 'sub.txt': strToU8(sub), 'num.txt': strToU8(badNum) }))
    await expect(extractFactsFromZip(zip, new Set([72903]))).rejects.toThrow(/num\.txt.*segments/)
  })
})

describe('parseNumLine', () => {
  it('수치 행을 파싱한다', () => {
    const line = '0001045810-25-000123\tRevenues\tus-gaap/2024\t20250430\t1\tUSD\t\t\t44060000000\t'
    expect(parseNumLine(line, NUM_HEADER)).toEqual({
      adsh: '0001045810-25-000123',
      tag: 'Revenues',
      ddate: '20250430',
      qtrs: 1,
      uom: 'USD',
      value: 44060000000,
      coreg: '',
      segments: '',
    })
  })

  it('segments 컬럼을 그대로 돌려준다 — 디멘션 슬라이스 판정의 유일한 근거다', () => {
    const line =
      '0001065088-26-000027\tGrossProfit\tus-gaap/2025\t20250930\t4\tUSD\t' +
      'EquityMethodInvestmentNonconsolidatedInvestee=EquityMethodInvestmentNonconsolidatedInvesteeOrGroupOfInvestees;\t\t44000000\t'
    expect(parseNumLine(line, NUM_HEADER)?.segments).toBe(
      'EquityMethodInvestmentNonconsolidatedInvestee=EquityMethodInvestmentNonconsolidatedInvesteeOrGroupOfInvestees;',
    )
  })

  it('value가 비어 있으면 null', () => {
    const line = '0001045810-25-000123\tRevenues\tus-gaap/2024\t20250430\t1\tUSD\t\t\t\t'
    expect(parseNumLine(line, NUM_HEADER)).toBeNull()
  })

  it('value가 "0"이면 실제 값 0으로 파싱한다 (빈 값과 구분)', () => {
    const line = '0001045810-25-000123\tRevenues\tus-gaap/2024\t20250430\t1\tUSD\t\t\t0\t'
    const result = parseNumLine(line, NUM_HEADER)
    expect(result).not.toBeNull()
    expect(result?.value).toBe(0)
  })

  it('qtrs 셀이 비어 있으면 null — 기간 사실이 시점(qtrs=0) 사실로 둔갑하지 않는다', () => {
    const line = '0001045810-25-000123\tRevenues\tus-gaap/2024\t20250430\t\tUSD\t\t\t44060000000\t'
    expect(parseNumLine(line, NUM_HEADER)).toBeNull()
  })
})

describe('extractFactsFromZip', () => {
  const sub = [
    SUB_HEADER.join('\t'),
    '0001045810-25-000123\t1045810\tNVIDIA CORP\t3674\t10-Q\t20250430\t2026\tQ1\t20250528',
    '0000000099-25-000001\t99\tOTHER CORP\t6022\t10-Q\t20250331\t2025\tQ1\t20250501',
  ].join('\n')

  const num = [
    NUM_HEADER.join('\t'),
    // 대상 CIK · 추적 태그 · 연결기준 → 채택
    '0001045810-25-000123\tRevenues\tus-gaap/2024\t20250430\t1\tUSD\t\t\t44060000000\t',
    // coreg가 있으면 자회사 단위이므로 제외
    '0001045810-25-000123\tRevenues\tus-gaap/2024\t20250430\t1\tUSD\t\tSUBSID\t1000\t',
    // segments가 있으면 디멘션 슬라이스이므로 제외 (제품·지역 축)
    '0001045810-25-000123\tRevenues\tus-gaap/2024\t20250430\t1\tUSD\tGeographical=CN;\t\t1169000000\t',
    // 추적 대상이 아닌 태그는 제외
    '0001045810-25-000123\tSomeOtherTag\tus-gaap/2024\t20250430\t1\tUSD\t\t\t5\t',
    // USD가 아닌 단위(주식수 제외)는 제외
    '0001045810-25-000123\tGrossProfit\tus-gaap/2024\t20250430\t1\tEUR\t\t\t9\t',
    // 유니버스 밖 CIK는 제외
    '0000000099-25-000001\tRevenues\tus-gaap/2024\t20250331\t1\tUSD\t\t\t777\t',
    // 주식수는 shares 단위 허용
    '0001045810-25-000123\tWeightedAverageNumberOfDilutedSharesOutstanding\tus-gaap/2024\t20250430\t1\tshares\t\t\t24600000000\t',
  ].join('\n')

  const zip = Buffer.from(
    zipSync({ 'sub.txt': strToU8(sub), 'num.txt': strToU8(num) }),
  )

  it('유니버스 CIK와 추적 태그만 남긴다', async () => {
    const facts = await extractFactsFromZip(zip, new Set([1045810]))
    const keys = facts.map((f) => `${f.tag}:${f.unit}`)
    expect(keys).toContain('Revenues:USD')
    expect(keys).toContain('WeightedAverageNumberOfDilutedSharesOutstanding:shares')
    expect(keys).not.toContain('SomeOtherTag:USD')
    expect(keys).not.toContain('GrossProfit:EUR')
    expect(facts).toHaveLength(2)
  })

  it('sub.txt에서 form과 filed를 결합한다', async () => {
    const facts = await extractFactsFromZip(zip, new Set([1045810]))
    const rev = facts.find((f) => f.tag === 'Revenues')!
    expect(rev.cik).toBe(1045810)
    expect(rev.form).toBe('10-Q')
    expect(rev.filedDate).toBe('2025-05-28')
    expect(rev.periodEnd).toBe('2025-04-30')
    expect(rev.qtrs).toBe(1)
    expect(rev.value).toBe(44060000000)
    expect(rev.source).toBe('bulk')
    expect(rev.periodStart).toBeNull()
  })

  it('디멘션 슬라이스를 버린다 — 연결 총계만 남는다', async () => {
    const facts = await extractFactsFromZip(zip, new Set([1045810]))
    const revenues = facts.filter((f) => f.tag === 'Revenues')
    expect(revenues).toHaveLength(1)
    expect(revenues[0]?.value).toBe(44060000000)
    // 지역 축 슬라이스 1,169,000,000이 연결 총계와 같은 키로 저장되면
    // 어느 쪽이 살아남을지는 num.txt의 줄 순서가 정한다.
    expect(facts.map((f) => f.value)).not.toContain(1169000000)
  })

  it('eBay 유령 연간 기간의 실제 행 — 지분법 피투자회사 축이 붙은 4분기 매출총이익은 들어오지 않는다', async () => {
    // 실측(0001065088-26-000027, eBay FY2025 10-K): `GrossProfit` ddate=20250930
    // qtrs=4 값 44,000,000에는 `EquityMethodInvestmentNonconsolidatedInvestee` 축이
    // 붙어 있다 — eBay(회계연도 12월 말)가 아니라 Adevinta의 요약재무다. 이 한 행이
    // 매출 NULL·매출총이익만 있는 "연간" 기간을 만들어 해자 lookback 창을 잠식했다.
    const ebaySub = [
      SUB_HEADER.join('\t'),
      '0001065088-26-000027\t1065088\tEBAY INC\t7389\t10-K\t20251231\t2025\tFY\t20260219',
    ].join('\n')
    const ebayNum = [
      NUM_HEADER.join('\t'),
      '0001065088-26-000027\tGrossProfit\tus-gaap/2025\t20250930\t4\tUSD\t' +
        'EquityMethodInvestmentNonconsolidatedInvestee=EquityMethodInvestmentNonconsolidatedInvesteeOrGroupOfInvestees;\t\t44000000\t',
      '0001065088-26-000027\tGrossProfit\tus-gaap/2025\t20251231\t4\tUSD\t\t\t7931000000\t',
    ].join('\n')
    const ebayZip = Buffer.from(
      zipSync({ 'sub.txt': strToU8(ebaySub), 'num.txt': strToU8(ebayNum) }),
    )
    const facts = await extractFactsFromZip(ebayZip, new Set([1065088]))
    expect(facts).toHaveLength(1)
    expect(facts[0]?.periodEnd).toBe('2025-12-31')
    expect(facts[0]?.value).toBe(7931000000)
  })

  it('XEL 자본변동표 슬라이스 — 자본이 음수로 저장되던 행이 들어오지 않는다', async () => {
    // 실측(0000072903-26-000009, XEL FY2025 10-K): 2023-12-31의 `StockholdersEquity`는
    // `EquityComponents=…` 축이 붙은 세 줄뿐이고(−53M / −94M / −41M) 연결 총계는 그
    // 신고서에 없다. 이 −53,000,000이 실제 수백억 달러대 자기자본 자리에 저장돼 있었고,
    // 나중 신고라는 이유로 이미 정확했던 API 값까지 덮어썼다.
    const xelSub = [
      SUB_HEADER.join('\t'),
      '0000072903-26-000009\t72903\tXCEL ENERGY INC\t4931\t10-K\t20251231\t2025\tFY\t20260225',
    ].join('\n')
    const xelNum = [
      NUM_HEADER.join('\t'),
      '0000072903-26-000009\tStockholdersEquity\tus-gaap/2025\t20231231\t0\tUSD\tEquityComponents=AccumulatedGainLossNetCashFlowHedgeParent;\t\t-53000000\t',
      '0000072903-26-000009\tStockholdersEquity\tus-gaap/2025\t20251231\t0\tUSD\t\t\t23609000000\t',
    ].join('\n')
    const xelZip = Buffer.from(
      zipSync({ 'sub.txt': strToU8(xelSub), 'num.txt': strToU8(xelNum) }),
    )
    const facts = await extractFactsFromZip(xelZip, new Set([72903]))
    expect(facts).toHaveLength(1)
    expect(facts[0]?.value).toBe(23609000000)
  })
})
