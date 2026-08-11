import { describe, it, expect } from 'vitest'
import { resolveFlow, resolveTotalDebt, type InstantContext } from '@/providers/fundamental/resolve'

/**
 * **총부채·주식수 회귀 기준선.**
 *
 * 기존 회귀 기준선(AAPL·NVDA·MSFT·GOOGL의 매출/매출총이익률/영업이익)은 F4가
 * `total_debt`를 QCOM −84% · NXPI −94% · MTCH −100%로 망가뜨리는 동안 **한 자리도
 * 움직이지 않았다.** 어느 기준선도 대차대조표를 건드리지 않았기 때문이다. 그 사각지대를
 * 닫는 것이 이 파일이다.
 *
 * 각 항목은 **신고서 원문의 대차대조표 두 줄**(유동 차입금 + 비유동 차입금)에서 나온
 * 값이며, 아래 표의 `SOURCE` 주석에 접근 URL과 줄 이름을 적었다. 범위가 아니라 계산된
 * 값 자체를 고정한다 — 이 코드에 대한 다음 변경이 부채를 조용히 망가뜨리면서 통과할 수
 * 없어야 한다.
 *
 * 태그 패턴은 이번에 깨진 것들을 전부 덮는다:
 *   1. `LongTermDebt`(대차대조표 비유동 줄) + `DebtCurrent`            — TSLA · XRX · ADBE
 *   2. 1 + `LongTermDebtCurrent`(주석의 유동 만기분)                   — QCOM
 *   3. `LongTermDebt` + `LongTermDebtCurrent` = 0                      — MTCH · SWKS
 *   4. `LongTermDebtNoncurrent`가 10-K에만 있고 앵커는 `DebtCurrent`만 — NXPI(이월)
 *   5. `DebtLongtermAndShorttermCombinedAmount`                        — VRSK · PTC
 *   6. 비유동 + 유동 만기분 + 단기차입금(별개)                          — WWD · OTTR
 *   7. 비유동 + 단기차입금(포함관계)                                    — GEHC
 *   8. 변하지 않아야 하는 대형주                                        — AAPL · NVDA · NFLX
 */

type Facts = Record<string, number>

function debt(facts: Facts, dates?: Record<string, string>): number | null {
  const ctx: InstantContext | undefined = dates === undefined ? undefined : {
    dates: new Map(Object.entries(dates)),
    absent: new Map(),
    instant: new Map(),
  }
  return resolveTotalDebt(new Map(Object.entries(facts)), ctx)?.value ?? null
}

