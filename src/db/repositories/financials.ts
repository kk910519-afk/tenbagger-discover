import type Database from 'better-sqlite3'
import type { FinancialPeriod } from '@/domain/types'
import type { RawFact } from '@/providers/types'
import type { NormalizeResult } from '@/providers/fundamental/normalizer'

// 왜 filed_date 동률에서 source도 봐야 하는가: ingest-fundamentals는 매 실행마다
// bulk를 먼저 적재하고 같은 회계기간을 다루는 API(companyfacts)를 나중에 적재한다.
// 같은 신고서(accession)에서 나온 두 값은 filed_date가 완전히 동일하므로, 예전의
// "filed_date가 엄격히 더 커야 갱신" 규칙 아래에서는 API 값이 절대로 bulk 값을
// 이길 수 없었다 — bulk가 먼저 자리를 잡으면 그걸로 영원히 굳어버린다. 그런데
// 두 소스는 신뢰도가 같지 않다: SEC bulk(num.txt)는 `coreg`가 빈 문자열인
// 디멘션 슬라이스(제품/세그먼트별 분해)를 연결 총계와 구별하지 못해 그대로
// 통과시키는 반면(Apple 매출, Alphabet 영업이익 실사례), 기업별 API는 이 문제가
// 없다. 그래서 filed_date가 같을 때는 API가 bulk를 대체하도록 허용하되, 그
// 반대(bulk가 같은 날짜의 API를 대체하는 것)는 여전히 막는다. filed_date가
// 진짜로 더 최신이면 소스와 무관하게 그 값이 이긴다 — 정정 신고가 항상 최우선.
// source까지 같은 상태로 동률이면(같은 잡의 재실행 등) 갱신하지 않는다 — 먼저
// 자리잡은 값을 그대로 유지하는 편이 재실행 때마다 결과가 흔들리지 않아 결정적이다.
export function insertFacts(raw: Database.Database, facts: RawFact[]): number {
  const stmt = raw.prepare(
    `INSERT INTO financial_facts
       (cik, tag, unit, period_start, period_end, qtrs, value, form, filed_date, accession, source)
     VALUES (@cik, @tag, @unit, @periodStart, @periodEnd, @qtrs, @value, @form, @filedDate, @accession, @source)
     ON CONFLICT(cik, tag, period_end, qtrs, form) DO UPDATE SET
       value = excluded.value,
       filed_date = excluded.filed_date,
       accession = excluded.accession,
       unit = excluded.unit,
       period_start = excluded.period_start,
       source = excluded.source
     WHERE excluded.filed_date > financial_facts.filed_date
        OR (excluded.filed_date = financial_facts.filed_date
            AND excluded.source = 'api'
            AND financial_facts.source = 'bulk')`,
  )
  let n = 0
  raw.transaction(() => {
    for (const f of facts) n += stmt.run(f).changes
  })()
  return n
}

export function getFacts(raw: Database.Database, cik: number): RawFact[] {
  return raw
    .prepare(
      `SELECT cik, tag, unit, period_start AS periodStart, period_end AS periodEnd,
              qtrs, value, form, filed_date AS filedDate, accession, source
       FROM financial_facts WHERE cik = ?`,
    )
    .all(cik) as RawFact[]
}

const FIN_COLUMNS = `cik, period_end, period_type, revenue, gross_profit, operating_income,
  net_income, ocf, capex, fcf, cash, total_debt, equity, shares_diluted,
  shares_outstanding, sbc, rd_expense, source_tags, computed_at`

export function replaceFinancials(
  raw: Database.Database,
  cik: number,
  r: NormalizeResult,
): void {
  const now = new Date().toISOString()
  const stmt = raw.prepare(
    `INSERT OR REPLACE INTO financials (${FIN_COLUMNS})
     VALUES (@cik, @periodEnd, @periodType, @revenue, @grossProfit, @operatingIncome,
             @netIncome, @ocf, @capex, @fcf, @cash, @totalDebt, @equity, @sharesDiluted,
             @sharesOutstanding, @sbc, @rdExpense, @sourceTags, @computedAt)`,
  )
  raw.transaction(() => {
    raw.prepare('DELETE FROM financials WHERE cik = ?').run(cik)
    for (const p of [...r.quarterly, ...r.annual, ...r.ttm]) {
      stmt.run({
        ...p,
        cik,
        sourceTags: JSON.stringify(r.sourceTags[`${p.periodType}:${p.periodEnd}`] ?? {}),
        computedAt: now,
      })
    }
  })()
}

