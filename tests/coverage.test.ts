import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { getRawDb } from '@/db/client'

const DB_PATH = process.env.DATABASE_PATH ?? './data/tenbagger.db'

/**
 * DB가 없으면 당연히 스킵한다. DB가 있어도 companies가 비어 있으면(마이그레이션만
 * 하고 파이프라인을 아직 돌리지 않은 상태) 스킵한다 — 그렇지 않으면 파이프라인을
 * 돌린 뒤 pull한 다음 사람이 `npm test`를 돌릴 때마다 이 테스트가 실제 데이터를
 * 대상으로 실행되어, 로컬에서 오래된 taxonomy로 얻은 결과에 따라 뜻밖에 실패할 수 있다.
 */
function hasPopulatedDb(): boolean {
  if (!existsSync(DB_PATH)) return false
  const raw = getRawDb(DB_PATH)
  try {
    const row = raw.prepare('SELECT COUNT(*) AS n FROM companies').get() as { n: number }
    return row.n > 0
  } finally {
    raw.close()
  }
}

const hasDb = hasPopulatedDb()

describe.skipIf(!hasDb)('SIC 매핑 커버리지 (실제 DB 필요)', () => {
  it('유니버스 수집 중 매핑되지 않은 SIC가 조용히 누락되지 않는다', () => {
    // classify()가 null을 반환하면(매핑도, 명시적 unmapped 등록도 없는 SIC) 그 회사는
    // ingest-universe.ts에서 upsertCompany/setCompanyIndustry 이전에 continue된다 —
    // companies 테이블에 행 자체가 생기지 않는다. 따라서 companies/company_industry를
    // 조인하는 쿼리는 애초에 이미 분류에 성공한 회사만 보게 되고, 이 실패 양상을
    // 구조적으로 관측할 수 없다. 유일하게 남는 신호는 ingestUniverse가 리포트하고
    // runJob이 job_runs.stats에 영속화하는 unmappedSicsSeen이다.
    const raw = getRawDb(DB_PATH)
    const row = raw
      .prepare(
        `SELECT stats FROM job_runs
         WHERE job = 'universe' AND status = 'succeeded' AND stats IS NOT NULL
         ORDER BY id DESC LIMIT 1`,
      )
      .get() as { stats: string } | undefined
    raw.close()

    expect(row, 'universe 잡이 성공적으로 실행된 기록이 job_runs에 없다').toBeDefined()
    const stats = JSON.parse(row!.stats) as { unmappedSicsSeen?: string[] }
    const unmapped = stats.unmappedSicsSeen ?? []

    // 발견되면 taxonomy/sic-map.yaml의 map에 추가하거나, 의도적으로 제외할
    // SIC라면 unmapped 목록에 명시적으로 넣는다.
    expect(unmapped, `매핑되지 않은 SIC: ${unmapped.join(', ')}`).toEqual([])
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
