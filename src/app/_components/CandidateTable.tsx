import type { CandidateRow } from '../_queries/industry'
import { formatUsd, formatPct, formatScore } from '../_lib/format'
import { Value, SignedValue } from './Value'
import { Badge } from './Badge'

const PREVIEW_COUNT = 10

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
              <th>Company</th>
              <th className="text-right">Market Cap</th>
              <th className="text-right">Rev Growth</th>
              <th className="text-right">Gross Margin</th>
              <th className="text-right">FCF Margin</th>
              <th className="text-right">Debt</th>
              <th className="text-right">Tenbagger</th>
              <th>Risk</th>
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
