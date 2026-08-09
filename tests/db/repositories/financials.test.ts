import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { getRawDb, runMigrations } from '@/db/client'
import { insertFacts, getFacts, replaceFinancials, getFinancialsFor } from '@/db/repositories/financials'
import type { RawFact } from '@/providers/types'
import type { FinancialPeriod } from '@/domain/types'
import type { NormalizeResult } from '@/providers/fundamental/normalizer'

const CIK = 1045810

let raw: Database.Database

beforeAll(() => {
  raw = getRawDb(join(mkdtempSync(join(tmpdir(), 'tb-fin-repo-')), 'f.db'))
  runMigrations(raw)
  raw.prepare(
    `INSERT INTO companies (cik, ticker, name, is_active, first_seen, last_updated)
     VALUES (${CIK}, 'NVDA', 'NVIDIA CORP', 1, '2026-08-09', '2026-08-09')`,
  ).run()
})

describe('insertFacts — 같은 키는 filedDate가 늦은 값이 이긴다 (permanent regression)', () => {
  const KEY = {
    cik: CIK, tag: 'Revenues', unit: 'USD', periodStart: null as string | null,
    periodEnd: '2025-03-31', qtrs: 1, form: '10-Q', source: 'bulk' as const,
  }
  function fact(filedDate: string, value: number, accession: string): RawFact {
    return { ...KEY, value, filedDate, accession }
  }

  it('최초 삽입', () => {
    const n = insertFacts(raw, [fact('2025-04-15', 100, 'a-1')])
    expect(n).toBe(1)
    const [row] = getFacts(raw, CIK)
    expect(row!.value).toBe(100)
    expect(row!.filedDate).toBe('2025-04-15')
  })

  it('더 늦은 filedDate로 재신고하면 값이 갱신된다 (정정치 우선)', () => {
    const n = insertFacts(raw, [fact('2025-06-01', 999, 'a-2')])
    expect(n).toBe(1) // .changes > 0 — WHERE 절 조건이 참이라 UPDATE가 실제로 일어남
    const [row] = getFacts(raw, CIK)
    expect(row!.value).toBe(999)
    expect(row!.filedDate).toBe('2025-06-01')
    expect(row!.accession).toBe('a-2')
  })

  it('더 이른 filedDate로 재신고해도 값이 바뀌지 않는다 (오래된 재처리가 정정치를 덮어쓰지 않는다)', () => {
    const n = insertFacts(raw, [fact('2025-01-01', 1, 'a-0')])
    expect(n).toBe(0) // WHERE 절이 거짓이라 .changes === 0
    const [row] = getFacts(raw, CIK)
    expect(row!.value).toBe(999) // 이전 갱신값 그대로
    expect(row!.filedDate).toBe('2025-06-01')
    expect(row!.accession).toBe('a-2')
  })
})

describe('replaceFinancials — 재계산 시 이전 회차의 소멸된 기간을 남기지 않는다', () => {
  const OTHER_CIK = 3000000

  function period(periodEnd: string, periodType: FinancialPeriod['periodType'], revenue: number): FinancialPeriod {
    return {
      periodEnd, periodType, revenue,
      grossProfit: null, operatingIncome: null, netIncome: null,
      ocf: null, capex: null, fcf: null,
      cash: null, totalDebt: null, equity: null,
      sharesDiluted: null, sharesOutstanding: null, sbc: null, rdExpense: null,
    }
  }

  beforeAll(() => {
    raw.prepare(
      `INSERT INTO companies (cik, ticker, name, is_active, first_seen, last_updated)
       VALUES (${OTHER_CIK}, 'OLDCO', 'OLD DERIVED CORP', 1, '2026-08-09', '2026-08-09')`,
    ).run()
  })

  it('1회차: 분기 4개 + 연간 1개 + TTM 1개(총 6행)를 저장한다', () => {
    const first: NormalizeResult = {
      quarterly: [
        period('2024-03-31', 'Q', 100),
        period('2024-06-30', 'Q', 110),
        period('2024-09-30', 'Q', 120),
        period('2024-12-31', 'Q', 130),
      ],
      annual: [period('2024-12-31', 'A', 460)],
      ttm: [period('2024-12-31', 'TTM', 460)],
      sourceTags: {},
    }
    replaceFinancials(raw, OTHER_CIK, first)
    const n = raw.prepare('SELECT COUNT(*) c FROM financials WHERE cik = ?').get(OTHER_CIK) as { c: number }
    expect(n.c).toBe(6)
  })

  it('2회차: 더 적은(1개) 기간만 저장하면 1회차의 소멸된 5개 행이 완전히 사라진다', () => {
    // 원본 사실이 바뀌어(예: 정정) 재계산 결과 이전 분기/연간/TTM 기간이 더 이상
    // 유효하지 않게 된 상황을 흉내낸다. DELETE 없이 INSERT OR REPLACE만 있었다면
    // 기존 6행 + 신규 1행 = 7행이 남아 오래된 기간이 이후 성장률 계산을 오염시킨다.
    const second: NormalizeResult = {
      quarterly: [period('2025-03-31', 'Q', 200)],
      annual: [],
      ttm: [],
      sourceTags: {},
    }
    replaceFinancials(raw, OTHER_CIK, second)

    const n = raw.prepare('SELECT COUNT(*) c FROM financials WHERE cik = ?').get(OTHER_CIK) as { c: number }
    expect(n.c).toBe(1)

    const fin = getFinancialsFor(raw, OTHER_CIK)
    expect(fin.quarterly).toHaveLength(1)
    expect(fin.quarterly[0]!.periodEnd).toBe('2025-03-31')
    expect(fin.annual).toHaveLength(0)
    expect(fin.ttm).toHaveLength(0)

    // 1회차의 기간이 하나도 남아있지 않은지 명시적으로 확인
    const stale = raw
      .prepare("SELECT COUNT(*) c FROM financials WHERE cik = ? AND period_end = '2024-12-31'")
      .get(OTHER_CIK) as { c: number }
    expect(stale.c).toBe(0)
  })
})
