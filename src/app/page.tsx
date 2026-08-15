import { getRawDb } from '@/db/client'
import { loadConfig } from '@/config'
import { getOpportunityMap, type IndustryRow, type ThemeBlock } from './_queries/map'
import { getTopCandidates, type TopCandidate } from './_queries/top-candidates'
import { formatUsd, formatPct, formatScore } from './_lib/format'
import { Value, SignedValue } from './_components/Value'
import { Badge } from './_components/Badge'
import { TopCandidates } from './_components/TopCandidates'
import { Legend, type LegendItem } from './_components/Legend'
import { industryPath, stockPath } from './_lib/paths'
import { snapshotDate, formatKoreanDate } from './_lib/snapshot'

const MAP_LEGEND: LegendItem[] = [
  { label: '산업', help: '테마 아래의 세부 산업입니다. 선택하면 후보 기업을 비교할 수 있습니다.' },
  { label: '후보', help: '해당 산업에 분류된 전체 기업 수입니다.' },
  { label: '매출 성장', help: '소속 기업의 최근 1년 매출 성장률 중앙값입니다.' },
  { label: '시가총액', help: '소속 기업 시가총액의 중앙값으로 산업의 크기를 보여줍니다.' },
  { label: '평균 점수', help: '데이터 완전성 기준을 통과한 기업의 텐배거 점수 평균입니다.' },
  { label: '대표 후보', help: 'Leader를 제외한 후보 중 텐배거 점수가 가장 높은 기업입니다.' },
  { label: '모멘텀', help: '매출 성장 속도가 이전보다 얼마나 변했는지 보여줍니다.' },
  { label: '위험', help: '심각한 재무 위험 신호가 발견된 기업의 비율입니다.' },
]

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
    (sum, theme) => sum + theme.industries.reduce((count, industry) => count + industry.candidateCount, 0),
    0,
  )
  const industries = themes.flatMap((theme) => theme.industries)
  const strongestIndustry = [...industries]
    .filter((industry) => industry.avgTenbagger !== null)
    .sort((a, b) => (b.avgTenbagger ?? 0) - (a.avgTenbagger ?? 0))[0] ?? null
  const fastestIndustry = [...industries]
    .filter((industry) => industry.medianRevenueGrowth !== null)
    .sort((a, b) => (b.medianRevenueGrowth ?? 0) - (a.medianRevenueGrowth ?? 0))[0] ?? null
  const lead = topCandidates[0] ?? null
  // 발행일은 "지금"이 아니라 스냅샷 기준일이다 — 정적 사이트에서 이 노트가 실제로
  // 쓰인 시점은 빌드일이고, 헤더의 데이터 기준 표시와 같은 날짜여야 한다.
  const issueDate = formatKoreanDate(snapshotDate())

  if (total === 0) {
    return (
      <section className="mx-auto max-w-2xl py-20">
        <p className="editorial-kicker">DATA PIPELINE</p>
        <h1 className="mt-4 font-serif text-3xl">아직 수집된 데이터가 없습니다.</h1>
        <p className="mt-4 leading-7 text-[var(--color-text-dim)]">
          아래 명령을 순서대로 실행하면 종목 수집부터 점수 계산까지 진행됩니다.
        </p>
        <pre className="num mt-6 border-y border-[var(--color-border-strong)] bg-[var(--color-surface)] p-5 text-sm">
          <code>{'npm run db:migrate\nnpm run pipeline:all'}</code>
        </pre>
      </section>
    )
  }

  return (
    <div>
      <div className="research-meta">
        <span>성장주 리서치 노트 · {issueDate}</span>
        <span>분석 유니버스 {total.toLocaleString()}개 기업 · {themes.length}개 성장 테마</span>
      </div>

      <section className="grid gap-12 py-10 lg:grid-cols-[minmax(0,2fr)_minmax(17rem,.72fr)] lg:items-end">
        <div>
          <p className="editorial-kicker">이번 리서치의 출발점</p>
          <h1 className="editorial-display mt-4">성장 가능성이 높은 산업에서<br />미래의 대표 기업을 찾습니다.</h1>
          <p className="editorial-deck mt-5">
            테마에서 산업으로, 산업에서 기업으로 좁혀가며 성장률과 수익성, 시장 기회와 위험을 함께 읽습니다.
            단순 순위보다 왜 점수가 높고 무엇을 더 확인해야 하는지에 집중합니다.
          </p>
        </div>

        {lead && (
          <aside className="border-l border-[var(--color-border-strong)] pl-6">
            <p className="editorial-kicker">TOP IDEA · 최우선 분석 후보</p>
            <a href={stockPath(lead.ticker)} className="mt-4 block">
              <strong className="font-serif text-4xl font-normal tracking-tight">{lead.ticker}</strong>
              <span className="mt-2 block text-base font-medium text-[var(--color-text-dim)]">{lead.name}</span>
            </a>
            <div className="mt-5 flex items-end gap-2 text-[var(--color-risk)]">
              <Value><span className="font-serif text-3xl">{formatScore(lead.tenbagger)}</span></Value>
              <span className="pb-1 text-xs">/ 100</span>
            </div>
            <p className="mt-4 text-[0.95rem] leading-7 text-[var(--color-text-dim)]">{lead.rationale}</p>
            <a href={industryPath(lead.industrySlug)} className="mt-6 block text-xs font-medium tracking-[0.1em] text-[var(--color-text-faint)] uppercase">
              {lead.industryName}
            </a>
          </aside>
        )}
      </section>

      <div className="editorial-rule" />

      <section className="grid md:grid-cols-3">
        <Story index="01" eyebrow="분석 범위" title="폭넓은 성장주 유니버스">
          <p>{themes.length}개 성장 테마에 속한 미국 상장기업을 같은 기준으로 비교합니다.</p>
          <div className="mt-7 font-serif text-3xl">{total.toLocaleString()} <small className="text-xs text-[var(--color-text-dim)]">개 후보</small></div>
        </Story>
        <Story index="02" eyebrow="가장 빠른 산업" title={fastestIndustry?.name ?? '데이터 집계 중'}>
          <p>최근 1년 매출 성장률 중앙값이 가장 높은 산업입니다. 기업별 지속 가능성은 상세 화면에서 확인합니다.</p>
          <div className="mt-7 font-serif text-3xl text-[var(--color-positive)]">{formatPct(fastestIndustry?.medianRevenueGrowth ?? null)}</div>
        </Story>
        <Story index="03" eyebrow="가장 높은 평균 점수" title={strongestIndustry?.name ?? '데이터 집계 중'} last>
          <p>데이터 완전성 기준을 통과한 기업들의 텐배거 점수 평균이 가장 높은 산업입니다.</p>
          <div className="mt-7 font-serif text-3xl">{formatScore(strongestIndustry?.avgTenbagger ?? null)} <small className="text-xs text-[var(--color-text-dim)]">/ 100</small></div>
        </Story>
      </section>

      <section id="top-candidates" className="mt-14 scroll-mt-6">
        <div className="editorial-section-heading flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="editorial-kicker">Universe-wide ranking</p>
            <h2 className="mt-2 text-3xl">지금 먼저 살펴볼 다섯 기업</h2>
          </div>
          <p className="max-w-xl text-[0.95rem] leading-7 text-[var(--color-text-dim)] lg:max-w-none lg:whitespace-nowrap lg:text-right">
            테마와 산업 경계를 넘어 점수가 가장 높은 후보입니다. 점수의 근거와 위험 신호를 함께 확인하세요.
          </p>
        </div>
        {topCandidates.length > 0 ? (
          <div className="mt-4"><TopCandidates candidates={topCandidates} /></div>
        ) : (
          <p className="mt-5 text-sm text-[var(--color-text-faint)]">
            데이터 완전성 기준({formatPct(cfg.scoring.min_completeness, 0)})을 통과한 후보가 아직 없습니다.
          </p>
        )}
      </section>

      <section id="opportunity-map" className="mt-16 scroll-mt-6">
        <div className="editorial-section-heading flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="editorial-kicker">Growth opportunity map</p>
            <span className="sr-only">Growth Opportunity Map</span>
            <h2 className="mt-2 text-3xl">테마별 산업 기회 지도</h2>
          </div>
          <p className="max-w-xl text-[0.95rem] leading-7 text-[var(--color-text-dim)]">
            어느 산업에 성장 후보가 모여 있는지 비교한 뒤, 산업과 종목 상세로 단계적으로 들어갑니다.
          </p>
        </div>

        <div className="mt-8 space-y-12">
          {themes.map((theme, index) => (
            <ThemeSection
              key={theme.slug}
              index={index + 1}
              slug={theme.slug}
              name={theme.name}
              industries={theme.industries}
            />
          ))}
        </div>
      </section>

      <section id="methodology" className="mt-16 scroll-mt-6 border-t border-[var(--color-border-strong)] pt-6">
        <p className="editorial-kicker">How to read</p>
        <h2 className="mt-2 font-serif text-2xl">지표 읽는 방법</h2>
        <Legend items={MAP_LEGEND} labelWidth="w-24" className="mt-6" />
      </section>
    </div>
  )
}

