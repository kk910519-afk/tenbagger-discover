import type { TopCandidate } from '../_queries/top-candidates'
import { formatScore } from '../_lib/format'
import { Badge } from './Badge'

/**
 * 테마·산업을 드릴다운하기 전, 유니버스 전체에서 가장 점수가 높은 5곳을 즉시 보여준다.
 * 시총은 의도적으로 뺐다 — 이 표의 임무는 "무엇부터 볼지"이지 "얼마나 큰지"가 아니고,
 * 시가총액은 이미 market_cap_opportunity 팩터로 점수에 반영되어 있으며 근거 문구에도
 * 종종 등장한다(예: KOPN "시가총액 $0.78B → 15점"). 열을 하나 더 넣는 대신 랭크·티커·
 * 산업·점수·근거 다섯 가지로 한 줄을 지킨다.
 */
export function TopCandidates({ candidates }: { candidates: TopCandidate[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr>
            <th className="w-8 text-center">#</th>
            <th className="text-center">기업</th>
            <th className="text-center">산업</th>
            <th className="w-24 text-center">점수</th>
            <th className="text-center">핵심 근거</th>
          </tr>
        </thead>
        <tbody>
          {candidates.map((c, idx) => (
            <tr key={c.cik}>
              <td className="num text-center text-xs text-[var(--color-risk)]">{String(idx + 1).padStart(2, '0')}</td>
              <td className="text-center">
                <a href={`/stock/${c.ticker}`} className="inline-flex items-baseline justify-center gap-2">
                  <span className="font-medium">{c.ticker}</span>
                  <span className="text-[0.92rem] font-medium text-[var(--color-text-dim)]">{c.name}</span>
                </a>
              </td>
              <td className="text-center text-xs">
                <a href={`/industry/${c.industrySlug}`} className="text-[var(--color-text-dim)]">
                  {c.industryName}
                </a>
              </td>
              <td className="num text-center font-semibold">
                {formatScore(c.tenbagger)}
              </td>
              <td
                className="max-w-md truncate text-center text-sm leading-6 text-[var(--color-text-dim)]"
                title={c.rationale}
              >
                {c.rationale}
                {c.hasCriticalFlag && (
                  <span className="ml-2 inline-block align-middle">
                    <Badge tone="risk">RED FLAG</Badge>
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
