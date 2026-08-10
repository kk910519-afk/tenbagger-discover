import { notFound } from 'next/navigation'
import { getRawDb } from '@/db/client'
import { getStockDetail, type StockDetail } from '@/app/_queries/stock'
import { formatUsd, formatPct, formatScore, formatDate, stalenessOf } from '@/app/_lib/format'
import { Value, SignedValue } from '@/app/_components/Value'
import { Badge, CategoryBadge } from '@/app/_components/Badge'
import { MetricGrid } from '@/app/_components/MetricGrid'
import { FactorBreakdown, StrengthWeakness } from '@/app/_components/FactorBreakdown'
import { CompanyFacts } from '@/app/_components/CompanyFacts'
import { ValuationSection } from '@/app/_components/Valuation'

export const dynamic = 'force-dynamic'

export default async function StockPage({
  params,
}: {
  params: Promise<{ ticker: string }>
}) {
  const { ticker } = await params
  const asOf = new Date().toISOString().slice(0, 10)
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
    <div className="space-y-8">
      <header>
        <p className="text-xs text-[var(--color-text-dim)]">
          {d.themeName} · <a href={`/industry/${d.industrySlug}`}>{d.industryName}</a>
          {d.classificationSource === 'sic' && (
            <span className="ml-2 text-[var(--color-text-faint)]">
              (SIC 기본 분류 — 수동 교정 없음)
            </span>
          )}
        </p>
        <h1 className="mt-1 flex items-center gap-3 text-lg">
          {d.ticker}
          <span className="font-serif text-xl text-[var(--color-text)]">{d.name}</span>
          <CategoryBadge category={d.category} />
        </h1>
      </header>

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
        <MetricGrid
          items={[
            {
              label: 'Revenue Growth (TTM YoY)',
              value: <SignedValue value={d.growth.revenueGrowth} text={formatPct(d.growth.revenueGrowth)} />,
            },
            {
              label: 'Revenue Acceleration',
              value: (
                <SignedValue
                  value={d.growth.revenueAcceleration}
                  text={formatPct(d.growth.revenueAcceleration)}
                />
              ),
            },
            { label: 'Revenue (TTM)', value: <Value>{formatUsd(d.quality.revenue)}</Value> },
          ]}
        />
      </section>

      <section>
        <h2 className="mb-2 text-sm text-[var(--color-text-dim)]">Quality</h2>
        <MetricGrid
          items={[
            { label: 'Gross Margin', value: <Value>{formatPct(d.quality.grossMargin)}</Value> },
            {
              label: 'Operating Margin',
              value: <SignedValue value={d.quality.operatingMargin} text={formatPct(d.quality.operatingMargin)} />,
            },
            {
              label: 'FCF Margin',
              value: <SignedValue value={d.quality.fcfMargin} text={formatPct(d.quality.fcfMargin)} />,
            },
            { label: 'Cash', value: <Value>{formatUsd(d.quality.cash)}</Value> },
            { label: 'Total Debt', value: <Value>{formatUsd(d.quality.totalDebt)}</Value> },
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
            <FactorBreakdown factors={d.factors} />
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