export function getFinancialsFor(
  raw: Database.Database,
  cik: number,
): { quarterly: FinancialPeriod[]; annual: FinancialPeriod[]; ttm: FinancialPeriod[] } {
  const rows = raw
    .prepare(
      `SELECT period_end AS periodEnd, period_type AS periodType, revenue,
              gross_profit AS grossProfit, operating_income AS operatingIncome,
              net_income AS netIncome, ocf, capex, fcf, cash,
              total_debt AS totalDebt, equity, shares_diluted AS sharesDiluted,
              shares_outstanding AS sharesOutstanding, sbc, rd_expense AS rdExpense
       FROM financials WHERE cik = ? ORDER BY period_end DESC`,
    )
    .all(cik) as FinancialPeriod[]

  return {
    quarterly: rows.filter((r) => r.periodType === 'Q'),
    annual: rows.filter((r) => r.periodType === 'A'),
    ttm: rows.filter((r) => r.periodType === 'TTM'),
  }
}

// 왜 period_end가 아니라 filed_date인가: period_end는 회계기간 "종료일"일 뿐,
// 그 값이 실제로 언제 신고됐는지와 무관하다 — 회계 마감부터 신고서 제출까지
// 통상 1~4개월이 걸리므로(fiscal lag), 오늘 날짜와 period_end를 직접 비교하는
// 것 자체가 잘못된 검사다. 게다가 SEC bulk는 회사가 실제로 신고를 멈춘 뒤에도
// (혹은 디멘션 오염된 값이라도) period_end만은 계속 최신처럼 채워 넣는 경우가
// 있어 — Alphabet 실사례: OperatingIncomeLoss가 매 분기 최신 period_end로
// 들어오지만 값 자체가 틀렸는데도 "최근 period_end가 있다"는 이유만으로
// 이 회사가 한 번도 stale로 판정된 적이 없어 API 재확인이 전혀 일어나지
// 않았다(ingest-hardening 과제 결함 1). filed_date는 신고자가 실제로 SEC에
// 제출한 날짜이므로 "이 회사 데이터가 실제로 언제 갱신됐는가"를 정직하게
// 측정한다.
export function selectStaleCiks(
  raw: Database.Database,
  asOf: string,
  days: number,
): number[] {
  const cutoff = new Date(Date.parse(asOf) - days * 86_400_000)
    .toISOString()
    .slice(0, 10)
  const rows = raw
    .prepare(
      `SELECT c.cik FROM companies c
       JOIN company_industry ci ON ci.cik = c.cik
       LEFT JOIN (SELECT cik, MAX(filed_date) AS latest FROM financial_facts GROUP BY cik) f
         ON f.cik = c.cik
       WHERE c.is_active = 1 AND (f.latest IS NULL OR f.latest < ?)
       ORDER BY c.cik`,
    )
    .all(cutoff) as { cik: number }[]
  return rows.map((r) => r.cik)
}

