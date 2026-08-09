/**
 * 수집 대상 XBRL 태그. 폴백 체인의 모든 후보를 포함한다.
 * 정규화(Task 9)가 이 중 어떤 태그를 실제로 쓸지 결정한다.
 */
export const TRACKED_TAGS = new Set<string>([
  // 매출
  'RevenueFromContractWithCustomerExcludingAssessedTax',
  'RevenueFromContractWithCustomerIncludingAssessedTax',
  'Revenues',
  'SalesRevenueNet',
  // 매출총이익 / 매출원가
  'GrossProfit',
  'CostOfRevenue',
  'CostOfGoodsAndServicesSold',
  // 손익
  'OperatingIncomeLoss',
  'NetIncomeLoss',
  'ResearchAndDevelopmentExpense',
  'ShareBasedCompensation',
  // 현금흐름
  'NetCashProvidedByUsedInOperatingActivities',
  'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations',
  'PaymentsToAcquirePropertyPlantAndEquipment',
  'PaymentsToAcquireProductiveAssets',
  // 재무상태
  'CashAndCashEquivalentsAtCarryingValue',
  'ShortTermInvestments',
  'LongTermDebtNoncurrent',
  'LongTermDebtCurrent',
  'DebtCurrent',
  'StockholdersEquity',
  // 주식수
  'WeightedAverageNumberOfDilutedSharesOutstanding',
  'EntityCommonStockSharesOutstanding',
])
