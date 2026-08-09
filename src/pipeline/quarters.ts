const PUBLICATION_LAG_DAYS = 45
const DAY_MS = 86_400_000

/**
 * SEC Financial Statement Data Set은 분기 종료 후 약 1개월 뒤 공개된다.
 * asOf에서 45일을 빼 최신 가용 분기를 정하고 거기서 count개를 역순으로 반환한다.
 */
export function recentQuarters(
  asOf: string,
  count: number,
): { year: number; quarter: number }[] {
  if (count <= 0) return []
  const d = new Date(Date.parse(asOf) - PUBLICATION_LAG_DAYS * DAY_MS)
  let year = d.getUTCFullYear()
  let quarter = Math.floor(d.getUTCMonth() / 3) + 1

  const out: { year: number; quarter: number }[] = []
  for (let i = 0; i < count; i++) {
    out.push({ year, quarter })
    quarter--
    if (quarter === 0) { quarter = 4; year-- }
  }
  return out
}
