import type { CandidateRow } from '../_queries/industry'
import { formatUsd, formatPct, formatScore } from '../_lib/format'
import { Value, SignedValue } from './Value'
import { Badge } from './Badge'
import { Tooltip } from './Tooltip'

const PREVIEW_COUNT = 10

/**
 * 검토·승인된 문구를 그대로 옮긴다 — 표현을 다듬지 않는다.
 * "무엇인지"는 테이블 위 ColumnLegend가 답한다. 이 툴팁은 "어떻게 읽을지"만 답한다.
 * Ticker는 값 자체가 자기설명적이라 툴팁이 없다. Company는 SIC 대 수동 교정
 * 구분이 종목 상세 페이지에 이미 공개되어 있어 여기서는 다루지 않는다.
 */
const HEADER_HELP: Record<string, string> = {
  'Market Cap':
    '작을수록 점수가 높습니다. $500M이 10배 되는 것과 $200B가 10배 되는 건 난이도가 다르니까요. 단, 매출이 줄고 있으면 이 점수는 0이 됩니다.',
  'Rev Growth':
    '9개 항목 중 배점이 가장 큽니다(20점). 같은 30%라도 반도체와 바이오텍에서 뜻하는 바가 다르니, 종목 상세의 산업 백분위와 함께 보세요.',
  'Gross Margin':
    '수준보다 방향이 중요합니다. 8분기 추세가 배점의 40%를 차지합니다. 소프트웨어 70~80%, 하드웨어 30~50%가 통상 범위라 산업이 다르면 직접 비교하지 마세요.',
  'FCF Margin':
    '성장 초기에는 음수가 정상입니다. 다만 현금이 버티는 기간이 짧아지면 Risk 칸에 표시됩니다.',
  Debt:
    '비어 있으면(—) 빚이 없는 게 아니라 "알 수 없음"입니다. 그 회사가 SEC 신고에서 이 항목을 태깅하지 않은 경우입니다.',
  Tenbagger:
    '채점된 항목의 배점으로만 나눈 값입니다. 데이터가 부족하면 적은 항목만으로 높은 점수가 나올 수 있으니 DATA 배지를 함께 보세요. 순위 비교용이지 절대 평가가 아닙니다.',
  Risk:
    '점수와 독립적입니다. 높은 Tenbagger에 RED FLAG가 함께 붙는 조합이 실제로 나옵니다.',
}

function HeaderLabel({ label }: { label: string }) {
  const help = HEADER_HELP[label]
  if (!help) return <>{label}</>
  return <Tooltip text={help}>{label}</Tooltip>
}

/*
 * 의미가 바뀌는 경계에만 세로 구분선을 둔다 (설계 브리프 §Part 2) — 열마다
 * 긋지 않는다. 경계는 셋: 정체성(Ticker·Company) | 규모(Market Cap) |
 * 성장·수익성(Rev Growth·Gross Margin·FCF Margin·Debt) | 평가(Tenbagger·Risk).
 * 구분선은 각 그룹의 첫 열(th/td)에 border-l로 표시한다.
 */
const GROUP_START = 'border-l border-[var(--color-border)]'

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
      <div className="overflow-x-auto bg-[var(--color-surface)]">
        <table className="w-full max-w-5xl text-sm">
          <thead>
            <tr className="text-xs">
              <th>Ticker</th>
              <th>Company</th>
              <th className={`text-right ${GROUP_START}`}><HeaderLabel label="Market Cap" /></th>
              <th className={`text-right ${GROUP_START}`}><HeaderLabel label="Rev Growth" /></th>
              <th className="text-right"><HeaderLabel label="Gross Margin" /></th>
              <th className="text-right"><HeaderLabel label="FCF Margin" /></th>
              <th className="text-right"><HeaderLabel label="Debt" /></th>
              <th className={`text-right ${GROUP_START}`}><HeaderLabel label="Tenbagger" /></th>
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
                <td className="font-serif text-[var(--color-text)]">{r.name}</td>
                <td className={`text-right ${GROUP_START}`}><Value dim>{formatUsd(r.marketCap)}</Value></td>
                <td className={`text-right ${GROUP_START}`}>
                  <SignedValue value={r.revenueGrowth} text={formatPct(r.revenueGrowth)} />
                </td>
                <td className="text-right"><Value>{formatPct(r.grossMargin)}</Value></td>
                <td className="text-right">
                  <SignedValue value={r.fcfMargin} text={formatPct(r.fcfMargin)} />
                </td>
                <td className="text-right"><Value dim>{formatUsd(r.totalDebt)}</Value></td>
                <td className={`text-right font-medium ${GROUP_START}`}><Value>{formatScore(r.tenbagger)}</Value></td>
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