describe('총부채 기준선 — 신고서 대차대조표 대조 (FILING-CONFIRMED)', () => {
  it('QCOM 2026-06-28 = 15,270,000,000 (Short-term debt 2,489 + Long-term debt 12,781)', () => {
    // SOURCE: 10-Q accession 0000804328-26-000086, R2.htm CONDENSED CONSOLIDATED BALANCE SHEETS
    // `LongTermDebtCurrent` 1,991,000,000은 단기차입금 2,489 안의 유동 만기분이라 따로
    // 더하지 않는다 — 더하면 1.99B 이중계상이다.
    expect(debt({
      LongTermDebt: 12_781_000_000,
      LongTermDebtCurrent: 1_991_000_000,
      DebtCurrent: 2_489_000_000,
    })).toBe(15_270_000_000)
  })

  it('TSLA 2026-06-30 = 9,061,000,000 (DebtCurrent 1,340 + LongTermDebt 7,721)', () => {
    // SOURCE: 10-Q accession 0001628280-26-049270, R2.htm — 대차대조표는 리스를 포함해
    // 유동 1,418 / 비유동 7,924로 적고, XBRL의 차입금 전용 태그가 위 두 값이다.
    expect(debt({ DebtCurrent: 1_340_000_000, LongTermDebt: 7_721_000_000 }))
      .toBe(9_061_000_000)
  })

  it('ADBE 2026-05-29 = 6,645,000,000 (Debt 유동 1,843 + Debt 비유동 4,802)', () => {
    // SOURCE: 10-Q accession 0000796343-26-000112, R2.htm — `Debt` 두 줄.
    expect(debt({ DebtCurrent: 1_843_000_000, LongTermDebt: 4_802_000_000 }))
      .toBe(6_645_000_000)
  })

  it('XRX 2026-06-30 = 4,223,000,000 (단기 70 + 장기 4,153)', () => {
    // SOURCE: 10-Q accession 0001770450-26-000040, R4.htm
    expect(debt({ DebtCurrent: 70_000_000, LongTermDebt: 4_153_000_000 }))
      .toBe(4_223_000_000)
  })

  it('MTCH 2026-06-30 = 3,551,878,000 (유동 만기분 0 + 장기차입금 3,551,878)', () => {
    // SOURCE: 10-Q accession 0000891103-26-000130, R2.htm
    // 결함 상태에서는 `LongTermDebtCurrent`=0 하나만 앵커에 남아 총부채가 0이었다.
    expect(debt({ LongTermDebt: 3_551_878_000, LongTermDebtCurrent: 0 }))
      .toBe(3_551_878_000)
  })

  it('SWKS 2026-07-03 = 496,900,000 (유동 만기분 0 + 장기차입금 496.9)', () => {
    // SOURCE: 10-Q accession 0000004127-26-000049, R4.htm
    expect(debt({ LongTermDebt: 496_900_000, DebtCurrent: 0 })).toBe(496_900_000)
  })

  it('NXPI 2026-03-29 = 11,722,000,000 — 10-K에만 있는 비유동 잔액을 이월한다', () => {
    // SOURCE: 10-K accession 0001413447-26-000008이 2025-12-31 `Long-term debt` 10,972를
    // 신고하고, 10-Q accession 0001413447-26-000034는 2026-03-29에 `Short-term debt` 750만
    // 태깅한다. 같은 10-Q의 대차대조표에는 장기차입금 줄이 그대로 있다
    // (다음 분기 10-Q 0001413447-26-000045 R4.htm: 2026-06-28 999 + 9,977).
    expect(debt(
      { LongTermDebtNoncurrent: 10_972_000_000, DebtCurrent: 750_000_000 },
      { LongTermDebtNoncurrent: '2025-12-31', DebtCurrent: '2026-03-29' },
    )).toBe(11_722_000_000)
  })

  it('VRSK 2026-03-31 = 4,475,600,000 — 신고자의 장·단기 합산 총계가 최우선', () => {
    // SOURCE: 10-Q accession 0001437749-26-013729. 같은 회사 2025-12-31에서
    // combined 4,737.2 ≠ LongTermDebt 4,773.5 + DebtCurrent 1,508.9 — 조립은 이 신고자에게
    // 이중계상이고 combined만 두 관행 모두에서 옳다.
    expect(debt({
      DebtLongtermAndShorttermCombinedAmount: 4_475_600_000,
      DebtCurrent: 258_400_000,
    })).toBe(4_475_600_000)
  })

  it('PTC 2026-06-30 = 1,423,315,000 (유동 25,074 + 비유동 1,398,241)', () => {
    // SOURCE: 10-Q accession 0001193125-26-328444, R2.htm
    expect(debt({ DebtLongtermAndShorttermCombinedAmount: 1_423_315_000 }))
      .toBe(1_423_315_000)
  })

  it('OTTR 2026-06-30 = 1,266,713,000 (단기 53,847 + 유동만기 79,977 + 장기 1,132,889)', () => {
    // SOURCE: 10-Q accession 0001466593-26-000071, R2.htm — 세 줄이 모두 별개다.
    // `LongTermDebt`가 대차대조표의 비유동 줄이고 단기차입금은 유동 만기분과 별개다.
    expect(debt({
      LongTermDebt: 1_132_889_000,
      LongTermDebtCurrent: 79_977_000,
      ShortTermBorrowings: 53_847_000,
    })).toBe(1_266_713_000)
  })

  it('WWD 2025-09-30 = 702,202,000 — 단기차입금이 유동 만기분과 값이 비슷해도 별개다', () => {
    // SOURCE: FY2025 10-K accession 0001193125-25-296204 대차대조표 세 줄 —
    // `Short-term debt 122,300` / `Current portion of long-term debt 122,934` /
    // `Long-term debt, less current portion 456,968`.
    // 신고자 자신의 롤업 항등식이 판정한다: LongTermDebt 579,902 = 456,968 + 122,934
    // (유동 만기분에서 끝난다) → 단기차입금 122,300은 그 밖. 상대차 0.52%를 "포함"으로
    // 본 옛 규칙은 여기서 122.3M을 통째로 버렸다.
    expect(debt({
      LongTermDebt: 579_902_000,
      LongTermDebtNoncurrent: 456_968_000,
      LongTermDebtCurrent: 122_934_000,
      ShortTermBorrowings: 122_300_000,
    })).toBe(702_202_000)
  })

  it('GEHC 2026-03-31 = 10,134,000,000 — 단기차입금이 곧 유동 만기분이면 더하지 않는다', () => {
    // SOURCE: Q1-2026 10-Q accession 0001932393-26-000031 차입금 주석 —
    // "Short-term borrowings as of March 31, 2026 … includes $2 million … related to the
    // current portion of our long-term borrowings", 총차입금 10,134 = 단기 7 + 장기 10,127.
    // 항등식: LongTermDebt 10,134 = Noncurrent 10,127 + ShortTermBorrowings 7 (정확히 성립).
    // 상대차 71%를 "별개"로 본 옛 규칙은 2M을 이중계상했다.
    expect(debt({
      LongTermDebt: 10_134_000_000,
      LongTermDebtNoncurrent: 10_127_000_000,
      LongTermDebtCurrent: 2_000_000,
      ShortTermBorrowings: 7_000_000,
    })).toBe(10_134_000_000)
  })

  it('변하면 안 되는 대형주 — AAPL / NVDA / NFLX', () => {
    // AAPL 2026-06-27 82,347,000,000 (10-Q 0000320193-26-000020)
    expect(debt({
      LongTermDebt: 82_300_000_000,
      LongTermDebtNoncurrent: 71_340_000_000,
      LongTermDebtCurrent: 11_007_000_000,
    })).toBe(82_347_000_000)
    // NVDA 2026-04-26 8,470,000,000 (10-Q 0001045810-26-000052)
    expect(debt({
      LongTermDebt: 8_470_000_000,
      LongTermDebtNoncurrent: 7_470_000_000,
      LongTermDebtCurrent: 1_000_000_000,
      DebtCurrent: 1_000_000_000,
    })).toBe(8_470_000_000)
    // NFLX 2026-06-30 14,309,306,000 = 비유동 + 단기차입금(별개)
    expect(debt({
      LongTermDebtNoncurrent: 11_825_548_000,
      ShortTermBorrowings: 2_483_758_000,
    })).toBe(14_309_306_000)
  })

  it('부채가 0으로 계산되면 어느 경로에서도 null이다', () => {
    expect(debt({ DebtCurrent: 0 })).toBeNull()
    expect(debt({ LongTermDebtCurrent: 0 })).toBeNull()
    expect(debt({ LongTermDebt: 0 })).toBeNull()
    expect(debt({ DebtLongtermAndShorttermCombinedAmount: 0 })).toBeNull()
    expect(debt({ LinesOfCreditCurrent: 0 })).toBeNull()
  })
})

