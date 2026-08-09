import type { ThemeMomentum } from '../_queries/theme-momentum'
import { formatPct, formatScore } from '../_lib/format'
import { SignedValue, Value } from './Value'

/**
 * 홈 화면 상단 테마 모멘텀 스트립 — 테마 6개를 한 줄(좁은 화면에서는 여러 줄)로
 * 보여준다.
 *
 * 원래 목업은 3개월 상대 가격 성과와 스파크라인을 쓰지만, 이 파이프라인은 시세를
 * 회사당 스냅샷 1개만 저장해 가격 히스토리 자체가 없다 — 비교할 과거 시점이 없으니
 * 3개월 성과를 낼 수 없고, 점 하나로는 선(스파크라인)도 그릴 수 없다. 대신 실제로
 * 존재하는 것만 보여준다: 적격 후보 수, 매출성장·매출가속(이 제품이 이미 Phase 1의
 * 모멘텀 대체 지표로 정의한 값) 중앙값, 그리고 테마 최고 점수 후보.
 *
 * 게이트(완전성 기준 미달 제외, LEADER는 Top Pick 불가)는 홈 화면의 다른 집계와
 * 동일한 정의를 공유한다(getThemeMomentum이 ./companies를 통해 강제한다) — 여기서는
 * 그 결과를 그대로 그린다.
 *
 * 적격 후보가 0명인 테마도 카드는 항상 렌더링하고, 점선 테두리로 "비어 있음"을
 * 표시하며 숫자는 전부 em dash로 비운다(0으로 위장하지 않는다). candidateCount만은
 * 예외 — 그 자체가 실측된 "0"이라 em dash가 아니라 숫자 0으로 보여준다.
 */
export function ThemeMomentumStrip({ themes }: { themes: ThemeMomentum[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {themes.map((t) => (
        <ThemeMomentumCard key={t.slug} theme={t} />
      ))}
    </div>
  )
}

function ThemeMomentumCard({ theme }: { theme: ThemeMomentum }) {
  const empty = theme.candidateCount === 0
  return (
    <div
      className={
        empty
          ? 'rounded border border-dashed border-[var(--color-border)] p-3'
          : 'rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-3'
      }
    >
      <h3 className="min-h-8 text-xs font-medium leading-snug text-[var(--color-text)]">{theme.name}</h3>

      <p className="mt-2 text-[11px] text-[var(--color-text-faint)]">적격 후보</p>
      <p className="num text-lg text-[var(--color-text)]">{theme.candidateCount}</p>

      <dl className="mt-2 space-y-1 text-[11px]">
        <div className="flex items-center justify-between gap-2">
          <dt className="text-[var(--color-text-faint)]">매출성장 중앙값</dt>
          <dd>
            <SignedValue value={theme.medianRevenueGrowth} text={formatPct(theme.medianRevenueGrowth)} />
          </dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt className="text-[var(--color-text-faint)]">매출가속 중앙값</dt>
          <dd>
            <SignedValue
              value={theme.medianRevenueAcceleration}
              text={formatPct(theme.medianRevenueAcceleration)}
            />
          </dd>
        </div>
      </dl>

      <div className="mt-2 border-t border-[var(--color-border)] pt-2">
        <p className="text-[11px] text-[var(--color-text-faint)]">Top Pick</p>
        {theme.topCandidate ? (
          <a
            href={`/stock/${theme.topCandidate.ticker}`}
            className="inline-flex items-baseline gap-1.5"
          >
            <span className="text-sm font-medium">{theme.topCandidate.ticker}</span>
            <Value dim>{formatScore(theme.topCandidate.tenbagger)}</Value>
          </a>
        ) : (
          <span className="text-sm text-[var(--color-text-faint)]">—</span>
        )}
      </div>
    </div>
  )
}
