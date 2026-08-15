import { notFound } from 'next/navigation'
import { getRawDb } from '@/db/client'
import { loadConfig } from '@/config'
import { getIndustryView, type IndustryView } from '@/app/_queries/industry'
import { CandidateTable } from '@/app/_components/CandidateTable'
import { ColumnLegend } from '@/app/_components/ColumnLegend'
import { PageHeading } from '@/app/_components/PageHeading'
import { industryBlurb } from '@/app/_lib/industry-blurbs'

export const dynamic = 'force-dynamic'

const GROUP_LABEL: Record<string, string> = {
  LEADER: 'Leader',
  CHALLENGER: 'Challenger',
  EMERGING: 'Emerging',
  INSUFFICIENT: 'Insufficient Data',
}

const GROUP_KICKER: Record<string, string> = {
  LEADER: '산업의 기준점',
  CHALLENGER: '검증된 성장 기업',
  EMERGING: '초기 성장 후보',
  INSUFFICIENT: '참고 관찰군',
}

const GROUP_NOTE: Record<string, string> = {
  LEADER: '산업을 대표하는 벤치마크 기업이며 텐배거 후보 순위에서는 제외됩니다.',
  CHALLENGER: '사업 모델과 성장성이 일정 수준 검증된 중형 성장 기업입니다.',
  EMERGING: '높은 성장 가능성과 함께 수익성 미확보 위험도 존재하는 초기 단계 기업입니다.',
  INSUFFICIENT: '데이터 완전성 기준에 미달해 기본 순위에서 제외하고 참고용으로 표시합니다.',
}

export default async function IndustryPage({
  params, searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ all?: string }>
}) {
  const { slug } = await params
  const { all } = await searchParams
  const cfg = loadConfig()
  const raw = getRawDb()
  let view: IndustryView
  try {
    view = getIndustryView(raw, slug, cfg.scoring.min_completeness)
  } finally {
    raw.close()
  }
  if (!view) notFound()

  const total = view.groups.reduce((sum, group) => sum + group.rows.length, 0)

  return (
    <div>
      <div className="research-meta">
        <span>산업 리서치 · {view.themeName}</span>
        <span>분석 기업 {total.toLocaleString()}개</span>
      </div>

      <header className="py-9">
        <PageHeading note={industryBlurb(view.slug)}>
          <div>
            <p className="editorial-kicker">Industry research</p>
            <h1 className="mt-3 font-serif text-5xl font-medium tracking-[-0.045em]">{view.name}</h1>
            <a href="/" className="mt-4 inline-block text-xs text-[var(--color-text-faint)]">← 성장 기회 지도로 돌아가기</a>
          </div>
        </PageHeading>
      </header>

      <div className="editorial-rule" />
      <div id="methodology" className="py-6"><ColumnLegend /></div>

      <div className="space-y-14">
        {view.groups.map((group, index) => {
          const key = group.category ?? 'UNSCORED'
          return (
            <section key={key}>
              <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[var(--color-border-strong)] pb-3">
                <div className="flex items-baseline gap-3">
                  <span className="num text-xs text-[var(--color-risk)]">{String(index + 1).padStart(2, '0')}</span>
                  <div>
                    <p className="editorial-kicker">{GROUP_KICKER[key] ?? '미분류'}</p>
                    <h2 className="mt-1 font-serif text-xl">{GROUP_LABEL[key] ?? '미분류'}</h2>
                  </div>
                </div>
                <p className="max-w-xl text-[0.95rem] leading-7 text-[var(--color-text-dim)]">
                  {group.category === null ? '점수 계산 전 기업으로 아직 후보군에 분류되지 않았습니다.' : GROUP_NOTE[key]}
                </p>
              </div>
              <div className="mt-3">
                <CandidateTable
                  rows={group.rows}
                  showAll={all === '1'}
                  industrySlug={slug}
                  insufficientBelow={cfg.scoring.min_completeness}
                />
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}