// 왜 네 번째 그물이 필요한가(F6 잔여 구멍): 위 `selectStaleCiks`는 `MAX(filed_date)`를
// **모든 소스**에서 계산한다. bulk는 매 분기 자동으로 최신 신고일을 채워 넣으므로, API
// 사실이 아무리 낡거나 망가져도 이 조건은 절대 발동하지 않는다. `selectThinCoverageCiks`는
// API 행만 세지만 **누적** 개수라 이미 800건이 쌓인 회사는 파서가 망가져도 그물을
// 빠져나가고, `selectTagSetStaleCiks`는 TRACKED_TAGS가 바뀔 때만 발동한다. 즉 세 그물 중
// **어느 것도 API 데이터 자체의 신선도를 보지 않는다** — 태그 집합을 바꾸지 않는 파서
// 회귀가 들어오면 재조회가 영원히 일어나지 않는다. 이 프로젝트에서 "최신처럼 보이는 낡은
// 데이터"가 네 번째로 반복된 형태다.
//
// 이 함수는 `source='api'` 행만으로 `MAX(filed_date)`를 계산해 같은 임계값을 적용한다.
// API 행이 아예 없는 회사(LEFT JOIN NULL)도 대상이다 — 그건 정확히 파서가 응답을 통째로
// 버린 코호트다. 실측(2026-08, 1,200개사): API 신고일이 120일 넘게 낡은 회사는 소수이며,
// 오탐이 나도 API 호출 한 번을 더 쓸 뿐 값을 왜곡하지 않는다.
export function selectApiStaleCiks(
  raw: Database.Database,
  asOf: string,
  days: number,
): number[] {
  const cutoff = new Date(Date.parse(asOf) - days * 86_400_000)
    .toISOString()
    .slice(0, 10)
  const rows = raw
    .prepare(
      `SELECT c.cik FROM companies c
       JOIN company_industry ci ON ci.cik = c.cik
       LEFT JOIN (SELECT cik, MAX(filed_date) AS latest FROM financial_facts
                  WHERE source = 'api' GROUP BY cik) f
         ON f.cik = c.cik
       WHERE c.is_active = 1 AND (f.latest IS NULL OR f.latest < ?)
       ORDER BY c.cik`,
    )
    .all(cutoff) as { cik: number }[]
  return rows.map((r) => r.cik)
}

// 왜 filed_date 기준 staleness만으로는 부족한가(결함: 문자열 cik 재발 시나리오): 이
// 함수가 잡아내는 대상은 selectStaleCiks가 "충분히 최신"이라고 판단해 절대 건드리지
// 않는 회사다. companyfacts 파서가 응답을 통째로 버리는 버그(예: cik가 숫자가 아닌
// 문자열이라 거부되는 경우)가 있으면 bulk 사실만 쌓이고 API 사실은 하나도 못 들어오는데,
// bulk의 filed_date는 최근 분기 그대로라 "최신"으로 보인다 — filed_date 기준으로는
// 절대 재조회 대상이 되지 않는다(실측: 1,179개 유니버스 중 180개가 이 패턴, API 소스
// 사실 0건·평균 149건 vs 정상군 평균 876건). 이 함수는 filed_date와 무관하게 "저장된
// 사실 자체가 이 정도로 적을 리 없다"는 신호만으로 재조회 후보를 골라 자가치유시킨다.
//
// 임계값 근거(companyfacts-cik-report.md 실측): API 소스가 전혀 없는 180개 회사의
// fact_count는 평균 149·최댓값 391인 반면, API 소스가 있는 999개 회사는 평균 876·
// 최솟값 127이며 그중 200 미만은 단 1개(0.1%, SAIHEAT Ltd — 신생 소형주로 실제로도
// 데이터가 얇다)뿐이다. 200을 기본값으로 쓰면 문제 코호트의 83%(149/180)를 잡아내고
// 이미 정상 커버리지를 가진 회사를 잘못 재조회 대상에 넣는 비율은 0.1%로 억제된다.
// 소형/신규 상장사가 진짜로 얇은 경우(예: 아직 상장 이력이 짧은 제약사)는 재조회해도
// 결과가 똑같이 얇을 뿐 — 값을 왜곡하지 않고 API 호출 한 번을 더 쓸 뿐이므로 안전한
// 방향의 오탐이다. financial_facts 행이 0건인 회사(신규 상장사, 아직 한 번도 못 받은
// 경우)는 INNER JOIN이 걸러낸다 — 그건 이미 selectStaleCiks의 NULL 분기가 처리한다.
//
// 왜 전체 사실이 아니라 `source='api'` 사실만 세는가: 이 그물이 잡으려는 것은 정확히
// "API 사실이 하나도(혹은 거의) 안 들어온 회사"다. 전체 행을 세면 bulk가 두껍게 쌓인
// 회사는 API가 0건이어도 임계값을 넘어 그물을 빠져나간다 — 실측(2026-08, 1,200개사):
// bulk 사실만으로 200건 이상인 회사가 53개(4%)이고, 그 53개는 신고 항목이 가장 많은
// 대형주, 즉 사용자가 실제로 행동할 가능성이 가장 높은 회사들이다. API 소스만 세면
// 그 구멍이 정확히 닫힌다. 임계값 자체는 그대로 둔다 — API 사실이 있는 999개 회사의
// 평균은 876건이고 200 미만은 0.1%(1개)뿐이었으므로, API만 세도 정상 회사가 잘못
// 뽑히는 비율은 거의 변하지 않는다.
export function selectThinCoverageCiks(
  raw: Database.Database,
  minFacts: number,
): number[] {
  const rows = raw
    .prepare(
      `SELECT c.cik FROM companies c
       JOIN company_industry ci ON ci.cik = c.cik
       JOIN (SELECT cik,
                    SUM(CASE WHEN source = 'api' THEN 1 ELSE 0 END) AS n
             FROM financial_facts GROUP BY cik) f
         ON f.cik = c.cik
       WHERE c.is_active = 1 AND f.n < ?
       ORDER BY c.cik`,
    )
    .all(minFacts) as { cik: number }[]
  return rows.map((r) => r.cik)
}

