# Tenbagger Discovery Dashboard — 설계 문서

- 작성일: 2026-08-09
- 상태: 승인됨 (Phase 1 구현 대상)

---

## 1. 목적

미국 상장 성장주 중 **향후 3~7년 내 Multibagger / Tenbagger가 될 가능성이 있는 기업을 조기에 발견**하기 위한 리서치 대시보드.

시가총액 상위 종목을 나열하는 스크리너가 아니다. 탐색 경로는 다음과 같다.

```
Growth Theme → Industry → Leader / Challenger / Emerging
  → Tenbagger Screening → Tenbagger Score
  → Fundamental Analysis → Fair Value → Risk / Catalyst
```

전통적인 `Sector → Industry → 시총 상위 → Valuation` 경로는 사용하지 않는다.

---

## 2. 범위

### Phase 1 (본 문서의 구현 대상)

- 유니버스 구성 및 필터링
- Growth Theme / Industry 분류 체계
- SEC 재무 데이터 수집 및 정규화
- 주가 / 시가총액 수집
- Tenbagger Score (9개 팩터)
- Quality Gate (Red Flag 판정)
- Leader / Challenger / Emerging 자동 분류
- 화면 3종: Growth Opportunity Map, Industry, Stock Detail
- CLI 파이프라인

### Phase 1 제외 (후속 Phase)

| 항목 | Phase | 이유 |
|---|---|---|
| Discovery Score | 2 | 기관 보유·애널리스트 커버리지 데이터 필요 |
| Quality Score (0~100) | 2 | Phase 1은 Quality **Gate**(Red Flag)만 |
| Growth Quality Matrix | 2 | Quality Score에 의존 |
| Hidden Gem Radar | 2 | Discovery Score에 의존 |
| Candidate Radar (필터 페이지) | 2 | |
| Watchlist | 2 | |
| Score History 차트 | 2 | `scores`가 append-only라 데이터는 Phase 1부터 쌓임 |
| Rising / Deteriorating Candidate | 2 | 최소 4주치 이력 필요 |
| DCF Fair Value, Moat 분석, Bull/Base/Bear | 3 | |
| Uncertainty Score, Risk Engine | 3 | |
| SEC Filing 통합, News, Earnings 이벤트 감지, Alert | 4 | |
| Institutional / Insider 팩터 | 4 | 13F·Form 4 파싱 필요 |
| Going Concern, 고객 집중도 Red Flag | 4 | 10-K 본문 파싱 필요 |

**Phase 2~4용 빈 폴더, 인터페이스, 플레이스홀더 UI를 미리 만들지 않는다.** `engines/` 경계 규칙(§12)이 있어 나중에 추가하는 비용이 낮다.

---

## 3. 확정된 기술 결정

| 항목 | 결정 | 근거 |
|---|---|---|
| 재무 데이터 | SEC EDGAR (무료·공식) | 원천 XBRL, API 키 불필요, 전체 미국 신고기업 커버 |
| 수집 전략 | **하이브리드**: 분기 벌크 ZIP 백필 + `companyfacts` API 증분 | 초기 적재 속도 + 최신성 동시 확보 |
| 주가 | Finnhub 무료 티어 (`PRICE_PROVIDER=finnhub`) | 공식 API, 분당 60호출. fixture로 폴백 가능 |
| 상장 메타데이터 | nasdaqtrader 심볼 디렉터리 | ETF·Test Issue·거래소·상장부적격 플래그 제공 |
| 정성 데이터 | 계산 가능한 프록시 + YAML 큐레이션 | 결정론적·재현 가능·git 이력 추적 |
| 스택 | Next.js 15 (App Router) + TypeScript strict | 단일 언어·단일 프로세스 |
| DB | SQLite (better-sqlite3) + Drizzle ORM | 로컬 실행, Postgres 이전 경로 확보 |
| 테스트 | Vitest | |
| 스타일 | Tailwind CSS 4 | |
| API 계층 | 없음. RSC가 SQLite 직접 읽기 | 개인 리서치 도구. REST 계층은 타입을 이중 정의하게 만듦 |

### 데이터 소스 검증 결과 (2026-08-09 실측)

| 엔드포인트 | 결과 |
|---|---|
| `https://www.sec.gov/files/company_tickers.json` | ✅ 200, 796KB, ~10,000 종목 |
| `https://data.sec.gov/submissions/CIK##########.json` | ✅ 200, SIC·거래소·filer 등급 제공 |
| `https://data.sec.gov/api/xbrl/companyconcept/...` | ✅ 200 |
| `https://www.sec.gov/files/dera/data/financial-statement-data-sets/YYYYqQ.zip` | ✅ 200, 분기당 ~127MB |
| `https://www.nasdaqtrader.com/dynamic/symdir/nasdaqtraded.txt` | ✅ 200, ETF·Test Issue 플래그 포함 |
| Stooq | ❌ 봇 차단(proof-of-work). **사용하지 않음** |
| Finnhub / Tiingo | ⚠️ 무료 API 키 필요 |

SEC 요청 시 `User-Agent` 헤더 필수. 초당 10요청 제한 준수.

---

## 4. 분류 체계 (Growth Theme / Industry)

### 4.1 Theme 6개와 Industry 49개

