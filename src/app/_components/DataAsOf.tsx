import { getRawDb } from '@/db/client'
import { loadConfig } from '@/config'
import { getDataFreshness } from '../_queries/freshness'
import { formatDate, stalenessOf } from '../_lib/format'
import { snapshotDate } from '../_lib/snapshot'
import { Badge } from './Badge'

/**
 * 전역 헤더의 데이터 기준일 표시. 두 가지를 말한다.
 *
 * **하나. 이 페이지 전체가 스냅샷이다.** 서버 렌더링일 때 페이지는 열리는 순간 만들어졌고
 * 언제 봐도 그 순간의 것이었다. 정적 사이트에서는 빌드 시점에 얼어붙는다 — 그 사실을
 * 모르는 방문자는 지난주 주가를 오늘 주가로 읽는다. 그래서 기준일을 문장으로 먼저 적는다.
 *
 * **둘. 갱신 주기가 다른 세 축을 합치지 않는다.** 주가는 일 단위, 재무는 분기 단위라
 * 하나로 합치면 가장 최신인 축이 대표값이 되고 화면은 실제보다 늘 신선해 보이는 쪽으로만
 * 틀린다. 스코어를 오늘 재계산해도 그 점수가 쓴 주가는 며칠 전 것일 수 있다는 사실이
 * 여기서 보여야 한다.
 *
 * ## STALE 판정을 무엇에 대고 재는가
 *
 * 임계(config.yaml `staleness`)는 그대로 쓰되, **방문자의 시계가 아니라 스냅샷 기준일에
 * 대고 잰다**. 이 구분이 정적 사이트에서는 결정적이다.
 *
 * 방문자의 시계로 재면 임계는 정보를 잃는다. 모든 페이지가 같은 빌드에서 함께 나이를
 * 먹으므로, price_days(5일)를 넘기는 날 사이트의 모든 종목이 한꺼번에 STALE이 된다.
 * 늘 켜져 있는 경고는 아무것도 구별해 주지 못한다 — 늑대가 나타났다고 매번 외치는 셈이고,
 * 진짜로 수집이 밀린 축과 그저 페이지가 오래된 것을 같은 배지로 표시하게 된다.
 *
 * 스냅샷 기준일에 대고 재면 임계는 원래 답하던 질문으로 돌아간다: "이 스냅샷을 뜰 때
 * 주가 수집이 재무·스코어에 비해 밀려 있었는가." 이건 파이프라인 실행에 관한 사실이라
 * 빌드 시점에 확정되고 시간이 지나도 변하지 않는다. 종목 상세의 Data Freshness 블록도
 * 같은 기준일(`snapshotDate()`)을 쓰므로 두 화면이 같은 사실을 다르게 판정하지 않는다.
 *
 * 그러면 "이 페이지 자체가 얼마나 오래됐는가"는 누가 답하는가 — 임계가 아니라 기준일이
 * 답한다. 방문자는 오늘이 며칠인지 알고 있고, 페이지는 자기가 며칟날 것인지 말한다.
 * 정적 사이트가 정직하게 제공할 수 있는 것은 임계가 아니라 이 날짜다.
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

  const asOf = snapshotDate()

  return (
    <div className="site-asof">
      <p className="site-asof-note">
        이 페이지는 <time dateTime={asOf} className="num">{asOf}</time> 기준으로 만들어진 정적 스냅샷입니다 — 실시간 시세가 아니며, 다음 빌드까지 갱신되지 않습니다.
      </p>
      <p className="site-asof-axes">
        <span>데이터 기준</span>
        {axes.map((a) => (
          <span key={a.key} data-axis={a.key} className="flex items-center gap-1.5">
            <span>{a.label}</span>
            <span className="num text-[var(--color-text-dim)]">{formatDate(a.date)}</span>
            {stalenessOf(a.date, asOf, a.thresholdDays) === 'STALE' && <Badge tone="watch">STALE</Badge>}
          </span>
        ))}
      </p>
    </div>
  )
}