// 왜 세 번째 재조회 기준이 필요한가: `TRACKED_TAGS`는 **파싱 시점에** 태그를 걸러내므로,
// 목록에 없던 태그는 SEC가 보내줘도 저장되지 않는다. 목록을 늘려도 이미 수집된 회사는
// 다시 조회되지 않는다 — `selectStaleCiks`는 신고일만 보는데 이 회사들의 저장된 신고일은
// 최신이고(bulk가 매 분기 갱신한다), `selectThinCoverageCiks`도 사실 수가 충분하니
// 발동하지 않는다. 즉 태그를 추가할 때마다 그 추가는 신규 상장사에만 적용되고 기존
// 유니버스에서는 조용히 무효가 된다(이번 과제의 부채 태그 확장이 정확히 그 경우다).
//
// 이 함수는 회사별로 "마지막 API 수집 시점의 추적 태그 집합 지문"을 저장한
// `ingest_tag_state`와 현재 지문을 비교해, 다르거나 아예 기록이 없는 회사를 고른다.
// 이번 한 번을 위한 수동 조치가 아니라 앞으로 태그를 추가·삭제할 때마다 자동으로
// 작동하는 구조다. 회사별로 기록하므로 실행이 중간에 끊겨도 이미 받은 회사는 다시
// 받지 않는다(재개 가능).
export function selectTagSetStaleCiks(
  raw: Database.Database,
  fingerprint: string,
): number[] {
  const rows = raw
    .prepare(
      `SELECT c.cik FROM companies c
       JOIN company_industry ci ON ci.cik = c.cik
       LEFT JOIN ingest_tag_state t ON t.cik = c.cik
       WHERE c.is_active = 1 AND (t.tags_fingerprint IS NULL OR t.tags_fingerprint <> ?)
       ORDER BY c.cik`,
    )
    .all(fingerprint) as { cik: number }[]
  return rows.map((r) => r.cik)
}

/** API 조회를 실제로 마친 회사에만 현재 지문을 기록한다(실패한 회사는 다음 실행에서 다시 대상). */
export function markTagSetFetched(
  raw: Database.Database,
  cik: number,
  fingerprint: string,
  at: string,
): void {
  raw
    .prepare(
      `INSERT INTO ingest_tag_state (cik, tags_fingerprint, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(cik) DO UPDATE SET tags_fingerprint = excluded.tags_fingerprint,
                                      updated_at = excluded.updated_at`,
    )
    .run(cik, fingerprint, at)
}