| Theme | Industry |
|---|---|
| **1. AI / Software / Semiconductor** | Semiconductors, Semiconductor Equipment, Software Infrastructure, Software Application, Cloud Computing, Cybersecurity, Data Infrastructure, AI Infrastructure, Networking, Data Center Infrastructure |
| **2. Healthcare / Biotechnology** | Biotechnology, Pharmaceuticals, Medical Devices, Diagnostics, Genomics, Precision Medicine, Drug Discovery, Healthcare Technology |
| **3. Industrial / Automation / Defense** | Robotics, Industrial Automation, Aerospace, Defense Technology, Drones, Advanced Manufacturing, Logistics Automation |
| **4. Digital Consumer / Fintech** | E-commerce, Fintech, Digital Payments, Digital Advertising, Gaming, Online Marketplace, Travel Technology, Digital Media |
| **5. Energy / Next Energy** | Nuclear, Uranium, Energy Storage, Solar, Grid Infrastructure, Power Semiconductor, Renewable Energy, Next-generation Energy |
| **6. Emerging Technology** | Quantum Computing, Space, Satellite, Autonomous Driving, Advanced Computing, AI Robotics, Advanced Materials, Synthetic Biology |

### 4.2 SIC 코드의 한계 — 반드시 인지할 것

SEC가 제공하는 유일한 업종 정보는 **4자리 SIC 코드**이며, 전체 약 440개다. 이것으로 위 49개 Industry를 자동 도출하는 것은 **불가능하다**.

구체적 사례:

- `7372` (Prepackaged Software) 하나에 MSFT, ADBE, CRWD, PANW, 게임회사가 모두 들어간다. → Software Infrastructure / Cybersecurity / Gaming을 구분할 수 없다.
- `3674` (Semiconductors)는 Theme 1(NVDA)과 Theme 5의 Power Semiconductor에 동시에 해당한다.
- `8731` (Commercial Physical & Biological Research)은 Theme 2(Drug Discovery)와 Theme 6(Synthetic Biology)에 동시에 해당한다.

즉 **Theme 판정조차 겹치는 SIC 코드에서는 자동으로 결정되지 않는다.**

### 4.3 해법 — 2단 분류

**1단: `taxonomy/sic-map.yaml`** — SIC → `{ theme, default_industry }`. SIC마다 **가장 지배적인** Theme/Industry 하나를 결정론적으로 지정한다. 이 파일에 없는 SIC는 유니버스에서 제외된다(은행·리츠·정유·식품 등이 자연히 빠짐).

```yaml
"3674": { theme: ai-software-semi, industry: semiconductors }
"7372": { theme: ai-software-semi, industry: software-application }
"8731": { theme: healthcare-biotech, industry: drug-discovery }
```

**2단: `taxonomy/company-overrides.yaml`** — 티커 → `{ theme?, industry? }`. 실제 분류는 대부분 여기서 결정된다.

```yaml
CRWD: { industry: cybersecurity }
PANW: { industry: cybersecurity }
OKLO: { theme: energy-next, industry: nuclear }
IONQ: { theme: emerging-tech, industry: quantum-computing }
```

**초기 시딩 범위**: 유니버스 내 시가총액 상위 및 주요 성장주 약 400 티커. 오버라이드가 없는 기업은 SIC의 `default_industry`에 배치되며, 이는 숨기지 않고 그대로 표시한다.

**측정 가능성**: `company_industry.source` 컬럼에 `'sic'` / `'override'`를 기록한다. 커버리지 테스트가 다음을 보고한다.

- 유니버스 중 `source='sic'`(= 기본 버킷) 비율
- 유니버스에 존재하지만 `sic-map.yaml`에도 명시적 `unmapped` 목록에도 없는 SIC → **테스트 실패**

이로써 신규 상장 기업이 조용히 누락되는 것을 방지하고, 분류 품질이 시간에 따라 개선되는 것을 수치로 확인할 수 있다.

### 4.4 TAM

`taxonomy/industries.yaml`이 Industry 단위로 보유한다. 기업 단위 TAM은 추정하지 않는다.

```yaml
- slug: cybersecurity
  theme: ai-software-semi
  name: Cybersecurity
  tam_usd: 220_000_000_000
  tam_cagr: 0.12
  tam_source: "Gartner Security & Risk Management Spending Forecast 2025"
  tam_as_of: 2025-12-31
```

`tam_source`와 `tam_as_of`는 필수다. 출처 없는 TAM은 점수에 쓰지 않는다.

---

## 5. 유니버스 구성

### 5.1 필터 (`config.yaml`에서 조정 가능)

| 조건 | 기준 | 데이터 출처 |
|---|---|---|
| 거래소 | NYSE / NASDAQ / AMEX | nasdaqtrader `Listing Exchange` |
| ETF 제외 | `ETF = Y` 제외 | nasdaqtrader `ETF` |
| Test Issue 제외 | `Test Issue = Y` 제외 | nasdaqtrader `Test Issue` |
| 상장부적격 제외 | `Financial Status`가 `D`/`E`/`Q` 제외 | nasdaqtrader `Financial Status` |
| 비보통주 제외 | `Security Name`에 `Preferred`, `Warrant`, `Unit`, `Right`, `Depositary`, `% Note`, `Trust Preferred`가 포함되면 제외. `Common Stock` / `Ordinary Shares` / `Class [A-Z] Common`만 유지 | nasdaqtrader `Security Name` |
| OTC 제외 | 위 거래소 목록에 없으면 자동 제외 | |
| 운영기업만 | `entityType = "operating"` | SEC submissions |
| Theme 매핑 | `sic-map.yaml`에 SIC가 존재 | §4.3 |
| 시가총액 하한 | ≥ $300M (기본값, 변경 가능) | 주가 × 주식수 |
| SPAC / Shell 제외 | SIC `6770` 제외 + TTM 매출 = 0 & 총자산 대비 현금 > 90% | SEC |
| Closed-end fund 제외 | `entityType` 및 SIC로 제외 | SEC |

