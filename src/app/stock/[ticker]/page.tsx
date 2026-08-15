import { notFound } from 'next/navigation'
import { getRawDb } from '@/db/client'
import { loadConfig } from '@/config'
import { getStockDetail, type StockDetail } from '@/app/_queries/stock'
import { getAllStockTickers } from '@/app/_queries/static-params'
import { snapshotDate } from '@/app/_lib/snapshot'
import { industryPath } from '@/app/_lib/paths'
import { formatUsd, formatPct, formatScore, formatDate, stalenessOf } from '@/app/_lib/format'
import { Value, SignedValue, DerivedNote } from '@/app/_components/Value'
import { Badge, CategoryBadge } from '@/app/_components/Badge'
import { MetricGrid } from '@/app/_components/MetricGrid'
import { FactorBreakdown, StrengthWeakness } from '@/app/_components/FactorBreakdown'
import { CompanyFacts } from '@/app/_components/CompanyFacts'
import { ValuationSection } from '@/app/_components/Valuation'
import { Legend, type LegendItem } from '@/app/_components/Legend'
import { PageHeading } from '@/app/_components/PageHeading'
import { industryBlurb } from '@/app/_lib/industry-blurbs'

/**
 * 빌드 시점에 **분류된 모든 회사**의 페이지를 만든다 — 완전성 게이트를 통과한 회사만이
 * 아니다. 산업 표는 INSUFFICIENT/미평가 그룹까지 링크를 걸기 때문에, 게이트로 목록을
 * 좁히면 표에는 보이는데 열리지 않는 링크가 생긴다. 404가 나는 링크는 "데이터가
 * 부족하다"고 말해 주는 페이지보다 나쁘다.
 */
export const dynamicParams = false

export function generateStaticParams(): { ticker: string }[] {
  const raw = getRawDb()
  try {
    return getAllStockTickers(raw).map((ticker) => ({ ticker }))
  } finally {
    raw.close()
  }
}

/** Overview는 헤드라인 수치 자체에 이미 면책·근사치 문구가 붙어 있어 범례를 겹치지 않는다. */
const GROWTH_LEGEND: LegendItem[] = [
  { label: 'Revenue Growth (TTM YoY)', help: '최근 1년 매출이 그 전 1년보다 얼마나 늘었는지.' },
  { label: 'Revenue Acceleration', help: '그 성장률 자체가 얼마나 빨라졌는지. 단위는 %p.' },
  { label: 'Revenue (TTM)', help: '최근 4개 분기를 더한 1년치 매출.' },
]

const QUALITY_LEGEND: LegendItem[] = [
  { label: 'Gross Margin', help: '매출에서 원가를 뺀 비율. 하나 팔 때 얼마가 남는지.' },
  { label: 'Operating Margin', help: '판관비까지 뺀 뒤 본업에서 남은 이익의 비율.' },
  { label: 'FCF Margin', help: '사업을 굴리고 실제로 손에 남은 현금의 비율.' },
  { label: 'Cash', help: '보유한 현금과 현금성 자산.' },
  { label: 'Total Debt', help: '갚아야 할 빚의 총액.' },
]

