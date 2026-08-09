import { getRawDb } from '@/db/client'
import { loadConfig } from '@/config'
import { getOpportunityMap, type IndustryRow, type ThemeBlock } from './_queries/map'
import { getTopCandidates, type TopCandidate } from './_queries/top-candidates'
import { formatUsd, formatPct, formatScore } from './_lib/format'
import { Value, SignedValue } from './_components/Value'
import { Badge } from './_components/Badge'
import { ScoreBar } from './_components/ScoreBar'
import { TopCandidates } from './_components/TopCandidates'
import { Card } from './_components/Card'

export const dynamic = 'force-dynamic'

export default function Home() {
  const cfg = loadConfig()
  const raw = getRawDb()
  let themes: ThemeBlock[]
  let topCandidates: TopCandidate[]
  try {
    themes = getOpportunityMap(raw, cfg.scoring.min_completeness)
    topCandidates = getTopCandidates(raw, cfg.scoring.min_completeness, 5)
  } finally {
    raw.close()
  }

  const total = themes.reduce(
    (sum, t) => sum + t.industries.reduce((n, i) => n + i.candidateCount, 0),
    0,
  )

  // 유니버스 자체가 비어 있는 경우(파이프라인 미실행)는 헤드라인 블록도 렌더링할
  // 데이터가 없다 — 빈 표 껍데기 대신 기존 설치 안내를 그대로 유지한다.
  if (total === 0) {
    return (
      <Card title="Setup Required" subtitle="파이프라인을 실행하면 대시보드가 채워집니다">
        <p className="text-sm text-[var(--color-text)]">아직 수집된 데이터가 없습니다.</p>
        <p className="mt-1 text-xs text-[var(--color-text-dim)]">
          아래 명령을 순서대로 실행하면 유니버스 수집부터 스코어링까지 완료됩니다.
        </p>
        <pre className="num mt-3 rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-xs text-[var(--color-text-dim)]">
          <code>{'npm run db:migrate\nnpm run pipeline:all'}</code>
        </pre>
      </Card>
    )
  }

  return (
    <div className="space-y-5">
      <Card
        title="Top 5 · Universe-Wide"
        subtitle="Theme·Industry 경계와 무관하게 점수가 가장 높은 후보 5곳"
      >
        {topCandidates.length === 0 ? (
          <p className="text-xs text-[var(--color-text-faint)]">
            데이터 완전성 기준({formatPct(cfg.scoring.min_completeness, 0)})을 통과한 후보가 아직 없습니다.
          </p>
        ) : (
          <TopCandidates candidates={topCandidates} />
        )}
      </Card>

      <div className="pt-2">
        <h1 className="text-xl font-medium tracking-tight">Growth Opportunity Map</h1>
        <p className="mt-1 text-xs text-[var(--color-text-dim)]">
          후보 <Value>{total.toLocaleString()}</Value>개 · Theme <Value>{themes.length}</Value>개
        </p>
      </div>

      <div className="grid grid-cols-1 gap-5">
        {themes.map((theme) => (
          <ThemeSection key={theme.slug} slug={theme.slug} name={theme.name} industries={theme.industries} />
        ))}
      </div>
    </div>
  )
}

function ThemeSection({
  slug, name, industries,
}: {
  slug: string
  name: string
  industries: IndustryRow[]
}) {
  const candidateCount = industries.reduce((n, i) => n + i.candidateCount, 0)
  const subtitle = industries.length > 0 ? `${industries.length}개 산업 · 후보 ${candidateCount}개` : '후보 없음'

  return (
    <Card id={slug} title={name} subtitle={subtitle}>
      {industries.length === 0 ? (
        <div className="border border-dashed border-[var(--color-border)] px-3 py-4 text-xs text-[var(--color-text-faint)]">
          이 Theme에는 아직 후보가 없습니다.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs">
                <th>Industry</th>
                <th className="text-right">후보</th>
                <th className="text-right">매출성장 중앙값</th>
                <th className="text-right">시총 중앙값</th>
                <th>평균 Score</th>
                <th>Top Candidate</th>
                <th className="text-right">Momentum</th>
                <th className="text-right">Risk</th>
              </tr>
            </thead>
            <tbody>
              {industries.map((i) => (
                <IndustryRowView key={i.slug} row={i} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

function IndustryRowView({ row }: { row: IndustryRow }) {
  return (
    <tr>
      <td>
        <a href={`/industry/${row.slug}`}>{row.name}</a>
      </td>
      <td className="text-right">
        <Value dim>{row.candidateCount}</Value>
      </td>
      <td className="text-right">
        <SignedValue value={row.medianRevenueGrowth} text={formatPct(row.medianRevenueGrowth)} />
      </td>
      <td className="text-right">
        <Value dim>{formatUsd(row.medianMarketCap)}</Value>
      </td>
      <td className="w-40">
        <ScoreBar value={row.avgTenbagger} />
      </td>
      <td>
        {row.topCandidate ? (
          <a href={`/stock/${row.topCandidate.ticker}`} className="inline-flex items-baseline gap-1.5">
            <span className="font-medium">{row.topCandidate.ticker}</span>
            <Value dim>{formatScore(row.topCandidate.tenbagger)}</Value>
          </a>
        ) : (
          <span className="text-[var(--color-text-faint)]">—</span>
        )}
      </td>
      <td className="text-right">
        <SignedValue value={row.momentum} text={formatPct(row.momentum)} />
      </td>
      <td className="text-right">
        {row.riskRatio > 0 ? (
          <Badge tone="risk">{formatPct(row.riskRatio, 0)}</Badge>
        ) : (
          <span className="text-[var(--color-text-faint)]">—</span>
        )}
      </td>
    </tr>
  )
}