/**
 * **리스 포함 롤업(`…AndCapitalLeaseObligations`) 기준선.**
 *
 * 이 두 태그는 리스를 품고 있어 그대로 쓰면 debt-coverage 과제가 기각한 리스부채가
 * 다시 들어온다. 그래서 (1) 같은 구역의 **금융리스를 빼고**, (2) 리스 없는 총계
 * 개념이 그 대차대조표에 **하나도 없을 때만** 쓴다. 아래 두 블록이 그 두 조건을
 * 각각 고정한다 — 값과 "움직이지 않음"을 함께 못박아야 규칙이 한쪽으로 새지 않는다.
 * 근거·반례는 tags.ts의 `LEASE_INCLUSIVE_DEBT_TAGS` 주석 참고.
 */
describe('리스 포함 롤업 — 금융리스를 뺀 뒤에만 쓴다', () => {
  it('MU 2026-05-28 = 3,052,000,000 (DACLO 5,722 − 금융리스 2,670)', () => {
    // SOURCE: 10-Q accession 0000723125-26-000047 (filed 2026-06-25).
    // 이전 동작: 앵커에 `DebtCurrent` 582,000,000만 남아 총부채가 **582M**이었다.
    // 그 582M은 `FinanceLeaseLiabilityCurrent`와 정확히 같은 값 — 100% 금융리스다.
    expect(debt({
      DebtAndCapitalLeaseObligations: 5_722_000_000,
      LongTermDebtAndCapitalLeaseObligations: 5_140_000_000,
      DebtCurrent: 582_000_000,
      FinanceLeaseLiability: 2_670_000_000,
      FinanceLeaseLiabilityCurrent: 582_000_000,
      FinanceLeaseLiabilityNoncurrent: 2_088_000_000,
      OperatingLeaseLiabilityNoncurrent: 654_000_000,
    })).toBe(3_052_000_000)
  })

  it('MU — 비유동 롤업만 있어도 같은 답이 나온다 (유동 쪽 리스도 뺀다)', () => {
    // `LongTermDebtAndCapitalLeaseObligations` 5,140 − 금융리스 비유동 2,088 = 3,052,
    // 유동은 `DebtCurrent` 582 − 금융리스 유동 582 = 0. 두 경로가 같은 값으로 만난다.
    expect(debt({
      LongTermDebtAndCapitalLeaseObligations: 5_140_000_000,
      DebtCurrent: 582_000_000,
      FinanceLeaseLiabilityCurrent: 582_000_000,
      FinanceLeaseLiabilityNoncurrent: 2_088_000_000,
    })).toBe(3_052_000_000)
  })

  it('MU 2025-08-28 — 차분이 신고자 자신의 `LongTermDebt`와 정확히 일치한다', () => {
    // 이 항등식이 규칙의 근거다. MU는 2019-02-28~2026-05-28의 22개 대차대조표 전부에서
    // DACLO − FinanceLeaseLiability = LongTermDebt를 오차 0으로 유지한다.
    // FY2025 10-K(0000723125-25-000041): 14,577 − 3,044 = 11,533 = `LongTermDebt`.
    expect(14_577_000_000 - 3_044_000_000).toBe(11_533_000_000)
    // 그리고 그 대차대조표에는 `LongTermDebt`가 실제로 있으므로 롤업 경로는 발동하지
    // 않는다 — 기존 티어가 그대로 답한다.
    expect(debt({
      DebtAndCapitalLeaseObligations: 14_577_000_000,
      LongTermDebt: 11_533_000_000,
      DebtCurrent: 560_000_000,
      FinanceLeaseLiability: 3_044_000_000,
    })).toBe(12_093_000_000)
  })

  it('CELU 2025-12-31 = 40,112,000 (LTDACLO 33,812 + 이월된 유동 만기분 6,300)', () => {
    // SOURCE: FY2025 10-K accession 0001752828-26-000031 (filed 2026-04-30). 이 신고서의
    // 유일한 장기차입금 줄이 `LongTermDebtAndCapitalLeaseObligations` 33,812,000이다.
    // 금융리스 태그는 이력 전체에 없고 `OperatingLeaseLiability` 26,898,000만 있다 —
    // 운용리스는 이 롤업에 들어가지 않으므로 뺄 것이 없다.
    // 이전 동작: 6개월 전 `LongTermDebtCurrent` 6,300,000만 이월돼 총부채 **6.3M**.
    expect(debt(
      {
        LongTermDebtAndCapitalLeaseObligations: 33_812_000,
        ConvertibleNotesPayable: 922_000,
        LongTermDebtCurrent: 6_300_000,
        OperatingLeaseLiability: 26_898_000,
        OperatingLeaseLiabilityNoncurrent: 26_898_000,
      },
      {
        LongTermDebtAndCapitalLeaseObligations: '2025-12-31',
        ConvertibleNotesPayable: '2025-12-31',
        LongTermDebtCurrent: '2025-06-30',
        OperatingLeaseLiability: '2025-12-31',
        OperatingLeaseLiabilityNoncurrent: '2025-12-31',
      },
    )).toBe(40_112_000)
  })

  it('EBAY 2026-06-30 = 6,735,000,000 (DACLO, 금융리스 없음)', () => {
    // SOURCE: 10-Q accession 0001065088-26-000060 (filed 2026-08-06).
    // 이전 동작: `DebtCurrent` 1,593,000,000만 잡혀 총부채가 4분의 1로 축소돼 있었다.
    // 검산: 비유동 롤업 5,142 + 유동 1,593 = 6,735 — 두 경로가 일치한다.
    expect(debt({
      DebtAndCapitalLeaseObligations: 6_735_000_000,
      LongTermDebtAndCapitalLeaseObligations: 5_142_000_000,
      LongTermDebtCurrent: 850_000_000,
      DebtCurrent: 1_593_000_000,
    })).toBe(6_735_000_000)
  })

  it('ASYS — 롤업이 통째로 금융리스면 null이다 (0도, 리스도 아니다)', () => {
    // SOURCE: 2025-12-31 `LongTermDebtAndCapitalLeaseObligations` 162,000 =
    // `FinanceLeaseLiabilityNoncurrent` 162,000. 차입금은 실제로 없다.
    expect(debt({
      LongTermDebtAndCapitalLeaseObligations: 162_000,
      FinanceLeaseLiability: 301_000,
      FinanceLeaseLiabilityCurrent: 139_000,
      FinanceLeaseLiabilityNoncurrent: 162_000,
    })).toBeNull()
  })

  it('PRPO — 롤업이 리스보다 작으면 차분을 쓰지 않는다', () => {
    // SOURCE: 2025-12-31 `DebtAndCapitalLeaseObligations` 77,000 <
    // `FinanceLeaseLiability` 960,000. 둘이 같은 줄을 재고 있지 않다는 뜻이다.
    expect(debt({
      DebtAndCapitalLeaseObligations: 77_000,
      FinanceLeaseLiability: 960_000,
    })).toBeNull()
  })

  it('다른 일자의 리스 잔액은 빼지 않는다 — 뺄셈은 같은 대차대조표 안에서만', () => {
    expect(debt(
      {
        DebtAndCapitalLeaseObligations: 5_722_000_000,
        FinanceLeaseLiability: 2_670_000_000,
      },
      {
        DebtAndCapitalLeaseObligations: '2026-05-28',
        FinanceLeaseLiability: '2025-08-28',
      },
    )).toBe(5_722_000_000)
  })
})