### 5.2 예상 규모

```
company_tickers.json                 ~10,000
  → 비보통주·ETF·Test Issue 제외       ~5,500
  → sic-map.yaml Theme 매핑            ~2,000
  → 시가총액 ≥ $300M                   ~1,300
```

구현 시 실측하여 이 문서를 갱신한다.

### 5.3 유동성 필터 — Phase 1 미작동 (알려진 제약)

§2의 "평균 거래대금이 지나치게 작은 종목 제외" 조건은 Finnhub 무료 티어의 `/quote` 응답에 거래량이 포함되지 않아 **Phase 1에서 작동하지 않는다.**

- `market_data.volume` 컬럼과 `config.yaml`의 `min_avg_dollar_volume` 항목은 정의하되 **비활성** 상태로 둔다.
- 그동안의 대체 수단: 시가총액 하한 + nasdaqtrader `Financial Status` + Test Issue 제외.
- 없는 데이터를 0으로 채워 필터가 동작하는 것처럼 보이게 하지 않는다.
- 실제 Finnhub 응답 확인 후 거래량이 없으면 Phase 2에서 별도 소스를 연결한다.

---

## 6. DB 스키마

원칙: **원천 사실과 파생 값을 분리한다.** 파생 값은 재수집 없이 재계산 가능해야 한다. 스코어 로직 변경 시 SEC 재크롤링이 필요하면 설계가 잘못된 것이다.

### 6.1 원천 계층 (덮어쓰지 않음)

```
companies
  cik PK, ticker, name, sic, sic_description, exchange,
  entity_type, fiscal_year_end, filer_category, is_active,
  first_seen, last_updated

listings                                   -- nasdaqtrader 원본
  ticker PK, exchange, security_name, is_etf, is_test_issue,
  financial_status, round_lot, last_updated

financial_facts                            -- 정규화된 XBRL 원시 사실
  cik, tag, unit, period_start, period_end, qtrs, value,
  form, filed_date, accession, source('bulk'|'api')
  UNIQUE(cik, tag, period_end, qtrs, form)

market_data
  cik, date, price, shares_outstanding, market_cap, volume
  PK(cik, date)
```

### 6.2 파생 계층 (전부 재계산 가능)

```
financials
  cik, period_end, period_type('Q'|'A'|'TTM'),
  revenue, gross_profit, operating_income, net_income,
  ocf, capex, fcf, cash, total_debt, equity,
  shares_diluted, sbc, rd_expense,
  source_tags(JSON),                       -- 어떤 XBRL 태그를 썼는지 기록
  computed_at
  PK(cik, period_end, period_type)

company_industry
  cik, industry_id, is_primary, source('sic'|'override')

scores                                     -- append-only
  cik, as_of, tenbagger, completeness, category,
  engine_version
  PK(cik, as_of)

score_factors
  cik, as_of, engine, factor_key, raw, points, weight,
  status('SCORED'|'NO_DATA'|'NOT_IMPLEMENTED'), detail

red_flags
  cik, as_of, code, severity('CRITICAL'|'WARNING'),
  message, evidence(JSON)
```

`scores`는 append-only이며 `latest_scores` 뷰로 현재값을 노출한다. **`score_history`를 별도 테이블로 두지 않는다** — 같은 행을 두 번 쓰면 두 테이블이 어긋날 수 있고, append-only + 뷰가 동일한 기능을 불일치 없이 제공한다.

### 6.3 분류·운영 계층

```
themes       id, slug, name, description, display_order
industries   id, theme_id, slug, name, description,
             tam_usd, tam_cagr, tam_source, tam_as_of
job_runs     id, job, started_at, finished_at, status,
             stats(JSON), error
```

### 6.4 데이터 신선도 (§24)

**별도 테이블을 만들지 않는다.** 기존 타임스탬프에서 유도한다.

| 표시 항목 | 출처 |
|---|---|
| Price updated | `market_data.date` (최신) |
| Financials updated | `financials.computed_at` / `financial_facts.filed_date` |
| Tenbagger Score | `scores.as_of` (최신) |
| TAM | `industries.tam_as_of` |

`STALE` 판정 임계값은 `config.yaml`에 두고 조회 시 계산한다. 중복 저장은 어긋날 수 있으므로 하지 않는다.

### 6.5 Phase 1에서 생성하지 않는 테이블

`valuations`, `valuation_history`, `filings`, `news`, `watchlist` — 해당 Phase에서 마이그레이션으로 추가한다.

---

## 7. 데이터 수집 및 정규화

### 7.1 파이프라인 잡

| 잡 | 명령 | 주기(§23) | 내용 |
|---|---|---|---|
| `ingest-universe` | `npm run pipeline:universe` | 주간 | nasdaqtrader + company_tickers + submissions → `companies`, `listings`, `company_industry` |
| `ingest-fundamentals` | `npm run pipeline:fundamentals` | 분기 / 이벤트 | 벌크 ZIP + companyfacts → `financial_facts` → `financials` |
| `refresh-prices` | `npm run pipeline:prices` | 일간 | Finnhub → `market_data` |
| `compute-scores` | `npm run pipeline:scores` | 주간 | → `scores`, `score_factors`, `red_flags` |
| 전체 | `npm run pipeline:all` | | 위 4개 순차 실행 |

