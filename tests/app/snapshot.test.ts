import { describe, it, expect, afterEach } from 'vitest'
import { snapshotDate, formatKoreanDate } from '@/app/_lib/snapshot'

const KEY = 'NEXT_PUBLIC_SNAPSHOT_DATE'

afterEach(() => {
  delete process.env[KEY]
})

describe('snapshotDate', () => {
  it('환경변수로 고정한 날짜를 그대로 쓴다', () => {
    process.env[KEY] = '2026-08-15'
    expect(snapshotDate()).toBe('2026-08-15')
  })

  /**
   * 정적 생성은 워커 프로세스에서 병렬로 돌고 1,000장이 넘는 페이지를 만드는 동안
   * 자정을 넘길 수 있다. 고정값이 없으면 같은 빌드 안에서 페이지마다 기준일이
   * 하루 어긋난다 — deploy 스크립트가 이 값을 찍어 넘기는 이유다.
   */
  it('고정하면 몇 번을 불러도 같은 값이다', () => {
    process.env[KEY] = '2026-01-01'
    expect(new Set([snapshotDate(), snapshotDate(), snapshotDate()]).size).toBe(1)
  })

  it('설정이 없으면 빌드 시각(UTC 날짜)으로 되돌아간다', () => {
    delete process.env[KEY]
    expect(snapshotDate()).toBe(new Date().toISOString().slice(0, 10))
  })

  it('형식이 어긋난 값은 무시한다 — 오타 하나로 사이트 전체 기준일이 깨지지 않게', () => {
    const today = new Date().toISOString().slice(0, 10)
    for (const bad of ['2026-8-15', 'yesterday', '', '2026-08-15T00:00:00Z']) {
      process.env[KEY] = bad
      expect(snapshotDate()).toBe(today)
    }
  })
})

describe('formatKoreanDate', () => {
  it('UTC로 읽어 한국어 날짜로 적는다 — 시간대 때문에 하루가 밀리지 않는다', () => {
    expect(formatKoreanDate('2026-08-15')).toBe('2026년 8월 15일')
    expect(formatKoreanDate('2026-01-01')).toBe('2026년 1월 1일')
    expect(formatKoreanDate('2026-12-31')).toBe('2026년 12월 31일')
  })
})
