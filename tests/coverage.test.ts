import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { loadTaxonomy } from '@/taxonomy'
import { getRawDb } from '@/db/client'

const DB_PATH = process.env.DATABASE_PATH ?? './data/tenbagger.db'
const hasDb = existsSync(DB_PATH)

describe.skipIf(!hasDb)('SIC 매핑 커버리지 (실제 DB 필요)', () => {
  const tx = loadTaxonomy()

  it('유니버스의 모든 SIC가 매핑되거나 명시적 제외 목록에 있다', () => {
    const raw = getRawDb(DB_PATH)
    const rows = raw
      .prepare(
        `SELECT DISTINCT c.sic FROM companies c
         JOIN company_industry ci ON ci.cik = c.cik
         WHERE c.sic IS NOT NULL`,
      )
      .all() as { sic: string }[]
    raw.close()

    const unknown = rows
      .map((r) => r.sic)
      .filter((sic) => !tx.mappedSics.has(sic) && !tx.unmappedSics.has(sic))

    // 새 SIC가 조용히 누락되는 것을 막는다. 발견되면 sic-map.yaml에 추가하거나
    // unmapped 목록에 명시적으로 넣는다.
    expect(unknown).toEqual([])
  })

  it('분류 출처 비율을 리포트한다', () => {
    const raw = getRawDb(DB_PATH)
    const rows = raw
      .prepare('SELECT source, COUNT(*) n FROM company_industry GROUP BY source')
      .all() as { source: string; n: number }[]
    raw.close()

    const total = rows.reduce((s, r) => s + r.n, 0)
    const sicBucket = rows.find((r) => r.source === 'sic')?.n ?? 0
    console.log(
      `분류 커버리지: 전체 ${total}개, SIC 기본 버킷 ${sicBucket}개 ` +
        `(${((sicBucket / total) * 100).toFixed(1)}%), ` +
        `오버라이드 ${total - sicBucket}개`,
    )
    expect(total).toBeGreaterThan(0)
  })
})