모든 잡은 `job_runs`에 시작·종료·처리 건수·실패 건수를 기록한다. 부분 실패는 잡 전체를 중단시키지 않되 `stats`에 실패 CIK 목록을 남겨 재시도 가능하게 한다.

### 7.2 벌크 ZIP 파싱

`financial-statement-data-sets/YYYYqQ.zip` 구조: `sub.txt`(제출), `num.txt`(수치), `pre.txt`(표시), `tag.txt`.

- `num.txt` 필드: `adsh, tag, version, coreg, ddate, qtrs, uom, value`
- `qtrs = 0` → 시점 값(재무상태표), `qtrs = 1` → 분기 구간, `qtrs = 4` → 연간 구간
- **파싱 중 유니버스 CIK로 필터링한다.** 분기당 약 1,000만 행 전체를 적재하지 않는다.
- 10-K에 전년 비교치가 포함되므로 최근 **8개 분기**(~1GB) 만으로 대부분 기업의 5년 이력이 확보된다. 분기 수는 `config.yaml`에서 조정 가능.

### 7.3 Q4 재구성

10-K는 연간 값만 보고하고 4분기 값을 따로 내지 않는 경우가 많다. 유량(flow) 항목에 한해 다음으로 유도한다.

```
Q4 = 연간(qtrs=4) − Q1 − Q2 − Q3
```

유도된 값은 `financials.source_tags`에 `derived: "Q4_from_annual"`로 표시한다.

### 7.4 XBRL 태그 폴백 체인

첫 번째로 값이 존재하는 태그를 사용하고, **어떤 태그를 썼는지 `source_tags`에 기록한다.**

| 항목 | 폴백 순서 |
|---|---|
| Revenue | `RevenueFromContractWithCustomerExcludingAssessedTax` → `Revenues` → `SalesRevenueNet` → `RevenueFromContractWithCustomerIncludingAssessedTax` |
| Gross Profit | `GrossProfit` → Revenue − (`CostOfRevenue` \| `CostOfGoodsAndServicesSold`) |
| Operating Income | `OperatingIncomeLoss` |
| Net Income | `NetIncomeLoss` |
| Operating Cash Flow | `NetCashProvidedByUsedInOperatingActivities` → `...ContinuingOperations` |
| Capex | `PaymentsToAcquirePropertyPlantAndEquipment` → `PaymentsToAcquireProductiveAssets` |
| Cash | `CashAndCashEquivalentsAtCarryingValue` (+ `ShortTermInvestments`) |
| Total Debt | `LongTermDebtNoncurrent` + `LongTermDebtCurrent` → `DebtCurrent` |
| Equity | `StockholdersEquity` |
| Diluted Shares | `WeightedAverageNumberOfDilutedSharesOutstanding` |
| Shares Outstanding | `dei:EntityCommonStockSharesOutstanding` |
| SBC | `ShareBasedCompensation` |
| R&D | `ResearchAndDevelopmentExpense` |

### 7.5 TTM 계산

- 유량 항목(revenue, gross_profit, operating_income, net_income, ocf, capex, sbc, rd): 최근 4개 분기 합
- 시점 항목(cash, total_debt, equity, shares_outstanding): 최근 분기 값
- `fcf = ocf − capex`
- 4개 분기가 모두 없으면 TTM 행을 만들지 않는다. 부족한 분기를 0으로 채우지 않는다.

### 7.6 시가총액

```
market_cap = price(Finnhub) × shares_outstanding(SEC dei 태그)
```

---

## 8. 스코어링 엔진

### 8.1 팩터 계약

```ts
type FactorResult = {
  key: string
  weight: number                                    // 만점
  points: number | null                             // null = 채점 불가
  raw: number | null                                // 원시 지표 (UI 표시)
  status: 'SCORED' | 'NO_DATA' | 'NOT_IMPLEMENTED'
  detail: string                                    // "TTM 매출 +38% (3Y CAGR +31%)"
}
```

**결측을 0점으로 처리하지 않는다.** 채점된 팩터의 가중치로만 정규화한다.

```
score        = 100 × Σpoints / Σ(weight where status = 'SCORED')
completeness = Σ(weight where status = 'SCORED') / Σ(weight where status ≠ 'NOT_IMPLEMENTED')
```

`NOT_IMPLEMENTED`와 `NO_DATA`를 구분하는 이유: `NOT_IMPLEMENTED`는 모든 기업에 균일하게 적용되어 상대 순위를 왜곡하지 않으므로 `completeness` 분모에서 제외한다. `NO_DATA`는 해당 기업만의 결함이므로 `completeness`를 떨어뜨린다.

`completeness < 0.6` → `INSUFFICIENT DATA` 배지, 기본 랭킹에서 제외(필터로 표시 가능).

### 8.2 점수 곡선

`config.yaml`에 구간 선형보간 곡선으로 정의한다. 코드가 아닌 데이터로 두면 리밸런싱이 git diff에 남고, `scores` 이력과 대조해 "가중치를 바꿔서 오른 것인지 기업이 좋아져서 오른 것인지" 구분할 수 있다.

```yaml
scoring:
  revenue_growth:
    weight: 20
    blend: { ttm_yoy: 0.6, cagr_3y: 0.4 }
    curve: [[-0.10, 0.00], [0.00, 0.10], [0.15, 0.35],
            [0.25, 0.60], [0.40, 0.85], [0.60, 1.00]]
```

곡선 함수는 구간 사이를 선형보간하고, 양 끝을 벗어나면 끝값으로 고정(clamp)한다.

