import { formatFiscalYearEnd, formatSicLabel, edgarFilingsUrl } from '../_lib/company-facts'
import { Value } from './Value'

export type CompanyFactsData = {
  cik: number
  sic: string | null
  sicDescription: string | null
  exchange: string | null
  fiscalYearEnd: string | null
  stateOfIncorporationDescription: string | null
}

/**
 * 종목 상세의 "회사 정보" 블록. DB에 이미 있는 값 + CIK에서 파생한 EDGAR 링크
 * 하나로 범위를 제한한다 — 웹사이트/IPO일자는 Finnhub profile2 호출이 추가로
 * 필요해(회사당 1콜, 파이프라인 실행마다 +20분) 의도적으로 뺐다.
 */
export function CompanyFacts({ d }: { d: CompanyFactsData }) {
  return (
    <dl className="grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-3 lg:grid-cols-5">
      <div>
        <dt className="text-xs text-[var(--color-text-dim)]">공식 업종</dt>
        <dd className="mt-0.5 text-sm">
          <Value>{formatSicLabel(d.sic, d.sicDescription)}</Value>
        </dd>
      </div>
      <div>
        <dt className="text-xs text-[var(--color-text-dim)]">거래소</dt>
        <dd className="mt-0.5 text-sm">
          <Value>{d.exchange ?? '—'}</Value>
        </dd>
      </div>
      <div>
        <dt className="text-xs text-[var(--color-text-dim)]">회계연도 말</dt>
        <dd className="mt-0.5 text-sm">
          <Value>{formatFiscalYearEnd(d.fiscalYearEnd)}</Value>
        </dd>
      </div>
      <div>
        <dt className="text-xs text-[var(--color-text-dim)]">설립 주(州)</dt>
        <dd className="mt-0.5 text-sm">
          <Value>{d.stateOfIncorporationDescription ?? '—'}</Value>
        </dd>
      </div>
      <div>
        <dt className="text-xs text-[var(--color-text-dim)]">SEC EDGAR 공시</dt>
        <dd className="mt-0.5 text-sm">
          <a
            href={edgarFilingsUrl(d.cik)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--color-info)] hover:underline"
          >
            10-K에서 사업 내용 확인
          </a>
        </dd>
      </div>
    </dl>
  )
}
