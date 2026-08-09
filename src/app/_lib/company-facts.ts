const DASH = '—'

/**
 * companies.fiscal_year_end는 SEC submissions API의 원본 형식(MMDD, 예: "0131")을
 * 그대로 저장한다. 화면에는 사람이 읽는 "1월 31일" 형태로 보여준다.
 * 자릿수가 4가 아니거나 월/일 범위를 벗어나면(오염된 데이터) 그대로 보여주는 대신
 * em dash로 안전하게 대체한다 — 잘못된 날짜를 마치 진짜 값인 것처럼 보여주는 것보다
 * "없음"으로 보이는 편이 낫다.
 */
export function formatFiscalYearEnd(mmdd: string | null): string {
  if (!mmdd || mmdd.length !== 4) return DASH
  const month = Number(mmdd.slice(0, 2))
  const day = Number(mmdd.slice(2, 4))
  if (!Number.isInteger(month) || month < 1 || month > 12) return DASH
  if (!Number.isInteger(day) || day < 1 || day > 31) return DASH
  return `${month}월 ${day}일`
}

/**
 * 공식 업종 표시는 "설명 (SIC 코드)" 형태다. 설명이 없으면 코드만, 코드가 없으면
 * 설명만 보여주고, 둘 다 없으면 em dash다.
 */
export function formatSicLabel(sic: string | null, sicDescription: string | null): string {
  if (sicDescription && sic) return `${sicDescription} (SIC ${sic})`
  if (sicDescription) return sicDescription
  if (sic) return `SIC ${sic}`
  return DASH
}

/**
 * SEC EDGAR의 browse-edgar CIK 파라미터는 10자리 0-padding을 요구한다 — 짧은 CIK를
 * 그대로 넘기면 조회 자체가 실패한다.
 */
export function edgarFilingsUrl(cik: number): string {
  const padded = String(cik).padStart(10, '0')
  return `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${padded}&type=10-K&dateb=&owner=include&count=10`
}