### 8.3 Tenbagger Score 팩터 정의 (§6)

| # | 팩터 | 배점 | Phase 1 | 계산식 |
|---|---|---|---|---|
| 1 | Revenue Growth | 20 | ✅ | `ttm_yoy = TTM_rev / TTM_rev(4Q전) − 1`<br>`cagr_3y = (TTM_rev / rev(12Q전))^(1/3) − 1`<br>블렌드 0.6 / 0.4. `cagr_3y`가 없으면 `ttm_yoy` 단독, 상태는 `SCORED` |
| 2 | Revenue Acceleration | 10 | ✅ | `최근 2개 분기 YoY 평균 − 직전 2개 분기 YoY 평균` |
| 3 | TAM / Industry Growth | 15 | ✅ | `0.6 × curve(산업 성장률) + 0.4 × curve_penetration(침투율)`<br>`침투율 = TTM_rev / industry.tam_usd`<br>**침투율 곡선은 감소 함수**: 이미 TAM을 상당 부분 점유했으면 남은 성장 여지가 작다<br>`[[0, 1.0], [0.05, 1.0], [0.15, 0.8], [0.30, 0.5], [0.50, 0.2], [1.0, 0.0]]` |

**개정 (2026-08-09, 구현 계획 수립 중) — TAM 대체값.** §4.4에 따라 `industries.yaml`의 TAM은 출처 없이 채우지 않으므로 초기값이 전부 `null`이다. 이 상태에서 팩터가 `NO_DATA`로 빠지면 15점이 통째로 사라져 상대 순위가 왜곡된다.

따라서 산업 성장률을 다음 우선순위로 정한다.

1. `industry.tam_cagr` (큐레이션된 값)
2. 없으면 **해당 산업 후보들의 매출 성장률 중앙값** (`industryStats.medianRevenueGrowth`)

대체값은 우리 데이터로 계산되므로 첫 실행부터 동작하고, TAM을 큐레이션하면 자동으로 그 값이 우선한다. 어느 쪽을 썼는지 `FactorResult.detail`에 명시해 화면에서 구분할 수 있게 한다. `tam_usd`가 없으면 침투율 항을 빼고 성장률 항만으로 채점한다.
| 4 | Gross Margin | 10 | ✅ | `0.6 × curve(TTM GM) + 0.4 × curve(8분기 GM 기울기)`<br>기울기는 OLS, 연율 bps |
| 5 | Operating Leverage | 10 | ✅ | `0.5 × curve(Δ영업이익률, pp) + 0.5 × curve(매출증가율 − opex증가율)`<br>`opex = 매출총이익 − 영업이익` |
| 6 | Market Cap Opportunity | 15 | ✅ | §8.4 |
| 7 | Competitive Advantage | 10 | ✅ 프록시 | §8.5 |
| 8 | Balance Sheet | 5 | ✅ | TTM FCF ≥ 0 → `0.6 × curve((현금 − 총부채) / 시가총액) + 0.4 × curve(−Debt/EBITDA)`<br>TTM FCF < 0 → `curve(현금 런웨이 분기수)` 단독<br>두 경로는 배타적이며 어느 쪽이 적용됐는지 `detail`에 기록 |
| 9 | Institutional / Insider | 5 | ❌ | `NOT_IMPLEMENTED`. 13F·Form 4 파싱 → Phase 4 |

모든 유량 지표는 TTM 기준이다. `scores.engine_version`은 `엔진 코드 버전 + config.yaml 내용 해시`로 기록하여, 점수 변화가 로직 변경 때문인지 데이터 변경 때문인지 구분할 수 있게 한다.

**5Y CAGR은 데이터가 있을 때만 표시한다.** 벌크 ZIP 8개 분기에서 확보되는 연간 이력은 기업마다 다르므로(10-K 손익계산서가 통상 3개 연도 비교치를 포함) 5년치가 없는 기업은 해당 항목을 `null`로 두고 UI에서 생략한다.

Phase 1 실효 만점은 95점이며 100점으로 정규화된다. 모든 기업에 동일 적용되므로 상대 순위는 왜곡되지 않는다.

### 8.4 Market Cap Opportunity (§7)

기본 구간표:

| 시가총액 | 점수 |
|---|---|
| < $1B | 15 |
| $1B ~ $3B | 14 |
| $3B ~ $10B | 12 |
| $10B ~ $30B | 8 |
| $30B ~ $100B | 4 |
| ≥ $100B | 1 |

§7이 지적한 "작을수록 무조건 고득점" 문제를 **승수**로 해결한다.

```
points = 구간표점수 × gate

gate = 0.0   ← TTM 매출 성장률 < 0  또는  TTM 매출 < $10M
       0.5   ← WARNING 등급 Red Flag 보유
       1.0   ← 그 외
```

매출이 감소 중인 시가총액 $500M 기업은 15점이 아니라 0점을 받는다. 곱셈이므로 사유가 명확하며 `detail` 문자열에 gate 사유를 기록한다. 임계값은 전부 `config.yaml`에 있다.

### 8.5 Competitive Advantage 프록시 (10점 = 2.5점 × 4)

정성 평가를 SEC 수치로 대체한다. 각 하위 신호는 독립적으로 `NO_DATA`가 될 수 있다.

