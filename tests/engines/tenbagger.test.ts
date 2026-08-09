import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseConfig } from '@/config'
import { scoreTenbagger, ENGINE_VERSION } from '@/engines/tenbagger'
import { evaluateQuality } from '@/engines/quality'
import { earlyTenbagger, valueTrap, megaCap, sparseData } from '../fixtures/companies'

const cfg = parseConfig(readFileSync('config.yaml', 'utf8'))

function run(s: ReturnType<typeof earlyTenbagger>) {
  const flags = evaluateQuality(s, cfg)
  return { result: scoreTenbagger(s, cfg, flags), flags }
}

describe('scoreTenbagger — 구조', () => {
  const { result } = run(earlyTenbagger())

  it('팩터 9개를 모두 보고한다', () => {
    expect(result.factors).toHaveLength(9)
    expect(result.factors.map((f) => f.key)).toContain('institutional_insider')
  })

  it('가중치 합이 100이다', () => {
    expect(result.factors.reduce((s, f) => s + f.weight, 0)).toBe(100)
  })

  it('기관/내부자는 NOT_IMPLEMENTED다', () => {
    const f = result.factors.find((x) => x.key === 'institutional_insider')!
    expect(f.status).toBe('NOT_IMPLEMENTED')
  })

  it('ENGINE_VERSION이 정의되어 있다', () => {
    expect(ENGINE_VERSION).toMatch(/\S/)
  })
})

describe('scoreTenbagger — 정규화', () => {
  it('NOT_IMPLEMENTED는 completeness 분모에서 제외된다', () => {
    const { result } = run(earlyTenbagger())
    // 9개 중 기관(5점) 제외 → 분모 95. 나머지가 모두 채점되면 completeness 1.0
    expect(result.completeness).toBeCloseTo(1.0, 2)
  })

  it('점수는 채점된 가중치로만 정규화된다', () => {
    const { result } = run(earlyTenbagger())
    const scoredFactors = result.factors.filter((f) => f.status === 'SCORED')
    const points = scoredFactors.reduce((s, f) => s + (f.points ?? 0), 0)
    const weights = scoredFactors.reduce((s, f) => s + f.weight, 0)
    expect(result.score).toBeCloseTo((100 * points) / weights, 6)
  })

  it('데이터가 부족하면 completeness가 낮다', () => {
    const { result } = run(sparseData())
    expect(result.completeness).toBeLessThan(cfg.scoring.min_completeness)
  })

  it('채점된 팩터가 하나도 없으면 score는 null', () => {
    // industryStats도 함께 비워야 한다: tam_industry_growth는 회사 자신의
    // ttm/quarterly/marketCap과 무관하게 industryStats.medianRevenueGrowth로
    // 대체 채점되므로(candidateCount >= min_industry_candidates일 때), 산업
    // 후보수까지 0으로 낮추지 않으면 이 케이스에서도 그 팩터 하나가 채점되어
    // score가 null이 아니게 된다.
    const s = sparseData()
    const empty = {
      ...s,
      ttm: [],
      quarterly: [],
      marketCap: null,
      industryStats: { ...s.industryStats, candidateCount: 0 },
    }
    const { result } = run(empty)
    expect(result.score).toBeNull()
    expect(result.completeness).toBe(0)
  })
})

describe('scoreTenbagger — 픽스처 기업별 기대 동작', () => {
  it('초기 텐배거 패턴은 높은 점수', () => {
    const { result } = run(earlyTenbagger())
    expect(result.score!).toBeGreaterThan(65)
  })

  it('밸류 트랩은 낮은 점수이고 시총 기회 게이트가 0이다', () => {
    const { result, flags } = run(valueTrap())
    expect(result.score!).toBeLessThan(35)
    const mc = result.factors.find((f) => f.key === 'market_cap_opportunity')!
    expect(mc.points).toBe(0)
    expect(flags.some((f) => f.code === 'REVENUE_DECLINE_2Y')).toBe(true)
  })

  it('밸류 트랩이 초기 텐배거보다 반드시 낮다', () => {
    expect(run(valueTrap()).result.score!).toBeLessThan(run(earlyTenbagger()).result.score!)
  })

  it('메가캡은 시총 기회 1점이지만 다른 팩터는 우수하다', () => {
    const { result } = run(megaCap())
    const mc = result.factors.find((f) => f.key === 'market_cap_opportunity')!
    expect(mc.points).toBe(1)
    const gm = result.factors.find((f) => f.key === 'gross_margin')!
    expect(gm.points!).toBeGreaterThan(7)
  })

  it('메가캡이 초기 텐배거보다 낮다 — 규모 자체가 성장 잠재력을 제한한다', () => {
    expect(run(megaCap()).result.score!).toBeLessThan(run(earlyTenbagger()).result.score!)
  })

  it('메가캡이 밸류 트랩보다 반드시 높다 — 우수한 펀더멘털을 가진 대형주는 매출이 꺾이고 Red Flag가 있는 회사보다 항상 앞선다', () => {
    expect(run(megaCap()).result.score!).toBeGreaterThan(run(valueTrap()).result.score!)
  })
})
