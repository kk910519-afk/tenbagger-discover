import { describe, it, expect } from 'vitest'
import { sufficient, qualifyingCandidates, type CompanyRow } from '@/app/_queries/companies'

const MIN_COMPLETENESS = 0.6

function row(overrides: Partial<CompanyRow> & { cik: number; ticker: string }): CompanyRow {
  return {
    name: `${overrides.ticker} Inc`,
    industrySlug: 'semiconductors',
    themeSlug: 'ai-software-semi',
    tenbagger: 50,
    completeness: 1.0,
    category: 'CHALLENGER',
    marketCap: 1e9,
    revenueGrowth: 0.2,
    acceleration: 0.05,
    criticalCount: 0,
    ...overrides,
  }
}

describe('sufficient — 완전성 게이트', () => {
  it('completeness가 기준 이상이면 통과한다', () => {
    expect(sufficient({ completeness: 0.6 }, MIN_COMPLETENESS)).toBe(true)
    expect(sufficient({ completeness: 0.9 }, MIN_COMPLETENESS)).toBe(true)
  })

  it('completeness가 기준 미만이면 탈락한다', () => {
    expect(sufficient({ completeness: 0.59 }, MIN_COMPLETENESS)).toBe(false)
  })

  it('completeness가 null이면(스코어링 미실행) 통과시킨다', () => {
    expect(sufficient({ completeness: null }, MIN_COMPLETENESS)).toBe(true)
  })
})

describe('qualifyingCandidates — "후보"의 단일 정의', () => {
  it('completeness가 기준 미달인 회사는 점수가 더 높아도 제외한다', () => {
    const members = [
      row({ cik: 1, ticker: 'WEAK', tenbagger: 99, completeness: MIN_COMPLETENESS - 0.01 }),
      row({ cik: 2, ticker: 'OK', tenbagger: 50, completeness: MIN_COMPLETENESS }),
    ]
    const candidates = qualifyingCandidates(members, MIN_COMPLETENESS)
    expect(candidates.map((c) => c.ticker)).toEqual(['OK'])
  })

  it('LEADER는 점수가 가장 높아도 후보에서 제외한다', () => {
    const members = [
      row({ cik: 1, ticker: 'TOPDOG', tenbagger: 95, category: 'LEADER' }),
      row({ cik: 2, ticker: 'CHAL', tenbagger: 60, category: 'CHALLENGER' }),
    ]
    const candidates = qualifyingCandidates(members, MIN_COMPLETENESS)
    expect(candidates.map((c) => c.ticker)).toEqual(['CHAL'])
    expect(candidates.some((c) => c.category === 'LEADER')).toBe(false)
  })

  it('tenbagger 내림차순으로 정렬한다', () => {
    const members = [
      row({ cik: 1, ticker: 'LOW', tenbagger: 30 }),
      row({ cik: 2, ticker: 'HIGH', tenbagger: 90 }),
      row({ cik: 3, ticker: 'MID', tenbagger: 60 }),
    ]
    const candidates = qualifyingCandidates(members, MIN_COMPLETENESS)
    expect(candidates.map((c) => c.ticker)).toEqual(['HIGH', 'MID', 'LOW'])
  })

  it('tenbagger가 null인(스코어링 미실행) 회사는 제외한다', () => {
    const members = [row({ cik: 1, ticker: 'UNSCORED', tenbagger: null, completeness: null })]
    expect(qualifyingCandidates(members, MIN_COMPLETENESS)).toEqual([])
  })

  it('빈 배열이면 빈 배열을 반환한다', () => {
    expect(qualifyingCandidates([], MIN_COMPLETENESS)).toEqual([])
  })
})