| 신호 | 대응하는 Moat 요소 | 계산 |
|---|---|---|
| ROIC 스프레드 | 종합 | `ROIC − WACC가정(9%, config)`<br>`ROIC = TTM 영업이익 × (1 − 0.21) / (총부채 + 자본총계 − 현금)`<br>투하자본 ≤ 0 이면 `NO_DATA` |
| GM 변동성 | 전환비용 / 무형자산 | `1 − (8분기 GM 표준편차 / 8분기 GM 평균)` — 낮은 변동성이 고득점<br>8분기 미만이면 `NO_DATA` |
| 산업 대비 GM | 비용우위 / 무형자산 | `기업 TTM GM − 산업 중앙값 GM` |
| R&D 집약도 | 무형자산 축적 | `TTM R&D / TTM 매출` |

**산업 중앙값의 정의**: 해당 Industry의 **후보 유니버스 전체**(Leader 포함, `completeness ≥ 0.6`인 기업)에 대한 중앙값. 후보가 3개 미만인 Industry는 중앙값이 무의미하므로 이 신호를 `NO_DATA`로 처리한다. §8.6의 산업 백분위도 동일한 모집단과 최소 개수 조건을 따른다.

**이것은 Moat 분석이 아니다.** 정식 Economic Moat(§12: Network Effect / Switching Cost / Intangible / Cost Advantage / Efficient Scale와 Wide/Narrow/None/Potential 분류)는 Phase 3이다. UI에서 이 팩터를 "Moat"로 표기하지 않는다.

### 8.6 산업 백분위

각 팩터의 원시 지표에 대해 **산업 내 백분위**를 계산하여 `score_factors`에 저장하고 UI에 표시한다. **Phase 1의 점수 계산에는 반영하지 않는다.**

절대 곡선과 백분위를 어떤 비율로 섞을지는 실제 점수 분포를 본 뒤 Phase 2에서 결정한다. 데이터 없이 가중치를 정하는 것은 튜닝이 아니라 추측이다.

---

## 9. Quality Gate (§8)

`CRITICAL` 발생 시 `RED FLAG` 배지를 표시하되 **Tenbagger Score는 그대로 계산하여 보여준다**(§8 요구사항). Hidden Gem 후보(Phase 2)에서만 제외된다.

### CRITICAL

| 코드 | 조건 |
|---|---|
| `REVENUE_DECLINE_2Y` | 2년 연속 연간 매출 감소 |
| `NEGATIVE_EQUITY_BURN` | 자본총계 < 0 **그리고** TTM FCF < 0 |
| `RUNWAY_CRITICAL` | 현금 런웨이 < 2분기 |
| `EXTREME_DILUTION` | 희석주식수 전년 대비 +50% 초과 |

### WARNING

| 코드 | 조건 |
|---|---|
| `GM_COLLAPSE` | TTM GM이 전년 대비 500bp 초과 하락 |
| `SBC_EXCESSIVE` | TTM SBC / TTM 매출 > 25% |
| `DILUTION` | 희석주식수 전년 대비 +15% 초과 |
| `LEVERAGE_HIGH` | 총부채 / TTM EBITDA > 5 |
| `RUNWAY_LOW` | 현금 런웨이 < 6분기 |

`현금 런웨이(분기) = 현금 / (직전 4분기 평균 분기 FCF 소모액)`. FCF ≥ 0이면 해당 없음.

### Phase 1에서 판정 불가

§8의 **Going Concern Risk**, **고객 집중도**, **단일 제품 의존**, **회계 red flag**는 XBRL 표준 태그로 안정적으로 포착되지 않는다. 10-K 본문 파싱이 필요하므로 **Phase 4**로 미룬다. Red Flag 코드 체계는 지금 정의하므로 이후 규칙만 추가하면 된다.

---

## 10. Leader / Challenger / Emerging (§4)

스펙의 Challenger($2B~$30B)와 Emerging($300M~$5B) 구간이 겹친다. 결정론적으로 해소한다. 모든 임계값은 `config.yaml`에 있다.

```
Leader:
  산업 내 시가총액 내림차순 정렬
  시가총액 ≥ (산업 최대 시가총액 × 0.25) 인 기업
  최대 5개, 최소 2개 (상위 2개는 조건과 무관하게 Leader)
  후보가 2개 이하인 Industry는 Leader를 지정하지 않는다
    — 2개짜리 산업에서 "상위 2개"는 정보가 아니다.
      이 경우 전원을 시가총액 기준 Challenger/Emerging 규칙으로 분류한다

비-Leader:
  시가총액 < $2B                  → Emerging
  $2B ≤ 시가총액 < $5B            → TTM 영업이익 ≤ 0  또는  TTM 매출 < $500M
                                     이면 Emerging, 아니면 Challenger
  $5B ≤ 시가총액 ≤ $30B           → Challenger
  시가총액 > $30B                 → Challenger
```

Leader는 Tenbagger 후보가 아니라 **Industry Benchmark 역할**이다(§4-A). UI에서 이를 명시한다.

---

## 11. 화면 구조

**종목 수를 인위적으로 제한하지 않는다**(§5). Screening을 통과한 기업은 전부 Candidate Universe에 포함되며, 가독성을 위해 초기에는 그룹별 상위 10개만 표시하고 `View All Candidates`로 전체를 연다.

### 11.1 Growth Opportunity Map (홈, §17)

Theme 6개 섹션(접기/펴기) 아래 Industry 행. 컬럼: Theme, Industry, Candidate Count, Median Revenue Growth, Median Market Cap, Average Tenbagger Score, Top Candidate, Industry Momentum, Industry Risk.

Phase 1 정의:

