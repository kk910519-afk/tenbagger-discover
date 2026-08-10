import { createInterface } from 'node:readline'
import { Readable } from 'node:stream'
import yauzl from 'yauzl'
import type { BulkFundamentalProvider, RawFact } from '../types.js'
import type { HttpClient } from '../http/client.js'
import { TRACKED_TAGS } from './tags.js'

const SHARE_UNITS = new Set(['shares', 'pure'])

function bulkUrl(year: number, quarter: number): string {
  return `https://www.sec.gov/files/dera/data/financial-statement-data-sets/${year}q${quarter}.zip`
}

function isoDate(yyyymmdd: string): string | null {
  if (!/^\d{8}$/.test(yyyymmdd)) return null
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`
}

function col(fields: string[], header: string[], name: string): string {
  const i = header.indexOf(name)
  return i === -1 ? '' : (fields[i] ?? '')
}

export function parseSubLine(
  line: string,
  header: string[],
): { adsh: string; cik: number; form: string; filed: string } | null {
  const f = line.split('\t')
  const cik = Number(col(f, header, 'cik'))
  const filed = isoDate(col(f, header, 'filed'))
  const adsh = col(f, header, 'adsh')
  if (!Number.isFinite(cik) || !filed || !adsh) return null
  return { adsh, cik, form: col(f, header, 'form'), filed }
}

export function parseNumLine(
  line: string,
  header: string[],
): {
  adsh: string; tag: string; ddate: string; qtrs: number; uom: string
  value: number; coreg: string; segments: string
} | null {
  const f = line.split('\t')
  const valueRaw = col(f, header, 'value')
  if (valueRaw === '') return null
  const value = Number(valueRaw)
  const qtrs = Number(col(f, header, 'qtrs'))
  if (!Number.isFinite(value) || !Number.isFinite(qtrs)) return null
  return {
    adsh: col(f, header, 'adsh'),
    tag: col(f, header, 'tag'),
    ddate: col(f, header, 'ddate'),
    qtrs,
    uom: col(f, header, 'uom'),
    value,
    coreg: col(f, header, 'coreg'),
    // num.txt는 축(axis) 조합을 `Axis=Member;` 형태로 이 컬럼에 담는다. 빈 문자열이
    // **연결 총계**이고, 비어 있지 않으면 디멘션 슬라이스다 — 아래 필터의 근거.
    segments: col(f, header, 'segments'),
  }
}

function openEntry(zip: Buffer, name: string): Promise<Readable> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(zip, { lazyEntries: true }, (err, zipfile) => {
      if (err || !zipfile) return reject(err ?? new Error('ZIP 열기 실패'))
      zipfile.on('entry', (entry) => {
        if (entry.fileName !== name) return zipfile.readEntry()
        zipfile.openReadStream(entry, (e2, stream) => {
          if (e2 || !stream) return reject(e2 ?? new Error(`${name} 스트림 실패`))
          resolve(stream)
        })
      })
      zipfile.on('end', () => reject(new Error(`ZIP에 ${name}이 없습니다`)))
      zipfile.readEntry()
    })
  })
}

async function* lines(stream: Readable): AsyncGenerator<string> {
  const rl = createInterface({ input: stream, crlfDelay: Infinity })
  for await (const line of rl) yield line
}

/**
 * sub.txt로 adsh→(cik, form, filed)를 만든 뒤 num.txt를 줄 단위로 흘려보내며
 * 유니버스 CIK와 추적 태그에 해당하는 행만 남긴다.
 * num.txt는 압축 해제 시 수백 MB이므로 전체를 메모리에 올리지 않는다.
 *
 * **`segments`가 비어 있지 않은 행은 버린다 — 디멘션 슬라이스다.**
 * `coreg`(자회사 축)만 걸러도 충분하다고 보아 이 컬럼을 무시해 왔는데, num.txt는
 * 세그먼트·지역·제품·자본구성요소·지분법피투자회사 같은 **모든** 축 조합을
 * `Axis=Member;` 형태로 `segments`에 담는다. 그 값들이 연결 총계와 같은 키
 * (cik, tag, period_end, qtrs, form)로 저장되면서 세 가지 손상을 만들었다 —
 * 셋 다 라이브 DB 실측이다:
 *
 *  1. **유령 연간 기간.** eBay FY2025 10-K(0001065088-26-000027)의
 *     `GrossProfit` ddate=20250930 qtrs=4 값 44,000,000은
 *     `segments=EquityMethodInvestmentNonconsolidatedInvestee=…;` — 지분법
 *     피투자회사(Adevinta)의 요약재무다. eBay의 회계연도는 12월 말이므로
 *     9월 30일로 끝나는 "연간" 기간 자체가 존재하지 않는데, 이 행 때문에
 *     2022~2025년 9월 30일에 매출 NULL·매출총이익만 있는 연간 행 네 개가
 *     생겨 해자 lookback 창을 잠식했다(전체 284행 / 85개사).
 *  2. **잘못된 값.** 같은 키의 슬라이스와 총계가 충돌하면 먼저 들어온 쪽이
 *     이긴다(insertFacts는 filed_date·source가 같으면 갱신하지 않는다).
 *     AZTA 2025-12-31 10-Q에서 연결 매출 148,642,000 옆에
 *     `BusinessSegments=Multiomics;` 슬라이스가 같은 키로 들어왔다.
 *  3. **부호까지 뒤집힌 값.** XEL의 2022·2023년 자기자본이 −93,000,000 /
 *     −53,000,000으로 저장돼 있었는데, 실제는 각각 수백억 달러대이고 저 값은
 *     `EquityComponents=AccumulatedGainLossNetCashFlowHedgeParent;` 같은
 *     자본변동표의 **한 칸**이다. 게다가 나중에 제출된 10-K의 슬라이스가
 *     filed_date 비교에서 이겨 이미 정확했던 API 값을 덮어썼다.
 *
 * 기업별 companyfacts API는 디멘션이 붙은 사실을 아예 내보내지 않으므로 이
 * 필터는 두 소스의 의미를 일치시킨다.
 */
export async function extractFactsFromZip(
  zip: Buffer,
  ciks: Set<number>,
): Promise<RawFact[]> {
  const subs = new Map<string, { cik: number; form: string; filed: string }>()
  {
    let header: string[] | null = null
    for await (const line of lines(await openEntry(zip, 'sub.txt'))) {
      if (!header) { header = line.split('\t'); continue }
      const s = parseSubLine(line, header)
      if (s && ciks.has(s.cik)) subs.set(s.adsh, { cik: s.cik, form: s.form, filed: s.filed })
    }
  }
  if (subs.size === 0) return []

  const out: RawFact[] = []
  let header: string[] | null = null
  for await (const line of lines(await openEntry(zip, 'num.txt'))) {
    if (!header) { header = line.split('\t'); continue }
    const n = parseNumLine(line, header)
    if (!n) continue
    if (n.coreg !== '') continue              // 자회사 단위 제외, 연결기준만
    if (n.segments !== '') continue           // 디멘션 슬라이스 제외 — 아래 근거
    if (!TRACKED_TAGS.has(n.tag)) continue
    const sub = subs.get(n.adsh)
    if (!sub) continue
    if (n.uom !== 'USD' && !SHARE_UNITS.has(n.uom)) continue
    const periodEnd = isoDate(n.ddate)
    if (!periodEnd) continue

    out.push({
      cik: sub.cik,
      tag: n.tag,
      unit: n.uom,
      periodStart: null,      // num.txt는 시작일을 제공하지 않는다. qtrs가 기간 길이를 나타낸다.
      periodEnd,
      qtrs: n.qtrs,
      value: n.value,
      form: sub.form,
      filedDate: sub.filed,
      accession: n.adsh,
      source: 'bulk',
    })
  }
  return out
}

export function createSecBulkProvider(http: HttpClient): BulkFundamentalProvider {
  return {
    async fetchQuarter(year, quarter, ciks) {
      const zip = await http.getBuffer(bulkUrl(year, quarter), { cache: true })
      return extractFactsFromZip(zip, ciks)
    },
  }
}
