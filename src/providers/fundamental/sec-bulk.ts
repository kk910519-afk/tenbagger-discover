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
  value: number; coreg: string
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