- **Industry Momentum** = 해당 산업 후보들의 **매출 가속도 중앙값**. §26의 스코어 변화율은 최소 4주 이력이 필요하므로 Phase 2에서 대체한다.
- **Industry Risk** = CRITICAL Red Flag 보유 비율 + 현금 런웨이 중앙값

별도의 Theme 페이지는 만들지 않는다. Map의 Theme 섹션이 그 역할을 한다.

### 11.2 Industry 페이지 (§18)

Leader / Challenger / Emerging 3개 그룹, 각 그룹 내 Tenbagger Score 내림차순.

Phase 1 컬럼: Ticker, Company, Category, Market Cap, Revenue Growth YoY, Revenue Growth 3Y CAGR, Gross Margin, FCF Margin, Debt, Tenbagger Score, Risk.

§18의 Discovery Score / Quality Score / Moat / Current Price / Fair Value / Price-FV는 Phase 2~3 항목이다. **대시로 채운 빈 컬럼을 만들지 않는다.** 해당 Phase에서 컬럼 정의를 추가한다.

### 11.3 Stock Detail 페이지 (§19)

Phase 1에서 렌더링하는 섹션:

- **Overview** — Company, Ticker, Industry, Theme, Category, Market Cap, SIC 설명, 분류 출처(sic/override)
- **Growth** — Revenue Growth YoY, 3Y CAGR, 5Y CAGR, 분기별 매출 추이, Revenue Acceleration
- **Quality 지표** — Gross Margin, Operating Margin, FCF Margin, ROIC, Cash, Debt, Share Dilution (지표만. Quality **Score**는 Phase 2)
- **Tenbagger Analysis** — 이 화면의 핵심. 9개 팩터를 막대로 나열하고 각 팩터의 `points / weight`, 원시 지표, `detail` 문자열, 산업 백분위를 함께 표시. Strength / Weakness는 점수 상위·하위 3개 팩터에서 자동 생성
- **Risks** — Red Flag 목록(severity, message, evidence)
- **Data Freshness** — §6.4의 항목별 갱신 시각, 임계값 초과 시 `STALE`

**Moat / Valuation / Catalysts 섹션은 Phase 3까지 렌더링하지 않는다.** 빈 골격을 미리 깔면 완성된 것처럼 보이지만 실제로는 아무것도 없다.

### 11.4 시각 방향 (§30)

Bloomberg Terminal 수준의 복잡도를 지향하지 않는다. 정보 밀도는 높게, 핵심 숫자는 즉시 파악 가능하게.

- 다크 테마 기반
- 숫자는 tabular numeral 고정폭 정렬
- 장식(그라디언트·그림자·불필요한 보더) 없음
- 색은 의미가 있을 때만: Green=긍정, Red=위험, Yellow=관찰, Blue=정보, Purple=Emerging/Discovery
- 점수는 색이 아니라 **위치와 굵기로 먼저** 구분하고 색은 보조로 사용

---

## 12. 디렉터리 구조

```
config.yaml                 # 유니버스 필터, 분류 임계값, 스코어 가중치·곡선,
                            # Red Flag 임계값, STALE 임계값 — 전부 여기 한 곳

taxonomy/
  themes.yaml
  industries.yaml           # + TAM, TAM CAGR, source, as_of
  sic-map.yaml              # SIC → { theme, default_industry }
  company-overrides.yaml    # ticker → { theme?, industry? }

src/
  domain/                   # 순수 타입 + 계산 헬퍼 (CAGR, TTM, 마진, 곡선보간)
                            # 외부 의존성 0
  providers/
    types.ts                # 인터페이스만
    http/client.ts          # rate limit · 재시도 · 디스크 캐시 · User-Agent
    listing/nasdaq-trader.ts
    reference/sec-submissions.ts
    fundamental/sec-bulk.ts, sec-companyfacts.ts, normalizer.ts
    price/finnhub.ts, fixture.ts, index.ts   # index.ts는 env 값 읽는 함수 하나
  engines/
    tenbagger/              # index.ts + factors/*.ts
    quality/                # Quality Gate · Red Flag
    classify/               # Leader / Challenger / Emerging
  db/
    schema.ts, client.ts, migrations/, repositories/
  pipeline/
    jobs/ingest-universe.ts, ingest-fundamentals.ts,
         refresh-prices.ts, compute-scores.ts
    snapshot.ts             # DB → CompanySnapshot 조립
    runner.ts               # job_runs 기록, CLI 진입점
  app/                      # Next.js App Router
    page.tsx                # Growth Opportunity Map
    industry/[slug]/page.tsx
    stock/[ticker]/page.tsx
    _components/

tests/
  engines/                  # TDD 대상
  providers/                # 녹화된 HTTP fixture
  fixtures/
```

### 12.1 핵심 아키텍처 규칙

**`src/engines/`는 `src/db/`와 `src/providers/`를 import하지 않는다.**

엔진은 `CompanySnapshot` 하나를 받아 점수를 반환하는 순수 함수 집합이다. 이 경계가 §28의 "Provider 교체 시 전체 수정 방지"를 실제로 보장하고, 엔진을 네트워크 없이 단위 테스트할 수 있게 한다. **문서가 아니라 테스트로 강제한다**(§14).

```ts
type CompanySnapshot = {
  cik: number
  ticker: string
  name: string
  themeSlug: string
  industrySlug: string
  industry: IndustryMeta          // tam_usd, tam_cagr 포함
  marketCap: number | null
  price: PricePoint | null
  ttm: FinancialPeriod | null
  annual: FinancialPeriod[]       // 최근 순
  quarterly: FinancialPeriod[]    // 최근 순
  industryStats: IndustryStats    // 백분위 계산용
  asOf: string
}
```

