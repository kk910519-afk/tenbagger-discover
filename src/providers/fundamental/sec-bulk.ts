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

/**
 * 한 파일에서 반드시 있어야 하는 컬럼. 없으면 그 파일은 우리가 아는 형식이 아니다.
 * `segments`·`coreg`가 특히 중요하다 — 이 둘은 **필터의 유일한 근거**라서 값이
 * 비어 있는 것이 "연결 총계"라는 뜻이기 때문이다(아래 SUB_REQUIRED 주석 참고).
 */
const SUB_REQUIRED = ['adsh', 'cik', 'form', 'filed'] as const
const NUM_REQUIRED = ['adsh', 'tag', 'ddate', 'qtrs', 'uom', 'value', 'coreg', 'segments'] as const

/**
 * 헤더가 필수 컬럼을 모두 갖췄는지 확인한다. 없으면 **던진다**.
 *
 * 이전 구현의 `col()`은 헤더에 없는 이름에 대해 `''`를 돌려줬다. 그 한 줄이
 * 이 코드베이스가 가장 비싸게 배운 결함 유형 — *틀린 값으로 계속 진행하기* —
 * 를 파일 형식 변화에 그대로 열어 뒀다. 컬럼별로 무슨 일이 벌어지는지 보면:
 *
 *  - `cik` 부재 → `Number('')`는 **0이고 `Number.isFinite(0)`은 true**다. 그
 *    아카이브의 모든 사실이 CIK 0에 귀속된다. 유니버스 필터(`ciks.has(0)`)가
 *    보통 이를 걸러 내지만, 걸러 내는 순간 그 분기 전체가 **조용히 0건**이 되어
 *    "SEC가 아직 안 올렸다"와 구분되지 않는다.
 *  - `qtrs` 부재 → 마찬가지로 0. 모든 **기간** 사실이 **시점(instant)** 사실로
 *    저장된다. 분기·연간 손익이 통째로 대차대조표 축으로 넘어간다.
 *  - `segments`/`coreg` 부재 → 모든 행이 `''`, 즉 **"연결 총계"로 판정**된다.
 *    디멘션 슬라이스 필터가 통째로 무력화되어, 세그먼트·지역·자본구성요소 값이
 *    연결 총계와 같은 키로 저장된다 — 이 파일 상단 주석이 서술하는 eBay 유령
 *    연간 기간·AZTA 잘못된 매출·XEL 음수 자기자본이 정확히 그 결과였다.
 *  - `uom`/`ddate`/`tag`/`adsh`/`value` 부재 → 모든 행이 탈락해 결과가 빈 배열이
 *    된다. 이것도 실패가 아니라 "데이터 없음"으로 보인다.
 *
 * 어느 경우든 예외는 나지 않고 파이프라인은 성공으로 끝난다. 그래서 부재를
 * 값으로 바꾸지 않고 **여기서 크게 실패시킨다** — 무엇이 없는지와 실제 헤더가
 * 무엇이었는지를 함께 담아 원인을 바로 짚을 수 있게 한다.
 */
export function requireColumns(
  file: string,
  header: readonly string[],
  required: readonly string[],
): void {
  const missing = required.filter((name) => !header.includes(name))
  if (missing.length > 0) {
    throw new Error(
      `SEC bulk ${file}: 필수 컬럼 없음 [${missing.join(', ')}] — 실제 헤더: [${header.join(', ')}]`,
    )
  }
}

/**
 * 컬럼 값을 읽는다. **헤더에 이름이 없으면 던진다** — 부재는 빈 문자열이 아니다.
 * 빈 문자열은 "그 셀이 비어 있다"는 정상적인 데이터이고, 그 둘을 같은 값으로
 * 뭉개는 것이 위 주석의 결함이었다. 행 길이가 짧아 셀이 없는 경우만 `''`이다.
 */
function col(fields: string[], header: readonly string[], name: string): string {
  const i = header.indexOf(name)
  if (i === -1) {
    throw new Error(`SEC bulk: 컬럼 "${name}" 없음 — 실제 헤더: [${header.join(', ')}]`)
  }
  return fields[i] ?? ''
}

export function parseSubLine(
  line: string,
  header: string[],
): { adsh: string; cik: number; form: string; filed: string } | null {
  const f = line.split('\t')
  const cikRaw = col(f, header, 'cik')
  // `Number('')`는 0이라 빈 셀이 CIK 0으로 통과한다. 빈 셀은 값이 아니라 결측이다.
  const cik = cikRaw === '' ? NaN : Number(cikRaw)
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
  // `qtrs`도 빈 셀을 0으로 읽으면 안 된다 — 0은 "시점(instant) 사실"이라는 뜻이라,
  // 기간 길이를 모르는 행이 대차대조표 값으로 둔갑한다.
  const qtrsRaw = col(f, header, 'qtrs')
  const qtrs = qtrsRaw === '' ? NaN : Number(qtrsRaw)
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
      if (!header) {
        header = line.split('\t')
        requireColumns('sub.txt', header, SUB_REQUIRED)
        continue
      }
      const s = parseSubLine(line, header)
      if (s && ciks.has(s.cik)) subs.set(s.adsh, { cik: s.cik, form: s.form, filed: s.filed })
    }
  }
  if (subs.size === 0) return []

  const out: RawFact[] = []
  let header: string[] | null = null
  for await (const line of lines(await openEntry(zip, 'num.txt'))) {
    if (!header) {
      header = line.split('\t')
      requireColumns('num.txt', header, NUM_REQUIRED)
      continue
    }
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
