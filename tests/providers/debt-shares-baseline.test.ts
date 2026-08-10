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