describe('리스 포함 롤업 — 리스 없는 총계가 있으면 아예 보지 않는다', () => {
  it('GOOGL 2024-12-31 = 11,882,000,000 — 롤업이 `LongTermDebtNoncurrent`의 동의어다', () => {
    // SOURCE: FY2024 10-K accession 0001652044-26-000019 재신고분.
    // `LongTermDebtAndCapitalLeaseObligations` 10,883,000,000은 `LongTermDebtNoncurrent`
    // 10,883,000,000과 **같은 값**인데 `FinanceLeaseLiabilityNoncurrent`는 1,442,000,000이다.
    // 여기서 리스를 빼면 근거 없이 1.44B을 지운다 — 게이트가 정확히 이것을 막는다.
    expect(debt({
      LongTermDebtAndCapitalLeaseObligations: 10_883_000_000,
      LongTermDebtNoncurrent: 10_883_000_000,
      LongTermDebtCurrent: 999_000_000,
      FinanceLeaseLiability: 1_677_000_000,
      FinanceLeaseLiabilityCurrent: 235_000_000,
      FinanceLeaseLiabilityNoncurrent: 1_442_000_000,
    })).toBe(11_882_000_000)
  })

  it('GOOGL 2026-06-30 = 100,164,000,000 — 기준선이 움직이지 않는다', () => {
    // SOURCE: 10-Q accession 0001652044-26-000082. 이 일자에는 롤업 자체가 없다.
    expect(debt({
      LongTermDebtNoncurrent: 98_165_000_000,
      LongTermDebtCurrent: 1_999_000_000,
      FinanceLeaseLiability: 2_590_000_000,
      FinanceLeaseLiabilityCurrent: 449_000_000,
      FinanceLeaseLiabilityNoncurrent: 2_141_000_000,
    })).toBe(100_164_000_000)
  })

  it('NXPI 2026-03-29 = 11,722,000,000 — 롤업이 함께 있어도 이월된 비유동이 이긴다', () => {
    // SOURCE: 10-Q accession 0001413447-26-000034는 2026-03-29에
    // `DebtAndCapitalLeaseObligations` 11,724,000,000과
    // `LongTermDebtAndCapitalLeaseObligations` 10,974,000,000을 함께 태깅한다.
    // 롤업을 쓰면 11,724가 되어 기준선이 2,000,000 움직인다 — 이월된
    // `LongTermDebtNoncurrent` 10,972,000,000이 있으므로 롤업은 보지 않는다.
    expect(debt(
      {
        LongTermDebtNoncurrent: 10_972_000_000,
        DebtCurrent: 750_000_000,
        DebtAndCapitalLeaseObligations: 11_724_000_000,
        LongTermDebtAndCapitalLeaseObligations: 10_974_000_000,
      },
      {
        LongTermDebtNoncurrent: '2025-12-31',
        DebtCurrent: '2026-03-29',
        DebtAndCapitalLeaseObligations: '2026-03-29',
        LongTermDebtAndCapitalLeaseObligations: '2026-03-29',
      },
    )).toBe(11_722_000_000)
  })

  it('VRSK / XEL — 신고자의 리스 없는 총계가 롤업보다 우선한다', () => {
    // VRSK 2026-03-31: `LongTermDebtAndCapitalLeaseObligations` 4,217,200,000이 있어도
    // 장·단기 합산 총계 4,475,600,000이 이긴다(기준선).
    expect(debt({
      DebtLongtermAndShorttermCombinedAmount: 4_475_600_000,
      LongTermDebtAndCapitalLeaseObligations: 4_217_200_000,
      FinanceLeaseLiabilityNoncurrent: 12_300_000,
      DebtCurrent: 258_400_000,
    })).toBe(4_475_600_000)
    // XEL 2025-12-31: `LongTermDebt` 32,333,000,000이 있으므로 롤업 31,832,000,000은
    // 보지 않는다. 단기차입금은 tags.ts 규칙대로 그대로 더한다.
    expect(debt({
      LongTermDebt: 32_333_000_000,
      LongTermDebtAndCapitalLeaseObligations: 31_832_000_000,
      FinanceLeaseLiability: 1_301_000_000,
      FinanceLeaseLiabilityNoncurrent: 1_262_000_000,
      ShortTermBorrowings: 1_243_000_000,
    })).toBe(33_576_000_000)
  })

  it('AAPL / NVDA — 롤업을 쓰지 않는 대형주는 그대로다', () => {
    expect(debt({
      LongTermDebtNoncurrent: 74_350_000_000,
      LongTermDebtCurrent: 8_000_000_000,
    })).toBe(82_350_000_000)
    expect(debt({
      LongTermDebtNoncurrent: 7_470_000_000,
      DebtCurrent: 1_000_000_000,
    })).toBe(8_470_000_000)
  })
})