export default async function StockPage({
  params,
}: {
  params: Promise<{ ticker: string }>
}) {
  const { ticker } = await params
  // 정적 사이트의 "오늘"은 빌드일이다. Data Freshness의 신선도 판정도 이 기준으로 내려간다 —
  // 자세한 근거는 DataAsOf의 주석 참조.
  const asOf = snapshotDate()
  const cfg = loadConfig()
  const raw = getRawDb()
  let d: StockDetail | null
  try {
    d = getStockDetail(raw, ticker, asOf)
  } finally {
    raw.close()
  }
  if (!d) notFound()

  // 스코어링 파이프라인이 아직 이 회사를 채점하지 않은 상태 — 정체성과 재무는
  // 있는 그대로 보여주고, 점수에서 파생되는 섹션만 빈 상태 안내로 대체한다.
  const isScored = d.factors.length > 0

  return (
    <div className="stock-report space-y-12">
      <div className="research-meta">
        <span>기업 리서치 · {d.themeName}</span>
        <span>평가 기준일 {formatDate(d.asOf)}</span>
      </div>
      <header className="pb-2 pt-3">
        {/* 우측 설명은 회사 소개가 아니라 이 회사가 속한 산업의 설명이다 — 왼쪽
            브레드크럼의 산업명을 그대로 받아, 산업 페이지와 같은 문장을 보여준다. */}
        <PageHeading note={industryBlurb(d.industrySlug)}>
          <div>
          <p className="editorial-kicker">
            Stock research · <a href={industryPath(d.industrySlug)}>{d.industryName}</a>
            {d.classificationSource === 'sic' && (
              <span className="ml-2 text-[var(--color-text-faint)]">
                (SIC 기본 분류 — 수동 교정 없음)
              </span>
            )}
          </p>
          <h1 className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-2">
            <span className="font-serif text-5xl font-medium tracking-[-0.045em]">{d.ticker}</span>
            <span className="text-2xl font-medium text-[var(--color-text-dim)]">{d.name}</span>
            <CategoryBadge category={d.category} />
          </h1>
          <a href={industryPath(d.industrySlug)} className="mt-4 inline-block text-xs text-[var(--color-text-faint)]">← {d.industryName} 산업으로 돌아가기</a>
          </div>
        </PageHeading>
      </header>

      <div className="editorial-rule" />

      <section>
        <h2 className="mb-2 text-sm text-[var(--color-text-dim)]">Overview</h2>
        <MetricGrid
          emphasize
          items={[
            {
              label: 'Tenbagger Score',
              value: (
                <span className="block">
                  <Value>{formatScore(d.tenbagger)}</Value>
                  {/* 브리프 §Tenbagger Score 면책 문구 — 문장을 그대로 넣는다, 다듬지 않는다. */}
                  <span className="mt-1 block text-[10px] font-normal normal-case leading-snug text-[var(--color-text-faint)]">
                    Tenbagger Score는 성장 잠재력을 평가하며, 현재 주가의 저평가 여부나 매수 추천을
                    의미하지 않습니다.
                  </span>
                </span>
              ),
            },
            {
              label: 'Market Cap',
              value: (
                <span className="block">
                  <Value>{formatUsd(d.marketCap)}</Value>
                  {d.marketCapBasis === 'diluted_fallback' && (
                    <span className="mt-1 block text-[10px] font-normal normal-case leading-snug text-[var(--color-text-faint)]">
                      근사치 — 표지 발행주식수를 보고하지 않아 희석평균주식수로 계산했습니다.
                    </span>
                  )}
                </span>
              ),
            },
            {
              label: 'Price',
              value: <Value>{d.price === null ? '—' : `$${d.price.toFixed(2)}`}</Value>,
            },
            {
              label: 'Exchange / SIC',
              value: (
                <span className="text-sm">
                  {d.exchange ?? '—'} · {d.sic ?? '—'}
                </span>
              ),
            },
          ]}
        />
        <div className="mt-4 border-t border-[var(--color-border)] pt-4">
          <CompanyFacts
            d={{
              cik: d.cik,
              sic: d.sic,
              sicDescription: d.sicDescription,
              exchange: d.exchange,
              fiscalYearEnd: d.fiscalYearEnd,
              stateOfIncorporationDescription: d.stateOfIncorporationDescription,
            }}
          />
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm text-[var(--color-text-dim)]">Growth</h2>
        <Legend items={GROWTH_LEGEND} labelWidth="w-44" className="mb-3" />
        <MetricGrid
          items={[
            {
              label: 'Revenue Growth (TTM YoY)',
              value: (
                <span className="block">
                  <SignedValue value={d.growth.revenueGrowth} text={formatPct(d.growth.revenueGrowth)} />
                  {d.growth.revenueGrowthDerived && <DerivedNote />}
                </span>
              ),
            },
            {
              label: 'Revenue Acceleration',
              value: (
                <span className="block">
                  <SignedValue
                    value={d.growth.revenueAcceleration}
                    text={formatPct(d.growth.revenueAcceleration)}
                  />
                  {d.growth.revenueAccelerationDerived && <DerivedNote />}
                </span>
              ),
            },
            {
              label: 'Revenue (TTM)',
              value: (
                <span className="block">
                  <Value>{formatUsd(d.quality.revenue)}</Value>
                  {d.quality.revenueDerived && <DerivedNote />}
                </span>
              ),
            },
          ]}
        />
      </section>

      <section>
        <h2 className="mb-2 text-sm text-[var(--color-text-dim)]">Quality</h2>
        <Legend items={QUALITY_LEGEND} labelWidth="w-44" className="mb-3" />
        <MetricGrid
          items={[
            {
              label: 'Gross Margin',
              value: (
                <span className="block">
                  <Value>{formatPct(d.quality.grossMargin)}</Value>
                  {d.quality.grossMarginDerived && <DerivedNote />}
                </span>
              ),
            },
            {
              label: 'Operating Margin',
              value: (
                <span className="block">
                  <SignedValue value={d.quality.operatingMargin} text={formatPct(d.quality.operatingMargin)} />
                  {d.quality.operatingMarginDerived && <DerivedNote />}
                </span>
              ),
            },
            {
              label: 'FCF Margin',
              value: (
                <span className="block">
                  <SignedValue value={d.quality.fcfMargin} text={formatPct(d.quality.fcfMargin)} />
                  {d.quality.fcfMarginDerived && <DerivedNote />}
                </span>
              ),
            },
            {
              label: 'Cash',
              value: (
                <span className="block">
                  <Value>{formatUsd(d.quality.cash)}</Value>
                  {d.quality.cashDerived && <DerivedNote />}
                </span>
              ),
            },
            {
              label: 'Total Debt',
              value: (
                <span className="block">
                  <Value>{formatUsd(d.quality.totalDebt)}</Value>
                  {d.quality.totalDebtDerived && <DerivedNote />}
                </span>
              ),
            },
          ]}
        />
      </section>

      <section>
        <h2 className="mb-1 text-sm">Tenbagger Analysis</h2>
        {isScored ? (
          <>
            <p className="mb-3 text-xs text-[var(--color-text-faint)]">
              데이터 완전성 {formatPct(d.completeness, 0)} · {d.engineVersion ?? '—'} · {formatDate(d.asOf)}
            </p>
            <FactorBreakdown factors={d.factors} extreme={cfg.scoring.extreme_display} />
            <div className="mt-4">
              <StrengthWeakness factors={d.factors} />
            </div>
          </>
        ) : (
          <p className="text-xs text-[var(--color-text-faint)]">
            스코어링 미실행 — 파이프라인이 아직 이 종목을 채점하지 않았습니다
          </p>
        )}
      </section>

      <ValuationSection valuation={d.valuation} price={d.price} />

      <section>
        <h2 className="mb-2 text-sm">Risks</h2>
        {!isScored ? (
          <p className="text-xs text-[var(--color-text-faint)]">스코어링 미실행 — Red Flag 판정 전</p>
        ) : d.flags.length === 0 ? (
          <p className="text-xs text-[var(--color-text-faint)]">감지된 Red Flag 없음</p>
        ) : (
          <ul className="space-y-1.5">
            {d.flags.map((f) => (
              <li key={f.code} className="flex items-start gap-2 text-sm">
                <Badge tone={f.severity === 'CRITICAL' ? 'risk' : 'watch'}>{f.severity}</Badge>
                <span>
                  {f.message}
                  <span className="ml-2 text-xs text-[var(--color-text-faint)]">{f.code}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm text-[var(--color-text-dim)]">Data Freshness</h2>
        <ul className="space-y-1 text-xs">
          {d.freshness.map((f) => {
            const state = stalenessOf(f.date, asOf, f.thresholdDays)
            return (
              <li key={f.label} className="flex items-center gap-2">
                <span className="w-32 text-[var(--color-text-dim)]">{f.label}</span>
                <Value dim>{formatDate(f.date)}</Value>
                {state === 'STALE' && <Badge tone="watch">STALE</Badge>}
                {state === 'UNKNOWN' && <Badge>NO DATA</Badge>}
              </li>
            )
          })}
        </ul>
      </section>
    </div>
  )
}