function Story({
  index, eyebrow, title, children, last = false,
}: {
  index: string
  eyebrow: string
  title: string
  children: React.ReactNode
  last?: boolean
}) {
  return (
    <article className={`py-8 md:min-h-72 md:pr-8 ${last ? '' : 'border-b md:border-r md:border-b-0'} border-[var(--color-border)] md:[&+&]:pl-8`}>
      <p className="editorial-kicker">{index} / {eyebrow}</p>
      <h2 className="mt-4 font-serif text-[1.28rem] font-medium leading-8">{title}</h2>
      <div className="mt-5 text-[0.95rem] leading-7 text-[var(--color-text-dim)]">{children}</div>
    </article>
  )
}

function ThemeSection({
  index, slug, name, industries,
}: {
  index: number
  slug: string
  name: string
  industries: IndustryRow[]
}) {
  const candidateCount = industries.reduce((count, industry) => count + industry.candidateCount, 0)

  return (
    <section id={slug}>
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[var(--color-border-strong)] pb-3">
        <div className="flex items-baseline gap-3">
          <span className="num text-xs text-[var(--color-risk)]">{String(index).padStart(2, '0')}</span>
          <h3 className="font-serif text-2xl font-medium">{name}</h3>
        </div>
        <span className="text-xs text-[var(--color-text-faint)]">{industries.length}개 산업 · 후보 {candidateCount.toLocaleString()}개</span>
      </div>

      {industries.length === 0 ? (
        <p className="border-b border-dashed border-[var(--color-border)] py-6 text-sm text-[var(--color-text-faint)]">아직 후보가 없습니다.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="text-center">산업</th>
                <th className="text-center">후보</th>
                <th className="text-center">매출 성장</th>
                <th className="text-center">시가총액</th>
                <th className="text-center">평균 점수</th>
                <th className="text-center">대표 후보</th>
                <th className="text-center">모멘텀</th>
                <th className="text-center">위험</th>
              </tr>
            </thead>
            <tbody>{industries.map((industry) => <IndustryRowView key={industry.slug} row={industry} />)}</tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function IndustryRowView({ row }: { row: IndustryRow }) {
  return (
    <tr>
      <td className="text-center"><a href={industryPath(row.slug)} className="font-serif text-[0.92rem]">{row.name}</a></td>
      <td className="text-center"><Value dim>{row.candidateCount}</Value></td>
      <td className="text-center"><SignedValue value={row.medianRevenueGrowth} text={formatPct(row.medianRevenueGrowth)} /></td>
      <td className="text-center"><Value dim>{formatUsd(row.medianMarketCap)}</Value></td>
      <td className="text-center font-medium"><Value>{formatScore(row.avgTenbagger)}</Value></td>
      <td className="text-center">
        {row.topCandidate ? (
          <a href={stockPath(row.topCandidate.ticker)} className="inline-flex items-baseline gap-2">
            <span className="font-medium">{row.topCandidate.ticker}</span>
            <Value dim>{formatScore(row.topCandidate.tenbagger)}</Value>
          </a>
        ) : <span className="text-[var(--color-text-faint)]">—</span>}
      </td>
      <td className="text-center"><SignedValue value={row.momentum} text={formatPct(row.momentum)} /></td>
      <td className="text-center">{row.riskRatio > 0 ? <Badge tone="risk">{formatPct(row.riskRatio, 0)}</Badge> : <span className="text-[var(--color-text-faint)]">—</span>}</td>
    </tr>
  )
}
