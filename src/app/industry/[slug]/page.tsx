import { notFound } from 'next/navigation'
import { getRawDb } from '@/db/client'
import { loadConfig } from '@/config'
import { getIndustryView, type IndustryView } from '@/app/_queries/industry'
import { CandidateTable } from '@/app/_components/CandidateTable'

export const dynamic = 'force-dynamic'

const GROUP_LABEL: Record<string, string> = {
  LEADER: 'Leader',
  CHALLENGER: 'Challenger',
  EMERGING: 'Emerging',
  INSUFFICIENT: 'Insufficient Data',
}

const GROUP_NOTE: Record<string, string> = {
  LEADER: '산업 벤치마크 — Tenbagger 후보가 아님',
  CHALLENGER: '비즈니스 모델이 검증된 중형 성장주',
  EMERGING: '초기 성장 단계 — 수익성 미확보 포함',
  INSUFFICIENT: '완결성 기준 미달 — 기본 랭킹에서 제외, 참고용으로만 표시',
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

  return (
    <div className="space-y-8">
      <div>
        <p className="text-xs text-[var(--color-text-dim)]">{view.themeName}</p>
        <h1 className="text-lg font-medium tracking-tight">{view.name}</h1>
      </div>

      {view.groups.map((g) => {
        const key = g.category ?? 'UNSCORED'
        return (
          <section key={key}>
            <h2 className="mb-1 flex items-baseline gap-2 text-sm tracking-wide">
              <span>{GROUP_LABEL[key] ?? '미분류'}</span>
              <span className="text-xs text-[var(--color-text-faint)]">
                {g.category === null
                  ? '스코어링 미실행 — 아직 후보/벤치마크로 분류되지 않음'
                  : GROUP_NOTE[key]}
              </span>
            </h2>
            <CandidateTable
              rows={g.rows}
              showAll={all === '1'}
              industrySlug={slug}
              insufficientBelow={cfg.scoring.min_completeness}
            />
          </section>
        )
      })}
    </div>
  )
}