/**
 * **매출·영업이익 회귀 기준선 — 새로 덮은 신고자 유형.**
 *
 * 위 부채 기준선이 만들어진 이유(“기준선은 자기가 이름 대지 않은 필드에 대해서는
 * 장님이다”)가 이번에도 그대로 반복됐다: 부채 기준선 12개는 XEL의 2019~2025년 매출이
 * 통째로 비어 있고 ADP의 영업이익이 6개 연간 기간 전부 결측인 동안 한 자리도 움직이지
 * 않았다. 이 블록은 그 사각지대를 닫는다 — 이번에 새로 덮은 세 유형(규제 유틸리티,
 * 대출·핀테크, 영업이익 줄을 신고하지 않는 대형 서비스 기업)의 값을 SEC companyfacts
 * 원문 수치 그대로 고정한다.
 */
function flow(facts: Record<string, number>) {
  return resolveFlow(new Map(Object.entries(facts)))
}

describe('매출·영업이익 기준선 — SEC companyfacts 원문 대조', () => {
  it('XEL 2025-12-31 — 매출 14,669,000,000 / 영업이익 2,583,000,000', () => {
    // SOURCE: FY2025 10-K accession 0000072903-26-000009.
    // `Revenues`는 2019-09-30에서 끊겼고 그 뒤로는 규제 유틸리티 총매출 태그만 쓴다.
    // 신고된 영업이익이 1순위이며, 여기서는 매출 − CostsAndExpenses와도 정확히 같다
    // (14,669 − 12,086 = 2,583) — 유도식이 이 신고자에게 항등식임을 함께 증명한다.
    const r = flow({
      RegulatedAndUnregulatedOperatingRevenue: 14_669_000_000,
      CostsAndExpenses: 12_086_000_000,
      OperatingIncomeLoss: 2_583_000_000,
    })
    expect(r.fields.revenue).toBe(14_669_000_000)
    expect(r.used.revenue).toBe('RegulatedAndUnregulatedOperatingRevenue')
    expect(r.fields.operatingIncome).toBe(2_583_000_000)
    expect(r.used.operatingIncome).toBe('OperatingIncomeLoss')
  })

  it('MGEE 2025-12-31 — 매출 743,654,000 (2008년 이후 이 태그만 쓴다)', () => {
    // SOURCE: FY2025 10-K. 추적 매출 태그를 한 번도 쓴 적이 없는 신고자다.
    const r = flow({ RegulatedAndUnregulatedOperatingRevenue: 743_654_000 })
    expect(r.fields.revenue).toBe(743_654_000)
  })

  it('LNT 2025-12-31 — 같은 태그가 부분 매출일 때 총계 4,362,000,000이 이긴다', () => {
    // SOURCE: FY2025 10-K. RUR 140,000,000은 비규제 부분이다.
    const r = flow({
      RegulatedAndUnregulatedOperatingRevenue: 140_000_000,
      Revenues: 4_362_000_000,
    })
    expect(r.fields.revenue).toBe(4_362_000_000)
  })

  it('SOFI 2025-12-31 — 매출 3,613,354,000 (계약매출 619,353,000이 아니다)', () => {
    // SOURCE: FY2025 10-K. `RevenuesNetOfInterestExpense`가 손익계산서의 총매출 줄이고
    // 추적 태그로 잡히던 619,353,000은 그 안의 계약매출 한 갈래다(6분의 1).
    const r = flow({
      RevenuesNetOfInterestExpense: 3_613_354_000,
      RevenueFromContractWithCustomerExcludingAssessedTax: 619_353_000,
    })
    expect(r.fields.revenue).toBe(3_613_354_000)
  })

  it('ADP FY2025·FY2026 — 영업이익 4,956,000,000 / 5,319,700,000', () => {
    // SOURCE: FY2026 10-K. ADP는 `OperatingIncomeLoss`도 `GrossProfit`도 신고하지 않고
    // 총매출과 총비용만 신고한다 — 여섯 개 연간 기간 전부 영업이익이 결측이었다.
    expect(flow({
      Revenues: 20_560_900_000,
      CostsAndExpenses: 15_604_900_000,
    }).fields.operatingIncome).toBe(4_956_000_000)
    expect(flow({
      Revenues: 21_947_400_000,
      CostsAndExpenses: 16_627_700_000,
    }).fields.operatingIncome).toBe(5_319_700_000)
  })

  it('BIIB 2025-12-31 / CACC 2025-12-31 — 영업이익 1,556,500,000 / 565,400,000', () => {
    // SOURCE: 각 사 FY2025 10-K. 둘 다 최근 연간 기간에서 `OperatingIncomeLoss`를
    // 신고하지 않는다(BIIB는 2022년부터, CACC는 이력 전체).
    expect(flow({
      Revenues: 9_890_600_000,
      CostsAndExpenses: 8_334_100_000,
    }).fields.operatingIncome).toBe(1_556_500_000)
    expect(flow({
      Revenues: 2_317_200_000,
      CostsAndExpenses: 1_751_800_000,
    }).fields.operatingIncome).toBe(565_400_000)
  })

  it('덮지 않은 것은 여전히 null이다 — 결측을 0으로 채우지 않는다', () => {
    // 이자·배당수익만으로 매출을 만들지 않는다(CASS 2025: 97,566,000은 총매출
    // 190,750,000의 절반, 실측 비율 중앙값 0.051).
    expect(flow({ InterestAndDividendIncomeOperating: 97_566_000 }).fields.revenue).toBeNull()
    expect(flow({ NoninterestIncome: 109_858_000 }).fields.revenue).toBeNull()
    // 매출 − OperatingExpenses는 매출원가가 빠져 있어 쓰지 않는다.
    expect(flow({
      Revenues: 34_100_000_000,
      OperatingExpenses: 12_919_000_000,
    }).fields.operatingIncome).toBeNull()
  })
})
