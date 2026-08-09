import type { CandidateRow } from '../_queries/industry'
import { formatUsd, formatPct, formatScore } from '../_lib/format'
import { Value, SignedValue } from './Value'
import { Badge } from './Badge'
import { Tooltip } from './Tooltip'

const PREVIEW_COUNT = 10

/**
 * 검토·승인된 문구를 그대로 옮긴다 — 표현을 다듬지 않는다.
 * Ticker는 값 자체가 자기설명적이라 툴팁이 없다.
 */
const HEADER_HELP: Record<string, string> = {
  Company:
    '산업 분류가 SIC 기본값인지 수동 교정인지 표시합니다. 기본값이면 같은 산업 내 비교가 거칠 수 있습니다.',
  'Market Cap':
    '주가 × SEC 발행주식수.\n이 대시보드에선 작을수록 점수가 높습니다 (15점). $500M이 10배 되는 것과 $200B가 10배 되는 건 난이도가 다르니까요. 단 매출이 줄고 있으면 이 점수는 0이 됩니다.',
  'Rev Growth':
    '최근 4개 분기 합계의 전년 대비 증가율.\n9개 팩터 중 배점이 가장 큽니다 (20점, 3년 CAGR과 6:4 블렌드). 30%가 반도체와 바이오텍에서 뜻하는 바가 다르므로, 종목 상세의 산업 백분위를 함께 보세요.',
  'Gross Margin':
    '매출총이익 ÷ 매출 (최근 4개 분기).\n수준보다 방향이 중요합니다 — 8분기 추세가 배점의 40%를 차지합니다. 소프트웨어 70~80%, 하드웨어 30~50%가 통상 범위라 산업 간 직접 비교는 의미 없습니다.',
  'FCF Margin':
    '(영업현금흐름 − 자본지출) ÷ 매출.\n회계상 이익이 아니라 실제로 남은 현금입니다. 성장 초기 기업은 음수가 정상이지만, 현금이 버티는 기간이 짧아지면 Risk에 표시됩니다.',
  Debt:
    '총부채 (장기 + 유동).\n비어 있으면(—) 부채가 0이 아니라 "알 수 없음"입니다. 해당 기업이 SEC 신고에 그 항목을 태깅하지 않은 경우입니다.',
  Tenbagger:
    '0~100점. 9개 팩터를 가중 합산하되 실제로 채점된 팩터의 가중치로만 나눕니다.\n그래서 데이터가 부족한 기업이 적은 팩터로 높은 점수를 받을 수 있습니다 — DATA 배지를 반드시 함께 보세요. 절대 평가가 아니라 비교·정렬용 도구입니다.',
  Risk:
    'RED FLAG(치명): 2년 연속 매출 감소 · 자본잠식+현금유출 · 현금 2분기 미만 · 주식수 1년 50%↑\nWATCH(경고): 마진 급락 · 주식보상 과다 · 희석 15%↑ · 레버리지 과다 · 현금 6분기 미만\n점수와 독립적입니다. 높은 Tenbagger + RED FLAG 조합이 실제로 나옵니다.',
}

function HeaderLabel({ label }: { label: string }) {
  const help = HEADER_HELP[label]
  if (!help) return <>{label}</>
  return <Tooltip text={help}>{label}</Tooltip>
}

export function CandidateTable({
  rows, showAll, industrySlug, insufficientBelow,
}: {
  rows: CandidateRow[]
  showAll: boolean
  industrySlug: string
  insufficientBelow: number
}) {
  if (rows.length === 0) {
    return <p className="text-xs text-[var(--color-text-faint)]">해당 없음</p>
  }
  const visible = showAll ? rows : rows.slice(0, PREVIEW_COUNT)

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs">
              <th>Ticker</th>
              <th><HeaderLabel label="Company" /></th>
              <th className="text-right"><HeaderLabel label="Market Cap" /></th>
              <th className="text-right"><HeaderLabel label="Rev Growth" /></th>
              <th className="text-right"><HeaderLabel label="Gross Margin" /></th>
              <th className="text-right"><HeaderLabel label="FCF Margin" /></th>
              <th className="text-right"><HeaderLabel label="Debt" /></th>
              <th className="text-right"><HeaderLabel label="Tenbagger" /></th>
              <th><HeaderLabel label="Risk" /></th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr key={r.cik}>
                <td>
                  <a href={`/stock/${r.ticker}`} className="font-medium">
                    {r.ticker}
                  </a>
                </td>
                <td className="text-[var(--color-text-dim)]">{r.name}</td>
                <td className="text-right"><Value dim>{formatUsd(r.marketCap)}</Value></td>
                <td className="text-right">
                  <SignedValue value={r.revenueGrowth} text={formatPct(r.revenueGrowth)} />
                </td>
                <td className="text-right"><Value>{formatPct(r.grossMargin)}</Value></td>
                <td className="text-right">
                  <SignedValue value={r.fcfMargin} text={formatPct(r.fcfMargin)} />
                </td>
                <td className="text-right"><Value dim>{formatUsd(r.totalDebt)}</Value></td>
                <td className="text-right font-medium"><Value>{formatScore(r.tenbagger)}</Value></td>
                <td className="space-x-1">
                  {r.criticalCount > 0 && <Badge tone="risk">RED FLAG</Badge>}
                  {r.criticalCount === 0 && r.warningCount > 0 && <Badge tone="watch">WATCH</Badge>}
                  {r.completeness !== null && r.completeness < insufficientBelow && (
                    <Badge>DATA {formatPct(r.completeness, 0)}</Badge>
                  )}
                  {r.completeness === null && <Badge>미평가</Badge>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!showAll && rows.length > PREVIEW_COUNT && (
        <a
          href={`/industry/${industrySlug}?all=1`}
          className="mt-2 inline-block text-xs text-[var(--color-info)]"
        >
          View All Candidates ({rows.length})
        </a>
      )}
    </>
  )
}