---

## 13. 에러 처리

- **Provider 계층** — 타입이 있는 에러, 지수 백오프 재시도, SEC 초당 10요청 준수. 잡 단위 부분 실패를 허용하고 `job_runs.stats`에 실패 CIK를 기록
- **결측 재무 태그** — §7.4 폴백 체인. 모두 실패하면 `null`을 저장하고 어떤 태그도 찾지 못했음을 `source_tags`에 기록
- **엔진** — `null`을 조용히 `0`으로 변환하지 않는다. `FactorResult.status`로 명시
- **UI** — `STALE` 배지(§6.4), `INSUFFICIENT DATA` 배지(`completeness < 0.6`), `RED FLAG` 배지(§9)
- **설정 검증** — `config.yaml`과 `taxonomy/*.yaml`은 zod 스키마로 로드 시점에 검증. 잘못된 설정은 파이프라인 시작 전에 실패

---

## 14. 테스트 전략

TDD로 진행한다. 엔진이 순수 함수이므로 테스트가 자연스럽다.

### 엔진 단위 테스트 — 4가지 고정 픽스처

| 픽스처 | 검증 내용 |
|---|---|
| 초기 텐배거 패턴 (고성장·고마진·소형) | 높은 Tenbagger Score |
| 밸류 트랩 (매출 감소 소형주) | 낮은 점수. Market Cap Opportunity gate = 0 동작 확인 |
| 메가캡 (펀더멘털 우수, 시총 $100B+) | Market Cap Opportunity 1점 확인 |
| 결측 데이터 기업 | rescale 및 `completeness` 계산, `INSUFFICIENT DATA` 판정 |

### 그 외

- **Provider 계약 테스트** — 실제 SEC / Finnhub / nasdaqtrader 응답을 녹화해 픽스처로 저장. CI에서 네트워크 불필요
- **아키텍처 테스트** — `src/engines/**`가 `src/db` 또는 `src/providers`를 import하면 실패
- **매핑 커버리지 테스트** — 유니버스의 모든 SIC 코드가 `sic-map.yaml`에 있거나 명시적 `unmapped` 목록에 있어야 통과. 기본 버킷 비율을 리포트로 출력
- **정규화 테스트** — Q4 재구성, TTM 합산, 태그 폴백 체인
- **파이프라인 스모크 테스트** — 20종목 픽스처 유니버스로 ingest → score 전 구간 실행

---

## 15. Phase 1 완료 기준

```bash
npm run db:migrate
npm run pipeline:all      # universe → fundamentals → prices → scores
npm run dev
```

이 세 명령으로 **실제 SEC 데이터가 들어간** 대시보드가 뜨고, 3개 화면(Map / Industry / Stock Detail)을 실제 티커로 탐색할 수 있으면 완료다.

**Mock 데이터는 테스트 경로에만 존재하고 기본 실행 경로에는 없다.**

추가 검증:

- 전체 테스트 통과 (`npm test`)
- 유니버스 규모가 §5.2 추정과 크게 다르지 않음. 다르면 원인 확인 후 문서 갱신
- 상위 20개 후보를 육안 검토하여 명백한 부실주가 상위에 없음
- 알려진 기업 몇 개(예: NVDA, PANW)의 재무 수치를 실제 10-K와 대조

예상 소요: universe 약 10분(SEC 초당 10요청), fundamentals 약 1GB 다운로드 + 파싱, prices 약 25분(Finnhub 분당 60호출). 이후 일일 갱신은 시세만이므로 약 25분.

---

## 16. 알려진 제약과 가정

| 항목 | 내용 |
|---|---|
| 유동성 필터 | Finnhub 무료 티어에 거래량이 없어 Phase 1 미작동 (§5.3) |
| Finnhub 응답 형식 | 실제 키 발급 후 확인 필요. 거래량 부재 시 Phase 2에서 별도 소스 |
| Industry 분류 정확도 | 오버라이드가 없는 기업은 SIC 기본 버킷. 초기 커버리지 약 400 티커 (§4.3) |
| TAM 데이터 | 수동 큐레이션. 출처와 기준일을 반드시 기록 (§4.4) |
| Competitive Advantage | 재무 프록시이며 Economic Moat 분석이 아님 (§8.5) |
| Institutional / Insider 팩터 | Phase 4까지 `NOT_IMPLEMENTED` |
| Going Concern · 고객 집중도 | 10-K 본문 파싱 필요. Phase 4 |
| 회계 기준 | US-GAAP 태그만 사용. IFRS 신고 외국기업은 커버리지가 낮을 수 있음 |
| 분기 벌크 데이터 지연 | 분기 종료 후 약 1개월. 최신 실적은 `companyfacts` 증분이 담당 |

---

## 17. 후속 Phase 개요 (참고)

| Phase | 내용 |
|---|---|
| 2 | Discovery Score, Quality Score, Growth Quality Matrix, Hidden Gem Radar, Candidate Radar, Watchlist, Score History 차트, Rising / Deteriorating Candidate |
| 3 | Economic Moat 분석(5요소, Wide/Narrow/None/Potential), DCF Fair Value(Bull/Base/Bear), Uncertainty Score, Risk Engine, Financial Strength, Capital Allocation |
| 4 | SEC Filing 통합(10-Q/10-K/8-K), News, Earnings 이벤트 감지, 13F·Form 4 파싱, 자동 갱신, Alert |
```
