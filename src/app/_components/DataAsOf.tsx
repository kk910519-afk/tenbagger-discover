import { getRawDb } from '@/db/client'
import { loadConfig } from '@/config'
import { getDataFreshness } from '../_queries/freshness'
import { formatDate, stalenessOf } from '../_lib/format'
import { Badge } from './Badge'

/**
 * 전역 헤더의 데이터 기준일 표시. 세 축을 하나로 합치지 않는 것이 요점이다 —
 * 갱신 주기가 근본적으로 달라서(주가는 일 단위, 재무는 분기 단위) 합치면 가장 최신인
 * 축이 대표값이 되고, 화면은 실제보다 늘 신선해 보이는 쪽으로만 틀린다. 스코어를 오늘
 * 재계산해도 그 점수가 쓴 주가는 며칠 전 것일 수 있다는 사실이 여기서 보여야 한다.
 *
 * 임계는 종목 상세의 Data Freshness 섹션과 같은 config(staleness)를 쓴다 — 같은 사실을
 * 두 화면이 다른 기준으로 판정하는 일이 없도록.
 */
export function DataAsOf() {
  const cfg = loadConfig()
  const raw = getRawDb()
  let freshness
  try {
    freshness = getDataFreshness(raw)
  } finally {
    raw.close()
  }

  const axes = [
    { key: 'price', label: '주가', date: freshness.priceDate, thresholdDays: cfg.staleness.price_days },
    { key: 'financials', label: '재무', date: freshness.financialsAt, thresholdDays: cfg.staleness.financials_days },
    { key: 'scores', label: '스코어', date: freshness.scoreAsOf, thresholdDays: cfg.staleness.scores_days },
  ]

  // 세 축이 전부 비어 있으면 파이프라인을 아직 돌리지 않은 상태다 — "— · — · —"를
  // 헤더에 상시로 띄우는 대신 아무것도 그리지 않는다. 그 안내는 홈이 맡는다.
  if (axes.every((a) => a.date === null)) return null

  const today = new Date().toISOString().slice(0, 10)

  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--color-text-faint)]">
      <span>데이터 기준</span>
      {axes.map((a) => (
        <span key={a.key} data-axis={a.key} className="flex items-center gap-1.5">
          <span>{a.label}</span>
          <span className="num text-[var(--color-text-dim)]">{formatDate(a.date)}</span>
          {stalenessOf(a.date, today, a.thresholdDays) === 'STALE' && <Badge tone="watch">STALE</Badge>}
        </span>
      ))}
    </p>
  )
}
