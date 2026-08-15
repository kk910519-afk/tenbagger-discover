import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { getRawDb, runMigrations } from '@/db/client'
import { getAllIndustrySlugs, getAllStockTickers } from '@/app/_queries/static-params'
import { getIndustryView } from '@/app/_queries/industry'
import { getStockDetail } from '@/app/_queries/stock'

/**
 * 정적 사이트에서는 미리 만들지 않은 경로가 곧 404다. 그래서 이 목록이 곧 링크의
 * 도달 가능성이고, 검증해야 할 것은 두 방향이다.
 *
 *  - 목록이 **좁으면** 표에는 보이는데 열리지 않는 링크가 생긴다.
 *  - 목록이 **넓으면** 페이지를 만들다 notFound()가 나 빌드가 통째로 깨진다.
 */
const MIN_COMPLETENESS = 0.6
const AS_OF = '2026-08-15'

let dbPath: string
let raw: Database.Database

beforeAll(() => {
  dbPath = join(mkdtempSync(join(tmpdir(), 'tb-staticparams-')), 'd.db')
  raw = getRawDb(dbPath)
  runMigrations(raw)

  raw.exec(`
    INSERT INTO themes (slug, name, display_order) VALUES ('growth', '성장', 1);
    INSERT INTO industries (slug, theme_slug, name) VALUES
      ('semis', 'growth', 'Semiconductors'),
      ('empty-industry', 'growth', 'No Companies Yet');
  `)

  const company = raw.prepare(
    `INSERT INTO companies (cik, ticker, name, is_active, first_seen, last_updated)
     VALUES (?, ?, ?, ?, '2026-01-01', '2026-01-01')`,
  )
  const classify = raw.prepare(
    `INSERT INTO company_industry (cik, industry_slug, theme_slug, source) VALUES (?, ?, 'growth', 'sic')`,
  )
  const score = raw.prepare(
    `INSERT INTO scores (cik, as_of, tenbagger, completeness, category, engine_version)
     VALUES (?, ?, ?, ?, ?, 'v1')`,
  )

  // 게이트 통과
  company.run(1, 'PASS', 'Passes Gate Inc.', 1)
  classify.run(1, 'semis')
  score.run(1, AS_OF, 70, 0.9, 'CHALLENGER')

  // 게이트 미달 — 산업 표의 INSUFFICIENT 그룹에 링크가 걸린다
  company.run(2, 'THIN', 'Thin Data Corp.', 1)
  classify.run(2, 'semis')
  score.run(2, AS_OF, 40, 0.2, 'EMERGING')

  // 스코어링 자체가 안 된 회사 — 산업 표의 미평가 그룹에 링크가 걸린다
  company.run(3, 'NOSC', 'Unscored Ltd.', 1)
  classify.run(3, 'semis')

  // 상장폐지(is_active = 0)지만 분류는 남아 있는 회사 — getStockDetail은 열어 준다
  company.run(4, 'GONE', 'Delisted Inc.', 0)
  classify.run(4, 'semis')

  // 분류되지 않은 회사 — getStockDetail이 null을 돌려주므로 목록에 들면 빌드가 깨진다
  company.run(5, 'UNCL', 'Unclassified Inc.', 1)
})

afterAll(() => {
  raw.close()
})

describe('getAllStockTickers', () => {
  it('완전성 게이트를 통과한 회사만이 아니라 분류된 모든 회사를 낸다', () => {
    expect(getAllStockTickers(raw)).toEqual(['GONE', 'NOSC', 'PASS', 'THIN'])
  })

  it('게이트 미달·미평가 회사가 빠지지 않는다 — 산업 표가 그들에게도 링크를 건다', () => {
    const view = getIndustryView(raw, 'semis', MIN_COMPLETENESS)
    const linked = view!.groups.flatMap((g) => g.rows.map((r) => r.ticker))
    // 표에 링크가 걸린 티커는 전부 생성 목록 안에 있어야 한다
    const generated = new Set(getAllStockTickers(raw))
    expect(linked.length).toBeGreaterThan(0)
    for (const ticker of linked) expect(generated.has(ticker)).toBe(true)
  })

  it('분류되지 않은 회사는 내지 않는다 — 그 경로는 빌드 중 notFound()가 된다', () => {
    expect(getAllStockTickers(raw)).not.toContain('UNCL')
    expect(getStockDetail(raw, 'UNCL', AS_OF)).toBeNull()
  })

  it('목록의 모든 티커가 실제로 페이지를 만들 수 있다', () => {
    for (const ticker of getAllStockTickers(raw)) {
      expect(getStockDetail(raw, ticker, AS_OF), ticker).not.toBeNull()
    }
  })
})

describe('getAllIndustrySlugs', () => {
  it('후보가 하나도 없는 산업도 낸다 — 홈의 지도가 링크를 걸기 때문이다', () => {
    expect(getAllIndustrySlugs(raw)).toEqual(['empty-industry', 'semis'])
  })

  it('목록의 모든 slug가 실제로 페이지를 만들 수 있다', () => {
    for (const slug of getAllIndustrySlugs(raw)) {
      expect(getIndustryView(raw, slug, MIN_COMPLETENESS), slug).not.toBeNull()
    }
  })

  it('테마가 없는 산업은 내지 않는다 — getIndustryView가 null을 돌려준다', () => {
    raw.exec(`INSERT INTO industries (slug, theme_slug, name) VALUES ('orphan', 'no-such-theme', 'Orphan')`)
    try {
      expect(getAllIndustrySlugs(raw)).not.toContain('orphan')
      expect(getIndustryView(raw, 'orphan', MIN_COMPLETENESS)).toBeNull()
    } finally {
      raw.exec(`DELETE FROM industries WHERE slug = 'orphan'`)
    }
  })
})

describe('마이그레이션 전 DB', () => {
  /**
   * getRawDb()는 파일이 없으면 만들어 준다. 파이프라인을 한 번도 돌리지 않은 사람이
   * npm run build를 실행하면 테이블 없는 DB를 열게 되는데, 여기서 SQL 에러가 터지면
   * 빌드가 "no such table"로 죽어 원인이 데이터 부재라는 사실이 드러나지 않는다.
   */
  it('테이블이 없으면 빈 목록을 낸다 — 홈 하나만 만들어지고 그 홈이 안내를 맡는다', () => {
    const emptyPath = join(mkdtempSync(join(tmpdir(), 'tb-nomigrate-')), 'd.db')
    const empty = getRawDb(emptyPath)
    try {
      expect(getAllIndustrySlugs(empty)).toEqual([])
      expect(getAllStockTickers(empty)).toEqual([])
    } finally {
      empty.close()
    }
  })
})
