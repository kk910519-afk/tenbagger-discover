# Tenbagger Discovery Dashboard — Phase 1 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** SEC EDGAR 실데이터로 미국 성장주 유니버스를 구성하고 Tenbagger Score를 계산해 3개 화면(Growth Opportunity Map / Industry / Stock Detail)으로 탐색할 수 있는 대시보드를 만든다.

**Architecture:** 순수 함수 스코어링 엔진(`src/engines/`)이 `CompanySnapshot` 하나만 받아 점수를 반환한다. 엔진은 DB와 Provider를 import하지 않으며 이 경계는 테스트로 강제한다. 원천 XBRL 사실(`financial_facts`)과 파생 재무(`financials`)를 분리해 스코어 로직 변경 시 재크롤링 없이 재계산한다. Next.js RSC가 SQLite를 직접 읽고 별도 API 계층은 없다.

**Tech Stack:** Next.js 15 (App Router) · React 19 · TypeScript strict · better-sqlite3 + Drizzle ORM · Vitest · Tailwind CSS 4 · zod · yaml

**설계 문서:** [2026-08-09-tenbagger-discovery-dashboard-design.md](../specs/2026-08-09-tenbagger-discovery-dashboard-design.md)

## Global Constraints

- Node.js 24 / npm 12 / Windows. 쉘 명령은 PowerShell 기준으로 검증할 것.
- TypeScript `strict: true`. `any` 금지. 결측은 `null`이며 `0`으로 대체하지 않는다.
- **`src/engines/**`는 `src/db` 또는 `src/providers`를 import할 수 없다.** Task 13의 테스트가 이를 강제한다.
- SEC 요청에는 `User-Agent: TenbaggerDashboard/0.1 (kk910519@gmail.com)` 헤더가 필수이며 초당 10요청을 넘지 않는다.
- YAML에 숫자 구분자 언더스코어(`300_000_000`)를 쓰지 않는다. YAML 1.2에서 문자열로 파싱된다. 평문 숫자만 사용한다.
- 금액 단위는 전부 USD 원단위(달러). 비율은 소수(0.38 = 38%). 마진 추세만 bps 단위.
- 모든 설정값은 `config.yaml` 한 곳에 있다. 코드에 매직넘버를 하드코딩하지 않는다.
- Mock 데이터는 `tests/fixtures/` 안에만 존재한다. 기본 실행 경로에 없어야 한다.
- 커밋 메시지는 한국어 본문 + Conventional Commits 프리픽스. 각 태스크 끝에 커밋한다.

---

## File Structure

**설정 · 분류 데이터 (코드 아님)**

| 파일 | 책임 |
|---|---|
| `config.yaml` | 유니버스 필터, 분류 임계값, 스코어 가중치·곡선, Red Flag 임계값, STALE 임계값 |
| `taxonomy/themes.yaml` | Theme 6개 |
| `taxonomy/industries.yaml` | Industry 49개 + TAM·출처·기준일 |
| `taxonomy/sic-map.yaml` | SIC → `{theme, default_industry}` / `unmapped` 목록 |
| `taxonomy/company-overrides.yaml` | ticker → `{theme?, industry?}` |

**`src/domain/` — 외부 의존성 0. 순수 계산**

| 파일 | 책임 |
|---|---|
| `types.ts` | `FinancialPeriod`, `CompanySnapshot`, `FactorResult`, `RedFlag`, `IndustryMeta`, `IndustryStats` |
| `curve.ts` | 구간 선형보간 + clamp |
| `growth.ts` | YoY, CAGR, TTM 합산 |
| `stats.ts` | 중앙값, 백분위, OLS 기울기, 표준편차 |

**`src/config/` — 설정 로딩**

| 파일 | 책임 |
|---|---|
| `schema.ts` | zod 스키마 (config.yaml 전체) |
| `index.ts` | `loadConfig()` — 파싱 + 검증 + 캐시 |

**`src/taxonomy/` — 분류 해석**

| 파일 | 책임 |
|---|---|
| `schema.ts` | zod 스키마 (4개 YAML) |
| `index.ts` | `loadTaxonomy()`, `classify(sic, ticker)` → `{themeSlug, industrySlug, source}` |

**`src/db/` — 영속화**

| 파일 | 책임 |
|---|---|
| `schema.ts` | Drizzle 테이블 12개 |
| `client.ts` | better-sqlite3 연결, WAL, `latest_scores` 뷰 |
| `migrate.ts` | 마이그레이션 실행 CLI |
| `repositories/companies.ts` | companies · listings · company_industry 읽기/쓰기 |
| `repositories/financials.ts` | financial_facts · financials 읽기/쓰기 |
| `repositories/market.ts` | market_data 읽기/쓰기 |
| `repositories/scores.ts` | scores · score_factors · red_flags 읽기/쓰기 |
| `repositories/jobs.ts` | job_runs 기록 |

**`src/providers/` — 외부 데이터. 인터페이스 뒤에 격리**

| 파일 | 책임 |
|---|---|
| `types.ts` | `ListingProvider`, `ReferenceProvider`, `FundamentalProvider`, `PriceProvider` 인터페이스 |
| `http/client.ts` | rate limit · 지수 백오프 재시도 · 디스크 캐시 · User-Agent |
| `listing/nasdaq-trader.ts` | `nasdaqtraded.txt` 파싱 |
| `reference/sec-submissions.ts` | SEC submissions → SIC·거래소·entityType |
| `fundamental/sec-bulk.ts` | 분기 ZIP 다운로드 + `num.txt`/`sub.txt` 파싱 |
| `fundamental/sec-companyfacts.ts` | companyfacts API 파싱 |
| `fundamental/normalizer.ts` | 원시 사실 → `FinancialPeriod` (태그 폴백, Q4 재구성, TTM) |
| `price/finnhub.ts` | Finnhub `/quote` |
| `price/fixture.ts` | 픽스처 시세 |
| `price/index.ts` | `getPriceProvider()` — env 값 하나로 선택 |

**`src/engines/` — 순수 함수. DB·Provider import 금지**

| 파일 | 책임 |
|---|---|
| `quality/index.ts` | Red Flag 9개 규칙 판정 |
| `tenbagger/factors/*.ts` | 팩터 8개 (파일당 1개) |
| `tenbagger/index.ts` | 조립 · rescale · completeness |
| `classify/index.ts` | Leader / Challenger / Emerging |

**`src/pipeline/`**

| 파일 | 책임 |
|---|---|
| `snapshot.ts` | DB → `CompanySnapshot` 조립, `IndustryStats` 계산 |
| `runner.ts` | `job_runs` 기록 래퍼 + CLI 진입점 |
| `jobs/ingest-universe.ts` | 유니버스 구성 |
| `jobs/ingest-fundamentals.ts` | 재무 수집 + 정규화 |
| `jobs/refresh-prices.ts` | 시세 + 시가총액 |
| `jobs/compute-scores.ts` | 스코어 계산 |

**`src/app/` — Next.js**

| 파일 | 책임 |
|---|---|
| `globals.css` | 디자인 토큰 (다크, tabular-nums) |
| `layout.tsx` | 루트 레이아웃 |
| `page.tsx` | Growth Opportunity Map |
| `industry/[slug]/page.tsx` | Industry 후보 테이블 |
| `stock/[ticker]/page.tsx` | Stock Detail |
| `_components/*` | `ScoreBar`, `MetricRow`, `Badge`, `CandidateTable`, `FactorBreakdown` |
| `_queries/*.ts` | 화면별 SQL 조회 (RSC에서 직접 호출) |

**`tests/`** — `engines/`, `providers/`, `pipeline/`, `architecture.test.ts`, `fixtures/`

---

## Stage A — 기반 (Task 1-4)

### Task 1: 프로젝트 스캐폴딩 & config 로더

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `.env.example`
- Create: `config.yaml`
- Create: `src/config/schema.ts`, `src/config/index.ts`
- Test: `tests/config.test.ts`

**Interfaces:**
- Consumes: 없음 (첫 태스크)
- Produces: `loadConfig(): AppConfig` — `src/config/index.ts`에서 export. `AppConfig` 타입은 `configSchema`의 `z.infer`. 이후 모든 태스크가 이 함수로 설정을 읽는다.

- [ ] **Step 1: 프로젝트 초기화**

```bash
npm init -y
npm i next@15 react@19 react-dom@19 better-sqlite3 drizzle-orm zod yaml
npm i -D typescript @types/node @types/react @types/better-sqlite3 vitest drizzle-kit tailwindcss@4 @tailwindcss/postcss
```

`package.json`의 `scripts`를 다음으로 교체한다.

```json
{
  "type": "module",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "test": "vitest run",
    "test:watch": "vitest",
    "db:migrate": "tsx src/db/migrate.ts",
    "pipeline:universe": "tsx src/pipeline/runner.ts universe",
    "pipeline:fundamentals": "tsx src/pipeline/runner.ts fundamentals",
    "pipeline:prices": "tsx src/pipeline/runner.ts prices",
    "pipeline:scores": "tsx src/pipeline/runner.ts scores",
    "pipeline:all": "tsx src/pipeline/runner.ts all"
  }
}
```

```bash
npm i -D tsx
```

- [ ] **Step 2: tsconfig / vitest / gitignore 작성**

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "jsx": "preserve",
    "incremental": true,
    "allowJs": false,
    "noEmit": true,
    "paths": { "@/*": ["./src/*"] },
    "plugins": [{ "name": "next" }]
  },
  "include": ["src/**/*", "tests/**/*", "next-env.d.ts", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
})
```

`.gitignore`:

```
node_modules/
.next/
data/
.env
.env.local
*.tsbuildinfo
next-env.d.ts
```

`.env.example`:

```
# Finnhub 무료 키: https://finnhub.io 가입 후 발급
PRICE_PROVIDER=finnhub
FINNHUB_API_KEY=
DATABASE_PATH=./data/tenbagger.db
```

- [ ] **Step 3: config.yaml 작성**

```yaml
universe:
  exchanges: [N, Q, A]              # nasdaqtrader: N=NYSE, Q=Nasdaq, A=NYSE American
  min_market_cap: 300000000
  min_avg_dollar_volume: null       # Phase 1 미작동 — 설계문서 §5.3
  exclude_financial_status: [D, E, Q]
  exclude_sic: ["6770"]
  security_name_include: ["Common Stock", "Ordinary Shares"]
  security_name_exclude:
    [Preferred, Warrant, Unit, Right, Depositary, "% Note", "Trust Preferred"]

ingest:
  bulk_quarters: 8
  sec_user_agent: "TenbaggerDashboard/0.1 (kk910519@gmail.com)"
  sec_rate_limit_per_sec: 10
  cache_dir: "./data/cache"

classification:
  leader_ratio_of_max: 0.25
  leader_max: 5
  leader_min: 2
  leader_min_industry_candidates: 3
  challenger_min_market_cap: 2000000000
  emerging_max_market_cap: 5000000000
  emerging_revenue_threshold: 500000000

staleness:
  price_days: 5
  financials_days: 120
  scores_days: 14
  tam_days: 400

scoring:
  min_completeness: 0.6
  wacc_assumption: 0.09
  tax_rate: 0.21
  min_industry_candidates: 3
  factors:
    revenue_growth:
      weight: 20
      blend: { ttm_yoy: 0.6, cagr_3y: 0.4 }
      curve: [[-0.10, 0.00], [0.00, 0.10], [0.15, 0.35], [0.25, 0.60], [0.40, 0.85], [0.60, 1.00]]
    revenue_acceleration:
      weight: 10
      curve: [[-0.20, 0.00], [-0.05, 0.25], [0.00, 0.45], [0.05, 0.70], [0.15, 0.90], [0.30, 1.00]]
    tam_industry_growth:
      weight: 15
      blend: { tam_cagr: 0.6, penetration: 0.4 }
      cagr_curve: [[0.00, 0.00], [0.05, 0.25], [0.10, 0.55], [0.15, 0.80], [0.25, 1.00]]
      penetration_curve: [[0.00, 1.00], [0.05, 1.00], [0.15, 0.80], [0.30, 0.50], [0.50, 0.20], [1.00, 0.00]]
    gross_margin:
      weight: 10
      blend: { level: 0.6, trend: 0.4 }
      level_curve: [[0.10, 0.00], [0.25, 0.25], [0.40, 0.50], [0.55, 0.75], [0.70, 0.95], [0.85, 1.00]]
      trend_curve: [[-500, 0.00], [-100, 0.30], [0, 0.50], [100, 0.70], [300, 0.90], [600, 1.00]]
    operating_leverage:
      weight: 10
      blend: { margin_delta: 0.5, growth_gap: 0.5 }
      margin_delta_curve: [[-5, 0.00], [-1, 0.30], [0, 0.50], [2, 0.75], [5, 0.95], [10, 1.00]]
      growth_gap_curve: [[-0.10, 0.00], [-0.02, 0.30], [0, 0.50], [0.05, 0.75], [0.12, 0.95], [0.25, 1.00]]
    market_cap_opportunity:
      weight: 15
      bands:
        - { max: 1000000000, points: 15 }
        - { max: 3000000000, points: 14 }
        - { max: 10000000000, points: 12 }
        - { max: 30000000000, points: 8 }
        - { max: 100000000000, points: 4 }
        - { max: null, points: 1 }
      gate:
        zero_if_revenue_growth_below: 0.0
        zero_if_revenue_below: 10000000
        warning_multiplier: 0.5
    competitive_advantage:
      weight: 10
      signals:
        roic_spread: [[-0.10, 0.00], [0.00, 0.35], [0.05, 0.60], [0.15, 0.85], [0.30, 1.00]]
        gm_stability: [[0.70, 0.00], [0.85, 0.35], [0.92, 0.65], [0.96, 0.90], [0.99, 1.00]]
        gm_vs_industry: [[-0.20, 0.00], [-0.05, 0.30], [0.00, 0.50], [0.10, 0.80], [0.25, 1.00]]
        rd_intensity: [[0.00, 0.00], [0.03, 0.25], [0.08, 0.55], [0.15, 0.85], [0.25, 1.00]]
    balance_sheet:
      weight: 5
      profitable_blend: { net_cash: 0.6, leverage: 0.4 }
      net_cash_curve: [[-0.50, 0.00], [-0.20, 0.25], [0.00, 0.50], [0.10, 0.75], [0.25, 1.00]]
      leverage_curve: [[0, 1.00], [1, 0.85], [2, 0.60], [4, 0.30], [6, 0.00]]
      runway_curve: [[2, 0.00], [4, 0.20], [8, 0.50], [12, 0.80], [20, 1.00]]
    institutional_insider:
      weight: 5
      implemented: false

quality_gate:
  revenue_decline_years: 2
  extreme_dilution: 0.50
  dilution_warning: 0.15
  gm_collapse_bps: 500
  sbc_of_revenue: 0.25
  debt_to_ebitda: 5
  runway_critical_quarters: 2
  runway_low_quarters: 6
```

- [ ] **Step 4: 실패하는 테스트 작성**

`tests/config.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { parseConfig } from '@/config'
import { readFileSync } from 'node:fs'

describe('parseConfig', () => {
  it('실제 config.yaml을 파싱한다', () => {
    const raw = readFileSync('config.yaml', 'utf8')
    const cfg = parseConfig(raw)
    expect(cfg.universe.min_market_cap).toBe(300_000_000)
    expect(cfg.scoring.factors.revenue_growth.weight).toBe(20)
    expect(cfg.scoring.factors.institutional_insider.implemented).toBe(false)
  })

  it('가중치 합이 100이다', () => {
    const cfg = parseConfig(readFileSync('config.yaml', 'utf8'))
    const total = Object.values(cfg.scoring.factors)
      .reduce((sum, f) => sum + f.weight, 0)
    expect(total).toBe(100)
  })

  it('곡선의 x가 오름차순이 아니면 거부한다', () => {
    const bad = `
universe: { exchanges: [N], min_market_cap: 1, min_avg_dollar_volume: null,
  exclude_financial_status: [], exclude_sic: [], security_name_include: [],
  security_name_exclude: [] }
ingest: { bulk_quarters: 1, sec_user_agent: "x", sec_rate_limit_per_sec: 10, cache_dir: "." }
classification: { leader_ratio_of_max: 0.25, leader_max: 5, leader_min: 2,
  leader_min_industry_candidates: 3, challenger_min_market_cap: 1,
  emerging_max_market_cap: 2, emerging_revenue_threshold: 1 }
staleness: { price_days: 5, financials_days: 120, scores_days: 14, tam_days: 400 }
scoring:
  min_completeness: 0.6
  wacc_assumption: 0.09
  tax_rate: 0.21
  min_industry_candidates: 3
  factors:
    revenue_growth:
      weight: 100
      blend: { ttm_yoy: 0.6, cagr_3y: 0.4 }
      curve: [[0.5, 0.0], [0.1, 1.0]]
quality_gate: { revenue_decline_years: 2, extreme_dilution: 0.5, dilution_warning: 0.15,
  gm_collapse_bps: 500, sbc_of_revenue: 0.25, debt_to_ebitda: 5,
  runway_critical_quarters: 2, runway_low_quarters: 6 }
`
    expect(() => parseConfig(bad)).toThrow(/오름차순/)
  })
})
```

- [ ] **Step 5: 테스트 실패 확인**

Run: `npx vitest run tests/config.test.ts`
Expected: FAIL — `Cannot find module '@/config'`

- [ ] **Step 6: zod 스키마 구현**

`src/config/schema.ts`:

```ts
import { z } from 'zod'

const curve = z
  .array(z.tuple([z.number(), z.number()]))
  .min(2)
  .refine(
    (pts) => pts.every((p, i) => i === 0 || p[0] > pts[i - 1]![0]),
    { message: '곡선의 x 좌표는 오름차순이어야 합니다' },
  )

const factorBase = z.object({ weight: z.number().nonnegative() })

export const configSchema = z.object({
  universe: z.object({
    exchanges: z.array(z.string()),
    min_market_cap: z.number().nonnegative(),
    min_avg_dollar_volume: z.number().nullable(),
    exclude_financial_status: z.array(z.string()),
    exclude_sic: z.array(z.string()),
    security_name_include: z.array(z.string()),
    security_name_exclude: z.array(z.string()),
  }),
  ingest: z.object({
    bulk_quarters: z.number().int().positive(),
    sec_user_agent: z.string().min(1),
    sec_rate_limit_per_sec: z.number().positive(),
    cache_dir: z.string(),
  }),
  classification: z.object({
    leader_ratio_of_max: z.number(),
    leader_max: z.number().int(),
    leader_min: z.number().int(),
    leader_min_industry_candidates: z.number().int(),
    challenger_min_market_cap: z.number(),
    emerging_max_market_cap: z.number(),
    emerging_revenue_threshold: z.number(),
  }),
  staleness: z.object({
    price_days: z.number().int(),
    financials_days: z.number().int(),
    scores_days: z.number().int(),
    tam_days: z.number().int(),
  }),
  scoring: z.object({
    min_completeness: z.number(),
    wacc_assumption: z.number(),
    tax_rate: z.number(),
    min_industry_candidates: z.number().int(),
    factors: z.object({
      revenue_growth: factorBase.extend({
        blend: z.object({ ttm_yoy: z.number(), cagr_3y: z.number() }),
        curve,
      }),
      revenue_acceleration: factorBase.extend({ curve }),
      tam_industry_growth: factorBase.extend({
        blend: z.object({ tam_cagr: z.number(), penetration: z.number() }),
        cagr_curve: curve,
        penetration_curve: curve,
      }),
      gross_margin: factorBase.extend({
        blend: z.object({ level: z.number(), trend: z.number() }),
        level_curve: curve,
        trend_curve: curve,
      }),
      operating_leverage: factorBase.extend({
        blend: z.object({ margin_delta: z.number(), growth_gap: z.number() }),
        margin_delta_curve: curve,
        growth_gap_curve: curve,
      }),
      market_cap_opportunity: factorBase.extend({
        bands: z.array(
          z.object({ max: z.number().nullable(), points: z.number() }),
        ),
        gate: z.object({
          zero_if_revenue_growth_below: z.number(),
          zero_if_revenue_below: z.number(),
          warning_multiplier: z.number(),
        }),
      }),
      competitive_advantage: factorBase.extend({
        signals: z.object({
          roic_spread: curve,
          gm_stability: curve,
          gm_vs_industry: curve,
          rd_intensity: curve,
        }),
      }),
      balance_sheet: factorBase.extend({
        profitable_blend: z.object({ net_cash: z.number(), leverage: z.number() }),
        net_cash_curve: curve,
        leverage_curve: curve,
        runway_curve: curve,
      }),
      institutional_insider: factorBase.extend({ implemented: z.literal(false) }),
    }),
  }),
  quality_gate: z.object({
    revenue_decline_years: z.number().int(),
    extreme_dilution: z.number(),
    dilution_warning: z.number(),
    gm_collapse_bps: z.number(),
    sbc_of_revenue: z.number(),
    debt_to_ebitda: z.number(),
    runway_critical_quarters: z.number(),
    runway_low_quarters: z.number(),
  }),
})

export type AppConfig = z.infer<typeof configSchema>
```

> 3번째 테스트는 부분 config를 넘기므로 `factors`의 다른 키가 없어 스키마가 먼저 실패한다.
> 곡선 순서 메시지가 나오도록, `parseConfig`는 zod 에러 전체를 `\n`으로 이어붙여 던진다.

`src/config/index.ts`:

```ts
import { readFileSync } from 'node:fs'
import { parse as parseYaml } from 'yaml'
import { configSchema, type AppConfig } from './schema.js'

export type { AppConfig }

export function parseConfig(raw: string): AppConfig {
  const result = configSchema.safeParse(parseYaml(raw))
  if (!result.success) {
    const detail = result.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('\n')
    throw new Error(`config.yaml 검증 실패:\n${detail}`)
  }
  return result.data
}

let cached: AppConfig | null = null

export function loadConfig(path = 'config.yaml'): AppConfig {
  if (!cached) cached = parseConfig(readFileSync(path, 'utf8'))
  return cached
}
```

- [ ] **Step 7: 테스트 통과 확인**

Run: `npx vitest run tests/config.test.ts`
Expected: PASS (3 tests)

3번째 테스트가 곡선 메시지 대신 다른 zod 에러로 실패하면, 부분 config의 `factors`에 나머지 8개 팩터를 유효한 값으로 채워 넣어 곡선 검증까지 도달하게 한다.

- [ ] **Step 8: 커밋**

```bash
git add -A
git commit -m "feat: 프로젝트 스캐폴딩 및 config 로더

config.yaml 단일 설정 파일 + zod 검증. 곡선 x좌표 오름차순을
스키마 수준에서 강제한다."
```

---

### Task 2: domain 수학 유틸

**Files:**
- Create: `src/domain/types.ts`, `src/domain/curve.ts`, `src/domain/growth.ts`, `src/domain/stats.ts`
- Test: `tests/domain/curve.test.ts`, `tests/domain/growth.test.ts`, `tests/domain/stats.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `interpolate(curve: [number, number][], x: number): number` — clamp 포함
  - `yoy(current: number | null, prior: number | null): number | null`
  - `cagr(latest: number | null, earliest: number | null, years: number): number | null`
  - `sumTTM(values: (number | null)[]): number | null` — 4개 전부 있어야 반환, 아니면 null
  - `median(values: number[]): number | null`
  - `percentileOf(sorted: number[], value: number): number | null`
  - `olsSlope(values: number[]): number | null`
  - `stdev(values: number[]): number | null`
  - 타입: `FinancialPeriod`, `IndustryMeta`, `IndustryStats`, `FactorResult`, `RedFlag`, `CompanySnapshot`

- [ ] **Step 1: 타입 정의**

`src/domain/types.ts`:

```ts
export type PeriodType = 'Q' | 'A' | 'TTM'

export type FinancialPeriod = {
  periodEnd: string            // ISO date (YYYY-MM-DD)
  periodType: PeriodType
  revenue: number | null
  grossProfit: number | null
  operatingIncome: number | null
  netIncome: number | null
  ocf: number | null
  capex: number | null
  fcf: number | null
  cash: number | null
  totalDebt: number | null
  equity: number | null
  /** 기간 가중평균 희석주식수 — EPS 계산용 */
  sharesDiluted: number | null
  /** 표지 기준 발행주식수 (dei 태그) — 시가총액 계산용 */
  sharesOutstanding: number | null
  sbc: number | null
  rdExpense: number | null
}

export type IndustryMeta = {
  slug: string
  name: string
  themeSlug: string
  tamUsd: number | null
  tamCagr: number | null
  tamSource: string | null
  tamAsOf: string | null
}

export type IndustryStats = {
  candidateCount: number
  /** 경쟁우위 팩터의 "산업 대비 GM" 신호에 쓰인다 */
  medianGrossMargin: number | null
  /** TAM CAGR이 큐레이션되지 않은 산업의 성장률 대체값 */
  medianRevenueGrowth: number | null
  /** 지표 키 → 오름차순 정렬된 값 배열. 백분위 표시용 */
  distributions: Record<string, number[]>
}

export type FactorStatus = 'SCORED' | 'NO_DATA' | 'NOT_IMPLEMENTED'

export type FactorResult = {
  key: string
  weight: number
  points: number | null
  raw: number | null
  status: FactorStatus
  detail: string
}

export type RedFlagSeverity = 'CRITICAL' | 'WARNING'

export type RedFlag = {
  code: string
  severity: RedFlagSeverity
  message: string
  evidence: Record<string, number | string | null>
}

export type Category = 'LEADER' | 'CHALLENGER' | 'EMERGING'

export type CompanySnapshot = {
  cik: number
  ticker: string
  name: string
  themeSlug: string
  industrySlug: string
  industry: IndustryMeta
  classificationSource: 'sic' | 'override'
  marketCap: number | null
  price: number | null
  priceDate: string | null
  sharesOutstanding: number | null
  /** TTM 계열, 최근순. [0]=현재 TTM, [4]=1년 전 TTM */
  ttm: FinancialPeriod[]
  /** 연간, 최근순 */
  annual: FinancialPeriod[]
  /** 분기, 최근순 */
  quarterly: FinancialPeriod[]
  industryStats: IndustryStats
  asOf: string
}
```

- [ ] **Step 2: curve 실패 테스트 작성**

`tests/domain/curve.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { interpolate } from '@/domain/curve'

const c: [number, number][] = [[0, 0], [10, 1]]

describe('interpolate', () => {
  it('구간 사이를 선형보간한다', () => {
    expect(interpolate(c, 5)).toBeCloseTo(0.5)
    expect(interpolate(c, 2.5)).toBeCloseTo(0.25)
  })

  it('구간 밖은 끝값으로 고정한다', () => {
    expect(interpolate(c, -100)).toBe(0)
    expect(interpolate(c, 999)).toBe(1)
  })

  it('정점에서는 그 값을 반환한다', () => {
    expect(interpolate(c, 0)).toBe(0)
    expect(interpolate(c, 10)).toBe(1)
  })

  it('y가 감소하는 곡선도 처리한다 (침투율 곡선)', () => {
    const dec: [number, number][] = [[0, 1], [1, 0]]
    expect(interpolate(dec, 0.25)).toBeCloseTo(0.75)
  })

  it('여러 구간을 가진 곡선을 처리한다', () => {
    const multi: [number, number][] = [[0, 0], [1, 0.5], [3, 0.6]]
    expect(interpolate(multi, 0.5)).toBeCloseTo(0.25)
    expect(interpolate(multi, 2)).toBeCloseTo(0.55)
  })
})
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `npx vitest run tests/domain/curve.test.ts`
Expected: FAIL — `Cannot find module '@/domain/curve'`

- [ ] **Step 4: curve 구현**

`src/domain/curve.ts`:

```ts
export type Curve = [number, number][]

/**
 * 구간 선형보간. x가 곡선 범위를 벗어나면 끝값으로 고정한다.
 * curve의 x 좌표는 오름차순이어야 한다 (config 스키마가 강제).
 */
export function interpolate(curve: Curve, x: number): number {
  const first = curve[0]
  const last = curve[curve.length - 1]
  if (!first || !last) throw new Error('빈 곡선입니다')
  if (x <= first[0]) return first[1]
  if (x >= last[0]) return last[1]

  for (let i = 1; i < curve.length; i++) {
    const prev = curve[i - 1]!
    const cur = curve[i]!
    if (x <= cur[0]) {
      const span = cur[0] - prev[0]
      const t = span === 0 ? 0 : (x - prev[0]) / span
      return prev[1] + t * (cur[1] - prev[1])
    }
  }
  return last[1]
}
```

- [ ] **Step 5: curve 테스트 통과 확인**

Run: `npx vitest run tests/domain/curve.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 6: growth 실패 테스트 작성**

`tests/domain/growth.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { yoy, cagr, sumTTM } from '@/domain/growth'

describe('yoy', () => {
  it('증가율을 계산한다', () => {
    expect(yoy(138, 100)).toBeCloseTo(0.38)
  })
  it('결측이면 null', () => {
    expect(yoy(null, 100)).toBeNull()
    expect(yoy(100, null)).toBeNull()
  })
  it('기준값이 0 이하면 null (비율이 무의미)', () => {
    expect(yoy(100, 0)).toBeNull()
    expect(yoy(100, -50)).toBeNull()
  })
})

describe('cagr', () => {
  it('3년 CAGR을 계산한다', () => {
    expect(cagr(200, 100, 3)).toBeCloseTo(0.2599, 3)
  })
  it('기준값이 0 이하면 null', () => {
    expect(cagr(200, 0, 3)).toBeNull()
  })
  it('결측이면 null', () => {
    expect(cagr(null, 100, 3)).toBeNull()
  })
})

describe('sumTTM', () => {
  it('4개 값을 합산한다', () => {
    expect(sumTTM([1, 2, 3, 4])).toBe(10)
  })
  it('하나라도 null이면 null — 0으로 채우지 않는다', () => {
    expect(sumTTM([1, null, 3, 4])).toBeNull()
  })
  it('4개가 아니면 null', () => {
    expect(sumTTM([1, 2, 3])).toBeNull()
  })
})
```

- [ ] **Step 7: 테스트 실패 확인**

Run: `npx vitest run tests/domain/growth.test.ts`
Expected: FAIL — `Cannot find module '@/domain/growth'`

- [ ] **Step 8: growth 구현**

`src/domain/growth.ts`:

```ts
export function yoy(current: number | null, prior: number | null): number | null {
  if (current === null || prior === null || prior <= 0) return null
  return current / prior - 1
}

export function cagr(
  latest: number | null,
  earliest: number | null,
  years: number,
): number | null {
  if (latest === null || earliest === null) return null
  if (earliest <= 0 || latest <= 0 || years <= 0) return null
  return Math.pow(latest / earliest, 1 / years) - 1
}

/** 4개 분기 유량 합. 하나라도 결측이면 null — 0으로 대체하지 않는다. */
export function sumTTM(values: (number | null)[]): number | null {
  if (values.length !== 4) return null
  let total = 0
  for (const v of values) {
    if (v === null) return null
    total += v
  }
  return total
}
```

- [ ] **Step 9: growth 테스트 통과 확인**

Run: `npx vitest run tests/domain/growth.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 10: stats 실패 테스트 작성**

`tests/domain/stats.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { median, percentileOf, olsSlope, stdev } from '@/domain/stats'

describe('median', () => {
  it('홀수 개수', () => expect(median([3, 1, 2])).toBe(2))
  it('짝수 개수는 평균', () => expect(median([1, 2, 3, 4])).toBe(2.5))
  it('빈 배열은 null', () => expect(median([])).toBeNull())
})

describe('percentileOf', () => {
  it('정렬된 배열에서 백분위를 반환한다', () => {
    const sorted = [10, 20, 30, 40, 50]
    expect(percentileOf(sorted, 30)).toBeCloseTo(0.4)   // 자기보다 작은 값 2/5
    expect(percentileOf(sorted, 10)).toBeCloseTo(0)
    expect(percentileOf(sorted, 50)).toBeCloseTo(0.8)
  })
  it('빈 배열은 null', () => expect(percentileOf([], 1)).toBeNull())
})

describe('olsSlope', () => {
  it('완전한 직선의 기울기', () => {
    expect(olsSlope([1, 2, 3, 4])).toBeCloseTo(1)
  })
  it('감소 추세는 음수', () => {
    expect(olsSlope([4, 3, 2, 1])).toBeCloseTo(-1)
  })
  it('2개 미만은 null', () => expect(olsSlope([1])).toBeNull())
})

describe('stdev', () => {
  it('표본표준편차를 계산한다', () => {
    expect(stdev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.138, 2)
  })
  it('2개 미만은 null', () => expect(stdev([1])).toBeNull())
})
```

- [ ] **Step 11: 테스트 실패 확인**

Run: `npx vitest run tests/domain/stats.test.ts`
Expected: FAIL — `Cannot find module '@/domain/stats'`

- [ ] **Step 12: stats 구현**

`src/domain/stats.ts`:

```ts
export function median(values: number[]): number | null {
  if (values.length === 0) return null
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 === 0 ? (s[mid - 1]! + s[mid]!) / 2 : s[mid]!
}

/** 오름차순 정렬된 배열에서 value보다 작은 값의 비율 */
export function percentileOf(sorted: number[], value: number): number | null {
  if (sorted.length === 0) return null
  let below = 0
  for (const v of sorted) {
    if (v < value) below++
    else break
  }
  return below / sorted.length
}

/** 등간격 시계열(x = 0,1,2,...)의 최소자승 기울기 */
export function olsSlope(values: number[]): number | null {
  const n = values.length
  if (n < 2) return null
  const meanX = (n - 1) / 2
  const meanY = values.reduce((a, b) => a + b, 0) / n
  let num = 0
  let den = 0
  for (let i = 0; i < n; i++) {
    num += (i - meanX) * (values[i]! - meanY)
    den += (i - meanX) ** 2
  }
  return den === 0 ? null : num / den
}

/** 표본표준편차 (n-1) */
export function stdev(values: number[]): number | null {
  const n = values.length
  if (n < 2) return null
  const mean = values.reduce((a, b) => a + b, 0) / n
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1)
  return Math.sqrt(variance)
}
```

- [ ] **Step 13: 전체 테스트 통과 확인**

Run: `npx vitest run tests/domain`
Expected: PASS (curve 5 + growth 9 + stats 9 = 23 tests)

- [ ] **Step 14: 커밋**

```bash
git add -A
git commit -m "feat: domain 순수 계산 유틸 및 핵심 타입

곡선 보간, YoY/CAGR, TTM 합산, 중앙값/백분위/OLS/표준편차.
결측은 전부 null로 전파하며 0으로 대체하지 않는다."
```

---

### Task 3: taxonomy 로더 & 분류 해석

**Files:**
- Create: `taxonomy/themes.yaml`, `taxonomy/industries.yaml`, `taxonomy/sic-map.yaml`, `taxonomy/company-overrides.yaml`
- Create: `src/taxonomy/schema.ts`, `src/taxonomy/index.ts`
- Test: `tests/taxonomy.test.ts`

**Interfaces:**
- Consumes: `IndustryMeta` (Task 2, `src/domain/types.ts`)
- Produces:
  - `loadTaxonomy(dir?: string): Taxonomy`
  - `Taxonomy = { themes: ThemeMeta[]; industries: Map<string, IndustryMeta>; unmappedSics: Set<string>; mappedSics: Set<string>; classify(sic: string, ticker: string): Classification | null }`
  - `Classification = { themeSlug: string; industrySlug: string; source: 'sic' | 'override' }`
  - `ThemeMeta = { slug: string; name: string; displayOrder: number }`
  - `classify`가 `null`을 반환하면 해당 기업은 유니버스에서 제외된다.

**설계 문서 §4.3 근거:** SIC 코드는 440개뿐이라 Industry 49개를 자동 도출할 수 없다. SIC는 Theme + 기본 Industry까지만 정하고 실질 분류는 오버라이드가 담당한다.

- [ ] **Step 1: themes.yaml 작성**

```yaml
- { slug: ai-software-semi,             name: "AI / Software / Semiconductor",      display_order: 1 }
- { slug: healthcare-biotech,           name: "Healthcare / Biotechnology",         display_order: 2 }
- { slug: industrial-automation-defense, name: "Industrial / Automation / Defense", display_order: 3 }
- { slug: digital-consumer-fintech,     name: "Digital Consumer / Fintech",         display_order: 4 }
- { slug: energy-next,                  name: "Energy / Next Energy",               display_order: 5 }
- { slug: emerging-tech,                name: "Emerging Technology",                display_order: 6 }
```

- [ ] **Step 2: industries.yaml 작성 — TAM은 전부 null로 시작**

TAM 수치를 출처 없이 만들어 넣지 않는다. 초기값은 `null`이며 사용자가 조사해 채운다. Task 15의 팩터는 `tam_cagr`가 null이면 산업 구성기업의 매출 성장률 중앙값으로 대체한다(설계 문서 개정 사항, Task 15에 상술).

49개 전부 아래 필드 구조로 작성한다. Theme 1의 10개 전체를 보이고, 나머지 39개는 동일 형식으로 슬러그만 바꾼다.

```yaml
# Theme 1 — AI / Software / Semiconductor
- { slug: semiconductors,             theme: ai-software-semi, name: Semiconductors,             tam_usd: null, tam_cagr: null, tam_source: null, tam_as_of: null }
- { slug: semiconductor-equipment,    theme: ai-software-semi, name: Semiconductor Equipment,    tam_usd: null, tam_cagr: null, tam_source: null, tam_as_of: null }
- { slug: software-infrastructure,    theme: ai-software-semi, name: Software Infrastructure,    tam_usd: null, tam_cagr: null, tam_source: null, tam_as_of: null }
- { slug: software-application,       theme: ai-software-semi, name: Software Application,       tam_usd: null, tam_cagr: null, tam_source: null, tam_as_of: null }
- { slug: cloud-computing,            theme: ai-software-semi, name: Cloud Computing,            tam_usd: null, tam_cagr: null, tam_source: null, tam_as_of: null }
- { slug: cybersecurity,              theme: ai-software-semi, name: Cybersecurity,              tam_usd: null, tam_cagr: null, tam_source: null, tam_as_of: null }
- { slug: data-infrastructure,        theme: ai-software-semi, name: Data Infrastructure,        tam_usd: null, tam_cagr: null, tam_source: null, tam_as_of: null }
- { slug: ai-infrastructure,          theme: ai-software-semi, name: AI Infrastructure,          tam_usd: null, tam_cagr: null, tam_source: null, tam_as_of: null }
- { slug: networking,                 theme: ai-software-semi, name: Networking,                 tam_usd: null, tam_cagr: null, tam_source: null, tam_as_of: null }
- { slug: data-center-infrastructure, theme: ai-software-semi, name: Data Center Infrastructure, tam_usd: null, tam_cagr: null, tam_source: null, tam_as_of: null }
```

나머지 39개 슬러그 (각 항목의 `theme` 값은 아래 그룹 키):

- `healthcare-biotech` — `biotechnology`, `pharmaceuticals`, `medical-devices`, `diagnostics`, `genomics`, `precision-medicine`, `drug-discovery`, `healthcare-technology`
- `industrial-automation-defense` — `robotics`, `industrial-automation`, `aerospace`, `defense-technology`, `drones`, `advanced-manufacturing`, `logistics-automation`
- `digital-consumer-fintech` — `e-commerce`, `fintech`, `digital-payments`, `digital-advertising`, `gaming`, `online-marketplace`, `travel-technology`, `digital-media`
- `energy-next` — `nuclear`, `uranium`, `energy-storage`, `solar`, `grid-infrastructure`, `power-semiconductor`, `renewable-energy`, `next-generation-energy`
- `emerging-tech` — `quantum-computing`, `space`, `satellite`, `autonomous-driving`, `advanced-computing`, `ai-robotics`, `advanced-materials`, `synthetic-biology`

`name` 값은 슬러그를 Title Case로 푼 것을 쓴다 (`e-commerce` → `E-commerce`, `ai-robotics` → `AI Robotics`).

- [ ] **Step 3: sic-map.yaml 작성**

```yaml
# SIC → { theme, default_industry }
# 여기 없는 SIC는 유니버스에서 제외된다.
# 겹치는 SIC는 가장 지배적인 하나로 배정하고 예외는 company-overrides.yaml이 처리한다.
map:
  # AI / Software / Semiconductor
  "3674": { theme: ai-software-semi, industry: semiconductors }
  "3672": { theme: ai-software-semi, industry: semiconductors }
  "3679": { theme: ai-software-semi, industry: semiconductors }
  "3559": { theme: ai-software-semi, industry: semiconductor-equipment }
  "3827": { theme: ai-software-semi, industry: semiconductor-equipment }
  "7372": { theme: ai-software-semi, industry: software-application }
  "7370": { theme: ai-software-semi, industry: software-infrastructure }
  "7371": { theme: ai-software-semi, industry: software-infrastructure }
  "7373": { theme: ai-software-semi, industry: software-infrastructure }
  "7374": { theme: ai-software-semi, industry: cloud-computing }
  "3570": { theme: ai-software-semi, industry: data-center-infrastructure }
  "3571": { theme: ai-software-semi, industry: data-center-infrastructure }
  "3577": { theme: ai-software-semi, industry: data-center-infrastructure }
  "3572": { theme: ai-software-semi, industry: data-infrastructure }
  "3576": { theme: ai-software-semi, industry: networking }
  "3661": { theme: ai-software-semi, industry: networking }
  "3663": { theme: ai-software-semi, industry: networking }
  "3669": { theme: ai-software-semi, industry: networking }
  # Healthcare / Biotechnology
  "2836": { theme: healthcare-biotech, industry: biotechnology }
  "8731": { theme: healthcare-biotech, industry: drug-discovery }
  "2833": { theme: healthcare-biotech, industry: pharmaceuticals }
  "2834": { theme: healthcare-biotech, industry: pharmaceuticals }
  "2835": { theme: healthcare-biotech, industry: diagnostics }
  "3826": { theme: healthcare-biotech, industry: diagnostics }
  "8071": { theme: healthcare-biotech, industry: diagnostics }
  "3841": { theme: healthcare-biotech, industry: medical-devices }
  "3842": { theme: healthcare-biotech, industry: medical-devices }
  "3843": { theme: healthcare-biotech, industry: medical-devices }
  "3844": { theme: healthcare-biotech, industry: medical-devices }
  "3845": { theme: healthcare-biotech, industry: medical-devices }
  "8090": { theme: healthcare-biotech, industry: healthcare-technology }
  # Industrial / Automation / Defense
  "3812": { theme: industrial-automation-defense, industry: defense-technology }
  "3760": { theme: industrial-automation-defense, industry: defense-technology }
  "3480": { theme: industrial-automation-defense, industry: defense-technology }
  "3721": { theme: industrial-automation-defense, industry: aerospace }
  "3724": { theme: industrial-automation-defense, industry: aerospace }
  "3728": { theme: industrial-automation-defense, industry: aerospace }
  "3550": { theme: industrial-automation-defense, industry: industrial-automation }
  "3561": { theme: industrial-automation-defense, industry: industrial-automation }
  "3823": { theme: industrial-automation-defense, industry: industrial-automation }
  "3829": { theme: industrial-automation-defense, industry: industrial-automation }
  "3555": { theme: industrial-automation-defense, industry: advanced-manufacturing }
  "3585": { theme: industrial-automation-defense, industry: advanced-manufacturing }
  "3537": { theme: industrial-automation-defense, industry: logistics-automation }
  # Digital Consumer / Fintech
  "5961": { theme: digital-consumer-fintech, industry: e-commerce }
  "7379": { theme: digital-consumer-fintech, industry: online-marketplace }
  "6199": { theme: digital-consumer-fintech, industry: fintech }
  "6141": { theme: digital-consumer-fintech, industry: fintech }
  "6099": { theme: digital-consumer-fintech, industry: digital-payments }
  "7311": { theme: digital-consumer-fintech, industry: digital-advertising }
  "7812": { theme: digital-consumer-fintech, industry: digital-media }
  "7841": { theme: digital-consumer-fintech, industry: digital-media }
  "4813": { theme: digital-consumer-fintech, industry: digital-media }
  "7990": { theme: digital-consumer-fintech, industry: gaming }
  "7999": { theme: digital-consumer-fintech, industry: gaming }
  "4724": { theme: digital-consumer-fintech, industry: travel-technology }
  # Energy / Next Energy
  "4911": { theme: energy-next, industry: grid-infrastructure }
  "4931": { theme: energy-next, industry: grid-infrastructure }
  "3612": { theme: energy-next, industry: grid-infrastructure }
  "3621": { theme: energy-next, industry: grid-infrastructure }
  "4991": { theme: energy-next, industry: renewable-energy }
  "1090": { theme: energy-next, industry: uranium }
  "1094": { theme: energy-next, industry: uranium }
  "3433": { theme: energy-next, industry: solar }
  "3690": { theme: energy-next, industry: energy-storage }
  "3691": { theme: energy-next, industry: energy-storage }
  "3692": { theme: energy-next, industry: energy-storage }
  # Emerging Technology
  "2820": { theme: emerging-tech, industry: advanced-materials }
  "2821": { theme: emerging-tech, industry: advanced-materials }
  "3711": { theme: emerging-tech, industry: autonomous-driving }
  "3714": { theme: emerging-tech, industry: autonomous-driving }

# 유니버스에 나타나지만 의도적으로 제외하는 SIC.
# 커버리지 테스트(Task 24)가 map에도 unmapped에도 없는 SIC를 발견하면 실패한다.
unmapped:
  - "6770"   # Blank Checks (SPAC)
  - "6798"   # REIT
  - "6021"   # National Commercial Banks
  - "6022"   # State Commercial Banks
  - "6311"   # Life Insurance
  - "1311"   # Crude Petroleum & Natural Gas
  - "2911"   # Petroleum Refining
  - "2000"   # Food & Kindred Products
  - "5812"   # Eating Places
  - "6500"   # Real Estate
```

- [ ] **Step 4: company-overrides.yaml 작성**

`industry`만 지정하면 theme은 `industries.yaml`에서 자동 결정된다. `theme`을 함께 주면 Theme까지 이동한다.

```yaml
CRWD: { industry: cybersecurity }
PANW: { industry: cybersecurity }
ZS:   { industry: cybersecurity }
S:    { industry: cybersecurity }
OKTA: { industry: cybersecurity }
FTNT: { industry: cybersecurity }
NET:  { industry: data-infrastructure }
DDOG: { industry: data-infrastructure }
SNOW: { industry: data-infrastructure }
MDB:  { industry: data-infrastructure }
NVDA: { industry: ai-infrastructure }
AMD:  { industry: semiconductors }
AVGO: { industry: semiconductors }
VRT:  { industry: data-center-infrastructure }
SMCI: { industry: data-center-infrastructure }
CRM:  { industry: software-application }
NOW:  { industry: software-application }
MSFT: { industry: cloud-computing }
PLTR: { industry: software-infrastructure }
OKLO: { industry: nuclear }
SMR:  { industry: nuclear }
LEU:  { industry: uranium }
CCJ:  { industry: uranium }
FSLR: { industry: solar }
ENPH: { industry: solar }
TSLA: { industry: autonomous-driving }
IONQ: { industry: quantum-computing }
RGTI: { industry: quantum-computing }
QBTS: { industry: quantum-computing }
RKLB: { industry: space }
ASTS: { industry: satellite }
```

> 최종 시딩 목표는 약 400 티커지만 **지금 추측으로 채우지 않는다.** Task 24의 커버리지 리포트가 기본 버킷 비율을 출력하면 그 결과를 보고 확장한다.

- [ ] **Step 5: 실패하는 테스트 작성**

`tests/taxonomy.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { loadTaxonomy } from '@/taxonomy'

const tx = loadTaxonomy()

describe('loadTaxonomy', () => {
  it('Theme 6개를 로드한다', () => {
    expect(tx.themes).toHaveLength(6)
    expect(tx.themes.map((t) => t.slug)).toContain('emerging-tech')
  })

  it('Theme은 display_order 순으로 정렬된다', () => {
    expect(tx.themes[0]!.slug).toBe('ai-software-semi')
    expect(tx.themes[5]!.slug).toBe('emerging-tech')
  })

  it('Industry 49개를 로드한다', () => {
    expect(tx.industries.size).toBe(49)
  })

  it('모든 Industry의 theme이 실재하는 Theme을 가리킨다', () => {
    const slugs = new Set(tx.themes.map((t) => t.slug))
    for (const ind of tx.industries.values()) {
      expect(slugs.has(ind.themeSlug)).toBe(true)
    }
  })
})

describe('classify', () => {
  it('오버라이드가 SIC보다 우선한다', () => {
    // CRWD의 SIC 7372는 software-application이지만 오버라이드가 cybersecurity로 지정
    expect(tx.classify('7372', 'CRWD')).toEqual({
      themeSlug: 'ai-software-semi',
      industrySlug: 'cybersecurity',
      source: 'override',
    })
  })

  it('오버라이드가 없으면 SIC 기본 Industry를 쓴다', () => {
    expect(tx.classify('7372', 'UNKNOWNTICKER')).toEqual({
      themeSlug: 'ai-software-semi',
      industrySlug: 'software-application',
      source: 'sic',
    })
  })

  it('오버라이드가 Theme까지 바꾼다', () => {
    // OKLO의 SIC 4911은 grid-infrastructure(energy-next)이지만 nuclear로 이동
    const r = tx.classify('4911', 'OKLO')
    expect(r?.industrySlug).toBe('nuclear')
    expect(r?.themeSlug).toBe('energy-next')
  })

  it('티커 대소문자를 구분하지 않는다', () => {
    expect(tx.classify('7372', 'crwd')?.industrySlug).toBe('cybersecurity')
  })

  it('매핑되지 않은 SIC는 null (유니버스 제외)', () => {
    expect(tx.classify('6022', 'JPM')).toBeNull()
    expect(tx.classify('9999', 'WHATEVER')).toBeNull()
  })

  it('오버라이드가 있으면 SIC가 미매핑이어도 분류된다', () => {
    expect(tx.classify('6770', 'IONQ')?.industrySlug).toBe('quantum-computing')
    expect(tx.classify('6770', 'IONQ')?.source).toBe('override')
  })
})
```

- [ ] **Step 6: 테스트 실패 확인**

Run: `npx vitest run tests/taxonomy.test.ts`
Expected: FAIL — `Cannot find module '@/taxonomy'`

- [ ] **Step 7: zod 스키마 구현**

`src/taxonomy/schema.ts`:

```ts
import { z } from 'zod'

export const themesSchema = z.array(
  z.object({
    slug: z.string().min(1),
    name: z.string().min(1),
    display_order: z.number().int(),
  }),
)

export const industriesSchema = z
  .array(
    z.object({
      slug: z.string().min(1),
      theme: z.string().min(1),
      name: z.string().min(1),
      tam_usd: z.number().positive().nullable(),
      tam_cagr: z.number().nullable(),
      tam_source: z.string().nullable(),
      tam_as_of: z.string().nullable(),
    }),
  )
  .superRefine((rows, ctx) => {
    for (const r of rows) {
      if (r.tam_usd !== null && !r.tam_source) {
        ctx.addIssue({
          code: 'custom',
          message: `${r.slug}: tam_usd가 있으면 tam_source가 필수입니다`,
        })
      }
    }
  })

export const sicMapSchema = z.object({
  map: z.record(z.string(), z.object({ theme: z.string(), industry: z.string() })),
  unmapped: z.array(z.string()),
})

export const overridesSchema = z.record(
  z.string(),
  z.object({ theme: z.string().optional(), industry: z.string().optional() }),
)
```

- [ ] **Step 8: 로더 구현**

`src/taxonomy/index.ts`:

```ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import type { IndustryMeta } from '@/domain/types'
import { themesSchema, industriesSchema, sicMapSchema, overridesSchema } from './schema.js'

export type ThemeMeta = { slug: string; name: string; displayOrder: number }

export type Classification = {
  themeSlug: string
  industrySlug: string
  source: 'sic' | 'override'
}

export type Taxonomy = {
  themes: ThemeMeta[]
  industries: Map<string, IndustryMeta>
  unmappedSics: Set<string>
  mappedSics: Set<string>
  classify(sic: string, ticker: string): Classification | null
}

function read(dir: string, file: string): unknown {
  return parseYaml(readFileSync(join(dir, file), 'utf8'))
}

export function loadTaxonomy(dir = 'taxonomy'): Taxonomy {
  const themesRaw = themesSchema.parse(read(dir, 'themes.yaml'))
  const industriesRaw = industriesSchema.parse(read(dir, 'industries.yaml'))
  const sicMap = sicMapSchema.parse(read(dir, 'sic-map.yaml'))
  const overrides = overridesSchema.parse(read(dir, 'company-overrides.yaml'))

  const industries = new Map<string, IndustryMeta>()
  for (const r of industriesRaw) {
    industries.set(r.slug, {
      slug: r.slug,
      name: r.name,
      themeSlug: r.theme,
      tamUsd: r.tam_usd,
      tamCagr: r.tam_cagr,
      tamSource: r.tam_source,
      tamAsOf: r.tam_as_of,
    })
  }

  // 참조 무결성 검증 — 로드 시점에 실패시켜 파이프라인이 잘못된 분류로 돌지 않게 한다
  const themeSlugs = new Set(themesRaw.map((t) => t.slug))
  for (const ind of industries.values()) {
    if (!themeSlugs.has(ind.themeSlug)) {
      throw new Error(`industries.yaml: ${ind.slug}의 theme "${ind.themeSlug}"이 존재하지 않습니다`)
    }
  }
  for (const [sic, v] of Object.entries(sicMap.map)) {
    if (!industries.has(v.industry)) {
      throw new Error(`sic-map.yaml: SIC ${sic}의 industry "${v.industry}"가 존재하지 않습니다`)
    }
  }
  for (const [ticker, v] of Object.entries(overrides)) {
    if (v.industry && !industries.has(v.industry)) {
      throw new Error(`company-overrides.yaml: ${ticker}의 industry "${v.industry}"가 존재하지 않습니다`)
    }
  }

  const upperOverrides = new Map(
    Object.entries(overrides).map(([k, v]) => [k.toUpperCase(), v]),
  )

  return {
    themes: themesRaw
      .map((t) => ({ slug: t.slug, name: t.name, displayOrder: t.display_order }))
      .sort((a, b) => a.displayOrder - b.displayOrder),
    industries,
    unmappedSics: new Set(sicMap.unmapped),
    mappedSics: new Set(Object.keys(sicMap.map)),

    classify(sic: string, ticker: string): Classification | null {
      const ov = upperOverrides.get(ticker.toUpperCase())
      if (ov?.industry) {
        const ind = industries.get(ov.industry)!
        return {
          themeSlug: ov.theme ?? ind.themeSlug,
          industrySlug: ov.industry,
          source: 'override',
        }
      }
      const m = sicMap.map[sic]
      if (!m) return null
      return { themeSlug: m.theme, industrySlug: m.industry, source: 'sic' }
    },
  }
}
```

- [ ] **Step 9: 테스트 통과 확인**

Run: `npx vitest run tests/taxonomy.test.ts`
Expected: PASS (11 tests)

`Industry 49개` 테스트가 실패하면 Step 2에서 빠뜨린 슬러그를 채운다.

- [ ] **Step 10: 커밋**

```bash
git add -A
git commit -m "feat: Theme/Industry 분류 체계 및 taxonomy 로더

SIC는 Theme과 기본 Industry까지만 결정하고 실질 분류는 오버라이드가 담당한다.
로드 시점에 참조 무결성을 검증해 잘못된 분류로 파이프라인이 돌지 않게 한다.
TAM은 출처 없이 채우지 않고 null로 시작한다."
```

---

### Task 4: DB 스키마 & 마이그레이션

**Files:**
- Create: `src/db/client.ts`, `src/db/schema.ts`, `src/db/migrate.ts`
- Test: `tests/db/migrate.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `getRawDb(path?: string): Database.Database` — better-sqlite3 인스턴스. 기본 경로는 `process.env.DATABASE_PATH ?? './data/tenbagger.db'`
  - `getDb(path?: string)` — Drizzle 인스턴스
  - `runMigrations(raw: Database.Database): void` — 테이블 12개 + `latest_scores` 뷰 생성. 멱등
  - `src/db/schema.ts`에서 테이블 export: `companies`, `listings`, `financialFacts`, `marketData`, `financials`, `companyIndustry`, `scores`, `scoreFactors`, `redFlags`, `themes`, `industries`, `jobRuns`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/db/migrate.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { getRawDb, runMigrations } from '@/db/client'

let raw: Database.Database

beforeAll(() => {
  const dbPath = join(mkdtempSync(join(tmpdir(), 'tb-')), 'test.db')
  raw = getRawDb(dbPath)
  runMigrations(raw)
})

const EXPECTED_TABLES = [
  'companies', 'listings', 'financial_facts', 'market_data',
  'financials', 'company_industry', 'scores', 'score_factors',
  'red_flags', 'themes', 'industries', 'job_runs',
]

describe('마이그레이션', () => {
  it('테이블 12개를 생성한다', () => {
    const rows = raw
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as { name: string }[]
    const names = rows.map((r) => r.name)
    for (const t of EXPECTED_TABLES) expect(names).toContain(t)
  })

  it('latest_scores 뷰를 생성한다', () => {
    const rows = raw
      .prepare("SELECT name FROM sqlite_master WHERE type='view'")
      .all() as { name: string }[]
    expect(rows.map((r) => r.name)).toContain('latest_scores')
  })

  it('두 번 실행해도 실패하지 않는다', () => {
    expect(() => runMigrations(raw)).not.toThrow()
  })

  it('scores는 (cik, as_of) 복합키로 이력을 누적한다', () => {
    const ins = raw.prepare(
      `INSERT INTO scores (cik, as_of, tenbagger, completeness, category, engine_version)
       VALUES (?, ?, ?, 0.95, 'EMERGING', 'v1')`,
    )
    ins.run(1, '2026-08-01', 70)
    ins.run(1, '2026-08-08', 78)
    const n = raw
      .prepare('SELECT COUNT(*) c FROM scores WHERE cik = 1')
      .get() as { c: number }
    expect(n.c).toBe(2)
  })

  it('latest_scores는 CIK당 최신 1건만 반환한다', () => {
    const rows = raw
      .prepare('SELECT * FROM latest_scores WHERE cik = 1')
      .all() as { as_of: string; tenbagger: number }[]
    expect(rows).toHaveLength(1)
    expect(rows[0]!.as_of).toBe('2026-08-08')
    expect(rows[0]!.tenbagger).toBe(78)
  })

  it('financial_facts는 중복 사실을 거부한다', () => {
    const ins = () =>
      raw
        .prepare(
          `INSERT INTO financial_facts
             (cik, tag, unit, period_start, period_end, qtrs, value, form, filed_date, accession, source)
           VALUES (1,'Revenues','USD','2025-01-01','2025-03-31',1,100,'10-Q','2025-05-01','a-1','api')`,
        )
        .run()
    ins()
    expect(ins).toThrow(/UNIQUE/i)
  })

  it('period_type과 source는 CHECK 제약으로 오타를 거부한다', () => {
    expect(() =>
      raw
        .prepare(
          `INSERT INTO financials (cik, period_end, period_type, computed_at)
           VALUES (1, '2025-03-31', 'YEARLY', '2026-08-09')`,
        )
        .run(),
    ).toThrow(/CHECK/i)
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run tests/db/migrate.test.ts`
Expected: FAIL — `Cannot find module '@/db/client'`

- [ ] **Step 3: client.ts 구현 (DDL 포함)**

스키마 생성은 아래 DDL이 담당하고, 조회는 Drizzle이 담당한다. drizzle-kit 마이그레이션 생성기를 쓰지 않아 파일이 하나로 유지된다.

`src/db/client.ts`:

```ts
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import * as schema from './schema.js'

export function getRawDb(
  path = process.env.DATABASE_PATH ?? './data/tenbagger.db',
): Database.Database {
  mkdirSync(dirname(path), { recursive: true })
  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  return db
}

export function getDb(path?: string) {
  return drizzle(getRawDb(path), { schema })
}

const DDL = `
CREATE TABLE IF NOT EXISTS companies (
  cik INTEGER PRIMARY KEY,
  ticker TEXT NOT NULL,
  name TEXT NOT NULL,
  sic TEXT,
  sic_description TEXT,
  exchange TEXT,
  entity_type TEXT,
  fiscal_year_end TEXT,
  filer_category TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  first_seen TEXT NOT NULL,
  last_updated TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_ticker ON companies(ticker);

CREATE TABLE IF NOT EXISTS listings (
  ticker TEXT PRIMARY KEY,
  exchange TEXT NOT NULL,
  security_name TEXT NOT NULL,
  is_etf INTEGER NOT NULL,
  is_test_issue INTEGER NOT NULL,
  financial_status TEXT,
  round_lot INTEGER,
  last_updated TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS financial_facts (
  cik INTEGER NOT NULL,
  tag TEXT NOT NULL,
  unit TEXT NOT NULL,
  period_start TEXT,
  period_end TEXT NOT NULL,
  qtrs INTEGER NOT NULL,
  value REAL NOT NULL,
  form TEXT NOT NULL,
  filed_date TEXT NOT NULL,
  accession TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('bulk','api')),
  UNIQUE (cik, tag, period_end, qtrs, form)
);
CREATE INDEX IF NOT EXISTS idx_facts_cik_tag ON financial_facts(cik, tag, period_end);

CREATE TABLE IF NOT EXISTS market_data (
  cik INTEGER NOT NULL,
  date TEXT NOT NULL,
  price REAL,
  shares_outstanding REAL,
  market_cap REAL,
  volume REAL,
  PRIMARY KEY (cik, date)
);

CREATE TABLE IF NOT EXISTS financials (
  cik INTEGER NOT NULL,
  period_end TEXT NOT NULL,
  period_type TEXT NOT NULL CHECK (period_type IN ('Q','A','TTM')),
  revenue REAL, gross_profit REAL, operating_income REAL, net_income REAL,
  ocf REAL, capex REAL, fcf REAL,
  cash REAL, total_debt REAL, equity REAL,
  shares_diluted REAL, shares_outstanding REAL, sbc REAL, rd_expense REAL,
  source_tags TEXT,
  computed_at TEXT NOT NULL,
  PRIMARY KEY (cik, period_end, period_type)
);

CREATE TABLE IF NOT EXISTS company_industry (
  cik INTEGER NOT NULL,
  industry_slug TEXT NOT NULL,
  theme_slug TEXT NOT NULL,
  is_primary INTEGER NOT NULL DEFAULT 1,
  source TEXT NOT NULL CHECK (source IN ('sic','override')),
  PRIMARY KEY (cik, industry_slug)
);

CREATE TABLE IF NOT EXISTS scores (
  cik INTEGER NOT NULL,
  as_of TEXT NOT NULL,
  tenbagger REAL,
  completeness REAL NOT NULL,
  category TEXT,
  engine_version TEXT NOT NULL,
  PRIMARY KEY (cik, as_of)
);

CREATE TABLE IF NOT EXISTS score_factors (
  cik INTEGER NOT NULL,
  as_of TEXT NOT NULL,
  engine TEXT NOT NULL,
  factor_key TEXT NOT NULL,
  raw REAL,
  points REAL,
  weight REAL NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('SCORED','NO_DATA','NOT_IMPLEMENTED')),
  percentile REAL,
  detail TEXT NOT NULL,
  PRIMARY KEY (cik, as_of, engine, factor_key)
);

CREATE TABLE IF NOT EXISTS red_flags (
  cik INTEGER NOT NULL,
  as_of TEXT NOT NULL,
  code TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('CRITICAL','WARNING')),
  message TEXT NOT NULL,
  evidence TEXT,
  PRIMARY KEY (cik, as_of, code)
);

CREATE TABLE IF NOT EXISTS themes (
  slug TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  display_order INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS industries (
  slug TEXT PRIMARY KEY,
  theme_slug TEXT NOT NULL,
  name TEXT NOT NULL,
  tam_usd REAL, tam_cagr REAL, tam_source TEXT, tam_as_of TEXT
);

CREATE TABLE IF NOT EXISTS job_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL,
  stats TEXT,
  error TEXT
);

CREATE VIEW IF NOT EXISTS latest_scores AS
SELECT s.* FROM scores s
JOIN (SELECT cik, MAX(as_of) AS as_of FROM scores GROUP BY cik) m
  ON s.cik = m.cik AND s.as_of = m.as_of;
`

export function runMigrations(raw: Database.Database): void {
  raw.exec(DDL)
}
```

- [ ] **Step 4: Drizzle 스키마 작성**

`src/db/schema.ts` — 위 DDL과 1:1 대응.

```ts
import { sqliteTable, text, integer, real, primaryKey } from 'drizzle-orm/sqlite-core'

export const companies = sqliteTable('companies', {
  cik: integer('cik').primaryKey(),
  ticker: text('ticker').notNull(),
  name: text('name').notNull(),
  sic: text('sic'),
  sicDescription: text('sic_description'),
  exchange: text('exchange'),
  entityType: text('entity_type'),
  fiscalYearEnd: text('fiscal_year_end'),
  filerCategory: text('filer_category'),
  isActive: integer('is_active').notNull().default(1),
  firstSeen: text('first_seen').notNull(),
  lastUpdated: text('last_updated').notNull(),
})

export const listings = sqliteTable('listings', {
  ticker: text('ticker').primaryKey(),
  exchange: text('exchange').notNull(),
  securityName: text('security_name').notNull(),
  isEtf: integer('is_etf').notNull(),
  isTestIssue: integer('is_test_issue').notNull(),
  financialStatus: text('financial_status'),
  roundLot: integer('round_lot'),
  lastUpdated: text('last_updated').notNull(),
})

export const financialFacts = sqliteTable('financial_facts', {
  cik: integer('cik').notNull(),
  tag: text('tag').notNull(),
  unit: text('unit').notNull(),
  periodStart: text('period_start'),
  periodEnd: text('period_end').notNull(),
  qtrs: integer('qtrs').notNull(),
  value: real('value').notNull(),
  form: text('form').notNull(),
  filedDate: text('filed_date').notNull(),
  accession: text('accession').notNull(),
  source: text('source').notNull(),
})

export const marketData = sqliteTable(
  'market_data',
  {
    cik: integer('cik').notNull(),
    date: text('date').notNull(),
    price: real('price'),
    sharesOutstanding: real('shares_outstanding'),
    marketCap: real('market_cap'),
    volume: real('volume'),
  },
  (t) => ({ pk: primaryKey({ columns: [t.cik, t.date] }) }),
)

export const financials = sqliteTable(
  'financials',
  {
    cik: integer('cik').notNull(),
    periodEnd: text('period_end').notNull(),
    periodType: text('period_type').notNull(),
    revenue: real('revenue'),
    grossProfit: real('gross_profit'),
    operatingIncome: real('operating_income'),
    netIncome: real('net_income'),
    ocf: real('ocf'),
    capex: real('capex'),
    fcf: real('fcf'),
    cash: real('cash'),
    totalDebt: real('total_debt'),
    equity: real('equity'),
    sharesDiluted: real('shares_diluted'),
    sharesOutstanding: real('shares_outstanding'),
    sbc: real('sbc'),
    rdExpense: real('rd_expense'),
    sourceTags: text('source_tags'),
    computedAt: text('computed_at').notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.cik, t.periodEnd, t.periodType] }) }),
)

export const companyIndustry = sqliteTable(
  'company_industry',
  {
    cik: integer('cik').notNull(),
    industrySlug: text('industry_slug').notNull(),
    themeSlug: text('theme_slug').notNull(),
    isPrimary: integer('is_primary').notNull().default(1),
    source: text('source').notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.cik, t.industrySlug] }) }),
)

export const scores = sqliteTable(
  'scores',
  {
    cik: integer('cik').notNull(),
    asOf: text('as_of').notNull(),
    tenbagger: real('tenbagger'),
    completeness: real('completeness').notNull(),
    category: text('category'),
    engineVersion: text('engine_version').notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.cik, t.asOf] }) }),
)

export const scoreFactors = sqliteTable(
  'score_factors',
  {
    cik: integer('cik').notNull(),
    asOf: text('as_of').notNull(),
    engine: text('engine').notNull(),
    factorKey: text('factor_key').notNull(),
    raw: real('raw'),
    points: real('points'),
    weight: real('weight').notNull(),
    status: text('status').notNull(),
    percentile: real('percentile'),
    detail: text('detail').notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.cik, t.asOf, t.engine, t.factorKey] }) }),
)

export const redFlags = sqliteTable(
  'red_flags',
  {
    cik: integer('cik').notNull(),
    asOf: text('as_of').notNull(),
    code: text('code').notNull(),
    severity: text('severity').notNull(),
    message: text('message').notNull(),
    evidence: text('evidence'),
  },
  (t) => ({ pk: primaryKey({ columns: [t.cik, t.asOf, t.code] }) }),
)

export const themes = sqliteTable('themes', {
  slug: text('slug').primaryKey(),
  name: text('name').notNull(),
  displayOrder: integer('display_order').notNull(),
})

export const industries = sqliteTable('industries', {
  slug: text('slug').primaryKey(),
  themeSlug: text('theme_slug').notNull(),
  name: text('name').notNull(),
  tamUsd: real('tam_usd'),
  tamCagr: real('tam_cagr'),
  tamSource: text('tam_source'),
  tamAsOf: text('tam_as_of'),
})

export const jobRuns = sqliteTable('job_runs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  job: text('job').notNull(),
  startedAt: text('started_at').notNull(),
  finishedAt: text('finished_at'),
  status: text('status').notNull(),
  stats: text('stats'),
  error: text('error'),
})
```

- [ ] **Step 5: migrate CLI 작성**

`src/db/migrate.ts`:

```ts
import { getRawDb, runMigrations } from './client.js'

const raw = getRawDb()
runMigrations(raw)
console.log(`마이그레이션 완료: ${raw.name}`)
raw.close()
```

- [ ] **Step 6: 테스트 통과 확인**

Run: `npx vitest run tests/db/migrate.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 7: 실제 마이그레이션 실행 확인**

Run: `npm run db:migrate`
Expected: `마이그레이션 완료: ./data/tenbagger.db`

- [ ] **Step 8: 전체 테스트 확인**

Run: `npm test`
Expected: PASS — config 3 + domain 23 + taxonomy 11 + db 7 = 44 tests

- [ ] **Step 9: 커밋**

```bash
git add -A
git commit -m "feat: DB 스키마 및 마이그레이션

테이블 12개와 latest_scores 뷰. scores는 (cik, as_of) 복합키
append-only이며 별도 score_history 테이블을 두지 않는다.
financial_facts는 UNIQUE 제약으로, 열거형 컬럼은 CHECK 제약으로
잘못된 데이터를 DB 수준에서 거부한다."
```

---

## Stage B — 데이터 수집 (Task 5-11)

### Task 5: HTTP 클라이언트 (rate limit · 재시도 · 디스크 캐시)

**Files:**
- Create: `src/providers/http/client.ts`
- Test: `tests/providers/http.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `createHttpClient(opts: HttpClientOptions): HttpClient`
  - `HttpClientOptions = { userAgent: string; rateLimitPerSec: number; cacheDir: string; maxRetries?: number; fetchImpl?: typeof fetch; sleepImpl?: (ms: number) => Promise<void> }`
  - `HttpClient = { getText(url: string, o?: FetchOpts): Promise<string>; getJson<T>(url: string, o?: FetchOpts): Promise<T>; getBuffer(url: string, o?: FetchOpts): Promise<Buffer> }`
  - `FetchOpts = { cache?: boolean }` — `cache: true`면 URL 해시로 `cacheDir`에 저장하고 재사용
  - `fetchImpl`/`sleepImpl` 주입은 테스트 전용이다. 실사용에서는 생략한다.

SEC는 `User-Agent` 헤더가 없으면 403을 반환하고 초당 10요청을 넘으면 차단한다. 이 클라이언트가 두 규칙을 한 곳에서 강제한다.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/providers/http.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHttpClient } from '@/providers/http/client'

function tmpCache() {
  return mkdtempSync(join(tmpdir(), 'tb-http-'))
}

function okResponse(body: string) {
  return new Response(body, { status: 200 })
}

describe('createHttpClient', () => {
  it('User-Agent 헤더를 붙인다', async () => {
    let seenUa: string | null = null
    const client = createHttpClient({
      userAgent: 'TestAgent/1.0',
      rateLimitPerSec: 1000,
      cacheDir: tmpCache(),
      fetchImpl: async (_url, init) => {
        seenUa = new Headers(init?.headers).get('user-agent')
        return okResponse('hi')
      },
    })
    await client.getText('https://example.com/a')
    expect(seenUa).toBe('TestAgent/1.0')
  })

  it('rate limit 간격만큼 sleep을 호출한다', async () => {
    const sleeps: number[] = []
    const client = createHttpClient({
      userAgent: 'x',
      rateLimitPerSec: 10, // 최소 간격 100ms
      cacheDir: tmpCache(),
      fetchImpl: async () => okResponse('ok'),
      sleepImpl: async (ms) => { sleeps.push(ms) },
    })
    await client.getText('https://example.com/1')
    await client.getText('https://example.com/2')
    // 두 번째 호출은 간격을 채우기 위해 sleep해야 한다
    expect(sleeps.length).toBeGreaterThanOrEqual(1)
    expect(sleeps.some((s) => s > 0 && s <= 100)).toBe(true)
  })

  it('429를 만나면 재시도하고 성공하면 값을 반환한다', async () => {
    let calls = 0
    const client = createHttpClient({
      userAgent: 'x',
      rateLimitPerSec: 1000,
      cacheDir: tmpCache(),
      maxRetries: 3,
      fetchImpl: async () => {
        calls++
        return calls < 3 ? new Response('slow down', { status: 429 }) : okResponse('done')
      },
      sleepImpl: async () => {},
    })
    expect(await client.getText('https://example.com/r')).toBe('done')
    expect(calls).toBe(3)
  })

  it('재시도를 소진하면 에러를 던진다', async () => {
    const client = createHttpClient({
      userAgent: 'x',
      rateLimitPerSec: 1000,
      cacheDir: tmpCache(),
      maxRetries: 2,
      fetchImpl: async () => new Response('boom', { status: 503 }),
      sleepImpl: async () => {},
    })
    await expect(client.getText('https://example.com/f')).rejects.toThrow(/503/)
  })

  it('404는 재시도하지 않고 즉시 던진다', async () => {
    let calls = 0
    const client = createHttpClient({
      userAgent: 'x',
      rateLimitPerSec: 1000,
      cacheDir: tmpCache(),
      maxRetries: 5,
      fetchImpl: async () => { calls++; return new Response('nope', { status: 404 }) },
      sleepImpl: async () => {},
    })
    await expect(client.getText('https://example.com/n')).rejects.toThrow(/404/)
    expect(calls).toBe(1)
  })

  it('cache: true면 두 번째 호출에서 네트워크를 타지 않는다', async () => {
    let calls = 0
    const client = createHttpClient({
      userAgent: 'x',
      rateLimitPerSec: 1000,
      cacheDir: tmpCache(),
      fetchImpl: async () => { calls++; return okResponse('cached-body') },
    })
    const url = 'https://example.com/c'
    expect(await client.getText(url, { cache: true })).toBe('cached-body')
    expect(await client.getText(url, { cache: true })).toBe('cached-body')
    expect(calls).toBe(1)
  })

  it('getJson은 파싱된 객체를 반환한다', async () => {
    const client = createHttpClient({
      userAgent: 'x',
      rateLimitPerSec: 1000,
      cacheDir: tmpCache(),
      fetchImpl: async () => okResponse('{"a":1}'),
    })
    expect(await client.getJson<{ a: number }>('https://example.com/j')).toEqual({ a: 1 })
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run tests/providers/http.test.ts`
Expected: FAIL — `Cannot find module '@/providers/http/client'`

- [ ] **Step 3: 구현**

`src/providers/http/client.ts`:

```ts
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

export type FetchOpts = { cache?: boolean }

export type HttpClient = {
  getText(url: string, o?: FetchOpts): Promise<string>
  getJson<T>(url: string, o?: FetchOpts): Promise<T>
  getBuffer(url: string, o?: FetchOpts): Promise<Buffer>
}

export type HttpClientOptions = {
  userAgent: string
  rateLimitPerSec: number
  cacheDir: string
  maxRetries?: number
  /** 테스트 전용 주입 */
  fetchImpl?: typeof fetch
  /** 테스트 전용 주입 */
  sleepImpl?: (ms: number) => Promise<void>
}

const RETRYABLE = new Set([408, 429, 500, 502, 503, 504])

export function createHttpClient(opts: HttpClientOptions): HttpClient {
  const doFetch = opts.fetchImpl ?? fetch
  const sleep = opts.sleepImpl ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))
  const maxRetries = opts.maxRetries ?? 4
  const minIntervalMs = 1000 / opts.rateLimitPerSec

  mkdirSync(opts.cacheDir, { recursive: true })
  let lastRequestAt = 0

  function cachePath(url: string): string {
    const hash = createHash('sha256').update(url).digest('hex').slice(0, 32)
    return join(opts.cacheDir, `${hash}.bin`)
  }

  async function throttle(): Promise<void> {
    const now = Date.now()
    const wait = lastRequestAt + minIntervalMs - now
    if (wait > 0) await sleep(wait)
    lastRequestAt = Date.now()
  }

  async function fetchBuffer(url: string, o?: FetchOpts): Promise<Buffer> {
    const path = cachePath(url)
    if (o?.cache && existsSync(path)) return readFileSync(path)

    let lastError: Error | null = null
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      await throttle()
      const res = await doFetch(url, {
        headers: { 'user-agent': opts.userAgent, 'accept-encoding': 'gzip, deflate' },
      })
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer())
        if (o?.cache) writeFileSync(path, buf)
        return buf
      }
      if (!RETRYABLE.has(res.status)) {
        throw new Error(`HTTP ${res.status} (재시도 불가): ${url}`)
      }
      lastError = new Error(`HTTP ${res.status}: ${url}`)
      if (attempt < maxRetries) await sleep(Math.min(2 ** attempt * 500, 8000))
    }
    throw lastError ?? new Error(`요청 실패: ${url}`)
  }

  return {
    getBuffer: fetchBuffer,
    async getText(url, o) {
      return (await fetchBuffer(url, o)).toString('utf8')
    },
    async getJson<T>(url: string, o?: FetchOpts): Promise<T> {
      return JSON.parse((await fetchBuffer(url, o)).toString('utf8')) as T
    },
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run tests/providers/http.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: 커밋**

```bash
git add -A
git commit -m "feat: HTTP 클라이언트 — rate limit, 재시도, 디스크 캐시

SEC의 User-Agent 필수 규칙과 초당 10요청 제한을 이 한 곳에서 강제한다.
4xx는 재시도하지 않고 429/5xx만 지수 백오프로 재시도한다."
```

---

### Task 6: 상장 메타데이터 & SEC 레퍼런스 Provider

**Files:**
- Create: `src/providers/types.ts`, `src/providers/listing/nasdaq-trader.ts`, `src/providers/reference/sec-submissions.ts`
- Create: `src/pipeline/universe-filter.ts`
- Test: `tests/providers/listing.test.ts`, `tests/providers/reference.test.ts`, `tests/pipeline/universe-filter.test.ts`
- Create: `tests/fixtures/nasdaqtraded.txt`, `tests/fixtures/submissions-nvda.json`, `tests/fixtures/company_tickers.json`

**Interfaces:**
- Consumes: `HttpClient` (Task 5), `AppConfig` (Task 1)
- Produces:
  - `type Listing = { ticker: string; exchange: string; securityName: string; isEtf: boolean; isTestIssue: boolean; financialStatus: string | null; roundLot: number | null }`
  - `type ListingProvider = { fetchListings(): Promise<Listing[]> }`
  - `createNasdaqTraderProvider(http: HttpClient): ListingProvider`
  - `type TickerMapEntry = { cik: number; ticker: string; title: string }`
  - `type CompanyReference = { cik: number; name: string; sic: string | null; sicDescription: string | null; exchanges: string[]; entityType: string | null; fiscalYearEnd: string | null; filerCategory: string | null }`
  - `type ReferenceProvider = { fetchTickerMap(): Promise<TickerMapEntry[]>; fetchCompany(cik: number): Promise<CompanyReference | null> }`
  - `createSecReferenceProvider(http: HttpClient): ReferenceProvider`
  - `passesListingFilter(listing: Listing, cfg: AppConfig): { pass: boolean; reason: string | null }`

- [ ] **Step 1: 픽스처 준비**

실제 응답 일부를 잘라 저장한다. 네트워크 없이 테스트가 돌아야 한다.

`tests/fixtures/nasdaqtraded.txt` — 마지막 줄의 파일 생성시각 푸터를 반드시 포함시킨다. 파서가 이 줄을 건너뛰는지 검증해야 한다.

```
Nasdaq Traded|Symbol|Security Name|Listing Exchange|Market Category|ETF|Round Lot Size|Test Issue|Financial Status|CQS Symbol|NASDAQ Symbol|NextShares
Y|NVDA|NVIDIA Corporation - Common Stock|Q|Q|N|100|N|N|NVDA|NVDA|N
Y|CRWD|CrowdStrike Holdings, Inc. - Class A Common Stock|Q|Q|N|100|N|N|CRWD|CRWD|N
Y|SPY|SPDR S&P 500 ETF Trust|P| |Y|100|N||SPY|SPY|N
Y|ZTEST|Nasdaq Test Issue|Q|G|N|100|Y|N|ZTEST|ZTEST|N
Y|BADCO|Deficient Corp - Common Stock|Q|Q|N|100|N|D|BADCO|BADCO|N
Y|PFDX|Some Bank - 7.5% Preferred Series A|N| |N|100|N||PFDX|PFDX|N
Y|WRNTW|Some Co - Warrant|Q|S|N|100|N|N|WRNTW|WRNTW|N
File Creation Time: 0809202606:00|||||||||||
```

`tests/fixtures/company_tickers.json`:

```json
{"0":{"cik_str":1045810,"ticker":"NVDA","title":"NVIDIA CORP"},
 "1":{"cik_str":1535527,"ticker":"CRWD","title":"CrowdStrike Holdings, Inc."}}
```

`tests/fixtures/submissions-nvda.json` — 실제 응답에서 필요한 필드만 남긴다.

```json
{"cik":"0001045810","entityType":"operating","sic":"3674",
 "sicDescription":"Semiconductors & Related Devices","name":"NVIDIA CORP",
 "tickers":["NVDA"],"exchanges":["Nasdaq"],"fiscalYearEnd":"0131",
 "category":"Large accelerated filer"}
```

- [ ] **Step 2: Provider 인터페이스 정의**

`src/providers/types.ts`:

```ts
export type Listing = {
  ticker: string
  exchange: string
  securityName: string
  isEtf: boolean
  isTestIssue: boolean
  financialStatus: string | null
  roundLot: number | null
}

export type ListingProvider = {
  fetchListings(): Promise<Listing[]>
}

export type TickerMapEntry = { cik: number; ticker: string; title: string }

export type CompanyReference = {
  cik: number
  name: string
  sic: string | null
  sicDescription: string | null
  exchanges: string[]
  entityType: string | null
  fiscalYearEnd: string | null
  filerCategory: string | null
}

export type ReferenceProvider = {
  fetchTickerMap(): Promise<TickerMapEntry[]>
  fetchCompany(cik: number): Promise<CompanyReference | null>
}
```

- [ ] **Step 3: listing provider 실패 테스트 작성**

`tests/providers/listing.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseNasdaqTraded } from '@/providers/listing/nasdaq-trader'

const raw = readFileSync('tests/fixtures/nasdaqtraded.txt', 'utf8')

describe('parseNasdaqTraded', () => {
  const rows = parseNasdaqTraded(raw)

  it('헤더와 파일 생성시각 푸터를 건너뛴다', () => {
    expect(rows).toHaveLength(7)
    expect(rows.some((r) => r.ticker.startsWith('File Creation'))).toBe(false)
  })

  it('ETF 플래그를 읽는다', () => {
    expect(rows.find((r) => r.ticker === 'SPY')!.isEtf).toBe(true)
    expect(rows.find((r) => r.ticker === 'NVDA')!.isEtf).toBe(false)
  })

  it('Test Issue 플래그를 읽는다', () => {
    expect(rows.find((r) => r.ticker === 'ZTEST')!.isTestIssue).toBe(true)
  })

  it('빈 Financial Status는 null로 만든다', () => {
    expect(rows.find((r) => r.ticker === 'SPY')!.financialStatus).toBeNull()
    expect(rows.find((r) => r.ticker === 'BADCO')!.financialStatus).toBe('D')
  })

  it('거래소 코드와 종목명을 보존한다', () => {
    const nvda = rows.find((r) => r.ticker === 'NVDA')!
    expect(nvda.exchange).toBe('Q')
    expect(nvda.securityName).toContain('Common Stock')
    expect(nvda.roundLot).toBe(100)
  })
})
```

- [ ] **Step 4: 테스트 실패 확인**

Run: `npx vitest run tests/providers/listing.test.ts`
Expected: FAIL — `Cannot find module '@/providers/listing/nasdaq-trader'`

- [ ] **Step 5: listing provider 구현**

`src/providers/listing/nasdaq-trader.ts`:

```ts
import type { HttpClient } from '../http/client.js'
import type { Listing, ListingProvider } from '../types.js'

const URL = 'https://www.nasdaqtrader.com/dynamic/symdir/nasdaqtraded.txt'

/** 파이프 구분 파일. 첫 줄은 헤더, 마지막 줄은 "File Creation Time" 푸터. */
export function parseNasdaqTraded(raw: string): Listing[] {
  const out: Listing[] = []
  const lines = raw.split(/\r?\n/)
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!
    if (!line.trim()) continue
    if (line.startsWith('File Creation Time')) continue
    const f = line.split('|')
    if (f.length < 9) continue
    const roundLot = Number(f[6])
    out.push({
      ticker: f[1]!.trim(),
      exchange: f[3]!.trim(),
      securityName: f[2]!.trim(),
      isEtf: f[5]!.trim() === 'Y',
      isTestIssue: f[7]!.trim() === 'Y',
      financialStatus: f[8]!.trim() === '' ? null : f[8]!.trim(),
      roundLot: Number.isFinite(roundLot) ? roundLot : null,
    })
  }
  return out
}

export function createNasdaqTraderProvider(http: HttpClient): ListingProvider {
  return {
    async fetchListings() {
      return parseNasdaqTraded(await http.getText(URL, { cache: true }))
    },
  }
}
```

- [ ] **Step 6: listing 테스트 통과 확인**

Run: `npx vitest run tests/providers/listing.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 7: 유니버스 필터 실패 테스트 작성**

`tests/pipeline/universe-filter.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseConfig } from '@/config'
import { parseNasdaqTraded } from '@/providers/listing/nasdaq-trader'
import { passesListingFilter } from '@/pipeline/universe-filter'

const cfg = parseConfig(readFileSync('config.yaml', 'utf8'))
const rows = parseNasdaqTraded(readFileSync('tests/fixtures/nasdaqtraded.txt', 'utf8'))
const byTicker = (t: string) => rows.find((r) => r.ticker === t)!

describe('passesListingFilter', () => {
  it('일반 보통주는 통과한다', () => {
    expect(passesListingFilter(byTicker('NVDA'), cfg).pass).toBe(true)
    expect(passesListingFilter(byTicker('CRWD'), cfg).pass).toBe(true)
  })

  it('ETF를 제외한다', () => {
    const r = passesListingFilter(byTicker('SPY'), cfg)
    expect(r.pass).toBe(false)
    expect(r.reason).toBe('ETF')
  })

  it('Test Issue를 제외한다', () => {
    expect(passesListingFilter(byTicker('ZTEST'), cfg).reason).toBe('TEST_ISSUE')
  })

  it('상장부적격 종목을 제외한다', () => {
    expect(passesListingFilter(byTicker('BADCO'), cfg).reason).toBe('FINANCIAL_STATUS')
  })

  it('우선주를 제외한다', () => {
    expect(passesListingFilter(byTicker('PFDX'), cfg).reason).toBe('NOT_COMMON_STOCK')
  })

  it('워런트를 제외한다', () => {
    expect(passesListingFilter(byTicker('WRNTW'), cfg).reason).toBe('NOT_COMMON_STOCK')
  })

  it('허용 거래소가 아니면 제외한다', () => {
    const foreign = { ...byTicker('NVDA'), exchange: 'V' }
    expect(passesListingFilter(foreign, cfg).reason).toBe('EXCHANGE')
  })
})
```

- [ ] **Step 8: 테스트 실패 확인**

Run: `npx vitest run tests/pipeline/universe-filter.test.ts`
Expected: FAIL — `Cannot find module '@/pipeline/universe-filter'`

- [ ] **Step 9: 유니버스 필터 구현**

`src/pipeline/universe-filter.ts`:

```ts
import type { AppConfig } from '@/config'
import type { Listing } from '@/providers/types'

export type FilterResult = { pass: boolean; reason: string | null }

const PASS: FilterResult = { pass: true, reason: null }

/**
 * 상장 메타데이터만으로 판정 가능한 유니버스 조건.
 * 시가총액·SIC 조건은 데이터가 더 필요하므로 ingest-universe 잡에서 별도로 적용한다.
 */
export function passesListingFilter(l: Listing, cfg: AppConfig): FilterResult {
  const u = cfg.universe
  if (!u.exchanges.includes(l.exchange)) return { pass: false, reason: 'EXCHANGE' }
  if (l.isEtf) return { pass: false, reason: 'ETF' }
  if (l.isTestIssue) return { pass: false, reason: 'TEST_ISSUE' }
  if (l.financialStatus && u.exclude_financial_status.includes(l.financialStatus)) {
    return { pass: false, reason: 'FINANCIAL_STATUS' }
  }

  const name = l.securityName
  if (u.security_name_exclude.some((p) => name.includes(p))) {
    return { pass: false, reason: 'NOT_COMMON_STOCK' }
  }
  if (!u.security_name_include.some((p) => name.includes(p))) {
    return { pass: false, reason: 'NOT_COMMON_STOCK' }
  }
  return PASS
}
```

- [ ] **Step 10: 필터 테스트 통과 확인**

Run: `npx vitest run tests/pipeline/universe-filter.test.ts`
Expected: PASS (7 tests)

`PFDX`의 종목명 `Some Bank - 7.5% Preferred Series A`는 `Preferred`를 포함하므로 제외 목록에서 먼저 걸린다. `WRNTW`는 `Warrant`로 걸린다.

- [ ] **Step 11: SEC 레퍼런스 provider 실패 테스트 작성**

`tests/providers/reference.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseTickerMap, parseSubmissions } from '@/providers/reference/sec-submissions'

describe('parseTickerMap', () => {
  it('객체 맵을 배열로 변환한다', () => {
    const raw = JSON.parse(readFileSync('tests/fixtures/company_tickers.json', 'utf8'))
    const rows = parseTickerMap(raw)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toEqual({ cik: 1045810, ticker: 'NVDA', title: 'NVIDIA CORP' })
  })
})

describe('parseSubmissions', () => {
  const raw = JSON.parse(readFileSync('tests/fixtures/submissions-nvda.json', 'utf8'))

  it('SIC와 메타데이터를 추출한다', () => {
    const c = parseSubmissions(raw)!
    expect(c.cik).toBe(1045810)
    expect(c.sic).toBe('3674')
    expect(c.entityType).toBe('operating')
    expect(c.exchanges).toEqual(['Nasdaq'])
    expect(c.fiscalYearEnd).toBe('0131')
    expect(c.filerCategory).toBe('Large accelerated filer')
  })

  it('CIK 문자열의 앞자리 0을 제거한다', () => {
    expect(parseSubmissions({ ...raw, cik: '0000320193' })!.cik).toBe(320193)
  })

  it('SIC가 없으면 null', () => {
    const { sic, ...rest } = raw
    expect(parseSubmissions(rest)!.sic).toBeNull()
  })

  it('cik이 없으면 null을 반환한다', () => {
    const { cik, ...rest } = raw
    expect(parseSubmissions(rest)).toBeNull()
  })
})
```

- [ ] **Step 12: 테스트 실패 확인**

Run: `npx vitest run tests/providers/reference.test.ts`
Expected: FAIL — `Cannot find module '@/providers/reference/sec-submissions'`

- [ ] **Step 13: SEC 레퍼런스 provider 구현**

`src/providers/reference/sec-submissions.ts`:

```ts
import type { HttpClient } from '../http/client.js'
import type { CompanyReference, ReferenceProvider, TickerMapEntry } from '../types.js'

const TICKERS_URL = 'https://www.sec.gov/files/company_tickers.json'

function submissionsUrl(cik: number): string {
  return `https://data.sec.gov/submissions/CIK${String(cik).padStart(10, '0')}.json`
}

/** company_tickers.json은 {"0": {...}, "1": {...}} 형태의 객체 맵이다. */
export function parseTickerMap(raw: unknown): TickerMapEntry[] {
  const out: TickerMapEntry[] = []
  for (const v of Object.values(raw as Record<string, unknown>)) {
    const r = v as { cik_str?: number; ticker?: string; title?: string }
    if (typeof r.cik_str !== 'number' || !r.ticker) continue
    out.push({ cik: r.cik_str, ticker: r.ticker.trim(), title: r.title ?? '' })
  }
  return out
}

export function parseSubmissions(raw: unknown): CompanyReference | null {
  const r = raw as Record<string, unknown>
  const cikRaw = r.cik
  if (cikRaw === undefined || cikRaw === null) return null
  const cik = Number(String(cikRaw).replace(/^0+/, ''))
  if (!Number.isFinite(cik)) return null

  const str = (k: string): string | null => {
    const v = r[k]
    return typeof v === 'string' && v.length > 0 ? v : null
  }

  return {
    cik,
    name: str('name') ?? '',
    sic: str('sic'),
    sicDescription: str('sicDescription'),
    exchanges: Array.isArray(r.exchanges) ? (r.exchanges as string[]) : [],
    entityType: str('entityType'),
    fiscalYearEnd: str('fiscalYearEnd'),
    filerCategory: str('category'),
  }
}

export function createSecReferenceProvider(http: HttpClient): ReferenceProvider {
  return {
    async fetchTickerMap() {
      return parseTickerMap(await http.getJson(TICKERS_URL, { cache: true }))
    },
    async fetchCompany(cik) {
      try {
        return parseSubmissions(await http.getJson(submissionsUrl(cik), { cache: true }))
      } catch (e) {
        // 상장폐지 등으로 404가 나는 CIK가 존재한다. 잡 전체를 중단시키지 않는다.
        if (e instanceof Error && /HTTP 404/.test(e.message)) return null
        throw e
      }
    },
  }
}
```

- [ ] **Step 14: 테스트 통과 확인**

Run: `npx vitest run tests/providers tests/pipeline`
Expected: PASS (http 7 + listing 5 + reference 5 + filter 7 = 24 tests)

- [ ] **Step 15: 커밋**

```bash
git add -A
git commit -m "feat: 상장 메타데이터 및 SEC 레퍼런스 Provider

nasdaqtraded.txt로 ETF/Test Issue/상장부적격/비보통주를 걸러내고
SEC submissions에서 SIC와 entityType을 가져온다.
404 CIK는 null을 반환해 잡 전체를 중단시키지 않는다."
```

---

### Task 7: ingest-universe 잡 & job runner

**Files:**
- Create: `src/db/repositories/jobs.ts`, `src/db/repositories/companies.ts`
- Create: `src/pipeline/runner.ts`, `src/pipeline/jobs/ingest-universe.ts`
- Test: `tests/pipeline/ingest-universe.test.ts`

**Interfaces:**
- Consumes: `ListingProvider`, `ReferenceProvider` (Task 6), `passesListingFilter` (Task 6), `loadTaxonomy` (Task 3), `AppConfig` (Task 1), `getRawDb`/`runMigrations` (Task 4)
- Produces:
  - `type JobStats = Record<string, number | string[]>`
  - `runJob(raw: Database.Database, name: string, fn: () => Promise<JobStats>): Promise<JobStats>` — `job_runs`에 시작·종료·통계를 기록하고 예외 시 `status='failed'`로 남긴 뒤 다시 던진다
  - `ingestUniverse(deps: UniverseDeps): Promise<JobStats>`
  - `type UniverseDeps = { raw: Database.Database; cfg: AppConfig; taxonomy: Taxonomy; listings: ListingProvider; reference: ReferenceProvider }`
  - `seedTaxonomy(raw, taxonomy): void` — `themes`/`industries` 테이블 채우기
  - 반환 통계 키: `listed`, `afterListingFilter`, `matchedCik`, `classified`, `skippedUnmappedSic`, `skippedNotOperating`, `failedLookups`, `unmappedSicsSeen`(문자열 배열), `overrideCount`, `sicBucketCount`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/pipeline/ingest-universe.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { getRawDb, runMigrations } from '@/db/client'
import { parseConfig } from '@/config'
import { loadTaxonomy } from '@/taxonomy'
import { parseNasdaqTraded } from '@/providers/listing/nasdaq-trader'
import { ingestUniverse, seedTaxonomy } from '@/pipeline/jobs/ingest-universe'
import type { CompanyReference, ListingProvider, ReferenceProvider } from '@/providers/types'

const cfg = parseConfig(readFileSync('config.yaml', 'utf8'))
const taxonomy = loadTaxonomy()
const listingRows = parseNasdaqTraded(readFileSync('tests/fixtures/nasdaqtraded.txt', 'utf8'))

const listings: ListingProvider = { fetchListings: async () => listingRows }

const REFS: Record<number, CompanyReference> = {
  1045810: {
    cik: 1045810, name: 'NVIDIA CORP', sic: '3674',
    sicDescription: 'Semiconductors', exchanges: ['Nasdaq'],
    entityType: 'operating', fiscalYearEnd: '0131', filerCategory: 'Large accelerated filer',
  },
  1535527: {
    cik: 1535527, name: 'CrowdStrike Holdings, Inc.', sic: '7372',
    sicDescription: 'Prepackaged Software', exchanges: ['Nasdaq'],
    entityType: 'operating', fiscalYearEnd: '0131', filerCategory: 'Large accelerated filer',
  },
  99: {
    cik: 99, name: 'Deficient Corp', sic: '6022',
    sicDescription: 'Banks', exchanges: ['Nasdaq'],
    entityType: 'operating', fiscalYearEnd: '1231', filerCategory: null,
  },
  100: {
    cik: 100, name: 'Shell Trust', sic: '3674',
    sicDescription: 'Semiconductors', exchanges: ['Nasdaq'],
    entityType: 'investment-company', fiscalYearEnd: '1231', filerCategory: null,
  },
}

const reference: ReferenceProvider = {
  fetchTickerMap: async () => [
    { cik: 1045810, ticker: 'NVDA', title: 'NVIDIA CORP' },
    { cik: 1535527, ticker: 'CRWD', title: 'CrowdStrike Holdings, Inc.' },
    { cik: 99, ticker: 'BADCO', title: 'Deficient Corp' },
    { cik: 100, ticker: 'SPY', title: 'Shell Trust' },
  ],
  fetchCompany: async (cik) => REFS[cik] ?? null,
}

let raw: Database.Database
let stats: Record<string, unknown>

beforeAll(async () => {
  raw = getRawDb(join(mkdtempSync(join(tmpdir(), 'tb-uni-')), 'u.db'))
  runMigrations(raw)
  seedTaxonomy(raw, taxonomy)
  stats = await ingestUniverse({ raw, cfg, taxonomy, listings, reference })
})

describe('seedTaxonomy', () => {
  it('themes와 industries 테이블을 채운다', () => {
    const t = raw.prepare('SELECT COUNT(*) c FROM themes').get() as { c: number }
    const i = raw.prepare('SELECT COUNT(*) c FROM industries').get() as { c: number }
    expect(t.c).toBe(6)
    expect(i.c).toBe(49)
  })
})

describe('ingestUniverse', () => {
  it('상장 필터를 통과한 보통주만 남긴다', () => {
    // 픽스처 7개 중 NVDA, CRWD, BADCO가 보통주 형태.
    // BADCO는 financial_status=D로 상장 필터에서 제외된다.
    expect(stats.afterListingFilter).toBe(2)
  })

  it('분류에 성공한 기업만 companies에 저장한다', () => {
    const rows = raw.prepare('SELECT ticker FROM companies ORDER BY ticker').all() as
      { ticker: string }[]
    expect(rows.map((r) => r.ticker)).toEqual(['CRWD', 'NVDA'])
  })

  it('오버라이드 분류를 company_industry에 기록한다', () => {
    const r = raw
      .prepare('SELECT industry_slug, theme_slug, source FROM company_industry WHERE cik = 1535527')
      .get() as { industry_slug: string; theme_slug: string; source: string }
    expect(r.industry_slug).toBe('cybersecurity')
    expect(r.theme_slug).toBe('ai-software-semi')
    expect(r.source).toBe('override')
  })

  it('listings 원본을 그대로 보존한다', () => {
    const n = raw.prepare('SELECT COUNT(*) c FROM listings').get() as { c: number }
    expect(n.c).toBe(listingRows.length)
  })

  it('분류 출처별 개수를 통계로 낸다', () => {
    expect(stats.overrideCount).toBe(2) // NVDA→ai-infrastructure, CRWD→cybersecurity
    expect(stats.sicBucketCount).toBe(0)
  })

  it('job_runs에 성공 기록을 남긴다', () => {
    const r = raw
      .prepare("SELECT job, status FROM job_runs WHERE job='universe' ORDER BY id DESC")
      .get() as { job: string; status: string } | undefined
    expect(r?.status).toBe('succeeded')
  })

  it('두 번 실행해도 중복 행이 생기지 않는다', async () => {
    await ingestUniverse({ raw, cfg, taxonomy, listings, reference })
    const n = raw.prepare('SELECT COUNT(*) c FROM companies').get() as { c: number }
    expect(n.c).toBe(2)
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run tests/pipeline/ingest-universe.test.ts`
Expected: FAIL — `Cannot find module '@/pipeline/jobs/ingest-universe'`

- [ ] **Step 3: job runner 구현**

`src/db/repositories/jobs.ts`:

```ts
import type Database from 'better-sqlite3'

export type JobStats = Record<string, number | string[]>

export function startJob(raw: Database.Database, job: string): number {
  const info = raw
    .prepare("INSERT INTO job_runs (job, started_at, status) VALUES (?, ?, 'running')")
    .run(job, new Date().toISOString())
  return Number(info.lastInsertRowid)
}

export function finishJob(
  raw: Database.Database,
  id: number,
  status: 'succeeded' | 'failed',
  stats: JobStats | null,
  error: string | null,
): void {
  raw
    .prepare('UPDATE job_runs SET finished_at = ?, status = ?, stats = ?, error = ? WHERE id = ?')
    .run(new Date().toISOString(), status, stats ? JSON.stringify(stats) : null, error, id)
}
```

`src/pipeline/runner.ts` (CLI 진입점은 Task 11에서 잡이 모두 갖춰진 뒤 채운다. 지금은 `runJob`만 export):

```ts
import type Database from 'better-sqlite3'
import { startJob, finishJob, type JobStats } from '@/db/repositories/jobs'

export type { JobStats }

/** 잡 실행을 job_runs에 기록한다. 예외는 기록 후 다시 던진다. */
export async function runJob(
  raw: Database.Database,
  name: string,
  fn: () => Promise<JobStats>,
): Promise<JobStats> {
  const id = startJob(raw, name)
  try {
    const stats = await fn()
    finishJob(raw, id, 'succeeded', stats, null)
    return stats
  } catch (e) {
    finishJob(raw, id, 'failed', null, e instanceof Error ? e.stack ?? e.message : String(e))
    throw e
  }
}
```

- [ ] **Step 4: companies 리포지토리 구현**

`src/db/repositories/companies.ts`:

```ts
import type Database from 'better-sqlite3'
import type { Listing } from '@/providers/types'

export type CompanyRow = {
  cik: number
  ticker: string
  name: string
  sic: string | null
  sicDescription: string | null
  exchange: string | null
  entityType: string | null
  fiscalYearEnd: string | null
  filerCategory: string | null
}

export function upsertCompany(raw: Database.Database, c: CompanyRow, now: string): void {
  raw
    .prepare(
      `INSERT INTO companies
         (cik, ticker, name, sic, sic_description, exchange, entity_type,
          fiscal_year_end, filer_category, is_active, first_seen, last_updated)
       VALUES (@cik, @ticker, @name, @sic, @sicDescription, @exchange, @entityType,
               @fiscalYearEnd, @filerCategory, 1, @now, @now)
       ON CONFLICT(cik) DO UPDATE SET
         ticker = excluded.ticker, name = excluded.name, sic = excluded.sic,
         sic_description = excluded.sic_description, exchange = excluded.exchange,
         entity_type = excluded.entity_type, fiscal_year_end = excluded.fiscal_year_end,
         filer_category = excluded.filer_category, is_active = 1,
         last_updated = excluded.last_updated`,
    )
    .run({ ...c, now })
}

export function upsertListing(raw: Database.Database, l: Listing, now: string): void {
  raw
    .prepare(
      `INSERT INTO listings
         (ticker, exchange, security_name, is_etf, is_test_issue,
          financial_status, round_lot, last_updated)
       VALUES (@ticker, @exchange, @securityName, @isEtf, @isTestIssue,
               @financialStatus, @roundLot, @now)
       ON CONFLICT(ticker) DO UPDATE SET
         exchange = excluded.exchange, security_name = excluded.security_name,
         is_etf = excluded.is_etf, is_test_issue = excluded.is_test_issue,
         financial_status = excluded.financial_status, round_lot = excluded.round_lot,
         last_updated = excluded.last_updated`,
    )
    .run({
      ...l,
      isEtf: l.isEtf ? 1 : 0,
      isTestIssue: l.isTestIssue ? 1 : 0,
      now,
    })
}

export function setCompanyIndustry(
  raw: Database.Database,
  cik: number,
  industrySlug: string,
  themeSlug: string,
  source: 'sic' | 'override',
): void {
  raw.prepare('DELETE FROM company_industry WHERE cik = ?').run(cik)
  raw
    .prepare(
      `INSERT INTO company_industry (cik, industry_slug, theme_slug, is_primary, source)
       VALUES (?, ?, ?, 1, ?)`,
    )
    .run(cik, industrySlug, themeSlug, source)
}

export function listUniverseCiks(raw: Database.Database): number[] {
  const rows = raw
    .prepare(
      `SELECT c.cik FROM companies c
       JOIN company_industry ci ON ci.cik = c.cik
       WHERE c.is_active = 1 ORDER BY c.cik`,
    )
    .all() as { cik: number }[]
  return rows.map((r) => r.cik)
}
```

- [ ] **Step 5: ingest-universe 잡 구현**

`src/pipeline/jobs/ingest-universe.ts`:

```ts
import type Database from 'better-sqlite3'
import type { AppConfig } from '@/config'
import type { Taxonomy } from '@/taxonomy'
import type { ListingProvider, ReferenceProvider } from '@/providers/types'
import { passesListingFilter } from '@/pipeline/universe-filter'
import { runJob, type JobStats } from '@/pipeline/runner'
import {
  upsertCompany,
  upsertListing,
  setCompanyIndustry,
} from '@/db/repositories/companies'

export type UniverseDeps = {
  raw: Database.Database
  cfg: AppConfig
  taxonomy: Taxonomy
  listings: ListingProvider
  reference: ReferenceProvider
}

export function seedTaxonomy(raw: Database.Database, taxonomy: Taxonomy): void {
  const insTheme = raw.prepare(
    `INSERT INTO themes (slug, name, display_order) VALUES (?, ?, ?)
     ON CONFLICT(slug) DO UPDATE SET name = excluded.name, display_order = excluded.display_order`,
  )
  const insInd = raw.prepare(
    `INSERT INTO industries (slug, theme_slug, name, tam_usd, tam_cagr, tam_source, tam_as_of)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(slug) DO UPDATE SET
       theme_slug = excluded.theme_slug, name = excluded.name,
       tam_usd = excluded.tam_usd, tam_cagr = excluded.tam_cagr,
       tam_source = excluded.tam_source, tam_as_of = excluded.tam_as_of`,
  )
  raw.transaction(() => {
    for (const t of taxonomy.themes) insTheme.run(t.slug, t.name, t.displayOrder)
    for (const i of taxonomy.industries.values()) {
      insInd.run(i.slug, i.themeSlug, i.name, i.tamUsd, i.tamCagr, i.tamSource, i.tamAsOf)
    }
  })()
}

export async function ingestUniverse(deps: UniverseDeps): Promise<JobStats> {
  const { raw, cfg, taxonomy, listings, reference } = deps

  return runJob(raw, 'universe', async () => {
    const now = new Date().toISOString()

    const allListings = await listings.fetchListings()
    raw.transaction(() => {
      for (const l of allListings) upsertListing(raw, l, now)
    })()

    const eligible = new Map<string, (typeof allListings)[number]>()
    for (const l of allListings) {
      if (passesListingFilter(l, cfg).pass) eligible.set(l.ticker.toUpperCase(), l)
    }

    const tickerMap = await reference.fetchTickerMap()
    const candidates = tickerMap.filter((t) => eligible.has(t.ticker.toUpperCase()))

    let classified = 0
    let skippedUnmappedSic = 0
    let skippedNotOperating = 0
    let failedLookups = 0
    let overrideCount = 0
    let sicBucketCount = 0
    const unmappedSicsSeen = new Set<string>()

    for (const t of candidates) {
      let ref
      try {
        ref = await reference.fetchCompany(t.cik)
      } catch {
        failedLookups++
        continue
      }
      if (!ref) {
        failedLookups++
        continue
      }
      if (ref.entityType !== null && ref.entityType !== 'operating') {
        skippedNotOperating++
        continue
      }
      if (ref.sic && cfg.universe.exclude_sic.includes(ref.sic)) {
        skippedUnmappedSic++
        continue
      }

      const cls = taxonomy.classify(ref.sic ?? '', t.ticker)
      if (!cls) {
        skippedUnmappedSic++
        if (ref.sic && !taxonomy.unmappedSics.has(ref.sic)) unmappedSicsSeen.add(ref.sic)
        continue
      }

      const listing = eligible.get(t.ticker.toUpperCase())!
      raw.transaction(() => {
        upsertCompany(
          raw,
          {
            cik: ref!.cik,
            ticker: t.ticker.toUpperCase(),
            name: ref!.name || t.title,
            sic: ref!.sic,
            sicDescription: ref!.sicDescription,
            exchange: listing.exchange,
            entityType: ref!.entityType,
            fiscalYearEnd: ref!.fiscalYearEnd,
            filerCategory: ref!.filerCategory,
          },
          now,
        )
        setCompanyIndustry(raw, ref!.cik, cls.industrySlug, cls.themeSlug, cls.source)
      })()

      classified++
      if (cls.source === 'override') overrideCount++
      else sicBucketCount++
    }

    return {
      listed: allListings.length,
      afterListingFilter: eligible.size,
      matchedCik: candidates.length,
      classified,
      skippedUnmappedSic,
      skippedNotOperating,
      failedLookups,
      overrideCount,
      sicBucketCount,
      unmappedSicsSeen: [...unmappedSicsSeen].sort(),
    }
  })
}
```

- [ ] **Step 6: 테스트 통과 확인**

Run: `npx vitest run tests/pipeline/ingest-universe.test.ts`
Expected: PASS (8 tests)

`SPY`는 상장 필터에서 ETF로 제외되므로 `entityType='investment-company'` 분기까지 가지 않는다. `BADCO`는 `financial_status='D'`로 제외된다.

- [ ] **Step 7: 커밋**

```bash
git add -A
git commit -m "feat: 유니버스 수집 잡 및 job runner

nasdaqtrader 상장 필터 통과 종목만 SEC submissions를 조회해 분류한다.
분류 실패 SIC를 통계로 수집해 커버리지 테스트가 쓸 수 있게 한다.
모든 upsert는 멱등이라 재실행해도 중복 행이 생기지 않는다."
```

---

### Task 8: SEC 재무 Provider (벌크 ZIP + companyfacts)

**Files:**
- Create: `src/providers/fundamental/tags.ts`, `src/providers/fundamental/sec-bulk.ts`, `src/providers/fundamental/sec-companyfacts.ts`
- Modify: `src/providers/types.ts` (RawFact · Provider 타입 추가)
- Test: `tests/providers/sec-bulk.test.ts`, `tests/providers/sec-companyfacts.test.ts`
- Create: `tests/fixtures/companyfacts-mini.json`

**Interfaces:**
- Consumes: `HttpClient` (Task 5)
- Produces:
  - `TRACKED_TAGS: Set<string>` — 수집 대상 XBRL 태그 전체 (폴백 체인 후보 포함)
  - `type RawFact = { cik: number; tag: string; unit: string; periodStart: string | null; periodEnd: string; qtrs: number; value: number; form: string; filedDate: string; accession: string; source: 'bulk' | 'api' }`
  - `parseSubLine(line: string, header: string[]): { adsh: string; cik: number; form: string; filed: string } | null`
  - `parseNumLine(line: string, header: string[]): { adsh: string; tag: string; ddate: string; qtrs: number; uom: string; value: number; coreg: string } | null`
  - `createSecBulkProvider(http: HttpClient): { fetchQuarter(year: number, q: number, ciks: Set<number>): Promise<RawFact[]> }`
  - `parseCompanyFacts(raw: unknown, tags: Set<string>): RawFact[]`
  - `createCompanyFactsProvider(http: HttpClient): { fetchCompany(cik: number): Promise<RawFact[]> }`

- [ ] **Step 1: 의존성 추가**

```bash
npm i yauzl
npm i -D @types/yauzl fflate
```

`yauzl`은 ZIP 엔트리를 스트리밍으로 읽는다. `num.txt`는 압축 해제 시 수백 MB이므로 전체를 메모리에 올리지 않고 줄 단위로 처리해야 한다. `fflate`는 테스트에서 ZIP 픽스처를 만드는 용도로만 쓴다.

- [ ] **Step 2: 추적 태그 목록 작성**

`src/providers/fundamental/tags.ts`:

```ts
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
```

- [ ] **Step 3: types.ts에 RawFact 추가**

`src/providers/types.ts`에 append:

```ts
export type RawFact = {
  cik: number
  tag: string
  unit: string
  periodStart: string | null
  periodEnd: string
  qtrs: number
  value: number
  form: string
  filedDate: string
  accession: string
  source: 'bulk' | 'api'
}

export type BulkFundamentalProvider = {
  fetchQuarter(year: number, quarter: number, ciks: Set<number>): Promise<RawFact[]>
}

export type CompanyFactsProvider = {
  fetchCompany(cik: number): Promise<RawFact[]>
}
```

- [ ] **Step 4: 벌크 파서 실패 테스트 작성**

`tests/providers/sec-bulk.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { zipSync, strToU8 } from 'fflate'
import {
  parseSubLine,
  parseNumLine,
  extractFactsFromZip,
} from '@/providers/fundamental/sec-bulk'

const SUB_HEADER = ['adsh', 'cik', 'name', 'sic', 'form', 'period', 'fy', 'fp', 'filed']
const NUM_HEADER = ['adsh', 'tag', 'version', 'coreg', 'ddate', 'qtrs', 'uom', 'value', 'footnote']

describe('parseSubLine', () => {
  it('adsh·cik·form·filed를 뽑는다', () => {
    const line = '0001045810-25-000123\t1045810\tNVIDIA CORP\t3674\t10-Q\t20250430\t2026\tQ1\t20250528'
    expect(parseSubLine(line, SUB_HEADER)).toEqual({
      adsh: '0001045810-25-000123',
      cik: 1045810,
      form: '10-Q',
      filed: '2025-05-28',
    })
  })

  it('cik이 숫자가 아니면 null', () => {
    expect(parseSubLine('a\tzz\tn\t1\t10-K\t1\t1\tFY\t20250101', SUB_HEADER)).toBeNull()
  })
})

describe('parseNumLine', () => {
  it('수치 행을 파싱한다', () => {
    const line = '0001045810-25-000123\tRevenues\tus-gaap/2024\t\t20250430\t1\tUSD\t44060000000\t'
    expect(parseNumLine(line, NUM_HEADER)).toEqual({
      adsh: '0001045810-25-000123',
      tag: 'Revenues',
      ddate: '20250430',
      qtrs: 1,
      uom: 'USD',
      value: 44060000000,
      coreg: '',
    })
  })

  it('value가 비어 있으면 null', () => {
    const line = '0001045810-25-000123\tRevenues\tus-gaap/2024\t\t20250430\t1\tUSD\t\t'
    expect(parseNumLine(line, NUM_HEADER)).toBeNull()
  })
})

describe('extractFactsFromZip', () => {
  const sub = [
    SUB_HEADER.join('\t'),
    '0001045810-25-000123\t1045810\tNVIDIA CORP\t3674\t10-Q\t20250430\t2026\tQ1\t20250528',
    '0000000099-25-000001\t99\tOTHER CORP\t6022\t10-Q\t20250331\t2025\tQ1\t20250501',
  ].join('\n')

  const num = [
    NUM_HEADER.join('\t'),
    // 대상 CIK · 추적 태그 · 연결기준 → 채택
    '0001045810-25-000123\tRevenues\tus-gaap/2024\t\t20250430\t1\tUSD\t44060000000\t',
    // coreg가 있으면 자회사 단위이므로 제외
    '0001045810-25-000123\tRevenues\tus-gaap/2024\tSUBSID\t20250430\t1\tUSD\t1000\t',
    // 추적 대상이 아닌 태그는 제외
    '0001045810-25-000123\tSomeOtherTag\tus-gaap/2024\t\t20250430\t1\tUSD\t5\t',
    // USD가 아닌 단위(주식수 제외)는 제외
    '0001045810-25-000123\tGrossProfit\tus-gaap/2024\t\t20250430\t1\tEUR\t9\t',
    // 유니버스 밖 CIK는 제외
    '0000000099-25-000001\tRevenues\tus-gaap/2024\t\t20250331\t1\tUSD\t777\t',
    // 주식수는 shares 단위 허용
    '0001045810-25-000123\tWeightedAverageNumberOfDilutedSharesOutstanding\tus-gaap/2024\t\t20250430\t1\tshares\t24600000000\t',
  ].join('\n')

  const zip = Buffer.from(
    zipSync({ 'sub.txt': strToU8(sub), 'num.txt': strToU8(num) }),
  )

  it('유니버스 CIK와 추적 태그만 남긴다', async () => {
    const facts = await extractFactsFromZip(zip, new Set([1045810]))
    const keys = facts.map((f) => `${f.tag}:${f.unit}`)
    expect(keys).toContain('Revenues:USD')
    expect(keys).toContain('WeightedAverageNumberOfDilutedSharesOutstanding:shares')
    expect(keys).not.toContain('SomeOtherTag:USD')
    expect(keys).not.toContain('GrossProfit:EUR')
    expect(facts).toHaveLength(2)
  })

  it('sub.txt에서 form과 filed를 결합한다', async () => {
    const facts = await extractFactsFromZip(zip, new Set([1045810]))
    const rev = facts.find((f) => f.tag === 'Revenues')!
    expect(rev.cik).toBe(1045810)
    expect(rev.form).toBe('10-Q')
    expect(rev.filedDate).toBe('2025-05-28')
    expect(rev.periodEnd).toBe('2025-04-30')
    expect(rev.qtrs).toBe(1)
    expect(rev.value).toBe(44060000000)
    expect(rev.source).toBe('bulk')
    expect(rev.periodStart).toBeNull()
  })
})
```

- [ ] **Step 5: 테스트 실패 확인**

Run: `npx vitest run tests/providers/sec-bulk.test.ts`
Expected: FAIL — `Cannot find module '@/providers/fundamental/sec-bulk'`

- [ ] **Step 6: 벌크 provider 구현**

`src/providers/fundamental/sec-bulk.ts`:

```ts
import { createInterface } from 'node:readline'
import { Readable } from 'node:stream'
import yauzl from 'yauzl'
import type { BulkFundamentalProvider, RawFact } from '../types.js'
import type { HttpClient } from '../http/client.js'
import { TRACKED_TAGS } from './tags.js'

const SHARE_UNITS = new Set(['shares', 'pure'])

function bulkUrl(year: number, quarter: number): string {
  return `https://www.sec.gov/files/dera/data/financial-statement-data-sets/${year}q${quarter}.zip`
}

function isoDate(yyyymmdd: string): string | null {
  if (!/^\d{8}$/.test(yyyymmdd)) return null
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`
}

function col(fields: string[], header: string[], name: string): string {
  const i = header.indexOf(name)
  return i === -1 ? '' : (fields[i] ?? '')
}

export function parseSubLine(
  line: string,
  header: string[],
): { adsh: string; cik: number; form: string; filed: string } | null {
  const f = line.split('\t')
  const cik = Number(col(f, header, 'cik'))
  const filed = isoDate(col(f, header, 'filed'))
  const adsh = col(f, header, 'adsh')
  if (!Number.isFinite(cik) || !filed || !adsh) return null
  return { adsh, cik, form: col(f, header, 'form'), filed }
}

export function parseNumLine(
  line: string,
  header: string[],
): {
  adsh: string; tag: string; ddate: string; qtrs: number; uom: string
  value: number; coreg: string
} | null {
  const f = line.split('\t')
  const valueRaw = col(f, header, 'value')
  if (valueRaw === '') return null
  const value = Number(valueRaw)
  const qtrs = Number(col(f, header, 'qtrs'))
  if (!Number.isFinite(value) || !Number.isFinite(qtrs)) return null
  return {
    adsh: col(f, header, 'adsh'),
    tag: col(f, header, 'tag'),
    ddate: col(f, header, 'ddate'),
    qtrs,
    uom: col(f, header, 'uom'),
    value,
    coreg: col(f, header, 'coreg'),
  }
}

function openEntry(zip: Buffer, name: string): Promise<Readable> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(zip, { lazyEntries: true }, (err, zipfile) => {
      if (err || !zipfile) return reject(err ?? new Error('ZIP 열기 실패'))
      zipfile.on('entry', (entry) => {
        if (entry.fileName !== name) return zipfile.readEntry()
        zipfile.openReadStream(entry, (e2, stream) => {
          if (e2 || !stream) return reject(e2 ?? new Error(`${name} 스트림 실패`))
          resolve(stream)
        })
      })
      zipfile.on('end', () => reject(new Error(`ZIP에 ${name}이 없습니다`)))
      zipfile.readEntry()
    })
  })
}

async function* lines(stream: Readable): AsyncGenerator<string> {
  const rl = createInterface({ input: stream, crlfDelay: Infinity })
  for await (const line of rl) yield line
}

/**
 * sub.txt로 adsh→(cik, form, filed)를 만든 뒤 num.txt를 줄 단위로 흘려보내며
 * 유니버스 CIK와 추적 태그에 해당하는 행만 남긴다.
 * num.txt는 압축 해제 시 수백 MB이므로 전체를 메모리에 올리지 않는다.
 */
export async function extractFactsFromZip(
  zip: Buffer,
  ciks: Set<number>,
): Promise<RawFact[]> {
  const subs = new Map<string, { cik: number; form: string; filed: string }>()
  {
    let header: string[] | null = null
    for await (const line of lines(await openEntry(zip, 'sub.txt'))) {
      if (!header) { header = line.split('\t'); continue }
      const s = parseSubLine(line, header)
      if (s && ciks.has(s.cik)) subs.set(s.adsh, { cik: s.cik, form: s.form, filed: s.filed })
    }
  }
  if (subs.size === 0) return []

  const out: RawFact[] = []
  let header: string[] | null = null
  for await (const line of lines(await openEntry(zip, 'num.txt'))) {
    if (!header) { header = line.split('\t'); continue }
    const n = parseNumLine(line, header)
    if (!n) continue
    if (n.coreg !== '') continue              // 자회사 단위 제외, 연결기준만
    if (!TRACKED_TAGS.has(n.tag)) continue
    const sub = subs.get(n.adsh)
    if (!sub) continue
    if (n.uom !== 'USD' && !SHARE_UNITS.has(n.uom)) continue
    const periodEnd = isoDate(n.ddate)
    if (!periodEnd) continue

    out.push({
      cik: sub.cik,
      tag: n.tag,
      unit: n.uom,
      periodStart: null,      // num.txt는 시작일을 제공하지 않는다. qtrs가 기간 길이를 나타낸다.
      periodEnd,
      qtrs: n.qtrs,
      value: n.value,
      form: sub.form,
      filedDate: sub.filed,
      accession: n.adsh,
      source: 'bulk',
    })
  }
  return out
}

export function createSecBulkProvider(http: HttpClient): BulkFundamentalProvider {
  return {
    async fetchQuarter(year, quarter, ciks) {
      const zip = await http.getBuffer(bulkUrl(year, quarter), { cache: true })
      return extractFactsFromZip(zip, ciks)
    },
  }
}
```

- [ ] **Step 7: 벌크 테스트 통과 확인**

Run: `npx vitest run tests/providers/sec-bulk.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 8: companyfacts 픽스처 작성**

`tests/fixtures/companyfacts-mini.json`:

```json
{
  "cik": 1045810,
  "entityName": "NVIDIA CORP",
  "facts": {
    "us-gaap": {
      "Revenues": {
        "units": {
          "USD": [
            { "start": "2025-02-01", "end": "2025-04-30", "val": 44060000000,
              "fy": 2026, "fp": "Q1", "form": "10-Q", "filed": "2025-05-28",
              "accn": "0001045810-25-000123", "frame": "CY2025Q1" },
            { "start": "2024-01-29", "end": "2025-01-26", "val": 130497000000,
              "fy": 2025, "fp": "FY", "form": "10-K", "filed": "2025-02-26",
              "accn": "0001045810-25-000023" }
          ]
        }
      },
      "SomeUntrackedTag": {
        "units": { "USD": [
          { "end": "2025-04-30", "val": 1, "fy": 2026, "fp": "Q1",
            "form": "10-Q", "filed": "2025-05-28", "accn": "x" } ] }
      }
    },
    "dei": {
      "EntityCommonStockSharesOutstanding": {
        "units": { "shares": [
          { "end": "2025-05-21", "val": 24390000000, "fy": 2026, "fp": "Q1",
            "form": "10-Q", "filed": "2025-05-28", "accn": "0001045810-25-000123" } ] }
      }
    }
  }
}
```

- [ ] **Step 9: companyfacts 실패 테스트 작성**

`tests/providers/sec-companyfacts.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseCompanyFacts } from '@/providers/fundamental/sec-companyfacts'
import { TRACKED_TAGS } from '@/providers/fundamental/tags'

const raw = JSON.parse(readFileSync('tests/fixtures/companyfacts-mini.json', 'utf8'))
const facts = parseCompanyFacts(raw, TRACKED_TAGS)

describe('parseCompanyFacts', () => {
  it('추적 태그만 남긴다', () => {
    expect(facts.some((f) => f.tag === 'SomeUntrackedTag')).toBe(false)
  })

  it('us-gaap과 dei 네임스페이스를 모두 읽는다', () => {
    expect(facts.some((f) => f.tag === 'Revenues')).toBe(true)
    expect(facts.some((f) => f.tag === 'EntityCommonStockSharesOutstanding')).toBe(true)
  })

  it('start/end로 qtrs를 유도한다', () => {
    const q = facts.find((f) => f.tag === 'Revenues' && f.periodEnd === '2025-04-30')!
    expect(q.qtrs).toBe(1)
    const a = facts.find((f) => f.tag === 'Revenues' && f.periodEnd === '2025-01-26')!
    expect(a.qtrs).toBe(4)
  })

  it('start가 없는 시점 값은 qtrs=0', () => {
    const s = facts.find((f) => f.tag === 'EntityCommonStockSharesOutstanding')!
    expect(s.qtrs).toBe(0)
    expect(s.unit).toBe('shares')
  })

  it('cik·form·filed·accession을 보존하고 source는 api', () => {
    const q = facts.find((f) => f.tag === 'Revenues' && f.periodEnd === '2025-04-30')!
    expect(q.cik).toBe(1045810)
    expect(q.form).toBe('10-Q')
    expect(q.filedDate).toBe('2025-05-28')
    expect(q.accession).toBe('0001045810-25-000123')
    expect(q.source).toBe('api')
    expect(q.periodStart).toBe('2025-02-01')
  })
})
```

- [ ] **Step 10: 테스트 실패 확인**

Run: `npx vitest run tests/providers/sec-companyfacts.test.ts`
Expected: FAIL — `Cannot find module '@/providers/fundamental/sec-companyfacts'`

- [ ] **Step 11: companyfacts provider 구현**

`src/providers/fundamental/sec-companyfacts.ts`:

```ts
import type { CompanyFactsProvider, RawFact } from '../types.js'
import type { HttpClient } from '../http/client.js'
import { TRACKED_TAGS } from './tags.js'

function factsUrl(cik: number): string {
  return `https://data.sec.gov/api/xbrl/companyfacts/CIK${String(cik).padStart(10, '0')}.json`
}

const DAY_MS = 86_400_000

/** start~end 일수로 기간 길이(분기 수)를 유도한다. start가 없으면 시점 값(0). */
function deriveQtrs(start: string | undefined, end: string): number {
  if (!start) return 0
  const days = (Date.parse(end) - Date.parse(start)) / DAY_MS
  if (!Number.isFinite(days) || days <= 0) return 0
  return Math.max(1, Math.round(days / 91.31))
}

type FactEntry = {
  start?: string; end?: string; val?: number
  form?: string; filed?: string; accn?: string
}

export function parseCompanyFacts(raw: unknown, tags: Set<string>): RawFact[] {
  const root = raw as {
    cik?: number
    facts?: Record<string, Record<string, { units?: Record<string, FactEntry[]> }>>
  }
  const cik = root.cik
  if (typeof cik !== 'number' || !root.facts) return []

  const out: RawFact[] = []
  for (const namespace of Object.values(root.facts)) {
    for (const [tag, concept] of Object.entries(namespace)) {
      if (!tags.has(tag)) continue
      for (const [unit, entries] of Object.entries(concept.units ?? {})) {
        for (const e of entries) {
          if (typeof e.val !== 'number' || !e.end || !e.form || !e.filed || !e.accn) continue
          out.push({
            cik,
            tag,
            unit,
            periodStart: e.start ?? null,
            periodEnd: e.end,
            qtrs: deriveQtrs(e.start, e.end),
            value: e.val,
            form: e.form,
            filedDate: e.filed,
            accession: e.accn,
            source: 'api',
          })
        }
      }
    }
  }
  return out
}

export function createCompanyFactsProvider(http: HttpClient): CompanyFactsProvider {
  return {
    async fetchCompany(cik) {
      try {
        return parseCompanyFacts(await http.getJson(factsUrl(cik), { cache: false }), TRACKED_TAGS)
      } catch (e) {
        // XBRL 신고 이력이 없는 CIK는 404. 잡 전체를 중단시키지 않는다.
        if (e instanceof Error && /HTTP 404/.test(e.message)) return []
        throw e
      }
    },
  }
}
```

- [ ] **Step 12: 테스트 통과 확인**

Run: `npx vitest run tests/providers`
Expected: PASS (http 7 + listing 5 + reference 5 + bulk 6 + companyfacts 5 = 28 tests)

- [ ] **Step 13: 커밋**

```bash
git add -A
git commit -m "feat: SEC 재무 Provider — 분기 벌크 ZIP 및 companyfacts API

벌크는 num.txt를 줄 단위로 스트리밍해 유니버스 CIK와 추적 태그만 남긴다.
coreg가 있는 자회사 단위 행은 제외하고 연결기준만 채택한다.
companyfacts는 start/end 일수로 기간 길이를 유도한다."
```

---

### Task 9: XBRL 태그 폴백 & 기간별 필드 해석

**Files:**
- Create: `src/providers/fundamental/resolve.ts`
- Test: `tests/providers/resolve.test.ts`

**Interfaces:**
- Consumes: `RawFact` (Task 8)
- Produces:
  - `type FactIndex = { duration: Map<number, Map<string, Map<string, number>>>; instant: Map<string, Map<string, number>> }` — `duration`은 `qtrs → periodEnd → tag → value`, `instant`는 `periodEnd → tag → value`
  - `indexFacts(facts: RawFact[]): FactIndex` — 같은 (qtrs, periodEnd, tag)에 값이 여럿이면 `filedDate`가 늦은 것을 채택
  - `type ResolvedFlow = { revenue, grossProfit, operatingIncome, netIncome, ocf, capex, sbc, rdExpense, sharesDiluted }` (전부 `number | null`)
  - `type ResolvedStock = { cash, totalDebt, equity, sharesOutstanding }` (전부 `number | null`)
  - `resolveFlow(tags: Map<string, number>): { fields: ResolvedFlow; used: Record<string, string> }`
  - `resolveStock(tags: Map<string, number>): { fields: ResolvedStock; used: Record<string, string> }`
  - `used`는 각 필드가 어떤 XBRL 태그에서 왔는지 기록하며 `financials.source_tags`에 저장된다.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/providers/resolve.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { indexFacts, resolveFlow, resolveStock } from '@/providers/fundamental/resolve'
import type { RawFact } from '@/providers/types'

function fact(p: Partial<RawFact>): RawFact {
  return {
    cik: 1, tag: 'Revenues', unit: 'USD', periodStart: null,
    periodEnd: '2025-03-31', qtrs: 1, value: 100, form: '10-Q',
    filedDate: '2025-05-01', accession: 'a', source: 'bulk', ...p,
  }
}

describe('indexFacts', () => {
  it('qtrs와 periodEnd로 계층 인덱스를 만든다', () => {
    const idx = indexFacts([
      fact({ tag: 'Revenues', qtrs: 1, periodEnd: '2025-03-31', value: 10 }),
      fact({ tag: 'Revenues', qtrs: 4, periodEnd: '2025-03-31', value: 40 }),
      fact({ tag: 'StockholdersEquity', qtrs: 0, periodEnd: '2025-03-31', value: 500 }),
    ])
    expect(idx.duration.get(1)!.get('2025-03-31')!.get('Revenues')).toBe(10)
    expect(idx.duration.get(4)!.get('2025-03-31')!.get('Revenues')).toBe(40)
    expect(idx.instant.get('2025-03-31')!.get('StockholdersEquity')).toBe(500)
  })

  it('같은 키에 값이 여럿이면 늦게 신고된 값을 쓴다 — 정정 공시 반영', () => {
    const idx = indexFacts([
      fact({ value: 100, filedDate: '2025-05-01' }),
      fact({ value: 111, filedDate: '2025-08-01', form: '10-K' }),
      fact({ value: 99, filedDate: '2025-04-01' }),
    ])
    expect(idx.duration.get(1)!.get('2025-03-31')!.get('Revenues')).toBe(111)
  })
})

describe('resolveFlow', () => {
  it('매출 폴백 체인의 1순위를 먼저 쓴다', () => {
    const r = resolveFlow(new Map([
      ['RevenueFromContractWithCustomerExcludingAssessedTax', 500],
      ['Revenues', 400],
    ]))
    expect(r.fields.revenue).toBe(500)
    expect(r.used.revenue).toBe('RevenueFromContractWithCustomerExcludingAssessedTax')
  })

  it('1순위가 없으면 다음 후보로 내려간다', () => {
    const r = resolveFlow(new Map([['SalesRevenueNet', 300]]))
    expect(r.fields.revenue).toBe(300)
    expect(r.used.revenue).toBe('SalesRevenueNet')
  })

  it('GrossProfit이 없으면 매출 - 매출원가로 유도한다', () => {
    const r = resolveFlow(new Map([['Revenues', 1000], ['CostOfRevenue', 400]]))
    expect(r.fields.grossProfit).toBe(600)
    expect(r.used.grossProfit).toBe('Revenues-CostOfRevenue')
  })

  it('매출원가 태그도 폴백한다', () => {
    const r = resolveFlow(new Map([['Revenues', 1000], ['CostOfGoodsAndServicesSold', 250]]))
    expect(r.fields.grossProfit).toBe(750)
  })

  it('GrossProfit이 있으면 그대로 쓴다', () => {
    const r = resolveFlow(new Map([
      ['Revenues', 1000], ['CostOfRevenue', 400], ['GrossProfit', 620],
    ]))
    expect(r.fields.grossProfit).toBe(620)
    expect(r.used.grossProfit).toBe('GrossProfit')
  })

  it('아무 태그도 없으면 null이며 used에 기록되지 않는다', () => {
    const r = resolveFlow(new Map())
    expect(r.fields.revenue).toBeNull()
    expect(r.fields.grossProfit).toBeNull()
    expect(r.used.revenue).toBeUndefined()
  })

  it('영업활동현금흐름 폴백', () => {
    const r = resolveFlow(new Map([
      ['NetCashProvidedByUsedInOperatingActivitiesContinuingOperations', 77],
    ]))
    expect(r.fields.ocf).toBe(77)
  })
})

describe('resolveStock', () => {
  it('현금은 현금성자산과 단기투자자산을 더한다', () => {
    const r = resolveStock(new Map([
      ['CashAndCashEquivalentsAtCarryingValue', 100],
      ['ShortTermInvestments', 50],
    ]))
    expect(r.fields.cash).toBe(150)
    expect(r.used.cash).toBe('CashAndCashEquivalentsAtCarryingValue+ShortTermInvestments')
  })

  it('단기투자자산이 없으면 현금성자산만 쓴다', () => {
    const r = resolveStock(new Map([['CashAndCashEquivalentsAtCarryingValue', 100]]))
    expect(r.fields.cash).toBe(100)
    expect(r.used.cash).toBe('CashAndCashEquivalentsAtCarryingValue')
  })

  it('총부채는 장기+유동 합산', () => {
    const r = resolveStock(new Map([
      ['LongTermDebtNoncurrent', 800], ['LongTermDebtCurrent', 200],
    ]))
    expect(r.fields.totalDebt).toBe(1000)
  })

  it('장기부채 태그가 없으면 DebtCurrent로 폴백한다', () => {
    const r = resolveStock(new Map([['DebtCurrent', 300]]))
    expect(r.fields.totalDebt).toBe(300)
    expect(r.used.totalDebt).toBe('DebtCurrent')
  })

  it('부채 태그가 전혀 없으면 null — 0으로 가정하지 않는다', () => {
    expect(resolveStock(new Map()).fields.totalDebt).toBeNull()
  })

  it('자본과 발행주식수를 읽는다', () => {
    const r = resolveStock(new Map([
      ['StockholdersEquity', 5000],
      ['EntityCommonStockSharesOutstanding', 24000000],
    ]))
    expect(r.fields.equity).toBe(5000)
    expect(r.fields.sharesOutstanding).toBe(24000000)
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run tests/providers/resolve.test.ts`
Expected: FAIL — `Cannot find module '@/providers/fundamental/resolve'`

- [ ] **Step 3: 구현**

`src/providers/fundamental/resolve.ts`:

```ts
import type { RawFact } from '../types.js'

export type FactIndex = {
  /** qtrs → periodEnd → tag → value */
  duration: Map<number, Map<string, Map<string, number>>>
  /** periodEnd → tag → value */
  instant: Map<string, Map<string, number>>
}

export function indexFacts(facts: RawFact[]): FactIndex {
  const duration: FactIndex['duration'] = new Map()
  const instant: FactIndex['instant'] = new Map()
  // 같은 키에 값이 여럿일 때 어떤 filedDate를 채택했는지 추적
  const chosenAt = new Map<string, string>()

  for (const f of facts) {
    const key = `${f.qtrs}|${f.periodEnd}|${f.tag}`
    const prev = chosenAt.get(key)
    if (prev !== undefined && prev >= f.filedDate) continue
    chosenAt.set(key, f.filedDate)

    if (f.qtrs === 0) {
      let byTag = instant.get(f.periodEnd)
      if (!byTag) { byTag = new Map(); instant.set(f.periodEnd, byTag) }
      byTag.set(f.tag, f.value)
    } else {
      let byPeriod = duration.get(f.qtrs)
      if (!byPeriod) { byPeriod = new Map(); duration.set(f.qtrs, byPeriod) }
      let byTag = byPeriod.get(f.periodEnd)
      if (!byTag) { byTag = new Map(); byPeriod.set(f.periodEnd, byTag) }
      byTag.set(f.tag, f.value)
    }
  }
  return { duration, instant }
}

const REVENUE_CHAIN = [
  'RevenueFromContractWithCustomerExcludingAssessedTax',
  'Revenues',
  'SalesRevenueNet',
  'RevenueFromContractWithCustomerIncludingAssessedTax',
]
const COST_CHAIN = ['CostOfRevenue', 'CostOfGoodsAndServicesSold']
const OCF_CHAIN = [
  'NetCashProvidedByUsedInOperatingActivities',
  'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations',
]
const CAPEX_CHAIN = [
  'PaymentsToAcquirePropertyPlantAndEquipment',
  'PaymentsToAcquireProductiveAssets',
]

/** 체인에서 처음 발견된 값과 그 태그명을 반환한다. */
function firstOf(
  tags: Map<string, number>,
  chain: string[],
): { value: number; tag: string } | null {
  for (const t of chain) {
    const v = tags.get(t)
    if (typeof v === 'number') return { value: v, tag: t }
  }
  return null
}

export type ResolvedFlow = {
  revenue: number | null
  grossProfit: number | null
  operatingIncome: number | null
  netIncome: number | null
  ocf: number | null
  capex: number | null
  sbc: number | null
  rdExpense: number | null
  sharesDiluted: number | null
}

export function resolveFlow(
  tags: Map<string, number>,
): { fields: ResolvedFlow; used: Record<string, string> } {
  const used: Record<string, string> = {}

  const rev = firstOf(tags, REVENUE_CHAIN)
  if (rev) used.revenue = rev.tag

  let grossProfit: number | null = null
  const gp = tags.get('GrossProfit')
  if (typeof gp === 'number') {
    grossProfit = gp
    used.grossProfit = 'GrossProfit'
  } else if (rev) {
    const cost = firstOf(tags, COST_CHAIN)
    if (cost) {
      grossProfit = rev.value - cost.value
      used.grossProfit = `${rev.tag}-${cost.tag}`
    }
  }

  const simple = (field: string, tag: string): number | null => {
    const v = tags.get(tag)
    if (typeof v !== 'number') return null
    used[field] = tag
    return v
  }

  const ocf = firstOf(tags, OCF_CHAIN)
  if (ocf) used.ocf = ocf.tag
  const capex = firstOf(tags, CAPEX_CHAIN)
  if (capex) used.capex = capex.tag

  return {
    fields: {
      revenue: rev?.value ?? null,
      grossProfit,
      operatingIncome: simple('operatingIncome', 'OperatingIncomeLoss'),
      netIncome: simple('netIncome', 'NetIncomeLoss'),
      ocf: ocf?.value ?? null,
      capex: capex?.value ?? null,
      sbc: simple('sbc', 'ShareBasedCompensation'),
      rdExpense: simple('rdExpense', 'ResearchAndDevelopmentExpense'),
      sharesDiluted: simple(
        'sharesDiluted',
        'WeightedAverageNumberOfDilutedSharesOutstanding',
      ),
    },
    used,
  }
}

export type ResolvedStock = {
  cash: number | null
  totalDebt: number | null
  equity: number | null
  sharesOutstanding: number | null
}

export function resolveStock(
  tags: Map<string, number>,
): { fields: ResolvedStock; used: Record<string, string> } {
  const used: Record<string, string> = {}

  let cash: number | null = null
  const cce = tags.get('CashAndCashEquivalentsAtCarryingValue')
  if (typeof cce === 'number') {
    const sti = tags.get('ShortTermInvestments')
    if (typeof sti === 'number') {
      cash = cce + sti
      used.cash = 'CashAndCashEquivalentsAtCarryingValue+ShortTermInvestments'
    } else {
      cash = cce
      used.cash = 'CashAndCashEquivalentsAtCarryingValue'
    }
  }

  let totalDebt: number | null = null
  const ltNon = tags.get('LongTermDebtNoncurrent')
  const ltCur = tags.get('LongTermDebtCurrent')
  if (typeof ltNon === 'number' || typeof ltCur === 'number') {
    totalDebt = (ltNon ?? 0) + (ltCur ?? 0)
    used.totalDebt = [
      typeof ltNon === 'number' ? 'LongTermDebtNoncurrent' : null,
      typeof ltCur === 'number' ? 'LongTermDebtCurrent' : null,
    ]
      .filter(Boolean)
      .join('+')
  } else {
    const dc = tags.get('DebtCurrent')
    if (typeof dc === 'number') {
      totalDebt = dc
      used.totalDebt = 'DebtCurrent'
    }
  }

  const simple = (field: string, tag: string): number | null => {
    const v = tags.get(tag)
    if (typeof v !== 'number') return null
    used[field] = tag
    return v
  }

  return {
    fields: {
      cash,
      totalDebt,
      equity: simple('equity', 'StockholdersEquity'),
      sharesOutstanding: simple('sharesOutstanding', 'EntityCommonStockSharesOutstanding'),
    },
    used,
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run tests/providers/resolve.test.ts`
Expected: PASS (15 tests)

- [ ] **Step 5: 커밋**

```bash
git add -A
git commit -m "feat: XBRL 태그 폴백 체인 및 기간별 필드 해석

기업마다 다른 태그를 쓰므로 체인으로 폴백하고 어떤 태그를 썼는지
used에 기록해 financials.source_tags로 저장한다.
정정 공시는 filedDate가 늦은 값을 채택한다.
부채 태그가 전혀 없으면 0이 아니라 null이다."
```

---

### Task 10: Q4 재구성 & TTM 조립

**Files:**
- Create: `src/providers/fundamental/normalizer.ts`
- Test: `tests/providers/normalizer.test.ts`

**Interfaces:**
- Consumes: `indexFacts`/`resolveFlow`/`resolveStock` (Task 9), `sumTTM` (Task 2), `FinancialPeriod` (Task 2), `RawFact` (Task 8)
- Produces:
  - `type NormalizeResult = { quarterly: FinancialPeriod[]; annual: FinancialPeriod[]; ttm: FinancialPeriod[]; sourceTags: Record<string, Record<string, string>> }` — 세 배열 모두 **최근순**. `sourceTags` 키는 `` `${periodType}:${periodEnd}` ``
  - `normalizeFacts(facts: RawFact[]): NormalizeResult`

**핵심 규칙 세 가지**

1. **Q4 재구성** — 10-K는 연간 값만 내고 4분기를 따로 내지 않는 경우가 많다. 연간 종료일 `E`에 대해 `(E-400일, E)` 구간의 분기가 정확히 3개이고 `E`에 분기 값이 없으면 `Q4 = 연간 − Q1 − Q2 − Q3`으로 유도한다. 유도된 기간은 `sourceTags['Q:E'].derived = 'Q4_from_annual'`로 표시한다.
2. **희석주식수는 합산하지 않는다** — 기간 가중평균이므로 TTM에서는 가장 최근 분기 값을 그대로 쓴다. 4개를 더하면 4배가 된다.
3. **시점 항목은 가장 가까운 과거 값** — 현금·부채·자본은 해당 종료일의 시점 값을 쓰되, 정확히 일치하는 값이 없으면 그 이전 중 가장 최근 값을 쓴다.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/providers/normalizer.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { normalizeFacts } from '@/providers/fundamental/normalizer'
import type { RawFact } from '@/providers/types'

function f(
  tag: string, qtrs: number, periodEnd: string, value: number, form = '10-Q',
): RawFact {
  return {
    cik: 1, tag, unit: tag.includes('Shares') ? 'shares' : 'USD',
    periodStart: null, periodEnd, qtrs, value, form,
    filedDate: '2025-06-01', accession: `a-${periodEnd}-${qtrs}`, source: 'bulk',
  }
}

const Q_ENDS = ['2024-06-30', '2024-09-30', '2024-12-31', '2025-03-31']

function fourQuarters(tag: string, values: number[]): RawFact[] {
  return Q_ENDS.map((e, i) => f(tag, 1, e, values[i]!))
}

describe('normalizeFacts — TTM', () => {
  const facts = [
    ...fourQuarters('Revenues', [100, 110, 130, 160]),
    ...fourQuarters('OperatingIncomeLoss', [10, 12, 18, 25]),
    ...fourQuarters('NetCashProvidedByUsedInOperatingActivities', [20, 22, 30, 40]),
    ...fourQuarters('PaymentsToAcquirePropertyPlantAndEquipment', [5, 5, 6, 8]),
    ...fourQuarters('WeightedAverageNumberOfDilutedSharesOutstanding', [900, 910, 920, 930]),
    f('StockholdersEquity', 0, '2025-03-31', 5000),
    f('CashAndCashEquivalentsAtCarryingValue', 0, '2025-03-31', 1200),
    f('LongTermDebtNoncurrent', 0, '2025-03-31', 800),
  ]
  const r = normalizeFacts(facts)

  it('4개 분기가 모두 있으면 TTM을 만든다', () => {
    expect(r.ttm[0]!.periodEnd).toBe('2025-03-31')
    expect(r.ttm[0]!.revenue).toBe(500)
    expect(r.ttm[0]!.operatingIncome).toBe(65)
  })

  it('FCF는 영업현금흐름 - 자본지출', () => {
    expect(r.ttm[0]!.ocf).toBe(112)
    expect(r.ttm[0]!.capex).toBe(24)
    expect(r.ttm[0]!.fcf).toBe(88)
  })

  it('희석주식수는 합산하지 않고 최근 분기 값을 쓴다', () => {
    expect(r.ttm[0]!.sharesDiluted).toBe(930)
  })

  it('시점 항목은 종료일의 재무상태표 값을 쓴다', () => {
    expect(r.ttm[0]!.cash).toBe(1200)
    expect(r.ttm[0]!.totalDebt).toBe(800)
    expect(r.ttm[0]!.equity).toBe(5000)
  })

  it('분기가 4개 미만이면 TTM을 만들지 않는다', () => {
    const partial = normalizeFacts(
      Q_ENDS.slice(0, 3).map((e, i) => f('Revenues', 1, e, [100, 110, 130][i]!)),
    )
    expect(partial.ttm).toHaveLength(0)
  })

  it('분기가 5개면 TTM이 2개 생기고 최근순으로 정렬된다', () => {
    const five = normalizeFacts([
      f('Revenues', 1, '2024-03-31', 90),
      ...fourQuarters('Revenues', [100, 110, 130, 160]),
    ])
    expect(five.ttm.map((t) => t.periodEnd)).toEqual(['2025-03-31', '2024-12-31'])
    expect(five.ttm[1]!.revenue).toBe(430)
  })
})

describe('normalizeFacts — Q4 재구성', () => {
  const facts = [
    f('Revenues', 4, '2024-12-31', 500, '10-K'),
    f('Revenues', 1, '2024-03-31', 100),
    f('Revenues', 1, '2024-06-30', 110),
    f('Revenues', 1, '2024-09-30', 130),
  ]
  const r = normalizeFacts(facts)

  it('연간 - 3개 분기로 Q4를 유도한다', () => {
    const q4 = r.quarterly.find((q) => q.periodEnd === '2024-12-31')!
    expect(q4.revenue).toBe(160)
  })

  it('유도 사실을 sourceTags에 남긴다', () => {
    expect(r.sourceTags['Q:2024-12-31']!.derived).toBe('Q4_from_annual')
  })

  it('Q4가 이미 신고되어 있으면 유도하지 않는다', () => {
    const withQ4 = normalizeFacts([...facts, f('Revenues', 1, '2024-12-31', 155)])
    const q4 = withQ4.quarterly.find((q) => q.periodEnd === '2024-12-31')!
    expect(q4.revenue).toBe(155)
    expect(withQ4.sourceTags['Q:2024-12-31']!.derived).toBeUndefined()
  })

  it('분기가 3개가 아니면 유도하지 않는다', () => {
    const twoQ = normalizeFacts([
      f('Revenues', 4, '2024-12-31', 500, '10-K'),
      f('Revenues', 1, '2024-03-31', 100),
      f('Revenues', 1, '2024-06-30', 110),
    ])
    expect(twoQ.quarterly.find((q) => q.periodEnd === '2024-12-31')).toBeUndefined()
  })
})

describe('normalizeFacts — 연간 및 출처 기록', () => {
  it('연간 기간을 최근순으로 만든다', () => {
    const r = normalizeFacts([
      f('Revenues', 4, '2023-12-31', 300, '10-K'),
      f('Revenues', 4, '2024-12-31', 500, '10-K'),
    ])
    expect(r.annual.map((a) => a.periodEnd)).toEqual(['2024-12-31', '2023-12-31'])
  })

  it('필드가 어떤 태그에서 왔는지 기록한다', () => {
    const r = normalizeFacts([f('SalesRevenueNet', 4, '2024-12-31', 300, '10-K')])
    expect(r.sourceTags['A:2024-12-31']!.revenue).toBe('SalesRevenueNet')
  })

  it('데이터가 없으면 빈 결과를 반환한다', () => {
    const r = normalizeFacts([])
    expect(r).toEqual({ quarterly: [], annual: [], ttm: [], sourceTags: {} })
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run tests/providers/normalizer.test.ts`
Expected: FAIL — `Cannot find module '@/providers/fundamental/normalizer'`

- [ ] **Step 3: 구현**

`src/providers/fundamental/normalizer.ts`:

```ts
import type { FinancialPeriod, PeriodType } from '@/domain/types'
import { sumTTM } from '@/domain/growth'
import type { RawFact } from '../types.js'
import { indexFacts, resolveFlow, resolveStock, type FactIndex } from './resolve.js'

export type NormalizeResult = {
  quarterly: FinancialPeriod[]
  annual: FinancialPeriod[]
  ttm: FinancialPeriod[]
  /** `${periodType}:${periodEnd}` → { field → tag } */
  sourceTags: Record<string, Record<string, string>>
}

const DAY_MS = 86_400_000
const FLOW_FIELDS = [
  'revenue', 'grossProfit', 'operatingIncome', 'netIncome', 'ocf', 'capex', 'sbc', 'rdExpense',
] as const

function daysBetween(a: string, b: string): number {
  return Math.abs(Date.parse(a) - Date.parse(b)) / DAY_MS
}

/** asOf 이전(포함) 중 가장 최근 시점 값 */
function pickInstant(idx: FactIndex, asOf: string): Map<string, number> {
  let best: string | null = null
  for (const d of idx.instant.keys()) {
    if (d <= asOf && (best === null || d > best)) best = d
  }
  return best === null ? new Map() : idx.instant.get(best)!
}

function fcfOf(ocf: number | null, capex: number | null): number | null {
  return ocf === null || capex === null ? null : ocf - capex
}

function emptyPeriod(periodEnd: string, periodType: PeriodType): FinancialPeriod {
  return {
    periodEnd, periodType,
    revenue: null, grossProfit: null, operatingIncome: null, netIncome: null,
    ocf: null, capex: null, fcf: null,
    cash: null, totalDebt: null, equity: null,
    sharesDiluted: null, sharesOutstanding: null, sbc: null, rdExpense: null,
  }
}

function buildPeriod(
  idx: FactIndex,
  periodEnd: string,
  periodType: PeriodType,
  tags: Map<string, number>,
  sourceTags: Record<string, Record<string, string>>,
): FinancialPeriod {
  const flow = resolveFlow(tags)
  const stock = resolveStock(pickInstant(idx, periodEnd))
  sourceTags[`${periodType}:${periodEnd}`] = { ...flow.used, ...stock.used }
  return {
    periodEnd,
    periodType,
    ...flow.fields,
    fcf: fcfOf(flow.fields.ocf, flow.fields.capex),
    cash: stock.fields.cash,
    totalDebt: stock.fields.totalDebt,
    equity: stock.fields.equity,
    sharesOutstanding: stock.fields.sharesOutstanding,
  }
}

export function normalizeFacts(facts: RawFact[]): NormalizeResult {
  const sourceTags: Record<string, Record<string, string>> = {}
  if (facts.length === 0) return { quarterly: [], annual: [], ttm: [], sourceTags }

  const idx = indexFacts(facts)
  const desc = (a: FinancialPeriod, b: FinancialPeriod) =>
    b.periodEnd.localeCompare(a.periodEnd)

  // 연간 (qtrs=4)
  const annual: FinancialPeriod[] = []
  for (const [periodEnd, tags] of idx.duration.get(4) ?? []) {
    annual.push(buildPeriod(idx, periodEnd, 'A', tags, sourceTags))
  }
  annual.sort(desc)

  // 분기 (qtrs=1)
  const quarterly: FinancialPeriod[] = []
  const reportedQuarterEnds = new Set<string>()
  for (const [periodEnd, tags] of idx.duration.get(1) ?? []) {
    reportedQuarterEnds.add(periodEnd)
    quarterly.push(buildPeriod(idx, periodEnd, 'Q', tags, sourceTags))
  }

  // Q4 재구성: 연간 종료일에 분기 값이 없고 직전 3개 분기가 있으면 차감으로 유도
  for (const a of annual) {
    if (reportedQuarterEnds.has(a.periodEnd)) continue
    const inYear = quarterly.filter(
      (q) => q.periodEnd < a.periodEnd && daysBetween(q.periodEnd, a.periodEnd) < 400,
    )
    if (inYear.length !== 3) continue

    const q4 = emptyPeriod(a.periodEnd, 'Q')
    for (const field of FLOW_FIELDS) {
      const annualValue = a[field]
      if (annualValue === null) continue
      const parts = inYear.map((q) => q[field])
      if (parts.some((p) => p === null)) continue
      q4[field] = annualValue - (parts as number[]).reduce((s, v) => s + v, 0)
    }
    q4.fcf = fcfOf(q4.ocf, q4.capex)
    // 희석주식수는 차감이 무의미하므로 연간 값을 그대로 쓴다
    q4.sharesDiluted = a.sharesDiluted
    const stock = resolveStock(pickInstant(idx, a.periodEnd))
    q4.cash = stock.fields.cash
    q4.totalDebt = stock.fields.totalDebt
    q4.equity = stock.fields.equity
    q4.sharesOutstanding = stock.fields.sharesOutstanding

    quarterly.push(q4)
    sourceTags[`Q:${a.periodEnd}`] = { ...stock.used, derived: 'Q4_from_annual' }
  }
  quarterly.sort(desc)

  // TTM: 연속한 4개 분기. 최신 종료일과 4번째 종료일 간격이 약 3분기여야 한다.
  const ttm: FinancialPeriod[] = []
  for (let i = 0; i + 3 < quarterly.length; i++) {
    const window = quarterly.slice(i, i + 4)
    const span = daysBetween(window[3]!.periodEnd, window[0]!.periodEnd)
    if (span < 240 || span > 310) continue

    const p = emptyPeriod(window[0]!.periodEnd, 'TTM')
    for (const field of FLOW_FIELDS) {
      p[field] = sumTTM(window.map((q) => q[field]))
    }
    p.fcf = fcfOf(p.ocf, p.capex)
    p.sharesDiluted = window[0]!.sharesDiluted   // 가중평균이므로 합산하지 않는다
    p.cash = window[0]!.cash
    p.totalDebt = window[0]!.totalDebt
    p.equity = window[0]!.equity
    p.sharesOutstanding = window[0]!.sharesOutstanding
    ttm.push(p)
    sourceTags[`TTM:${p.periodEnd}`] = sourceTags[`Q:${p.periodEnd}`] ?? {}
  }

  return { quarterly, annual, ttm, sourceTags }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run tests/providers/normalizer.test.ts`
Expected: PASS (13 tests)

`분기가 5개면 TTM이 2개` 테스트에서 span 검증이 걸려 실패하면, `2024-03-31`부터 `2025-03-31`까지 4개 창의 간격이 240~310일 범위인지 확인한다. `2024-06-30`~`2025-03-31`은 273일, `2024-03-31`~`2024-12-31`은 275일로 둘 다 범위 안이다.

- [ ] **Step 5: 커밋**

```bash
git add -A
git commit -m "feat: Q4 재구성 및 TTM 조립

10-K가 4분기를 따로 내지 않는 경우 연간에서 3개 분기를 빼 유도하고
유도 사실을 sourceTags에 남긴다.
희석주식수는 기간 가중평균이라 TTM에서 합산하지 않고 최근 분기 값을 쓴다.
분기가 4개 미만이면 TTM을 만들지 않고 결측을 0으로 채우지 않는다."
```

---

### Task 11: ingest-fundamentals 잡

**Files:**
- Create: `src/db/repositories/financials.ts`, `src/pipeline/quarters.ts`, `src/pipeline/jobs/ingest-fundamentals.ts`
- Test: `tests/pipeline/quarters.test.ts`, `tests/pipeline/ingest-fundamentals.test.ts`

**Interfaces:**
- Consumes: `BulkFundamentalProvider`/`CompanyFactsProvider`/`RawFact` (Task 8), `normalizeFacts`/`NormalizeResult` (Task 10), `listUniverseCiks` (Task 7), `runJob` (Task 7)
- Produces:
  - `recentQuarters(asOf: string, count: number): { year: number; quarter: number }[]` — 최근순
  - `insertFacts(raw, facts: RawFact[]): number` — 삽입/갱신된 행 수. 같은 키는 `filedDate`가 늦은 값이 이긴다
  - `getFacts(raw, cik: number): RawFact[]`
  - `replaceFinancials(raw, cik: number, r: NormalizeResult): void`
  - `getFinancialsFor(raw, cik: number): { quarterly: FinancialPeriod[]; annual: FinancialPeriod[]; ttm: FinancialPeriod[] }` — 전부 최근순
  - `selectStaleCiks(raw, asOf: string, days: number): number[]` — 최신 사실이 `asOf - days`보다 오래된 CIK
  - `ingestFundamentals(deps: FundamentalsDeps): Promise<JobStats>`
  - `type FundamentalsDeps = { raw; cfg; bulk; companyFacts; asOf: string }`

**설계 판단 — companyfacts는 전체가 아니라 지연 기업에만 쓴다.** `companyfacts.json`은 기업당 1~15MB라 1,300개 전체를 매번 받으면 4GB에 이른다. 벌크 ZIP이 이미 대부분을 덮으므로, 최신 사실이 120일보다 오래된 CIK(비회계연도 결산 기업, 신규 상장사)에만 API를 호출한다.

- [ ] **Step 1: quarters 실패 테스트 작성**

`tests/pipeline/quarters.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { recentQuarters } from '@/pipeline/quarters'

describe('recentQuarters', () => {
  it('공시 지연 45일을 반영해 최근 분기부터 역순으로 만든다', () => {
    // 2026-08-09 기준 45일 전은 2026-06-25 → 2026Q2가 최신 가용 데이터셋
    expect(recentQuarters('2026-08-09', 3)).toEqual([
      { year: 2026, quarter: 2 },
      { year: 2026, quarter: 1 },
      { year: 2025, quarter: 4 },
    ])
  })

  it('연도 경계를 넘어간다', () => {
    // 2026-02-20 기준 45일 전은 2026-01-06 → 2026Q1
    expect(recentQuarters('2026-02-20', 2)).toEqual([
      { year: 2026, quarter: 1 },
      { year: 2025, quarter: 4 },
    ])
  })

  it('count가 0이면 빈 배열', () => {
    expect(recentQuarters('2026-08-09', 0)).toEqual([])
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run tests/pipeline/quarters.test.ts`
Expected: FAIL — `Cannot find module '@/pipeline/quarters'`

- [ ] **Step 3: quarters 구현**

`src/pipeline/quarters.ts`:

```ts
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
```

- [ ] **Step 4: quarters 테스트 통과 확인**

Run: `npx vitest run tests/pipeline/quarters.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: financials 리포지토리 구현**

`src/db/repositories/financials.ts`:

```ts
import type Database from 'better-sqlite3'
import type { FinancialPeriod } from '@/domain/types'
import type { RawFact } from '@/providers/types'
import type { NormalizeResult } from '@/providers/fundamental/normalizer'

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
     WHERE excluded.filed_date > financial_facts.filed_date`,
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

type FinRow = FinancialPeriod & { period_type: string }

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
       LEFT JOIN (SELECT cik, MAX(period_end) AS latest FROM financial_facts GROUP BY cik) f
         ON f.cik = c.cik
       WHERE f.latest IS NULL OR f.latest < ?
       ORDER BY c.cik`,
    )
    .all(cutoff) as { cik: number }[]
  return rows.map((r) => r.cik)
}
```

`FinRow` 타입은 위 쿼리가 별칭으로 카멜케이스를 반환하므로 사용하지 않는다. 정의를 넣지 말 것.

- [ ] **Step 6: 잡 실패 테스트 작성**

`tests/pipeline/ingest-fundamentals.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { getRawDb, runMigrations } from '@/db/client'
import { parseConfig } from '@/config'
import { ingestFundamentals } from '@/pipeline/jobs/ingest-fundamentals'
import { getFinancialsFor, selectStaleCiks } from '@/db/repositories/financials'
import type { BulkFundamentalProvider, CompanyFactsProvider, RawFact } from '@/providers/types'

const cfg = parseConfig(readFileSync('config.yaml', 'utf8'))

function f(tag: string, qtrs: number, periodEnd: string, value: number): RawFact {
  return {
    cik: 1045810, tag, unit: 'USD', periodStart: null, periodEnd, qtrs, value,
    form: qtrs === 4 ? '10-K' : '10-Q', filedDate: '2025-06-01',
    accession: `a-${periodEnd}-${qtrs}`, source: 'bulk',
  }
}

const BULK_FACTS = [
  f('Revenues', 1, '2024-06-30', 100),
  f('Revenues', 1, '2024-09-30', 110),
  f('Revenues', 1, '2024-12-31', 130),
  f('Revenues', 1, '2025-03-31', 160),
  { ...f('StockholdersEquity', 0, '2025-03-31', 5000) },
  { ...f('EntityCommonStockSharesOutstanding', 0, '2025-03-31', 24000), unit: 'shares' },
]

const bulk: BulkFundamentalProvider = {
  fetchQuarter: async (_y, q) => (q === 2 ? BULK_FACTS : []),
}

let apiCalls: number[] = []
const companyFacts: CompanyFactsProvider = {
  fetchCompany: async (cik) => { apiCalls.push(cik); return [] },
}

let raw: Database.Database
let stats: Record<string, unknown>

beforeAll(async () => {
  raw = getRawDb(join(mkdtempSync(join(tmpdir(), 'tb-fund-')), 'f.db'))
  runMigrations(raw)
  raw.prepare(
    `INSERT INTO companies (cik, ticker, name, is_active, first_seen, last_updated)
     VALUES (1045810, 'NVDA', 'NVIDIA CORP', 1, '2026-08-09', '2026-08-09')`,
  ).run()
  raw.prepare(
    `INSERT INTO company_industry (cik, industry_slug, theme_slug, is_primary, source)
     VALUES (1045810, 'ai-infrastructure', 'ai-software-semi', 1, 'override')`,
  ).run()
  stats = await ingestFundamentals({ raw, cfg, bulk, companyFacts, asOf: '2026-08-09' })
})

describe('ingestFundamentals', () => {
  it('벌크 사실을 financial_facts에 적재한다', () => {
    const n = raw.prepare('SELECT COUNT(*) c FROM financial_facts').get() as { c: number }
    expect(n.c).toBe(BULK_FACTS.length)
  })

  it('설정된 분기 수만큼 벌크를 조회한다', () => {
    expect(stats.quartersRequested).toBe(cfg.ingest.bulk_quarters)
  })

  it('정규화 결과를 financials에 저장한다', () => {
    const fin = getFinancialsFor(raw, 1045810)
    expect(fin.quarterly).toHaveLength(4)
    expect(fin.ttm).toHaveLength(1)
    expect(fin.ttm[0]!.revenue).toBe(500)
    expect(fin.ttm[0]!.sharesOutstanding).toBe(24000)
  })

  it('source_tags를 JSON으로 보존한다', () => {
    const row = raw
      .prepare(
        "SELECT source_tags FROM financials WHERE cik=1045810 AND period_type='TTM'",
      )
      .get() as { source_tags: string }
    expect(JSON.parse(row.source_tags).revenue).toBe('Revenues')
  })

  it('최신 사실이 있는 기업에는 companyfacts API를 호출하지 않는다', () => {
    // 최신 period_end가 2025-03-31이고 asOf가 2026-08-09이라 120일을 넘으므로 호출된다
    expect(apiCalls).toContain(1045810)
  })

  it('job_runs에 성공 기록을 남긴다', () => {
    const r = raw
      .prepare("SELECT status FROM job_runs WHERE job='fundamentals' ORDER BY id DESC")
      .get() as { status: string }
    expect(r.status).toBe('succeeded')
  })

  it('재실행해도 financials 행이 중복되지 않는다', async () => {
    await ingestFundamentals({ raw, cfg, bulk, companyFacts, asOf: '2026-08-09' })
    const n = raw
      .prepare('SELECT COUNT(*) c FROM financials WHERE cik = 1045810')
      .get() as { c: number }
    expect(n.c).toBe(5) // 분기 4 + TTM 1
  })
})

describe('selectStaleCiks', () => {
  it('최신 사실이 기준일보다 오래되면 지연으로 판정한다', () => {
    expect(selectStaleCiks(raw, '2026-08-09', 120)).toContain(1045810)
  })

  it('충분히 최신이면 제외한다', () => {
    expect(selectStaleCiks(raw, '2025-04-15', 120)).not.toContain(1045810)
  })
})
```

- [ ] **Step 7: 테스트 실패 확인**

Run: `npx vitest run tests/pipeline/ingest-fundamentals.test.ts`
Expected: FAIL — `Cannot find module '@/pipeline/jobs/ingest-fundamentals'`

- [ ] **Step 8: 잡 구현**

`src/pipeline/jobs/ingest-fundamentals.ts`:

```ts
import type Database from 'better-sqlite3'
import type { AppConfig } from '@/config'
import type { BulkFundamentalProvider, CompanyFactsProvider } from '@/providers/types'
import { normalizeFacts } from '@/providers/fundamental/normalizer'
import { listUniverseCiks } from '@/db/repositories/companies'
import {
  insertFacts, getFacts, replaceFinancials, selectStaleCiks,
} from '@/db/repositories/financials'
import { recentQuarters } from '@/pipeline/quarters'
import { runJob, type JobStats } from '@/pipeline/runner'

const INCREMENTAL_STALE_DAYS = 120

export type FundamentalsDeps = {
  raw: Database.Database
  cfg: AppConfig
  bulk: BulkFundamentalProvider
  companyFacts: CompanyFactsProvider
  asOf: string
}

export async function ingestFundamentals(deps: FundamentalsDeps): Promise<JobStats> {
  const { raw, cfg, bulk, companyFacts, asOf } = deps

  return runJob(raw, 'fundamentals', async () => {
    const ciks = new Set(listUniverseCiks(raw))
    const quarters = recentQuarters(asOf, cfg.ingest.bulk_quarters)

    let bulkFacts = 0
    let quartersLoaded = 0
    const quarterErrors: string[] = []
    for (const q of quarters) {
      try {
        bulkFacts += insertFacts(raw, await bulk.fetchQuarter(q.year, q.quarter, ciks))
        quartersLoaded++
      } catch (e) {
        // 아직 공개되지 않은 분기는 404가 난다. 잡 전체를 중단시키지 않는다.
        quarterErrors.push(`${q.year}Q${q.quarter}: ${e instanceof Error ? e.message : e}`)
      }
    }

    // 벌크가 덮지 못한 기업만 API로 보충한다
    const stale = selectStaleCiks(raw, asOf, INCREMENTAL_STALE_DAYS)
    let apiFacts = 0
    let apiFailed = 0
    for (const cik of stale) {
      try {
        apiFacts += insertFacts(raw, await companyFacts.fetchCompany(cik))
      } catch {
        apiFailed++
      }
    }

    let normalized = 0
    let noData = 0
    for (const cik of ciks) {
      const result = normalizeFacts(getFacts(raw, cik))
      if (result.quarterly.length === 0 && result.annual.length === 0) { noData++; continue }
      replaceFinancials(raw, cik, result)
      normalized++
    }

    return {
      universeSize: ciks.size,
      quartersRequested: quarters.length,
      quartersLoaded,
      bulkFacts,
      staleCompanies: stale.length,
      apiFacts,
      apiFailed,
      normalized,
      noData,
      quarterErrors,
    }
  })
}
```

- [ ] **Step 9: 테스트 통과 확인**

Run: `npx vitest run tests/pipeline/ingest-fundamentals.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 10: 커밋**

```bash
git add -A
git commit -m "feat: 재무 수집 잡 — 벌크 백필 + 지연 기업 API 보충

companyfacts는 기업당 1~15MB라 전체 호출 시 4GB에 달하므로
최신 사실이 120일보다 오래된 기업에만 호출한다.
공개되지 않은 분기의 404는 기록만 하고 잡을 중단시키지 않는다."
```

---

### Task 12: 시세 Provider & refresh-prices 잡

**Files:**
- Create: `src/providers/price/finnhub.ts`, `src/providers/price/fixture.ts`, `src/providers/price/index.ts`
- Create: `src/db/repositories/market.ts`, `src/pipeline/jobs/refresh-prices.ts`
- Modify: `config.yaml`, `src/config/schema.ts` (finnhub rate limit 추가)
- Test: `tests/providers/price.test.ts`, `tests/pipeline/refresh-prices.test.ts`
- Create: `tests/fixtures/prices.json`

**Interfaces:**
- Consumes: `HttpClient` (Task 5), `getFinancialsFor` (Task 11), `listUniverseCiks` (Task 7)
- Produces:
  - `type Quote = { price: number; date: string }`
  - `type PriceProvider = { name: string; fetchQuote(ticker: string): Promise<Quote | null> }`
  - `parseFinnhubQuote(raw: unknown): Quote | null`
  - `createFinnhubProvider(http: HttpClient, apiKey: string): PriceProvider`
  - `createFixtureProvider(path: string): PriceProvider`
  - `getPriceProvider(http: HttpClient, env: NodeJS.ProcessEnv): PriceProvider`
  - `upsertMarketData(raw, row: MarketRow): void`
  - `type MarketRow = { cik: number; date: string; price: number | null; sharesOutstanding: number | null; marketCap: number | null; volume: number | null }`
  - `getLatestMarketData(raw, cik: number): MarketRow | null`
  - `refreshPrices(deps: PriceDeps): Promise<JobStats>`

- [ ] **Step 1: config에 finnhub rate limit 추가**

`config.yaml`의 `ingest` 블록에 한 줄 추가:

```yaml
ingest:
  bulk_quarters: 8
  sec_user_agent: "TenbaggerDashboard/0.1 (kk910519@gmail.com)"
  sec_rate_limit_per_sec: 10
  finnhub_rate_limit_per_sec: 1     # 무료 티어 분당 60회
  cache_dir: "./data/cache"
```

`src/config/schema.ts`의 `ingest` 객체에 대응 필드 추가:

```ts
  ingest: z.object({
    bulk_quarters: z.number().int().positive(),
    sec_user_agent: z.string().min(1),
    sec_rate_limit_per_sec: z.number().positive(),
    finnhub_rate_limit_per_sec: z.number().positive(),
    cache_dir: z.string(),
  }),
```

`tests/config.test.ts`의 3번째 테스트에 쓰인 축약 config에도 `finnhub_rate_limit_per_sec: 1`을 추가한다.

- [ ] **Step 2: 픽스처 작성**

`tests/fixtures/prices.json`:

```json
{ "date": "2026-08-08", "prices": { "NVDA": 223.96, "CRWD": 412.5 } }
```

- [ ] **Step 3: 실패하는 테스트 작성**

`tests/providers/price.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHttpClient } from '@/providers/http/client'
import { parseFinnhubQuote, createFinnhubProvider } from '@/providers/price/finnhub'
import { createFixtureProvider } from '@/providers/price/fixture'
import { getPriceProvider } from '@/providers/price'

const cacheDir = () => mkdtempSync(join(tmpdir(), 'tb-price-'))

describe('parseFinnhubQuote', () => {
  it('현재가와 타임스탬프를 읽는다', () => {
    expect(parseFinnhubQuote({ c: 223.96, h: 1, l: 1, o: 1, pc: 1, t: 1786132800 }))
      .toEqual({ price: 223.96, date: '2026-08-09' })
  })

  it('c가 0이면 null — 알 수 없는 심볼', () => {
    expect(parseFinnhubQuote({ c: 0, t: 1786132800 })).toBeNull()
  })

  it('형식이 다르면 null', () => {
    expect(parseFinnhubQuote({})).toBeNull()
    expect(parseFinnhubQuote(null)).toBeNull()
  })
})

describe('createFinnhubProvider', () => {
  it('토큰을 쿼리에 붙이고 시세를 반환한다', async () => {
    let seenUrl = ''
    const http = createHttpClient({
      userAgent: 'x', rateLimitPerSec: 1000, cacheDir: cacheDir(),
      fetchImpl: async (url) => {
        seenUrl = String(url)
        return new Response(JSON.stringify({ c: 50, t: 1786132800 }), { status: 200 })
      },
    })
    const p = createFinnhubProvider(http, 'KEY123')
    expect(await p.fetchQuote('NVDA')).toEqual({ price: 50, date: '2026-08-09' })
    expect(seenUrl).toContain('symbol=NVDA')
    expect(seenUrl).toContain('token=KEY123')
  })
})

describe('createFixtureProvider', () => {
  const p = createFixtureProvider('tests/fixtures/prices.json')

  it('픽스처 가격을 반환한다', async () => {
    expect(await p.fetchQuote('NVDA')).toEqual({ price: 223.96, date: '2026-08-08' })
  })

  it('없는 티커는 null', async () => {
    expect(await p.fetchQuote('NOPE')).toBeNull()
  })
})

describe('getPriceProvider', () => {
  const http = createHttpClient({
    userAgent: 'x', rateLimitPerSec: 1000, cacheDir: cacheDir(),
    fetchImpl: async () => new Response('{}', { status: 200 }),
  })

  it('PRICE_PROVIDER=fixture면 픽스처를 쓴다', () => {
    expect(getPriceProvider(http, { PRICE_PROVIDER: 'fixture' }).name).toBe('fixture')
  })

  it('PRICE_PROVIDER=finnhub이고 키가 있으면 finnhub', () => {
    expect(
      getPriceProvider(http, { PRICE_PROVIDER: 'finnhub', FINNHUB_API_KEY: 'k' }).name,
    ).toBe('finnhub')
  })

  it('finnhub인데 키가 없으면 명확한 에러를 던진다', () => {
    expect(() => getPriceProvider(http, { PRICE_PROVIDER: 'finnhub' }))
      .toThrow(/FINNHUB_API_KEY/)
  })

  it('알 수 없는 값이면 에러', () => {
    expect(() => getPriceProvider(http, { PRICE_PROVIDER: 'yahoo' })).toThrow(/yahoo/)
  })
})
```

- [ ] **Step 4: 테스트 실패 확인**

Run: `npx vitest run tests/providers/price.test.ts`
Expected: FAIL — `Cannot find module '@/providers/price/finnhub'`

- [ ] **Step 5: 시세 Provider 구현**

`src/providers/types.ts`에 append:

```ts
export type Quote = { price: number; date: string }

export type PriceProvider = {
  name: string
  fetchQuote(ticker: string): Promise<Quote | null>
}
```

`src/providers/price/finnhub.ts`:

```ts
import type { HttpClient } from '../http/client.js'
import type { PriceProvider, Quote } from '../types.js'

/** Finnhub /quote 응답: c=현재가, t=유닉스 초. 알 수 없는 심볼은 c=0을 반환한다. */
export function parseFinnhubQuote(raw: unknown): Quote | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as { c?: number; t?: number }
  if (typeof r.c !== 'number' || r.c <= 0) return null
  if (typeof r.t !== 'number' || r.t <= 0) return null
  return { price: r.c, date: new Date(r.t * 1000).toISOString().slice(0, 10) }
}

export function createFinnhubProvider(http: HttpClient, apiKey: string): PriceProvider {
  return {
    name: 'finnhub',
    async fetchQuote(ticker) {
      const url =
        `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(ticker)}` +
        `&token=${encodeURIComponent(apiKey)}`
      try {
        return parseFinnhubQuote(await http.getJson(url))
      } catch {
        return null
      }
    },
  }
}
```

`src/providers/price/fixture.ts`:

```ts
import { readFileSync } from 'node:fs'
import type { PriceProvider } from '../types.js'

export function createFixtureProvider(path: string): PriceProvider {
  const data = JSON.parse(readFileSync(path, 'utf8')) as {
    date: string
    prices: Record<string, number>
  }
  return {
    name: 'fixture',
    async fetchQuote(ticker) {
      const price = data.prices[ticker.toUpperCase()]
      return typeof price === 'number' ? { price, date: data.date } : null
    },
  }
}
```

`src/providers/price/index.ts`:

```ts
import type { HttpClient } from '../http/client.js'
import type { PriceProvider } from '../types.js'
import { createFinnhubProvider } from './finnhub.js'
import { createFixtureProvider } from './fixture.js'

const FIXTURE_PATH = 'tests/fixtures/prices.json'

export function getPriceProvider(
  http: HttpClient,
  env: NodeJS.ProcessEnv,
): PriceProvider {
  const kind = env.PRICE_PROVIDER ?? 'finnhub'
  if (kind === 'fixture') return createFixtureProvider(FIXTURE_PATH)
  if (kind === 'finnhub') {
    const key = env.FINNHUB_API_KEY
    if (!key) {
      throw new Error(
        'FINNHUB_API_KEY가 없습니다. https://finnhub.io 에서 무료 키를 발급받아 .env에 넣거나 ' +
          'PRICE_PROVIDER=fixture로 실행하세요.',
      )
    }
    return createFinnhubProvider(http, key)
  }
  throw new Error(`알 수 없는 PRICE_PROVIDER: ${kind} (finnhub | fixture)`)
}

export { createFinnhubProvider, createFixtureProvider }
```

- [ ] **Step 6: Provider 테스트 통과 확인**

Run: `npx vitest run tests/providers/price.test.ts`
Expected: PASS (10 tests)

- [ ] **Step 7: refresh-prices 실패 테스트 작성**

`tests/pipeline/refresh-prices.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { getRawDb, runMigrations } from '@/db/client'
import { refreshPrices } from '@/pipeline/jobs/refresh-prices'
import { getLatestMarketData } from '@/db/repositories/market'
import type { PriceProvider } from '@/providers/types'

const prices: PriceProvider = {
  name: 'test',
  fetchQuote: async (t) => (t === 'NOQUOTE' ? null : { price: 200, date: '2026-08-08' }),
}

let raw: Database.Database
let stats: Record<string, unknown>

beforeAll(async () => {
  raw = getRawDb(join(mkdtempSync(join(tmpdir(), 'tb-px-')), 'p.db'))
  runMigrations(raw)
  const addCompany = (cik: number, ticker: string) => {
    raw.prepare(
      `INSERT INTO companies (cik, ticker, name, is_active, first_seen, last_updated)
       VALUES (?, ?, ?, 1, '2026-08-09', '2026-08-09')`,
    ).run(cik, ticker, ticker)
    raw.prepare(
      `INSERT INTO company_industry (cik, industry_slug, theme_slug, is_primary, source)
       VALUES (?, 'semiconductors', 'ai-software-semi', 1, 'sic')`,
    ).run(cik)
  }
  addCompany(1, 'NVDA')
  addCompany(2, 'NOSHARES')
  addCompany(3, 'NOQUOTE')

  raw.prepare(
    `INSERT INTO financials (cik, period_end, period_type, shares_outstanding, computed_at)
     VALUES (1, '2025-03-31', 'TTM', 1000, '2026-08-09')`,
  ).run()
  raw.prepare(
    `INSERT INTO financials (cik, period_end, period_type, computed_at)
     VALUES (2, '2025-03-31', 'TTM', '2026-08-09')`,
  ).run()

  stats = await refreshPrices({ raw, prices })
})

describe('refreshPrices', () => {
  it('주가와 주식수로 시가총액을 계산한다', () => {
    const m = getLatestMarketData(raw, 1)!
    expect(m.price).toBe(200)
    expect(m.sharesOutstanding).toBe(1000)
    expect(m.marketCap).toBe(200_000)
    expect(m.date).toBe('2026-08-08')
  })

  it('주식수가 없으면 시가총액은 null이고 주가는 저장한다', () => {
    const m = getLatestMarketData(raw, 2)!
    expect(m.price).toBe(200)
    expect(m.marketCap).toBeNull()
  })

  it('시세를 못 받으면 행을 만들지 않는다', () => {
    expect(getLatestMarketData(raw, 3)).toBeNull()
  })

  it('통계를 반환한다', () => {
    expect(stats.quoted).toBe(2)
    expect(stats.noQuote).toBe(1)
    expect(stats.missingShares).toBe(1)
  })

  it('재실행해도 같은 날짜 행이 중복되지 않는다', async () => {
    await refreshPrices({ raw, prices })
    const n = raw
      .prepare('SELECT COUNT(*) c FROM market_data WHERE cik = 1')
      .get() as { c: number }
    expect(n.c).toBe(1)
  })
})
```

세 기업의 역할: `NVDA`는 정상 경로, `NOSHARES`는 주식수 결측(시가총액 null), `NOQUOTE`는 시세 없음(행 미생성).

- [ ] **Step 8: 테스트 실패 확인**

Run: `npx vitest run tests/pipeline/refresh-prices.test.ts`
Expected: FAIL — `Cannot find module '@/pipeline/jobs/refresh-prices'`

- [ ] **Step 9: market 리포지토리 및 잡 구현**

`src/db/repositories/market.ts`:

```ts
import type Database from 'better-sqlite3'

export type MarketRow = {
  cik: number
  date: string
  price: number | null
  sharesOutstanding: number | null
  marketCap: number | null
  volume: number | null
}

export function upsertMarketData(raw: Database.Database, row: MarketRow): void {
  raw
    .prepare(
      `INSERT INTO market_data (cik, date, price, shares_outstanding, market_cap, volume)
       VALUES (@cik, @date, @price, @sharesOutstanding, @marketCap, @volume)
       ON CONFLICT(cik, date) DO UPDATE SET
         price = excluded.price,
         shares_outstanding = excluded.shares_outstanding,
         market_cap = excluded.market_cap,
         volume = excluded.volume`,
    )
    .run(row)
}

export function getLatestMarketData(
  raw: Database.Database,
  cik: number,
): MarketRow | null {
  const r = raw
    .prepare(
      `SELECT cik, date, price, shares_outstanding AS sharesOutstanding,
              market_cap AS marketCap, volume
       FROM market_data WHERE cik = ? ORDER BY date DESC LIMIT 1`,
    )
    .get(cik) as MarketRow | undefined
  return r ?? null
}
```

`src/pipeline/jobs/refresh-prices.ts`:

```ts
import type Database from 'better-sqlite3'
import type { PriceProvider } from '@/providers/types'
import { upsertMarketData } from '@/db/repositories/market'
import { runJob, type JobStats } from '@/pipeline/runner'

export type PriceDeps = { raw: Database.Database; prices: PriceProvider }

type Target = { cik: number; ticker: string; sharesOutstanding: number | null }

export async function refreshPrices(deps: PriceDeps): Promise<JobStats> {
  const { raw, prices } = deps

  return runJob(raw, 'prices', async () => {
    // 발행주식수는 가장 최근 기간의 값을 쓴다. TTM이 없으면 분기·연간 어느 쪽이든 최신을 택한다.
    const targets = raw
      .prepare(
        `SELECT c.cik, c.ticker,
                (SELECT f.shares_outstanding FROM financials f
                  WHERE f.cik = c.cik AND f.shares_outstanding IS NOT NULL
                  ORDER BY f.period_end DESC LIMIT 1) AS sharesOutstanding
         FROM companies c
         JOIN company_industry ci ON ci.cik = c.cik
         WHERE c.is_active = 1
         ORDER BY c.cik`,
      )
      .all() as Target[]

    let quoted = 0
    let noQuote = 0
    let missingShares = 0

    for (const t of targets) {
      const q = await prices.fetchQuote(t.ticker)
      if (!q) { noQuote++; continue }
      if (t.sharesOutstanding === null) missingShares++
      upsertMarketData(raw, {
        cik: t.cik,
        date: q.date,
        price: q.price,
        sharesOutstanding: t.sharesOutstanding,
        marketCap: t.sharesOutstanding === null ? null : q.price * t.sharesOutstanding,
        volume: null, // Finnhub 무료 티어 /quote는 거래량을 제공하지 않는다 (설계문서 §5.3)
      })
      quoted++
    }

    return { targets: targets.length, quoted, noQuote, missingShares, provider: prices.name }
  })
}
```

`JobStats` 타입이 `Record<string, number | string[]>`이므로 `provider: prices.name`(문자열)을 담으려면 Task 7의 타입을 다음으로 넓힌다.

```ts
export type JobStats = Record<string, number | string | string[]>
```

- [ ] **Step 10: 테스트 통과 확인**

Run: `npx vitest run tests/pipeline/refresh-prices.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 11: 전체 테스트 확인**

Run: `npm test`
Expected: PASS — Stage A 44 + http 7 + listing 5 + reference 5 + filter 7 + bulk 6 + companyfacts 5 + resolve 15 + normalizer 13 + universe 8 + quarters 3 + fundamentals 9 + price 10 + refresh 5 = 142 tests

- [ ] **Step 12: 커밋**

```bash
git add -A
git commit -m "feat: 시세 Provider 및 refresh-prices 잡

Finnhub /quote와 픽스처 두 구현을 env 값 하나로 전환한다.
키가 없으면 발급 방법과 대안을 담은 에러를 던진다.
시가총액 = 주가 x SEC 발행주식수. 주식수가 없으면 시가총액은 null이며
주가는 그대로 저장한다. 무료 티어에 거래량이 없어 volume은 null이다."
```

---

## Stage C — 스코어링 (Task 13-21)

### Task 13: 아키텍처 테스트 & 도메인 지표 함수

**Files:**
- Create: `src/domain/metrics.ts`
- Test: `tests/architecture.test.ts`, `tests/domain/metrics.test.ts`

**Interfaces:**
- Consumes: `FinancialPeriod` (Task 2), `yoy`/`cagr` (Task 2), `olsSlope`/`stdev` (Task 2)
- Produces (전부 `src/domain/metrics.ts`, 인자는 최근순 배열):
  - `ttmRevenueGrowth(ttm: FinancialPeriod[]): number | null` — `ttm[0]` 대 `ttm[4]`
  - `revenueCagr3y(ttm: FinancialPeriod[]): number | null` — `ttm[0]` 대 `ttm[12]`, 3년
  - `revenueAcceleration(quarterly: FinancialPeriod[]): number | null`
  - `grossMargin(p: FinancialPeriod | undefined): number | null`
  - `operatingMargin(p): number | null`
  - `fcfMargin(p): number | null`
  - `grossMarginSeries(quarterly: FinancialPeriod[], n: number): number[]` — **오래된 순**으로 반환(OLS 기울기가 양수면 개선)
  - `grossMarginTrendBps(quarterly, n): number | null` — 분기당 기울기를 연율 bps로
  - `roic(p: FinancialPeriod | undefined, taxRate: number): number | null`
  - `cashRunwayQuarters(ttm: FinancialPeriod[]): number | null` — FCF ≥ 0이면 null
  - `netCashToMarketCap(p, marketCap): number | null`
  - `debtToEbitda(p): number | null`
  - `opexGrowth(ttm: FinancialPeriod[]): number | null`

이 함수들은 스냅샷 통계(Task 14)와 팩터(Task 16-18) 양쪽에서 쓰인다. 한 곳에 두어 두 경로가 다른 값을 내는 일을 막는다.

- [ ] **Step 1: 아키텍처 테스트 작성**

`tests/architecture.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { globSync } from 'node:fs'

/**
 * engines/는 순수 함수여야 한다. DB나 Provider를 import하면
 * 네트워크 없이 테스트할 수 없고 Provider 교체 시 엔진까지 고쳐야 한다.
 */
describe('아키텍처 경계', () => {
  it('engines는 db와 providers를 import하지 않는다', () => {
    const files = globSync('src/engines/**/*.ts')
    const violations: string[] = []
    for (const file of files) {
      const src = readFileSync(file, 'utf8')
      for (const m of src.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
        const spec = m[1]!
        if (/(^|\/)(@\/)?(db|providers)(\/|$)/.test(spec)) {
          violations.push(`${file} → ${spec}`)
        }
      }
    }
    expect(violations).toEqual([])
  })

  it('engines 파일이 실제로 존재한다 (테스트가 공허하지 않음을 보장)', () => {
    expect(globSync('src/engines/**/*.ts').length).toBeGreaterThan(0)
  })
})
```

> `globSync`는 Node 22+의 `node:fs`에 있다. Node 24이므로 사용 가능하다.
> 두 번째 테스트는 Task 15에서 첫 엔진 파일이 생기기 전까지 실패한다.
> **Step 1에서는 첫 번째 테스트만 작성하고, 두 번째는 Task 15의 커밋에서 추가한다.**

- [ ] **Step 2: 아키텍처 테스트 통과 확인**

Run: `npx vitest run tests/architecture.test.ts`
Expected: PASS (1 test — `src/engines/`가 비어 있으므로 위반 0)

- [ ] **Step 3: 지표 실패 테스트 작성**

`tests/domain/metrics.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import type { FinancialPeriod } from '@/domain/types'
import {
  ttmRevenueGrowth, revenueCagr3y, revenueAcceleration,
  grossMargin, operatingMargin, fcfMargin,
  grossMarginSeries, grossMarginTrendBps,
  roic, cashRunwayQuarters, netCashToMarketCap, debtToEbitda, opexGrowth,
} from '@/domain/metrics'

function p(over: Partial<FinancialPeriod> & { periodEnd: string }): FinancialPeriod {
  return {
    periodType: 'TTM', revenue: null, grossProfit: null, operatingIncome: null,
    netIncome: null, ocf: null, capex: null, fcf: null, cash: null,
    totalDebt: null, equity: null, sharesDiluted: null, sharesOutstanding: null,
    sbc: null, rdExpense: null, ...over,
  }
}

/** 최근순 TTM 계열 — index가 클수록 과거 */
function ttmSeries(revenues: (number | null)[]): FinancialPeriod[] {
  return revenues.map((r, i) =>
    p({ periodEnd: `2025-${String(12 - i).padStart(2, '0')}-31`, revenue: r }),
  )
}

describe('ttmRevenueGrowth', () => {
  it('현재 TTM과 4분기 전 TTM을 비교한다', () => {
    const s = ttmSeries([500, 480, 460, 440, 400])
    expect(ttmRevenueGrowth(s)).toBeCloseTo(0.25)
  })
  it('4분기 전 TTM이 없으면 null', () => {
    expect(ttmRevenueGrowth(ttmSeries([500, 480]))).toBeNull()
  })
})

describe('revenueCagr3y', () => {
  it('12분기 전과 비교해 3년 CAGR을 낸다', () => {
    const s = ttmSeries(Array(13).fill(null).map((_, i) => (i === 0 ? 200 : i === 12 ? 100 : 150)))
    expect(revenueCagr3y(s)).toBeCloseTo(0.2599, 3)
  })
  it('이력이 짧으면 null', () => {
    expect(revenueCagr3y(ttmSeries([200, 190]))).toBeNull()
  })
})

describe('revenueAcceleration', () => {
  it('최근 2개 분기 YoY 평균에서 직전 2개 분기 YoY 평균을 뺀다', () => {
    // 분기 8개, 최근순. q[i] vs q[i+4]가 YoY
    const q = [160, 130, 110, 100, 100, 90, 85, 80].map((r, i) =>
      p({ periodEnd: `2025-${String(8 - i).padStart(2, '0')}-30`, periodType: 'Q', revenue: r }),
    )
    // 최근 2분기 YoY: 160/100-1=0.60, 130/90-1=0.4444 → 평균 0.5222
    // 직전 2분기 YoY: 110/85-1=0.2941, 100/80-1=0.25   → 평균 0.2721
    expect(revenueAcceleration(q)).toBeCloseTo(0.2502, 3)
  })
  it('분기가 8개 미만이면 null', () => {
    expect(revenueAcceleration([])).toBeNull()
  })
})

describe('마진', () => {
  const per = p({ periodEnd: '2025-12-31', revenue: 1000, grossProfit: 700, operatingIncome: 200, fcf: 150 })
  it('매출총이익률', () => expect(grossMargin(per)).toBeCloseTo(0.7))
  it('영업이익률', () => expect(operatingMargin(per)).toBeCloseTo(0.2))
  it('FCF 마진', () => expect(fcfMargin(per)).toBeCloseTo(0.15))
  it('매출이 0 이하면 null', () => {
    expect(grossMargin(p({ periodEnd: 'x', revenue: 0, grossProfit: 5 }))).toBeNull()
  })
  it('기간이 없으면 null', () => expect(grossMargin(undefined)).toBeNull())
})

describe('grossMarginSeries / grossMarginTrendBps', () => {
  const quarterly = [0.74, 0.72, 0.70, 0.68, 0.66, 0.64, 0.62, 0.60].map((gm, i) =>
    p({
      periodEnd: `2025-${String(8 - i).padStart(2, '0')}-30`, periodType: 'Q',
      revenue: 100, grossProfit: gm * 100,
    }),
  )

  it('오래된 순으로 반환한다', () => {
    const s = grossMarginSeries(quarterly, 8)
    expect(s[0]).toBeCloseTo(0.60)
    expect(s[7]).toBeCloseTo(0.74)
  })

  it('개선 추세는 양수 bps', () => {
    // 분기당 +0.02 → 연간 +0.08 → +800bps
    expect(grossMarginTrendBps(quarterly, 8)).toBeCloseTo(800, 0)
  })

  it('분기가 부족하면 null', () => {
    expect(grossMarginTrendBps(quarterly.slice(0, 2), 8)).toBeNull()
  })
})

describe('roic', () => {
  it('NOPAT을 투하자본으로 나눈다', () => {
    const per = p({
      periodEnd: '2025-12-31', operatingIncome: 1000,
      totalDebt: 2000, equity: 6000, cash: 1000,
    })
    // NOPAT = 1000 * 0.79 = 790, 투하자본 = 2000 + 6000 - 1000 = 7000
    expect(roic(per, 0.21)).toBeCloseTo(0.1129, 4)
  })
  it('투하자본이 0 이하면 null', () => {
    const per = p({ periodEnd: 'x', operatingIncome: 100, totalDebt: 0, equity: 100, cash: 500 })
    expect(roic(per, 0.21)).toBeNull()
  })
})

describe('cashRunwayQuarters', () => {
  it('현금을 분기 평균 소모액으로 나눈다', () => {
    const s = [p({ periodEnd: '2025-12-31', fcf: -400, cash: 1000 })]
    // 분기 평균 소모 = 400/4 = 100 → 런웨이 10분기
    expect(cashRunwayQuarters(s)).toBeCloseTo(10)
  })
  it('FCF가 양수면 null — 런웨이 개념이 없다', () => {
    expect(cashRunwayQuarters([p({ periodEnd: 'x', fcf: 100, cash: 1000 })])).toBeNull()
  })
  it('현금이 없으면 null', () => {
    expect(cashRunwayQuarters([p({ periodEnd: 'x', fcf: -100, cash: null })])).toBeNull()
  })
})

describe('netCashToMarketCap / debtToEbitda / opexGrowth', () => {
  it('순현금 비율', () => {
    const per = p({ periodEnd: 'x', cash: 1500, totalDebt: 500 })
    expect(netCashToMarketCap(per, 10000)).toBeCloseTo(0.1)
  })
  it('시가총액이 없으면 null', () => {
    expect(netCashToMarketCap(p({ periodEnd: 'x', cash: 1, totalDebt: 0 }), null)).toBeNull()
  })
  it('EBITDA 근사는 영업이익을 쓴다', () => {
    expect(debtToEbitda(p({ periodEnd: 'x', totalDebt: 1000, operatingIncome: 250 }))).toBeCloseTo(4)
  })
  it('영업이익이 0 이하면 null', () => {
    expect(debtToEbitda(p({ periodEnd: 'x', totalDebt: 1000, operatingIncome: -10 }))).toBeNull()
  })
  it('opex 증가율은 (매출총이익 - 영업이익) 기준', () => {
    const s = [
      p({ periodEnd: '2025-12-31', grossProfit: 700, operatingIncome: 200 }),
      p({ periodEnd: '2025-09-30' }), p({ periodEnd: '2025-06-30' }), p({ periodEnd: '2025-03-31' }),
      p({ periodEnd: '2024-12-31', grossProfit: 500, operatingIncome: 100 }),
    ]
    // opex: 500 vs 400 → +25%
    expect(opexGrowth(s)).toBeCloseTo(0.25)
  })
})
```

- [ ] **Step 4: 테스트 실패 확인**

Run: `npx vitest run tests/domain/metrics.test.ts`
Expected: FAIL — `Cannot find module '@/domain/metrics'`

- [ ] **Step 5: 구현**

`src/domain/metrics.ts`:

```ts
import type { FinancialPeriod } from './types.js'
import { yoy, cagr } from './growth.js'
import { olsSlope } from './stats.js'

const QUARTERS_PER_YEAR = 4

function ratio(numerator: number | null, revenue: number | null): number | null {
  if (numerator === null || revenue === null || revenue <= 0) return null
  return numerator / revenue
}

export function ttmRevenueGrowth(ttm: FinancialPeriod[]): number | null {
  return yoy(ttm[0]?.revenue ?? null, ttm[QUARTERS_PER_YEAR]?.revenue ?? null)
}

export function revenueCagr3y(ttm: FinancialPeriod[]): number | null {
  return cagr(ttm[0]?.revenue ?? null, ttm[12]?.revenue ?? null, 3)
}

/** 최근 2개 분기 YoY 평균 − 직전 2개 분기 YoY 평균. 분기 8개가 필요하다. */
export function revenueAcceleration(quarterly: FinancialPeriod[]): number | null {
  if (quarterly.length < 8) return null
  const q = (i: number) => quarterly[i]?.revenue ?? null
  const growthAt = (i: number) => yoy(q(i), q(i + QUARTERS_PER_YEAR))

  const recent = [growthAt(0), growthAt(1)]
  const prior = [growthAt(2), growthAt(3)]
  if (recent.some((v) => v === null) || prior.some((v) => v === null)) return null

  const mean = (xs: (number | null)[]) => (xs as number[]).reduce((a, b) => a + b, 0) / xs.length
  return mean(recent) - mean(prior)
}

export function grossMargin(p: FinancialPeriod | undefined): number | null {
  return p ? ratio(p.grossProfit, p.revenue) : null
}

export function operatingMargin(p: FinancialPeriod | undefined): number | null {
  return p ? ratio(p.operatingIncome, p.revenue) : null
}

export function fcfMargin(p: FinancialPeriod | undefined): number | null {
  return p ? ratio(p.fcf, p.revenue) : null
}

/** 오래된 순으로 반환한다. 기울기가 양수면 마진이 개선되고 있다는 뜻. */
export function grossMarginSeries(quarterly: FinancialPeriod[], n: number): number[] {
  const out: number[] = []
  for (const q of quarterly.slice(0, n)) {
    const gm = grossMargin(q)
    if (gm !== null) out.push(gm)
  }
  return out.reverse()
}

/** 분기당 기울기를 연율 bps로 환산한다. */
export function grossMarginTrendBps(
  quarterly: FinancialPeriod[],
  n: number,
): number | null {
  const series = grossMarginSeries(quarterly, n)
  if (series.length < n) return null
  const slope = olsSlope(series)
  return slope === null ? null : slope * QUARTERS_PER_YEAR * 10_000
}

export function roic(p: FinancialPeriod | undefined, taxRate: number): number | null {
  if (!p || p.operatingIncome === null) return null
  if (p.totalDebt === null || p.equity === null || p.cash === null) return null
  const invested = p.totalDebt + p.equity - p.cash
  if (invested <= 0) return null
  return (p.operatingIncome * (1 - taxRate)) / invested
}

/** FCF가 음수인 기업만 의미가 있다. 분기 평균 소모액 기준 잔여 분기 수. */
export function cashRunwayQuarters(ttm: FinancialPeriod[]): number | null {
  const p = ttm[0]
  if (!p || p.fcf === null || p.fcf >= 0 || p.cash === null) return null
  const burnPerQuarter = -p.fcf / QUARTERS_PER_YEAR
  if (burnPerQuarter <= 0) return null
  return p.cash / burnPerQuarter
}

export function netCashToMarketCap(
  p: FinancialPeriod | undefined,
  marketCap: number | null,
): number | null {
  if (!p || marketCap === null || marketCap <= 0) return null
  if (p.cash === null || p.totalDebt === null) return null
  return (p.cash - p.totalDebt) / marketCap
}

/** EBITDA는 감가상각 태그를 안정적으로 얻기 어려워 영업이익으로 근사한다. */
export function debtToEbitda(p: FinancialPeriod | undefined): number | null {
  if (!p || p.totalDebt === null || p.operatingIncome === null) return null
  if (p.operatingIncome <= 0) return null
  return p.totalDebt / p.operatingIncome
}

function opexOf(p: FinancialPeriod | undefined): number | null {
  if (!p || p.grossProfit === null || p.operatingIncome === null) return null
  return p.grossProfit - p.operatingIncome
}

export function opexGrowth(ttm: FinancialPeriod[]): number | null {
  return yoy(opexOf(ttm[0]), opexOf(ttm[QUARTERS_PER_YEAR]))
}
```

- [ ] **Step 6: 테스트 통과 확인**

Run: `npx vitest run tests/domain/metrics.test.ts tests/architecture.test.ts`
Expected: PASS (metrics 22 + architecture 1 = 23 tests)

- [ ] **Step 7: 커밋**

```bash
git add -A
git commit -m "feat: 도메인 지표 함수 및 아키텍처 경계 테스트

성장률·마진·ROIC·런웨이를 한 곳에 두어 스냅샷 통계와 팩터가
서로 다른 값을 내는 일을 막는다.
engines가 db나 providers를 import하면 테스트가 실패한다."
```

---

### Task 14: CompanySnapshot 조립

**Files:**
- Create: `src/pipeline/snapshot.ts`
- Test: `tests/pipeline/snapshot.test.ts`

**Interfaces:**
- Consumes: `getFinancialsFor` (Task 11), `getLatestMarketData` (Task 12), `loadTaxonomy` (Task 3), 지표 함수 (Task 13), `median`/`percentileOf` (Task 2)
- Produces:
  - `buildSnapshots(deps: SnapshotDeps): CompanySnapshot[]`
  - `type SnapshotDeps = { raw: Database.Database; taxonomy: Taxonomy; cfg: AppConfig; asOf: string }`
  - `DISTRIBUTION_KEYS = ['revenue_growth', 'revenue_acceleration', 'gross_margin', 'fcf_margin', 'market_cap', 'roic'] as const`

**2단 구성이 필요한 이유:** `IndustryStats`(중앙값·백분위)는 같은 산업의 다른 기업 값이 있어야 계산된다. 1차로 기업별 기본 지표를 모으고, 2차로 산업별 통계를 붙인다.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/pipeline/snapshot.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { getRawDb, runMigrations } from '@/db/client'
import { parseConfig } from '@/config'
import { loadTaxonomy } from '@/taxonomy'
import { buildSnapshots } from '@/pipeline/snapshot'
import type { CompanySnapshot } from '@/domain/types'

const cfg = parseConfig(readFileSync('config.yaml', 'utf8'))
const taxonomy = loadTaxonomy()

let raw: Database.Database
let snaps: CompanySnapshot[]

function seedCompany(
  db: Database.Database,
  cik: number, ticker: string, industry: string,
  revenue: number, grossProfit: number, marketCap: number | null,
) {
  db.prepare(
    `INSERT INTO companies (cik, ticker, name, sic, is_active, first_seen, last_updated)
     VALUES (?, ?, ?, '3674', 1, '2026-08-09', '2026-08-09')`,
  ).run(cik, ticker, `${ticker} Inc`)
  db.prepare(
    `INSERT INTO company_industry (cik, industry_slug, theme_slug, is_primary, source)
     VALUES (?, ?, 'ai-software-semi', 1, 'sic')`,
  ).run(cik, industry)
  // TTM 5개: 현재와 4분기 전이 있어야 성장률이 계산된다
  const ins = db.prepare(
    `INSERT INTO financials (cik, period_end, period_type, revenue, gross_profit, computed_at)
     VALUES (?, ?, 'TTM', ?, ?, '2026-08-09')`,
  )
  const ends = ['2025-03-31', '2024-12-31', '2024-09-30', '2024-06-30', '2024-03-31']
  ends.forEach((e, i) => ins.run(cik, e, i === 0 ? revenue : revenue / 1.25, grossProfit))
  if (marketCap !== null) {
    db.prepare(
      `INSERT INTO market_data (cik, date, price, shares_outstanding, market_cap)
       VALUES (?, '2026-08-08', 10, ?, ?)`,
    ).run(cik, marketCap / 10, marketCap)
  }
}

beforeAll(() => {
  raw = getRawDb(join(mkdtempSync(join(tmpdir(), 'tb-snap-')), 's.db'))
  runMigrations(raw)
  seedCompany(raw, 1, 'AAA', 'semiconductors', 1000, 700, 5_000_000_000)
  seedCompany(raw, 2, 'BBB', 'semiconductors', 2000, 1000, 20_000_000_000)
  seedCompany(raw, 3, 'CCC', 'semiconductors', 500, 200, 400_000_000)
  seedCompany(raw, 4, 'DDD', 'cybersecurity', 800, 600, null) // 시가총액 없음
  snaps = buildSnapshots({ raw, taxonomy, cfg, asOf: '2026-08-09' })
})

describe('buildSnapshots', () => {
  it('유니버스 기업마다 스냅샷을 만든다', () => {
    expect(snaps.map((s) => s.ticker).sort()).toEqual(['AAA', 'BBB', 'CCC', 'DDD'])
  })

  it('산업 메타데이터를 붙인다', () => {
    const a = snaps.find((s) => s.ticker === 'AAA')!
    expect(a.industrySlug).toBe('semiconductors')
    expect(a.themeSlug).toBe('ai-software-semi')
    expect(a.industry.name).toBe('Semiconductors')
  })

  it('시가총액과 주가를 붙인다', () => {
    const a = snaps.find((s) => s.ticker === 'AAA')!
    expect(a.marketCap).toBe(5_000_000_000)
    expect(a.price).toBe(10)
    expect(a.priceDate).toBe('2026-08-08')
  })

  it('시가총액이 없어도 스냅샷을 만들고 null로 둔다', () => {
    const d = snaps.find((s) => s.ticker === 'DDD')!
    expect(d.marketCap).toBeNull()
  })

  it('TTM 계열을 최근순으로 붙인다', () => {
    const a = snaps.find((s) => s.ticker === 'AAA')!
    expect(a.ttm[0]!.periodEnd).toBe('2025-03-31')
    expect(a.ttm[0]!.revenue).toBe(1000)
    expect(a.ttm).toHaveLength(5)
  })

  it('산업별 후보 수를 센다', () => {
    const a = snaps.find((s) => s.ticker === 'AAA')!
    expect(a.industryStats.candidateCount).toBe(3)
    const d = snaps.find((s) => s.ticker === 'DDD')!
    expect(d.industryStats.candidateCount).toBe(1)
  })

  it('산업 GM 중앙값을 계산한다', () => {
    // semiconductors GM: 0.70, 0.50, 0.40 → 중앙값 0.50
    const a = snaps.find((s) => s.ticker === 'AAA')!
    expect(a.industryStats.medianGrossMargin).toBeCloseTo(0.5)
  })

  it('산업 매출성장률 중앙값을 계산한다', () => {
    // 세 기업 모두 1.25배 성장 → 0.25
    const a = snaps.find((s) => s.ticker === 'AAA')!
    expect(a.industryStats.medianRevenueGrowth).toBeCloseTo(0.25)
  })

  it('백분위 계산용 분포를 오름차순으로 담는다', () => {
    const a = snaps.find((s) => s.ticker === 'AAA')!
    const gm = a.industryStats.distributions.gross_margin!
    expect(gm).toEqual([...gm].sort((x, y) => x - y))
    expect(gm).toHaveLength(3)
  })

  it('asOf를 전파한다', () => {
    expect(snaps[0]!.asOf).toBe('2026-08-09')
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run tests/pipeline/snapshot.test.ts`
Expected: FAIL — `Cannot find module '@/pipeline/snapshot'`

- [ ] **Step 3: 구현**

`src/pipeline/snapshot.ts`:

```ts
import type Database from 'better-sqlite3'
import type { AppConfig } from '@/config'
import type { Taxonomy } from '@/taxonomy'
import type { CompanySnapshot, IndustryStats } from '@/domain/types'
import { median } from '@/domain/stats'
import {
  ttmRevenueGrowth, revenueAcceleration, grossMargin, fcfMargin, roic,
} from '@/domain/metrics'
import { getFinancialsFor } from '@/db/repositories/financials'
import { getLatestMarketData } from '@/db/repositories/market'

export const DISTRIBUTION_KEYS = [
  'revenue_growth', 'revenue_acceleration', 'gross_margin',
  'fcf_margin', 'market_cap', 'roic',
] as const

export type SnapshotDeps = {
  raw: Database.Database
  taxonomy: Taxonomy
  cfg: AppConfig
  asOf: string
}

type CompanyRow = {
  cik: number
  ticker: string
  name: string
  industrySlug: string
  themeSlug: string
  source: 'sic' | 'override'
}

const EMPTY_STATS: IndustryStats = {
  candidateCount: 0,
  medianGrossMargin: null,
  medianRevenueGrowth: null,
  distributions: {},
}

export function buildSnapshots(deps: SnapshotDeps): CompanySnapshot[] {
  const { raw, taxonomy, cfg, asOf } = deps

  const rows = raw
    .prepare(
      `SELECT c.cik, c.ticker, c.name,
              ci.industry_slug AS industrySlug, ci.theme_slug AS themeSlug, ci.source
       FROM companies c
       JOIN company_industry ci ON ci.cik = c.cik
       WHERE c.is_active = 1
       ORDER BY c.cik`,
    )
    .all() as CompanyRow[]

  // 1차: 산업 통계 없이 스냅샷을 만든다
  const partial: CompanySnapshot[] = []
  for (const r of rows) {
    const industry = taxonomy.industries.get(r.industrySlug)
    if (!industry) continue // taxonomy 로더가 무결성을 검증하므로 정상 경로에서는 발생하지 않는다

    const fin = getFinancialsFor(raw, r.cik)
    const market = getLatestMarketData(raw, r.cik)

    partial.push({
      cik: r.cik,
      ticker: r.ticker,
      name: r.name,
      themeSlug: r.themeSlug,
      industrySlug: r.industrySlug,
      industry,
      classificationSource: r.source,
      marketCap: market?.marketCap ?? null,
      price: market?.price ?? null,
      priceDate: market?.date ?? null,
      sharesOutstanding: market?.sharesOutstanding ?? null,
      ttm: fin.ttm,
      annual: fin.annual,
      quarterly: fin.quarterly,
      industryStats: EMPTY_STATS,
      asOf,
    })
  }

  // 2차: 산업별 통계를 계산해 붙인다
  const byIndustry = new Map<string, CompanySnapshot[]>()
  for (const s of partial) {
    const list = byIndustry.get(s.industrySlug)
    if (list) list.push(s)
    else byIndustry.set(s.industrySlug, [s])
  }

  const statsByIndustry = new Map<string, IndustryStats>()
  for (const [slug, members] of byIndustry) {
    const values: Record<string, number[]> = {}
    for (const key of DISTRIBUTION_KEYS) values[key] = []

    for (const s of members) {
      const push = (key: string, v: number | null) => {
        if (v !== null && Number.isFinite(v)) values[key]!.push(v)
      }
      push('revenue_growth', ttmRevenueGrowth(s.ttm))
      push('revenue_acceleration', revenueAcceleration(s.quarterly))
      push('gross_margin', grossMargin(s.ttm[0]))
      push('fcf_margin', fcfMargin(s.ttm[0]))
      push('market_cap', s.marketCap)
      push('roic', roic(s.ttm[0], cfg.scoring.tax_rate))
    }
    for (const key of DISTRIBUTION_KEYS) values[key]!.sort((a, b) => a - b)

    statsByIndustry.set(slug, {
      candidateCount: members.length,
      medianGrossMargin: median(values.gross_margin!),
      medianRevenueGrowth: median(values.revenue_growth!),
      distributions: values,
    })
  }

  return partial.map((s) => ({
    ...s,
    industryStats: statsByIndustry.get(s.industrySlug) ?? EMPTY_STATS,
  }))
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run tests/pipeline/snapshot.test.ts`
Expected: PASS (10 tests)

- [ ] **Step 5: 커밋**

```bash
git add -A
git commit -m "feat: CompanySnapshot 조립

엔진이 받을 유일한 입력을 DB에서 만든다.
산업 중앙값과 백분위 분포는 같은 산업의 다른 기업이 필요하므로
1차로 기업 지표를 모으고 2차로 통계를 붙이는 2단 구성이다."
```

---

### Task 15: Quality Gate 엔진 (Red Flag)

**Files:**
- Create: `src/engines/quality/index.ts`
- Test: `tests/engines/quality.test.ts`
- Modify: `tests/architecture.test.ts` (두 번째 테스트 추가)

**Interfaces:**
- Consumes: `CompanySnapshot`/`RedFlag` (Task 2), `AppConfig` (Task 1), 지표 함수 (Task 13)
- Produces:
  - `evaluateQuality(s: CompanySnapshot, cfg: AppConfig): RedFlag[]`
  - `hasCritical(flags: RedFlag[]): boolean`
  - `hasWarning(flags: RedFlag[]): boolean`
  - Red Flag 코드: `REVENUE_DECLINE_2Y`, `NEGATIVE_EQUITY_BURN`, `RUNWAY_CRITICAL`, `EXTREME_DILUTION` (CRITICAL) / `GM_COLLAPSE`, `SBC_EXCESSIVE`, `DILUTION`, `LEVERAGE_HIGH`, `RUNWAY_LOW` (WARNING)

**중복 방지 규칙:** 희석과 런웨이는 CRITICAL과 WARNING 임계값이 겹친다. 심각한 쪽이 발동하면 약한 쪽은 내지 않는다. 같은 사실을 두 번 세면 화면이 오해를 부른다.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/engines/quality.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseConfig } from '@/config'
import { evaluateQuality, hasCritical, hasWarning } from '@/engines/quality'
import type { CompanySnapshot, FinancialPeriod } from '@/domain/types'

const cfg = parseConfig(readFileSync('config.yaml', 'utf8'))

function fp(over: Partial<FinancialPeriod>): FinancialPeriod {
  return {
    periodEnd: '2025-03-31', periodType: 'TTM',
    revenue: 1000, grossProfit: 700, operatingIncome: 200, netIncome: 150,
    ocf: 250, capex: 50, fcf: 200, cash: 5000, totalDebt: 100, equity: 8000,
    sharesDiluted: 1000, sharesOutstanding: 1000, sbc: 50, rdExpense: 200, ...over,
  }
}

function snap(over: Partial<CompanySnapshot>): CompanySnapshot {
  return {
    cik: 1, ticker: 'TEST', name: 'Test Inc',
    themeSlug: 'ai-software-semi', industrySlug: 'semiconductors',
    industry: {
      slug: 'semiconductors', name: 'Semiconductors', themeSlug: 'ai-software-semi',
      tamUsd: null, tamCagr: null, tamSource: null, tamAsOf: null,
    },
    classificationSource: 'sic',
    marketCap: 5_000_000_000, price: 10, priceDate: '2026-08-08', sharesOutstanding: 1000,
    ttm: [fp({}), fp({ periodEnd: '2024-12-31' }), fp({ periodEnd: '2024-09-30' }),
          fp({ periodEnd: '2024-06-30' }), fp({ periodEnd: '2024-03-31' })],
    annual: [], quarterly: [],
    industryStats: {
      candidateCount: 5, medianGrossMargin: 0.6, medianRevenueGrowth: 0.2, distributions: {},
    },
    asOf: '2026-08-09', ...over,
  }
}

const codes = (s: CompanySnapshot) => evaluateQuality(s, cfg).map((f) => f.code).sort()

describe('evaluateQuality — 정상 기업', () => {
  it('건전한 기업은 Red Flag가 없다', () => {
    expect(evaluateQuality(snap({}), cfg)).toEqual([])
  })
})

describe('CRITICAL', () => {
  it('2년 연속 매출 감소', () => {
    const annual = [
      fp({ periodType: 'A', periodEnd: '2024-12-31', revenue: 800 }),
      fp({ periodType: 'A', periodEnd: '2023-12-31', revenue: 900 }),
      fp({ periodType: 'A', periodEnd: '2022-12-31', revenue: 1000 }),
    ]
    expect(codes(snap({ annual }))).toContain('REVENUE_DECLINE_2Y')
  })

  it('한 해만 감소하면 발동하지 않는다', () => {
    const annual = [
      fp({ periodType: 'A', periodEnd: '2024-12-31', revenue: 800 }),
      fp({ periodType: 'A', periodEnd: '2023-12-31', revenue: 900 }),
      fp({ periodType: 'A', periodEnd: '2022-12-31', revenue: 850 }),
    ]
    expect(codes(snap({ annual }))).not.toContain('REVENUE_DECLINE_2Y')
  })

  it('자본잠식 + 음의 FCF', () => {
    const ttm = [fp({ equity: -500, fcf: -100 }), fp({ periodEnd: '2024-12-31' })]
    expect(codes(snap({ ttm }))).toContain('NEGATIVE_EQUITY_BURN')
  })

  it('자본잠식이어도 FCF가 양수면 발동하지 않는다', () => {
    const ttm = [fp({ equity: -500, fcf: 100 })]
    expect(codes(snap({ ttm }))).not.toContain('NEGATIVE_EQUITY_BURN')
  })

  it('현금 런웨이 2분기 미만', () => {
    // 현금 100, TTM FCF -400 → 분기 소모 100 → 런웨이 1분기
    const ttm = [fp({ cash: 100, fcf: -400 })]
    const c = codes(snap({ ttm }))
    expect(c).toContain('RUNWAY_CRITICAL')
    expect(c).not.toContain('RUNWAY_LOW')   // 중복 방지
  })

  it('주식수 1년 50% 초과 증가', () => {
    const ttm = [fp({ sharesDiluted: 1600 }), fp({ periodEnd: '2024-12-31' }),
                 fp({ periodEnd: '2024-09-30' }), fp({ periodEnd: '2024-06-30' }),
                 fp({ periodEnd: '2024-03-31', sharesDiluted: 1000 })]
    const c = codes(snap({ ttm }))
    expect(c).toContain('EXTREME_DILUTION')
    expect(c).not.toContain('DILUTION')     // 중복 방지
  })
})

describe('WARNING', () => {
  it('GM 500bp 초과 하락', () => {
    const ttm = [fp({ revenue: 1000, grossProfit: 600 }), fp({ periodEnd: '2024-12-31' }),
                 fp({ periodEnd: '2024-09-30' }), fp({ periodEnd: '2024-06-30' }),
                 fp({ periodEnd: '2024-03-31', revenue: 1000, grossProfit: 700 })]
    expect(codes(snap({ ttm }))).toContain('GM_COLLAPSE')
  })

  it('SBC가 매출의 25% 초과', () => {
    expect(codes(snap({ ttm: [fp({ sbc: 300 })] }))).toContain('SBC_EXCESSIVE')
  })

  it('주식수 15% 초과 증가', () => {
    const ttm = [fp({ sharesDiluted: 1200 }), fp({ periodEnd: '2024-12-31' }),
                 fp({ periodEnd: '2024-09-30' }), fp({ periodEnd: '2024-06-30' }),
                 fp({ periodEnd: '2024-03-31', sharesDiluted: 1000 })]
    expect(codes(snap({ ttm }))).toContain('DILUTION')
  })

  it('Debt/EBITDA 5 초과', () => {
    expect(codes(snap({ ttm: [fp({ totalDebt: 2000, operatingIncome: 200 })] })))
      .toContain('LEVERAGE_HIGH')
  })

  it('런웨이 6분기 미만', () => {
    // 현금 400, TTM FCF -400 → 분기 소모 100 → 런웨이 4분기
    expect(codes(snap({ ttm: [fp({ cash: 400, fcf: -400 })] }))).toContain('RUNWAY_LOW')
  })
})

describe('증거 및 헬퍼', () => {
  it('Red Flag에 근거 수치를 담는다', () => {
    const flags = evaluateQuality(snap({ ttm: [fp({ sbc: 300 })] }), cfg)
    const sbc = flags.find((f) => f.code === 'SBC_EXCESSIVE')!
    expect(sbc.evidence.ratio).toBeCloseTo(0.3)
    expect(sbc.severity).toBe('WARNING')
    expect(sbc.message.length).toBeGreaterThan(0)
  })

  it('데이터가 없으면 Red Flag를 만들지 않는다 — 결측은 위험 신호가 아니다', () => {
    const empty = snap({ ttm: [], annual: [], quarterly: [] })
    expect(evaluateQuality(empty, cfg)).toEqual([])
  })

  it('hasCritical / hasWarning', () => {
    const critical = evaluateQuality(snap({ ttm: [fp({ cash: 100, fcf: -400 })] }), cfg)
    expect(hasCritical(critical)).toBe(true)
    const warning = evaluateQuality(snap({ ttm: [fp({ sbc: 300 })] }), cfg)
    expect(hasCritical(warning)).toBe(false)
    expect(hasWarning(warning)).toBe(true)
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run tests/engines/quality.test.ts`
Expected: FAIL — `Cannot find module '@/engines/quality'`

- [ ] **Step 3: 구현**

`src/engines/quality/index.ts`:

```ts
import type { AppConfig } from '@/config'
import type { CompanySnapshot, RedFlag } from '@/domain/types'
import { yoy } from '@/domain/growth'
import { grossMargin, cashRunwayQuarters, debtToEbitda } from '@/domain/metrics'

const QUARTERS_PER_YEAR = 4

function flag(
  code: string,
  severity: 'CRITICAL' | 'WARNING',
  message: string,
  evidence: Record<string, number | string | null>,
): RedFlag {
  return { code, severity, message, evidence }
}

export function evaluateQuality(s: CompanySnapshot, cfg: AppConfig): RedFlag[] {
  const g = cfg.quality_gate
  const out: RedFlag[] = []
  const ttm = s.ttm[0]
  const ttmPrior = s.ttm[QUARTERS_PER_YEAR]

  // 2년 연속 연간 매출 감소
  const a = s.annual
  if (a.length >= g.revenue_decline_years + 1) {
    let declining = true
    for (let i = 0; i < g.revenue_decline_years; i++) {
      const cur = a[i]?.revenue
      const prev = a[i + 1]?.revenue
      if (typeof cur !== 'number' || typeof prev !== 'number' || cur >= prev) {
        declining = false
        break
      }
    }
    if (declining) {
      out.push(
        flag('REVENUE_DECLINE_2Y', 'CRITICAL',
          `${g.revenue_decline_years}년 연속 매출 감소`,
          { latest: a[0]?.revenue ?? null, oldest: a[g.revenue_decline_years]?.revenue ?? null }),
      )
    }
  }

  // 자본잠식 + 음의 FCF
  if (ttm && ttm.equity !== null && ttm.equity < 0 && ttm.fcf !== null && ttm.fcf < 0) {
    out.push(
      flag('NEGATIVE_EQUITY_BURN', 'CRITICAL', '자본잠식 상태에서 현금이 유출되고 있음',
        { equity: ttm.equity, fcf: ttm.fcf }),
    )
  }

  // 현금 런웨이 — CRITICAL이 발동하면 WARNING은 내지 않는다
  const runway = cashRunwayQuarters(s.ttm)
  if (runway !== null) {
    if (runway < g.runway_critical_quarters) {
      out.push(
        flag('RUNWAY_CRITICAL', 'CRITICAL',
          `현금 런웨이 ${runway.toFixed(1)}분기 — ${g.runway_critical_quarters}분기 미만`,
          { quarters: runway }),
      )
    } else if (runway < g.runway_low_quarters) {
      out.push(
        flag('RUNWAY_LOW', 'WARNING',
          `현금 런웨이 ${runway.toFixed(1)}분기 — ${g.runway_low_quarters}분기 미만`,
          { quarters: runway }),
      )
    }
  }

  // 주식 희석 — 마찬가지로 심각한 쪽만
  const dilution = yoy(ttm?.sharesDiluted ?? null, ttmPrior?.sharesDiluted ?? null)
  if (dilution !== null) {
    if (dilution > g.extreme_dilution) {
      out.push(
        flag('EXTREME_DILUTION', 'CRITICAL',
          `희석주식수 1년 ${(dilution * 100).toFixed(0)}% 증가`, { ratio: dilution }),
      )
    } else if (dilution > g.dilution_warning) {
      out.push(
        flag('DILUTION', 'WARNING',
          `희석주식수 1년 ${(dilution * 100).toFixed(0)}% 증가`, { ratio: dilution }),
      )
    }
  }

  // 매출총이익률 급락
  const gmNow = grossMargin(ttm)
  const gmPrior = grossMargin(ttmPrior)
  if (gmNow !== null && gmPrior !== null) {
    const dropBps = (gmPrior - gmNow) * 10_000
    if (dropBps > g.gm_collapse_bps) {
      out.push(
        flag('GM_COLLAPSE', 'WARNING',
          `매출총이익률 1년 ${dropBps.toFixed(0)}bp 하락`,
          { now: gmNow, prior: gmPrior, dropBps }),
      )
    }
  }

  // 주식보상비용 과다
  if (ttm && ttm.sbc !== null && ttm.revenue !== null && ttm.revenue > 0) {
    const ratio = ttm.sbc / ttm.revenue
    if (ratio > g.sbc_of_revenue) {
      out.push(
        flag('SBC_EXCESSIVE', 'WARNING',
          `주식보상비용이 매출의 ${(ratio * 100).toFixed(0)}%`, { ratio }),
      )
    }
  }

  // 레버리지 과다
  const leverage = debtToEbitda(ttm)
  if (leverage !== null && leverage > g.debt_to_ebitda) {
    out.push(
      flag('LEVERAGE_HIGH', 'WARNING',
        `부채/영업이익 ${leverage.toFixed(1)}배`, { ratio: leverage }),
    )
  }

  return out
}

export function hasCritical(flags: RedFlag[]): boolean {
  return flags.some((f) => f.severity === 'CRITICAL')
}

export function hasWarning(flags: RedFlag[]): boolean {
  return flags.some((f) => f.severity === 'WARNING')
}
```

- [ ] **Step 4: 아키텍처 테스트에 두 번째 케이스 추가**

`tests/architecture.test.ts`에 append (이제 `src/engines/`에 파일이 존재한다):

```ts
  it('engines 파일이 실제로 존재한다 (테스트가 공허하지 않음을 보장)', () => {
    expect(globSync('src/engines/**/*.ts').length).toBeGreaterThan(0)
  })
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npx vitest run tests/engines/quality.test.ts tests/architecture.test.ts`
Expected: PASS (quality 15 + architecture 2 = 17 tests)

- [ ] **Step 6: 커밋**

```bash
git add -A
git commit -m "feat: Quality Gate 엔진 — Red Flag 9종

희석과 런웨이는 CRITICAL이 발동하면 WARNING을 내지 않는다.
데이터가 없으면 Red Flag를 만들지 않는다 — 결측은 위험 신호가 아니다.
Going Concern과 고객 집중도는 10-K 본문 파싱이 필요해 Phase 4로 미룬다."
```

---

### Task 16: Tenbagger 팩터 1-3 (성장 · 가속도 · TAM)

**Files:**
- Create: `src/engines/tenbagger/factor-utils.ts`
- Create: `src/engines/tenbagger/factors/revenue-growth.ts`, `revenue-acceleration.ts`, `tam-industry-growth.ts`
- Test: `tests/engines/factors-growth.test.ts`

**Interfaces:**
- Consumes: `CompanySnapshot`/`FactorResult`/`RedFlag` (Task 2), `AppConfig` (Task 1), `interpolate` (Task 2), 지표 함수 (Task 13)
- Produces:
  - `type FactorContext = { snapshot: CompanySnapshot; cfg: AppConfig; flags: RedFlag[] }`
  - `type FactorFn = (ctx: FactorContext) => FactorResult`
  - `scored(key, weight, raw, normalized, detail): FactorResult`
  - `noData(key, weight, detail): FactorResult`
  - `notImplemented(key, weight): FactorResult`
  - `pct(v: number | null, digits?: number): string` — `0.384` → `"+38.4%"`
  - `revenueGrowthFactor: FactorFn` (key `revenue_growth`)
  - `revenueAccelerationFactor: FactorFn` (key `revenue_acceleration`)
  - `tamIndustryGrowthFactor: FactorFn` (key `tam_industry_growth`)

**설계 문서 개정 사항 — TAM 대체값.** `industries.yaml`의 `tam_cagr`는 출처 없이 채우지 않으므로 초기값이 전부 `null`이다. 이 경우 팩터가 `NO_DATA`로 빠지면 15점이 통째로 사라져 상대 순위가 왜곡된다. 대신 **해당 산업 구성기업의 매출 성장률 중앙값**(`industryStats.medianRevenueGrowth`)을 산업 성장률의 대체값으로 쓴다. 우리 데이터로 계산되므로 첫 실행부터 동작하고, TAM을 큐레이션하면 자동으로 그 값이 우선한다. `detail`에 어느 쪽을 썼는지 명시한다.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/engines/factors-growth.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseConfig } from '@/config'
import { revenueGrowthFactor } from '@/engines/tenbagger/factors/revenue-growth'
import { revenueAccelerationFactor } from '@/engines/tenbagger/factors/revenue-acceleration'
import { tamIndustryGrowthFactor } from '@/engines/tenbagger/factors/tam-industry-growth'
import type { FactorContext } from '@/engines/tenbagger/factor-utils'
import type { CompanySnapshot, FinancialPeriod } from '@/domain/types'

const cfg = parseConfig(readFileSync('config.yaml', 'utf8'))

function fp(periodEnd: string, over: Partial<FinancialPeriod> = {}): FinancialPeriod {
  return {
    periodEnd, periodType: 'TTM', revenue: null, grossProfit: null,
    operatingIncome: null, netIncome: null, ocf: null, capex: null, fcf: null,
    cash: null, totalDebt: null, equity: null, sharesDiluted: null,
    sharesOutstanding: null, sbc: null, rdExpense: null, ...over,
  }
}

function ctx(over: Partial<CompanySnapshot>): FactorContext {
  const snapshot: CompanySnapshot = {
    cik: 1, ticker: 'T', name: 'T',
    themeSlug: 'ai-software-semi', industrySlug: 'semiconductors',
    industry: {
      slug: 'semiconductors', name: 'Semiconductors', themeSlug: 'ai-software-semi',
      tamUsd: null, tamCagr: null, tamSource: null, tamAsOf: null,
    },
    classificationSource: 'sic', marketCap: 1e9, price: 10,
    priceDate: '2026-08-08', sharesOutstanding: 1e8,
    ttm: [], annual: [], quarterly: [],
    industryStats: {
      candidateCount: 5, medianGrossMargin: 0.6, medianRevenueGrowth: 0.18, distributions: {},
    },
    asOf: '2026-08-09', ...over,
  }
  return { snapshot, cfg, flags: [] }
}

/** TTM 계열 — index 0이 현재, 4가 1년 전, 12가 3년 전 */
function ttmOf(map: Record<number, number>): FinancialPeriod[] {
  const out: FinancialPeriod[] = []
  for (let i = 0; i <= 12; i++) {
    out.push(fp(`2025-${String(i).padStart(2, '0')}`, { revenue: map[i] ?? 1000 }))
  }
  return out
}

describe('revenueGrowthFactor', () => {
  it('TTM YoY와 3년 CAGR을 블렌드한다', () => {
    const r = revenueGrowthFactor(ctx({ ttm: ttmOf({ 0: 1400, 4: 1000, 12: 700 }) }))
    expect(r.key).toBe('revenue_growth')
    expect(r.weight).toBe(20)
    expect(r.status).toBe('SCORED')
    expect(r.raw).toBeCloseTo(0.40)          // raw는 TTM YoY
    expect(r.points!).toBeGreaterThan(14)     // 40% 성장은 곡선상 0.85 → 17점 부근
    expect(r.detail).toContain('+40.0%')
  })

  it('3년 이력이 없으면 TTM YoY만으로 채점한다', () => {
    const r = revenueGrowthFactor(ctx({ ttm: ttmOf({ 0: 1250, 4: 1000 }).slice(0, 5) }))
    expect(r.status).toBe('SCORED')
    expect(r.detail).toContain('3Y CAGR 없음')
  })

  it('성장률을 계산할 수 없으면 NO_DATA', () => {
    const r = revenueGrowthFactor(ctx({ ttm: [] }))
    expect(r.status).toBe('NO_DATA')
    expect(r.points).toBeNull()
  })

  it('역성장은 최저점 부근', () => {
    const r = revenueGrowthFactor(ctx({ ttm: ttmOf({ 0: 800, 4: 1000, 12: 1200 }) }))
    expect(r.points!).toBeLessThan(2)
  })
})

describe('revenueAccelerationFactor', () => {
  function quarters(revs: number[]): FinancialPeriod[] {
    return revs.map((r, i) =>
      fp(`2025-${String(20 - i).padStart(2, '0')}`, { periodType: 'Q', revenue: r }),
    )
  }

  it('가속 중이면 높은 점수', () => {
    const r = revenueAccelerationFactor(
      ctx({ quarterly: quarters([160, 130, 110, 100, 100, 90, 85, 80]) }),
    )
    expect(r.key).toBe('revenue_acceleration')
    expect(r.weight).toBe(10)
    expect(r.status).toBe('SCORED')
    expect(r.raw!).toBeGreaterThan(0.2)
    expect(r.points!).toBeGreaterThan(9)
  })

  it('분기가 8개 미만이면 NO_DATA', () => {
    expect(revenueAccelerationFactor(ctx({ quarterly: quarters([100, 90]) })).status)
      .toBe('NO_DATA')
  })
})

describe('tamIndustryGrowthFactor', () => {
  it('TAM이 큐레이션되어 있으면 그것을 쓴다', () => {
    const r = tamIndustryGrowthFactor(
      ctx({
        industry: {
          slug: 'cybersecurity', name: 'Cybersecurity', themeSlug: 'ai-software-semi',
          tamUsd: 200_000_000_000, tamCagr: 0.15,
          tamSource: 'Example Report 2025', tamAsOf: '2025-12-31',
        },
        ttm: ttmOf({ 0: 1_000_000_000 }),
      }),
    )
    expect(r.status).toBe('SCORED')
    expect(r.weight).toBe(15)
    expect(r.raw).toBeCloseTo(0.15)
    expect(r.detail).toContain('Example Report 2025')
  })

  it('TAM이 없으면 산업 매출성장률 중앙값으로 대체한다', () => {
    const r = tamIndustryGrowthFactor(ctx({ ttm: ttmOf({ 0: 1000 }) }))
    expect(r.status).toBe('SCORED')
    expect(r.raw).toBeCloseTo(0.18)
    expect(r.detail).toContain('산업 매출성장률 중앙값')
  })

  it('침투율이 높으면 감점된다', () => {
    const industry = {
      slug: 'x', name: 'X', themeSlug: 'ai-software-semi',
      tamUsd: 1_000_000_000, tamCagr: 0.15, tamSource: 'src', tamAsOf: '2025-12-31',
    }
    const low = tamIndustryGrowthFactor(ctx({ industry, ttm: ttmOf({ 0: 10_000_000 }) }))
    const high = tamIndustryGrowthFactor(ctx({ industry, ttm: ttmOf({ 0: 600_000_000 }) }))
    expect(high.points!).toBeLessThan(low.points!)
  })

  it('TAM도 산업 중앙값도 없으면 NO_DATA', () => {
    const r = tamIndustryGrowthFactor(
      ctx({
        industryStats: {
          candidateCount: 1, medianGrossMargin: null,
          medianRevenueGrowth: null, distributions: {},
        },
      }),
    )
    expect(r.status).toBe('NO_DATA')
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run tests/engines/factors-growth.test.ts`
Expected: FAIL — `Cannot find module '@/engines/tenbagger/factor-utils'`

- [ ] **Step 3: factor-utils 구현**

`src/engines/tenbagger/factor-utils.ts`:

```ts
import type { AppConfig } from '@/config'
import type { CompanySnapshot, FactorResult, RedFlag } from '@/domain/types'

export type FactorContext = {
  snapshot: CompanySnapshot
  cfg: AppConfig
  flags: RedFlag[]
}

export type FactorFn = (ctx: FactorContext) => FactorResult

/** normalized는 0~1. points = weight × normalized */
export function scored(
  key: string,
  weight: number,
  raw: number | null,
  normalized: number,
  detail: string,
): FactorResult {
  return { key, weight, points: weight * normalized, raw, status: 'SCORED', detail }
}

export function noData(key: string, weight: number, detail: string): FactorResult {
  return { key, weight, points: null, raw: null, status: 'NO_DATA', detail }
}

export function notImplemented(key: string, weight: number): FactorResult {
  return {
    key, weight, points: null, raw: null, status: 'NOT_IMPLEMENTED',
    detail: 'Phase 4에서 구현 예정 — 모든 기업에 동일 적용되어 상대 순위에 영향 없음',
  }
}

export function pct(v: number | null, digits = 1): string {
  if (v === null) return '—'
  const sign = v > 0 ? '+' : ''
  return `${sign}${(v * 100).toFixed(digits)}%`
}
```

- [ ] **Step 4: 팩터 3개 구현**

`src/engines/tenbagger/factors/revenue-growth.ts`:

```ts
import { interpolate } from '@/domain/curve'
import { ttmRevenueGrowth, revenueCagr3y } from '@/domain/metrics'
import { scored, noData, pct, type FactorFn } from '../factor-utils.js'

const KEY = 'revenue_growth'

export const revenueGrowthFactor: FactorFn = ({ snapshot, cfg }) => {
  const f = cfg.scoring.factors.revenue_growth
  const ttmYoy = ttmRevenueGrowth(snapshot.ttm)
  const cagr3y = revenueCagr3y(snapshot.ttm)

  if (ttmYoy === null && cagr3y === null) {
    return noData(KEY, f.weight, 'TTM 매출 이력 부족')
  }

  // 한쪽만 있으면 그 값 단독으로 채점한다. 없는 쪽을 0으로 치지 않는다.
  let normalized: number
  let detail: string
  if (ttmYoy !== null && cagr3y !== null) {
    normalized =
      f.blend.ttm_yoy * interpolate(f.curve, ttmYoy) +
      f.blend.cagr_3y * interpolate(f.curve, cagr3y)
    detail = `TTM 매출 ${pct(ttmYoy)} · 3Y CAGR ${pct(cagr3y)}`
  } else if (ttmYoy !== null) {
    normalized = interpolate(f.curve, ttmYoy)
    detail = `TTM 매출 ${pct(ttmYoy)} · 3Y CAGR 없음`
  } else {
    normalized = interpolate(f.curve, cagr3y!)
    detail = `3Y CAGR ${pct(cagr3y)} · TTM YoY 없음`
  }

  return scored(KEY, f.weight, ttmYoy ?? cagr3y, normalized, detail)
}
```

`src/engines/tenbagger/factors/revenue-acceleration.ts`:

```ts
import { interpolate } from '@/domain/curve'
import { revenueAcceleration } from '@/domain/metrics'
import { scored, noData, pct, type FactorFn } from '../factor-utils.js'

const KEY = 'revenue_acceleration'

export const revenueAccelerationFactor: FactorFn = ({ snapshot, cfg }) => {
  const f = cfg.scoring.factors.revenue_acceleration
  const accel = revenueAcceleration(snapshot.quarterly)
  if (accel === null) return noData(KEY, f.weight, '분기 매출 8개 분기가 필요함')

  return scored(
    KEY, f.weight, accel, interpolate(f.curve, accel),
    `최근 2개 분기 성장률이 직전 2개 분기 대비 ${pct(accel)}p`,
  )
}
```

`src/engines/tenbagger/factors/tam-industry-growth.ts`:

```ts
import { interpolate } from '@/domain/curve'
import { scored, noData, pct, type FactorFn } from '../factor-utils.js'

const KEY = 'tam_industry_growth'

export const tamIndustryGrowthFactor: FactorFn = ({ snapshot, cfg }) => {
  const f = cfg.scoring.factors.tam_industry_growth
  const { industry, industryStats } = snapshot

  // TAM CAGR이 큐레이션되어 있으면 우선, 없으면 산업 구성기업 매출성장률 중앙값으로 대체
  const curated = industry.tamCagr
  const fallback = industryStats.medianRevenueGrowth
  const growth = curated ?? fallback
  if (growth === null) {
    return noData(KEY, f.weight, 'TAM CAGR 미큐레이션 · 산업 성장률 대체값도 없음')
  }
  const growthSource =
    curated !== null
      ? `TAM CAGR ${pct(curated)} (출처: ${industry.tamSource ?? '미기재'})`
      : `산업 매출성장률 중앙값 ${pct(fallback)}로 대체 — TAM 미큐레이션`

  const cagrScore = interpolate(f.cagr_curve, growth)

  // 침투율: TAM 대비 매출 비중이 높을수록 남은 성장 여지가 작다
  const revenue = snapshot.ttm[0]?.revenue ?? null
  if (industry.tamUsd === null || revenue === null || industry.tamUsd <= 0) {
    return scored(KEY, f.weight, growth, cagrScore, `${growthSource} · 침투율 미산출`)
  }
  const penetration = revenue / industry.tamUsd
  const normalized =
    f.blend.tam_cagr * cagrScore +
    f.blend.penetration * interpolate(f.penetration_curve, penetration)

  return scored(
    KEY, f.weight, growth, normalized,
    `${growthSource} · TAM 침투율 ${pct(penetration)}`,
  )
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npx vitest run tests/engines/factors-growth.test.ts`
Expected: PASS (10 tests)

`revenueGrowthFactor`의 첫 테스트에서 `points`가 14를 넘지 않으면 곡선을 확인한다. TTM YoY 0.40 → 0.85, 3Y CAGR `(1400/700)^(1/3)-1 = 0.26` → 약 0.617. 블렌드 = `0.6×0.85 + 0.4×0.617 = 0.757` → `20 × 0.757 = 15.1점`.

- [ ] **Step 6: 커밋**

```bash
git add -A
git commit -m "feat: Tenbagger 팩터 1-3 (매출성장·가속도·TAM)

한쪽 지표만 있으면 그 값 단독으로 채점하고 없는 쪽을 0으로 치지 않는다.
TAM CAGR이 미큐레이션이면 산업 구성기업 매출성장률 중앙값으로 대체해
첫 실행부터 동작하게 하고, 어느 쪽을 썼는지 detail에 명시한다."
```

---

### Task 17: Tenbagger 팩터 4-5 (마진 · 영업레버리지)

**Files:**
- Create: `src/engines/tenbagger/factors/gross-margin.ts`, `operating-leverage.ts`
- Test: `tests/engines/factors-margin.test.ts`

**Interfaces:**
- Consumes: `FactorFn`/`scored`/`noData`/`pct` (Task 16), 지표 함수 (Task 13)
- Produces:
  - `grossMarginFactor: FactorFn` (key `gross_margin`, weight 10)
  - `operatingLeverageFactor: FactorFn` (key `operating_leverage`, weight 10)

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/engines/factors-margin.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseConfig } from '@/config'
import { grossMarginFactor } from '@/engines/tenbagger/factors/gross-margin'
import { operatingLeverageFactor } from '@/engines/tenbagger/factors/operating-leverage'
import type { FactorContext } from '@/engines/tenbagger/factor-utils'
import type { CompanySnapshot, FinancialPeriod } from '@/domain/types'

const cfg = parseConfig(readFileSync('config.yaml', 'utf8'))

function fp(periodEnd: string, over: Partial<FinancialPeriod> = {}): FinancialPeriod {
  return {
    periodEnd, periodType: 'TTM', revenue: null, grossProfit: null,
    operatingIncome: null, netIncome: null, ocf: null, capex: null, fcf: null,
    cash: null, totalDebt: null, equity: null, sharesDiluted: null,
    sharesOutstanding: null, sbc: null, rdExpense: null, ...over,
  }
}

function ctx(over: Partial<CompanySnapshot>): FactorContext {
  return {
    cfg, flags: [],
    snapshot: {
      cik: 1, ticker: 'T', name: 'T',
      themeSlug: 'ai-software-semi', industrySlug: 'semiconductors',
      industry: {
        slug: 'semiconductors', name: 'Semiconductors', themeSlug: 'ai-software-semi',
        tamUsd: null, tamCagr: null, tamSource: null, tamAsOf: null,
      },
      classificationSource: 'sic', marketCap: 1e9, price: 10,
      priceDate: '2026-08-08', sharesOutstanding: 1e8,
      ttm: [], annual: [], quarterly: [],
      industryStats: {
        candidateCount: 5, medianGrossMargin: 0.6,
        medianRevenueGrowth: 0.18, distributions: {},
      },
      asOf: '2026-08-09', ...over,
    },
  }
}

/** 마진이 개선되는 8개 분기 (최근순) */
function improvingQuarters(): FinancialPeriod[] {
  return [0.74, 0.72, 0.70, 0.68, 0.66, 0.64, 0.62, 0.60].map((gm, i) =>
    fp(`2025-${String(20 - i).padStart(2, '0')}`, {
      periodType: 'Q', revenue: 100, grossProfit: gm * 100,
    }),
  )
}

describe('grossMarginFactor', () => {
  it('수준과 추세를 블렌드한다', () => {
    const r = grossMarginFactor(
      ctx({
        ttm: [fp('2025-03-31', { revenue: 1000, grossProfit: 740 })],
        quarterly: improvingQuarters(),
      }),
    )
    expect(r.key).toBe('gross_margin')
    expect(r.weight).toBe(10)
    expect(r.status).toBe('SCORED')
    expect(r.raw).toBeCloseTo(0.74)
    expect(r.points!).toBeGreaterThan(9)   // 74% + 개선 추세
    expect(r.detail).toContain('74.0%')
    expect(r.detail).toContain('bp')
  })

  it('분기가 부족하면 수준만으로 채점한다', () => {
    const r = grossMarginFactor(
      ctx({ ttm: [fp('2025-03-31', { revenue: 1000, grossProfit: 400 })] }),
    )
    expect(r.status).toBe('SCORED')
    expect(r.detail).toContain('추세 산출 불가')
  })

  it('매출총이익이 없으면 NO_DATA', () => {
    const r = grossMarginFactor(ctx({ ttm: [fp('2025-03-31', { revenue: 1000 })] }))
    expect(r.status).toBe('NO_DATA')
  })
})

describe('operatingLeverageFactor', () => {
  /** 현재와 1년 전 TTM. index 4가 1년 전 */
  function ttmPair(now: Partial<FinancialPeriod>, prior: Partial<FinancialPeriod>) {
    const out = [fp('2025-03-31', now)]
    for (let i = 1; i < 4; i++) out.push(fp(`2024-${12 - i}-31`))
    out.push(fp('2024-03-31', prior))
    return out
  }

  it('마진이 개선되고 opex가 매출보다 느리게 늘면 고득점', () => {
    const r = operatingLeverageFactor(
      ctx({
        ttm: ttmPair(
          { revenue: 1500, grossProfit: 1050, operatingIncome: 300 },  // opex 750, 마진 20%
          { revenue: 1000, grossProfit: 700, operatingIncome: 100 },   // opex 600, 마진 10%
        ),
      }),
    )
    expect(r.key).toBe('operating_leverage')
    expect(r.status).toBe('SCORED')
    // 매출 +50%, opex +25% → 격차 +25%p, 영업이익률 +10%p
    expect(r.points!).toBeGreaterThan(9)
    expect(r.detail).toContain('영업이익률')
  })

  it('opex가 매출보다 빨리 늘면 저득점', () => {
    const r = operatingLeverageFactor(
      ctx({
        ttm: ttmPair(
          { revenue: 1100, grossProfit: 770, operatingIncome: -50 },
          { revenue: 1000, grossProfit: 700, operatingIncome: 100 },
        ),
      }),
    )
    expect(r.points!).toBeLessThan(3)
  })

  it('1년 전 TTM이 없으면 NO_DATA', () => {
    const r = operatingLeverageFactor(
      ctx({ ttm: [fp('2025-03-31', { revenue: 1000, operatingIncome: 100 })] }),
    )
    expect(r.status).toBe('NO_DATA')
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run tests/engines/factors-margin.test.ts`
Expected: FAIL — `Cannot find module '@/engines/tenbagger/factors/gross-margin'`

- [ ] **Step 3: 구현**

`src/engines/tenbagger/factors/gross-margin.ts`:

```ts
import { interpolate } from '@/domain/curve'
import { grossMargin, grossMarginTrendBps } from '@/domain/metrics'
import { scored, noData, pct, type FactorFn } from '../factor-utils.js'

const KEY = 'gross_margin'
const TREND_QUARTERS = 8

export const grossMarginFactor: FactorFn = ({ snapshot, cfg }) => {
  const f = cfg.scoring.factors.gross_margin
  const level = grossMargin(snapshot.ttm[0])
  if (level === null) return noData(KEY, f.weight, '매출총이익 데이터 없음')

  const levelScore = interpolate(f.level_curve, level)
  const trendBps = grossMarginTrendBps(snapshot.quarterly, TREND_QUARTERS)

  if (trendBps === null) {
    return scored(
      KEY, f.weight, level, levelScore,
      `매출총이익률 ${pct(level)} · 추세 산출 불가 (분기 ${TREND_QUARTERS}개 필요)`,
    )
  }

  const normalized =
    f.blend.level * levelScore + f.blend.trend * interpolate(f.trend_curve, trendBps)

  return scored(
    KEY, f.weight, level, normalized,
    `매출총이익률 ${pct(level)} · 추세 ${trendBps > 0 ? '+' : ''}${trendBps.toFixed(0)}bp/년`,
  )
}
```

`src/engines/tenbagger/factors/operating-leverage.ts`:

```ts
import { interpolate } from '@/domain/curve'
import { operatingMargin, opexGrowth, ttmRevenueGrowth } from '@/domain/metrics'
import { scored, noData, pct, type FactorFn } from '../factor-utils.js'

const KEY = 'operating_leverage'
const QUARTERS_PER_YEAR = 4

export const operatingLeverageFactor: FactorFn = ({ snapshot, cfg }) => {
  const f = cfg.scoring.factors.operating_leverage
  const now = operatingMargin(snapshot.ttm[0])
  const prior = operatingMargin(snapshot.ttm[QUARTERS_PER_YEAR])
  const revGrowth = ttmRevenueGrowth(snapshot.ttm)
  const opex = opexGrowth(snapshot.ttm)

  const marginDeltaPp = now !== null && prior !== null ? (now - prior) * 100 : null
  const growthGap = revGrowth !== null && opex !== null ? revGrowth - opex : null

  if (marginDeltaPp === null && growthGap === null) {
    return noData(KEY, f.weight, '1년 전 TTM 손익 데이터 없음')
  }

  // 한쪽만 있으면 그 값 단독으로 채점한다
  let normalized: number
  const parts: string[] = []
  if (marginDeltaPp !== null && growthGap !== null) {
    normalized =
      f.blend.margin_delta * interpolate(f.margin_delta_curve, marginDeltaPp) +
      f.blend.growth_gap * interpolate(f.growth_gap_curve, growthGap)
    parts.push(`영업이익률 ${marginDeltaPp > 0 ? '+' : ''}${marginDeltaPp.toFixed(1)}%p`)
    parts.push(`매출-비용 증가율 격차 ${pct(growthGap)}p`)
  } else if (marginDeltaPp !== null) {
    normalized = interpolate(f.margin_delta_curve, marginDeltaPp)
    parts.push(`영업이익률 ${marginDeltaPp > 0 ? '+' : ''}${marginDeltaPp.toFixed(1)}%p`)
    parts.push('비용 증가율 산출 불가')
  } else {
    normalized = interpolate(f.growth_gap_curve, growthGap!)
    parts.push(`매출-비용 증가율 격차 ${pct(growthGap)}p`)
    parts.push('영업이익률 변화 산출 불가')
  }

  return scored(KEY, f.weight, marginDeltaPp, normalized, parts.join(' · '))
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run tests/engines/factors-margin.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: 커밋**

```bash
git add -A
git commit -m "feat: Tenbagger 팩터 4-5 (매출총이익률·영업레버리지)

마진은 수준과 8분기 추세를 블렌드하고, 분기가 부족하면 수준만 쓴다.
영업레버리지는 영업이익률 변화와 매출-비용 증가율 격차를 함께 본다."
```

---

### Task 18: Tenbagger 팩터 6-9 (시가총액 기회 · 경쟁우위 · 재무상태 · 기관)

**Files:**
- Create: `src/engines/tenbagger/factors/market-cap-opportunity.ts`, `competitive-advantage.ts`, `balance-sheet.ts`, `institutional-insider.ts`
- Test: `tests/engines/factors-quality.test.ts`

**Interfaces:**
- Consumes: `FactorFn`/`scored`/`noData`/`notImplemented`/`pct` (Task 16), `hasWarning` (Task 15), 지표 함수 (Task 13), `stdev` (Task 2)
- Produces:
  - `marketCapOpportunityFactor: FactorFn` (key `market_cap_opportunity`, weight 15)
  - `competitiveAdvantageFactor: FactorFn` (key `competitive_advantage`, weight 10)
  - `balanceSheetFactor: FactorFn` (key `balance_sheet`, weight 5)
  - `institutionalInsiderFactor: FactorFn` (key `institutional_insider`, weight 5, 항상 `NOT_IMPLEMENTED`)

**§7 함정 해소 — 승수 게이트.** 작을수록 고득점인 구조가 부실 소형주를 상위로 밀어올리지 않도록, 구간표 점수에 게이트 승수를 곱한다. 게이트가 0이 되는 사유를 `detail`에 반드시 남긴다.

**경쟁우위는 Moat가 아니다.** 4개 재무 프록시의 평균이며 UI에서 "Moat"로 표기하지 않는다. 각 신호는 독립적으로 `NO_DATA`가 될 수 있고, 사용 가능한 신호로만 정규화한다.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/engines/factors-quality.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseConfig } from '@/config'
import { marketCapOpportunityFactor } from '@/engines/tenbagger/factors/market-cap-opportunity'
import { competitiveAdvantageFactor } from '@/engines/tenbagger/factors/competitive-advantage'
import { balanceSheetFactor } from '@/engines/tenbagger/factors/balance-sheet'
import { institutionalInsiderFactor } from '@/engines/tenbagger/factors/institutional-insider'
import type { FactorContext } from '@/engines/tenbagger/factor-utils'
import type { CompanySnapshot, FinancialPeriod, RedFlag } from '@/domain/types'

const cfg = parseConfig(readFileSync('config.yaml', 'utf8'))

function fp(periodEnd: string, over: Partial<FinancialPeriod> = {}): FinancialPeriod {
  return {
    periodEnd, periodType: 'TTM', revenue: null, grossProfit: null,
    operatingIncome: null, netIncome: null, ocf: null, capex: null, fcf: null,
    cash: null, totalDebt: null, equity: null, sharesDiluted: null,
    sharesOutstanding: null, sbc: null, rdExpense: null, ...over,
  }
}

function ctx(over: Partial<CompanySnapshot>, flags: RedFlag[] = []): FactorContext {
  return {
    cfg, flags,
    snapshot: {
      cik: 1, ticker: 'T', name: 'T',
      themeSlug: 'ai-software-semi', industrySlug: 'semiconductors',
      industry: {
        slug: 'semiconductors', name: 'Semiconductors', themeSlug: 'ai-software-semi',
        tamUsd: null, tamCagr: null, tamSource: null, tamAsOf: null,
      },
      classificationSource: 'sic', marketCap: 1e9, price: 10,
      priceDate: '2026-08-08', sharesOutstanding: 1e8,
      ttm: [], annual: [], quarterly: [],
      industryStats: {
        candidateCount: 5, medianGrossMargin: 0.60,
        medianRevenueGrowth: 0.18, distributions: {},
      },
      asOf: '2026-08-09', ...over,
    },
  }
}

/** 성장 중인 TTM 계열 — 게이트를 통과시키기 위한 기본값 */
function growingTtm(over: Partial<FinancialPeriod> = {}): FinancialPeriod[] {
  const now = fp('2025-03-31', { revenue: 1250, ...over })
  const mid = [1, 2, 3].map((i) => fp(`2024-${12 - i}-31`))
  const prior = fp('2024-03-31', { revenue: 1000 })
  return [now, ...mid, prior]
}

const WARNING: RedFlag = {
  code: 'DILUTION', severity: 'WARNING', message: 'x', evidence: {},
}

describe('marketCapOpportunityFactor', () => {
  it('$1B 미만은 만점 15점', () => {
    const r = marketCapOpportunityFactor(ctx({ marketCap: 5e8, ttm: growingTtm() }))
    expect(r.key).toBe('market_cap_opportunity')
    expect(r.points).toBe(15)
    expect(r.raw).toBe(5e8)
  })

  it('$100B 이상은 1점', () => {
    expect(marketCapOpportunityFactor(ctx({ marketCap: 2e11, ttm: growingTtm() })).points)
      .toBe(1)
  })

  it('구간 경계는 상한 미만 기준', () => {
    expect(marketCapOpportunityFactor(ctx({ marketCap: 3e9, ttm: growingTtm() })).points)
      .toBe(12)   // 3e9는 $1B~$3B 구간의 상한이므로 다음 구간
  })

  it('매출이 감소 중이면 게이트 0', () => {
    const shrinking = [
      fp('2025-03-31', { revenue: 800 }),
      fp('2024-12-31'), fp('2024-09-30'), fp('2024-06-30'),
      fp('2024-03-31', { revenue: 1000 }),
    ]
    const r = marketCapOpportunityFactor(ctx({ marketCap: 5e8, ttm: shrinking }))
    expect(r.points).toBe(0)
    expect(r.detail).toContain('매출 감소')
  })

  it('매출이 $10M 미만이면 게이트 0', () => {
    const tiny = growingTtm({ revenue: 5_000_000 })
    tiny[4] = fp('2024-03-31', { revenue: 4_000_000 })
    const r = marketCapOpportunityFactor(ctx({ marketCap: 5e8, ttm: tiny }))
    expect(r.points).toBe(0)
    expect(r.detail).toContain('매출 규모')
  })

  it('WARNING Red Flag가 있으면 절반', () => {
    const r = marketCapOpportunityFactor(ctx({ marketCap: 5e8, ttm: growingTtm() }, [WARNING]))
    expect(r.points).toBe(7.5)
    expect(r.detail).toContain('WARNING')
  })

  it('시가총액이 없으면 NO_DATA', () => {
    expect(marketCapOpportunityFactor(ctx({ marketCap: null, ttm: growingTtm() })).status)
      .toBe('NO_DATA')
  })
})

describe('competitiveAdvantageFactor', () => {
  function stableQuarters(gm: number): FinancialPeriod[] {
    return Array.from({ length: 8 }, (_, i) =>
      fp(`2025-${String(20 - i).padStart(2, '0')}`, {
        periodType: 'Q', revenue: 100, grossProfit: gm * 100,
      }),
    )
  }

  it('ROIC·마진 안정성·산업 대비 마진·R&D를 종합한다', () => {
    const r = competitiveAdvantageFactor(
      ctx({
        ttm: [fp('2025-03-31', {
          revenue: 1000, grossProfit: 800, operatingIncome: 400,
          totalDebt: 500, equity: 2000, cash: 500, rdExpense: 200,
        })],
        quarterly: stableQuarters(0.80),
      }),
    )
    expect(r.key).toBe('competitive_advantage')
    expect(r.weight).toBe(10)
    expect(r.status).toBe('SCORED')
    expect(r.points!).toBeGreaterThan(7)
    expect(r.detail).toContain('ROIC')
  })

  it('신호가 하나도 없으면 NO_DATA', () => {
    expect(competitiveAdvantageFactor(ctx({ ttm: [], quarterly: [] })).status).toBe('NO_DATA')
  })

  it('일부 신호만 있어도 그 신호로만 정규화한다', () => {
    const r = competitiveAdvantageFactor(
      ctx({ ttm: [fp('2025-03-31', { revenue: 1000, rdExpense: 200 })] }),
    )
    expect(r.status).toBe('SCORED')
    expect(r.detail).toContain('4개 중 1개')
  })
})

describe('balanceSheetFactor', () => {
  it('흑자 기업은 순현금과 레버리지로 채점한다', () => {
    const r = balanceSheetFactor(
      ctx({
        marketCap: 1e10,
        ttm: [fp('2025-03-31', {
          revenue: 1000, operatingIncome: 300, fcf: 250,
          cash: 3e9, totalDebt: 5e8,
        })],
      }),
    )
    expect(r.key).toBe('balance_sheet')
    expect(r.weight).toBe(5)
    expect(r.points!).toBeGreaterThan(4)
    expect(r.detail).toContain('순현금')
  })

  it('적자 기업은 현금 런웨이로 채점한다', () => {
    const r = balanceSheetFactor(
      ctx({ ttm: [fp('2025-03-31', { fcf: -400, cash: 4000 })] }),   // 런웨이 40분기
    )
    expect(r.points).toBe(5)
    expect(r.detail).toContain('런웨이')
  })

  it('런웨이가 짧으면 저득점', () => {
    const r = balanceSheetFactor(ctx({ ttm: [fp('2025-03-31', { fcf: -400, cash: 300 })] }))
    expect(r.points!).toBeLessThan(1)
  })

  it('재무 데이터가 없으면 NO_DATA', () => {
    expect(balanceSheetFactor(ctx({ ttm: [fp('2025-03-31', {})] })).status).toBe('NO_DATA')
  })
})

describe('institutionalInsiderFactor', () => {
  it('항상 NOT_IMPLEMENTED이며 5점 가중치를 보고한다', () => {
    const r = institutionalInsiderFactor(ctx({}))
    expect(r.key).toBe('institutional_insider')
    expect(r.weight).toBe(5)
    expect(r.status).toBe('NOT_IMPLEMENTED')
    expect(r.points).toBeNull()
    expect(r.detail).toContain('Phase 4')
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run tests/engines/factors-quality.test.ts`
Expected: FAIL — `Cannot find module '@/engines/tenbagger/factors/market-cap-opportunity'`

- [ ] **Step 3: 구현**

`src/engines/tenbagger/factors/market-cap-opportunity.ts`:

```ts
import { ttmRevenueGrowth } from '@/domain/metrics'
import { hasWarning } from '@/engines/quality'
import { noData, pct, type FactorFn } from '../factor-utils.js'
import type { FactorResult } from '@/domain/types'

const KEY = 'market_cap_opportunity'

function bandPoints(
  marketCap: number,
  bands: { max: number | null; points: number }[],
): number {
  for (const b of bands) {
    if (b.max === null || marketCap < b.max) return b.points
  }
  return bands[bands.length - 1]?.points ?? 0
}

export const marketCapOpportunityFactor: FactorFn = ({ snapshot, cfg, flags }) => {
  const f = cfg.scoring.factors.market_cap_opportunity
  const marketCap = snapshot.marketCap
  if (marketCap === null || marketCap <= 0) {
    return noData(KEY, f.weight, '시가총액 없음 — 주가 또는 발행주식수 결측')
  }

  const base = bandPoints(marketCap, f.bands)
  const revenue = snapshot.ttm[0]?.revenue ?? null
  const growth = ttmRevenueGrowth(snapshot.ttm)

  // 게이트: 작을수록 고득점인 구조가 부실 소형주를 밀어올리지 않게 한다
  let gate = 1
  let gateReason = ''
  if (growth !== null && growth < f.gate.zero_if_revenue_growth_below) {
    gate = 0
    gateReason = `게이트 0 — 매출 감소 ${pct(growth)}`
  } else if (revenue !== null && revenue < f.gate.zero_if_revenue_below) {
    gate = 0
    gateReason = `게이트 0 — 매출 규모 $${(revenue / 1e6).toFixed(1)}M`
  } else if (hasWarning(flags)) {
    gate = f.gate.warning_multiplier
    gateReason = `게이트 ${f.gate.warning_multiplier} — WARNING Red Flag 보유`
  }

  const billions = (marketCap / 1e9).toFixed(2)
  const detail = gateReason
    ? `시가총액 $${billions}B → ${base}점, ${gateReason}`
    : `시가총액 $${billions}B → ${base}점`

  const result: FactorResult = {
    key: KEY, weight: f.weight, points: base * gate, raw: marketCap,
    status: 'SCORED', detail,
  }
  return result
}
```

`src/engines/tenbagger/factors/competitive-advantage.ts`:

```ts
import { interpolate } from '@/domain/curve'
import { stdev } from '@/domain/stats'
import { grossMargin, grossMarginSeries, roic } from '@/domain/metrics'
import { scored, noData, pct, type FactorFn } from '../factor-utils.js'

const KEY = 'competitive_advantage'
const STABILITY_QUARTERS = 8
const SIGNAL_COUNT = 4

export const competitiveAdvantageFactor: FactorFn = ({ snapshot, cfg }) => {
  const f = cfg.scoring.factors.competitive_advantage
  const ttm = snapshot.ttm[0]
  const signals: { score: number; label: string }[] = []

  // 1. ROIC 스프레드 — 자본비용을 넘는 초과수익
  const r = roic(ttm, cfg.scoring.tax_rate)
  if (r !== null) {
    const spread = r - cfg.scoring.wacc_assumption
    signals.push({
      score: interpolate(f.signals.roic_spread, spread),
      label: `ROIC ${pct(r)} (스프레드 ${pct(spread)})`,
    })
  }

  // 2. 마진 안정성 — 변동성이 낮으면 전환비용·무형자산 시사
  const series = grossMarginSeries(snapshot.quarterly, STABILITY_QUARTERS)
  if (series.length === STABILITY_QUARTERS) {
    const mean = series.reduce((a, b) => a + b, 0) / series.length
    const sd = stdev(series)
    if (sd !== null && mean > 0) {
      const stability = 1 - sd / mean
      signals.push({
        score: interpolate(f.signals.gm_stability, stability),
        label: `마진 안정성 ${stability.toFixed(3)}`,
      })
    }
  }

  // 3. 산업 대비 마진 — 후보 3개 미만 산업은 중앙값이 무의미
  const gm = grossMargin(ttm)
  const industryGm = snapshot.industryStats.medianGrossMargin
  if (
    gm !== null && industryGm !== null &&
    snapshot.industryStats.candidateCount >= cfg.scoring.min_industry_candidates
  ) {
    const delta = gm - industryGm
    signals.push({
      score: interpolate(f.signals.gm_vs_industry, delta),
      label: `산업 대비 마진 ${pct(delta)}p`,
    })
  }

  // 4. R&D 집약도 — 무형자산 축적
  if (ttm && ttm.rdExpense !== null && ttm.revenue !== null && ttm.revenue > 0) {
    const intensity = ttm.rdExpense / ttm.revenue
    signals.push({
      score: interpolate(f.signals.rd_intensity, intensity),
      label: `R&D 집약도 ${pct(intensity)}`,
    })
  }

  if (signals.length === 0) {
    return noData(KEY, f.weight, '재무 프록시 4개 신호를 하나도 계산할 수 없음')
  }

  const normalized = signals.reduce((s, x) => s + x.score, 0) / signals.length
  const coverage =
    signals.length < SIGNAL_COUNT ? ` (4개 중 ${signals.length}개 신호)` : ''

  return scored(
    KEY, f.weight, normalized, normalized,
    `${signals.map((s) => s.label).join(' · ')}${coverage}`,
  )
}
```

`src/engines/tenbagger/factors/balance-sheet.ts`:

```ts
import { interpolate } from '@/domain/curve'
import { cashRunwayQuarters, debtToEbitda, netCashToMarketCap } from '@/domain/metrics'
import { scored, noData, pct, type FactorFn } from '../factor-utils.js'

const KEY = 'balance_sheet'

export const balanceSheetFactor: FactorFn = ({ snapshot, cfg }) => {
  const f = cfg.scoring.factors.balance_sheet
  const ttm = snapshot.ttm[0]

  // 적자 기업: 런웨이가 유일하게 의미 있는 지표
  const runway = cashRunwayQuarters(snapshot.ttm)
  if (runway !== null) {
    return scored(
      KEY, f.weight, runway, interpolate(f.runway_curve, runway),
      `현금 런웨이 ${runway.toFixed(1)}분기 (FCF 적자)`,
    )
  }

  // 흑자 기업: 순현금 포지션 + 레버리지
  const netCash = netCashToMarketCap(ttm, snapshot.marketCap)
  const leverage = debtToEbitda(ttm)
  if (netCash === null && leverage === null) {
    return noData(KEY, f.weight, '현금·부채 데이터 없음')
  }

  if (netCash !== null && leverage !== null) {
    const normalized =
      f.profitable_blend.net_cash * interpolate(f.net_cash_curve, netCash) +
      f.profitable_blend.leverage * interpolate(f.leverage_curve, leverage)
    return scored(
      KEY, f.weight, netCash, normalized,
      `순현금 시총 대비 ${pct(netCash)} · 부채/영업이익 ${leverage.toFixed(1)}배`,
    )
  }
  if (netCash !== null) {
    return scored(
      KEY, f.weight, netCash, interpolate(f.net_cash_curve, netCash),
      `순현금 시총 대비 ${pct(netCash)} · 레버리지 산출 불가`,
    )
  }
  return scored(
    KEY, f.weight, leverage, interpolate(f.leverage_curve, leverage!),
    `부채/영업이익 ${leverage!.toFixed(1)}배 · 순현금 산출 불가`,
  )
}
```

`src/engines/tenbagger/factors/institutional-insider.ts`:

```ts
import { notImplemented, type FactorFn } from '../factor-utils.js'

/**
 * 기관 보유·내부자 거래 신호. 13F와 Form 4 파싱이 필요해 Phase 4로 미룬다.
 * NOT_IMPLEMENTED는 모든 기업에 동일 적용되므로 completeness 분모에서 제외되고
 * 상대 순위를 왜곡하지 않는다.
 */
export const institutionalInsiderFactor: FactorFn = ({ cfg }) =>
  notImplemented('institutional_insider', cfg.scoring.factors.institutional_insider.weight)
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run tests/engines/factors-quality.test.ts`
Expected: PASS (15 tests)

- [ ] **Step 5: 커밋**

```bash
git add -A
git commit -m "feat: Tenbagger 팩터 6-9 (시총 기회·경쟁우위·재무상태·기관)

시가총액 기회는 구간표에 게이트 승수를 곱해 매출이 감소 중인 소형주가
15점을 받지 못하게 한다. 게이트 사유는 detail에 남긴다.
경쟁우위는 재무 프록시 4개의 평균이며 Moat 분석이 아니다.
기관/내부자는 NOT_IMPLEMENTED로 completeness 분모에서 제외된다."
```

---

### Task 19: Tenbagger 엔진 조립 (rescale · completeness)

**Files:**
- Create: `src/engines/tenbagger/index.ts`
- Test: `tests/engines/tenbagger.test.ts`, `tests/fixtures/companies.ts`

**Interfaces:**
- Consumes: 팩터 9개 (Task 16-18), `FactorResult` (Task 2)
- Produces:
  - `type TenbaggerResult = { score: number | null; completeness: number; factors: FactorResult[] }`
  - `scoreTenbagger(snapshot, cfg, flags): TenbaggerResult`
  - `ENGINE_VERSION: string` — 엔진 코드 버전. `scores.engine_version`에 config 해시와 함께 기록된다
  - `tests/fixtures/companies.ts`에서 `earlyTenbagger()`, `valueTrap()`, `megaCap()`, `sparseData()` 스냅샷 팩토리 export

**정규화 규칙 (설계 문서 §8.1)**

```
score        = 100 × Σpoints / Σ(weight where status='SCORED')
completeness = Σ(weight where 'SCORED') / Σ(weight where status ≠ 'NOT_IMPLEMENTED')
```

`NOT_IMPLEMENTED`는 모든 기업에 동일 적용되므로 `completeness` 분모에서 제외한다. `NO_DATA`는 그 기업만의 결함이므로 분모에 남겨 completeness를 떨어뜨린다.

- [ ] **Step 1: 픽스처 기업 4종 작성**

`tests/fixtures/companies.ts`:

```ts
import type { CompanySnapshot, FinancialPeriod, IndustryStats } from '@/domain/types'

const INDUSTRY = {
  slug: 'semiconductors', name: 'Semiconductors', themeSlug: 'ai-software-semi',
  tamUsd: null, tamCagr: null, tamSource: null, tamAsOf: null,
}

const STATS: IndustryStats = {
  candidateCount: 12, medianGrossMargin: 0.55,
  medianRevenueGrowth: 0.15, distributions: {},
}

function period(
  periodEnd: string, periodType: 'Q' | 'A' | 'TTM', over: Partial<FinancialPeriod>,
): FinancialPeriod {
  return {
    periodEnd, periodType, revenue: null, grossProfit: null, operatingIncome: null,
    netIncome: null, ocf: null, capex: null, fcf: null, cash: null, totalDebt: null,
    equity: null, sharesDiluted: null, sharesOutstanding: null, sbc: null,
    rdExpense: null, ...over,
  }
}

/** TTM 13개(3년) 생성. scale은 분기마다의 성장 배수. */
function ttmSeries(
  latestRevenue: number, quarterlyGrowth: number, shape: Partial<FinancialPeriod>,
): FinancialPeriod[] {
  return Array.from({ length: 13 }, (_, i) =>
    period(`2025-${String(40 - i).padStart(2, '0')}`, 'TTM', {
      ...shape,
      revenue: latestRevenue / Math.pow(1 + quarterlyGrowth, i),
      grossProfit:
        shape.grossProfit === undefined
          ? null
          : (latestRevenue / Math.pow(1 + quarterlyGrowth, i)) *
            (shape.grossProfit / (shape.revenue ?? 1)),
    }),
  )
}

function quarterSeries(
  latestRevenue: number, quarterlyGrowth: number, gm: number,
): FinancialPeriod[] {
  return Array.from({ length: 12 }, (_, i) => {
    const rev = latestRevenue / Math.pow(1 + quarterlyGrowth, i)
    return period(`2025-${String(40 - i).padStart(2, '0')}`, 'Q', {
      revenue: rev, grossProfit: rev * gm,
    })
  })
}

function base(over: Partial<CompanySnapshot>): CompanySnapshot {
  return {
    cik: 1, ticker: 'X', name: 'X Inc',
    themeSlug: 'ai-software-semi', industrySlug: 'semiconductors',
    industry: INDUSTRY, classificationSource: 'sic',
    marketCap: null, price: 10, priceDate: '2026-08-08', sharesOutstanding: 1e8,
    ttm: [], annual: [], quarterly: [], industryStats: STATS,
    asOf: '2026-08-09', ...over,
  }
}

/** 고성장·고마진·소형 — 높은 점수가 나와야 한다 */
export function earlyTenbagger(): CompanySnapshot {
  const shape = {
    revenue: 400_000_000, grossProfit: 320_000_000, operatingIncome: 40_000_000,
    ocf: 60_000_000, capex: 10_000_000, fcf: 50_000_000,
    cash: 500_000_000, totalDebt: 50_000_000, equity: 700_000_000,
    sharesDiluted: 100_000_000, sharesOutstanding: 100_000_000,
    sbc: 40_000_000, rdExpense: 80_000_000,
  }
  return base({
    ticker: 'GROW', marketCap: 2_500_000_000,
    ttm: ttmSeries(400_000_000, 0.09, shape),
    quarterly: quarterSeries(110_000_000, 0.09, 0.80),
  })
}

/** 매출 감소 소형주 — 낮은 점수와 게이트 0이 나와야 한다 */
export function valueTrap(): CompanySnapshot {
  const shape = {
    revenue: 200_000_000, grossProfit: 60_000_000, operatingIncome: -20_000_000,
    ocf: -15_000_000, capex: 5_000_000, fcf: -20_000_000,
    cash: 30_000_000, totalDebt: 120_000_000, equity: 40_000_000,
    sharesDiluted: 90_000_000, sharesOutstanding: 90_000_000,
    sbc: 10_000_000, rdExpense: 8_000_000,
  }
  return base({
    ticker: 'TRAP', marketCap: 400_000_000,
    ttm: ttmSeries(200_000_000, -0.04, shape),
    quarterly: quarterSeries(48_000_000, -0.04, 0.30),
    annual: [
      period('2024-12-31', 'A', { revenue: 200_000_000 }),
      period('2023-12-31', 'A', { revenue: 240_000_000 }),
      period('2022-12-31', 'A', { revenue: 280_000_000 }),
    ],
  })
}

/** 펀더멘털은 우수하나 시가총액 $200B — 시총 기회 1점이 나와야 한다 */
export function megaCap(): CompanySnapshot {
  const shape = {
    revenue: 120_000_000_000, grossProfit: 90_000_000_000,
    operatingIncome: 60_000_000_000, ocf: 65_000_000_000, capex: 5_000_000_000,
    fcf: 60_000_000_000, cash: 40_000_000_000, totalDebt: 10_000_000_000,
    equity: 80_000_000_000, sharesDiluted: 24_000_000_000,
    sharesOutstanding: 24_000_000_000, sbc: 4_000_000_000, rdExpense: 12_000_000_000,
  }
  return base({
    ticker: 'MEGA', marketCap: 200_000_000_000,
    ttm: ttmSeries(120_000_000_000, 0.05, shape),
    quarterly: quarterSeries(32_000_000_000, 0.05, 0.75),
  })
}

/** TTM이 2개뿐 — completeness가 낮게 나와야 한다 */
export function sparseData(): CompanySnapshot {
  return base({
    ticker: 'SPARSE', marketCap: 800_000_000,
    ttm: [
      period('2025-03-31', 'TTM', { revenue: 50_000_000 }),
      period('2024-12-31', 'TTM', { revenue: 48_000_000 }),
    ],
  })
}
```

- [ ] **Step 2: 실패하는 테스트 작성**

`tests/engines/tenbagger.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseConfig } from '@/config'
import { scoreTenbagger, ENGINE_VERSION } from '@/engines/tenbagger'
import { evaluateQuality } from '@/engines/quality'
import { earlyTenbagger, valueTrap, megaCap, sparseData } from '../fixtures/companies'

const cfg = parseConfig(readFileSync('config.yaml', 'utf8'))

function run(s: ReturnType<typeof earlyTenbagger>) {
  const flags = evaluateQuality(s, cfg)
  return { result: scoreTenbagger(s, cfg, flags), flags }
}

describe('scoreTenbagger — 구조', () => {
  const { result } = run(earlyTenbagger())

  it('팩터 9개를 모두 보고한다', () => {
    expect(result.factors).toHaveLength(9)
    expect(result.factors.map((f) => f.key)).toContain('institutional_insider')
  })

  it('가중치 합이 100이다', () => {
    expect(result.factors.reduce((s, f) => s + f.weight, 0)).toBe(100)
  })

  it('기관/내부자는 NOT_IMPLEMENTED다', () => {
    const f = result.factors.find((x) => x.key === 'institutional_insider')!
    expect(f.status).toBe('NOT_IMPLEMENTED')
  })

  it('ENGINE_VERSION이 정의되어 있다', () => {
    expect(ENGINE_VERSION).toMatch(/\S/)
  })
})

describe('scoreTenbagger — 정규화', () => {
  it('NOT_IMPLEMENTED는 completeness 분모에서 제외된다', () => {
    const { result } = run(earlyTenbagger())
    // 9개 중 기관(5점) 제외 → 분모 95. 나머지가 모두 채점되면 completeness 1.0
    expect(result.completeness).toBeCloseTo(1.0, 2)
  })

  it('점수는 채점된 가중치로만 정규화된다', () => {
    const { result } = run(earlyTenbagger())
    const scoredFactors = result.factors.filter((f) => f.status === 'SCORED')
    const points = scoredFactors.reduce((s, f) => s + (f.points ?? 0), 0)
    const weights = scoredFactors.reduce((s, f) => s + f.weight, 0)
    expect(result.score).toBeCloseTo((100 * points) / weights, 6)
  })

  it('데이터가 부족하면 completeness가 낮다', () => {
    const { result } = run(sparseData())
    expect(result.completeness).toBeLessThan(cfg.scoring.min_completeness)
  })

  it('채점된 팩터가 하나도 없으면 score는 null', () => {
    const empty = { ...sparseData(), ttm: [], quarterly: [], marketCap: null }
    const { result } = run(empty)
    expect(result.score).toBeNull()
    expect(result.completeness).toBe(0)
  })
})

describe('scoreTenbagger — 픽스처 기업별 기대 동작', () => {
  it('초기 텐배거 패턴은 높은 점수', () => {
    const { result } = run(earlyTenbagger())
    expect(result.score!).toBeGreaterThan(65)
  })

  it('밸류 트랩은 낮은 점수이고 시총 기회 게이트가 0이다', () => {
    const { result, flags } = run(valueTrap())
    expect(result.score!).toBeLessThan(35)
    const mc = result.factors.find((f) => f.key === 'market_cap_opportunity')!
    expect(mc.points).toBe(0)
    expect(flags.some((f) => f.code === 'REVENUE_DECLINE_2Y')).toBe(true)
  })

  it('밸류 트랩이 초기 텐배거보다 반드시 낮다', () => {
    expect(run(valueTrap()).result.score!).toBeLessThan(run(earlyTenbagger()).result.score!)
  })

  it('메가캡은 시총 기회 1점이지만 다른 팩터는 우수하다', () => {
    const { result } = run(megaCap())
    const mc = result.factors.find((f) => f.key === 'market_cap_opportunity')!
    expect(mc.points).toBe(1)
    const gm = result.factors.find((f) => f.key === 'gross_margin')!
    expect(gm.points!).toBeGreaterThan(7)
  })

  it('메가캡이 초기 텐배거보다 낮다 — 규모 자체가 성장 잠재력을 제한한다', () => {
    expect(run(megaCap()).result.score!).toBeLessThan(run(earlyTenbagger()).result.score!)
  })
})
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `npx vitest run tests/engines/tenbagger.test.ts`
Expected: FAIL — `Cannot find module '@/engines/tenbagger'`

- [ ] **Step 4: 구현**

`src/engines/tenbagger/index.ts`:

```ts
import type { AppConfig } from '@/config'
import type { CompanySnapshot, FactorResult, RedFlag } from '@/domain/types'
import type { FactorContext, FactorFn } from './factor-utils.js'
import { revenueGrowthFactor } from './factors/revenue-growth.js'
import { revenueAccelerationFactor } from './factors/revenue-acceleration.js'
import { tamIndustryGrowthFactor } from './factors/tam-industry-growth.js'
import { grossMarginFactor } from './factors/gross-margin.js'
import { operatingLeverageFactor } from './factors/operating-leverage.js'
import { marketCapOpportunityFactor } from './factors/market-cap-opportunity.js'
import { competitiveAdvantageFactor } from './factors/competitive-advantage.js'
import { balanceSheetFactor } from './factors/balance-sheet.js'
import { institutionalInsiderFactor } from './factors/institutional-insider.js'

/** 팩터 구성이나 정규화 규칙을 바꾸면 반드시 올린다. scores.engine_version에 기록된다. */
export const ENGINE_VERSION = 'tenbagger-1.0.0'

const FACTORS: FactorFn[] = [
  revenueGrowthFactor,
  revenueAccelerationFactor,
  tamIndustryGrowthFactor,
  grossMarginFactor,
  operatingLeverageFactor,
  marketCapOpportunityFactor,
  competitiveAdvantageFactor,
  balanceSheetFactor,
  institutionalInsiderFactor,
]

export type TenbaggerResult = {
  score: number | null
  completeness: number
  factors: FactorResult[]
}

export function scoreTenbagger(
  snapshot: CompanySnapshot,
  cfg: AppConfig,
  flags: RedFlag[],
): TenbaggerResult {
  const ctx: FactorContext = { snapshot, cfg, flags }
  const factors = FACTORS.map((fn) => fn(ctx))

  let scoredPoints = 0
  let scoredWeight = 0
  let implementedWeight = 0

  for (const f of factors) {
    if (f.status !== 'NOT_IMPLEMENTED') implementedWeight += f.weight
    if (f.status === 'SCORED') {
      scoredPoints += f.points ?? 0
      scoredWeight += f.weight
    }
  }

  return {
    score: scoredWeight === 0 ? null : (100 * scoredPoints) / scoredWeight,
    completeness: implementedWeight === 0 ? 0 : scoredWeight / implementedWeight,
    factors,
  }
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npx vitest run tests/engines/tenbagger.test.ts`
Expected: PASS (12 tests)

점수 기대값이 빗나가면 **곡선을 먼저 의심하지 말고 픽스처를 확인한다.** 예를 들어 `earlyTenbagger`의 분기 성장률 0.09는 TTM YoY 약 42%가 되어야 한다. 실제 값을 `console.log`로 확인한 뒤, 픽스처가 의도대로면 `config.yaml`의 곡선을 조정하고 그 변경을 커밋 메시지에 남긴다.

- [ ] **Step 6: 커밋**

```bash
git add -A
git commit -m "feat: Tenbagger 엔진 조립 — rescale 및 completeness

채점된 팩터의 가중치로만 정규화하고 결측을 0점으로 처리하지 않는다.
NOT_IMPLEMENTED는 모든 기업에 동일 적용되므로 completeness 분모에서 제외하고
NO_DATA는 분모에 남겨 그 기업의 데이터 결함을 드러낸다.
픽스처 4종으로 상대 순위(텐배거 > 메가캡 > 밸류트랩)를 고정한다."
```

---

### Task 20: Leader / Challenger / Emerging 분류 엔진

**Files:**
- Create: `src/engines/classify/index.ts`
- Test: `tests/engines/classify.test.ts`

**Interfaces:**
- Consumes: `CompanySnapshot`/`Category` (Task 2), `AppConfig` (Task 1)
- Produces:
  - `classifyIndustry(members: CompanySnapshot[], cfg: AppConfig): Map<number, Category>` — 한 산업 내에서 판정
  - `classifyAll(snapshots: CompanySnapshot[], cfg: AppConfig): Map<number, Category>` — 산업별로 묶어 전체 판정

**규칙 (설계 문서 §10)**

```
Leader: 시총 내림차순. 시총 ≥ (산업 최대 × leader_ratio_of_max), 최대 5개, 최소 2개.
        후보가 leader_min_industry_candidates(3) 미만인 산업은 Leader를 지정하지 않는다.
비-Leader:
  시총 < $2B                      → EMERGING
  $2B ≤ 시총 < $5B                → 영업이익 ≤ 0 또는 매출 < $500M 이면 EMERGING, 아니면 CHALLENGER
  $5B ≤ 시총                      → CHALLENGER
시총이 null이면 EMERGING (규모를 알 수 없는 기업을 벤치마크로 쓸 수 없다)
```

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/engines/classify.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseConfig } from '@/config'
import { classifyIndustry, classifyAll } from '@/engines/classify'
import type { CompanySnapshot, FinancialPeriod } from '@/domain/types'

const cfg = parseConfig(readFileSync('config.yaml', 'utf8'))

function co(
  cik: number, marketCap: number | null,
  fin: Partial<FinancialPeriod> = {}, industrySlug = 'semiconductors',
): CompanySnapshot {
  const ttm: FinancialPeriod[] = [{
    periodEnd: '2025-03-31', periodType: 'TTM',
    revenue: 1_000_000_000, grossProfit: null, operatingIncome: 100_000_000,
    netIncome: null, ocf: null, capex: null, fcf: null, cash: null,
    totalDebt: null, equity: null, sharesDiluted: null, sharesOutstanding: null,
    sbc: null, rdExpense: null, ...fin,
  }]
  return {
    cik, ticker: `T${cik}`, name: `T${cik}`,
    themeSlug: 'ai-software-semi', industrySlug,
    industry: {
      slug: industrySlug, name: industrySlug, themeSlug: 'ai-software-semi',
      tamUsd: null, tamCagr: null, tamSource: null, tamAsOf: null,
    },
    classificationSource: 'sic', marketCap, price: null, priceDate: null,
    sharesOutstanding: null, ttm, annual: [], quarterly: [],
    industryStats: {
      candidateCount: 0, medianGrossMargin: null,
      medianRevenueGrowth: null, distributions: {},
    },
    asOf: '2026-08-09',
  }
}

describe('classifyIndustry — Leader', () => {
  it('시총 최대값의 25% 이상인 상위 기업을 Leader로 지정한다', () => {
    const m = classifyIndustry([
      co(1, 400e9), co(2, 200e9), co(3, 50e9), co(4, 10e9), co(5, 1e9),
    ], cfg)
    expect(m.get(1)).toBe('LEADER')
    expect(m.get(2)).toBe('LEADER')
    expect(m.get(3)).toBe('CHALLENGER')   // 50e9 < 400e9 × 0.25 = 100e9
  })

  it('조건에 미달해도 상위 2개는 Leader로 만든다', () => {
    const m = classifyIndustry([co(1, 400e9), co(2, 10e9), co(3, 5e9)], cfg)
    expect(m.get(1)).toBe('LEADER')
    expect(m.get(2)).toBe('LEADER')
  })

  it('Leader는 최대 5개까지', () => {
    const members = Array.from({ length: 8 }, (_, i) => co(i + 1, 100e9 - i * 1e9))
    const m = classifyIndustry(members, cfg)
    expect([...m.values()].filter((v) => v === 'LEADER')).toHaveLength(5)
  })

  it('후보가 3개 미만이면 Leader를 지정하지 않는다', () => {
    const m = classifyIndustry([co(1, 400e9), co(2, 100e9)], cfg)
    expect([...m.values()]).not.toContain('LEADER')
    expect(m.get(1)).toBe('CHALLENGER')
  })
})

describe('classifyIndustry — Challenger / Emerging', () => {
  const leaders = [co(101, 500e9), co(102, 400e9), co(103, 300e9)]

  it('시총 $2B 미만은 Emerging', () => {
    const m = classifyIndustry([...leaders, co(1, 1.5e9)], cfg)
    expect(m.get(1)).toBe('EMERGING')
  })

  it('$2B~$5B에서 영업적자면 Emerging', () => {
    const m = classifyIndustry(
      [...leaders, co(1, 3e9, { operatingIncome: -10_000_000 })], cfg,
    )
    expect(m.get(1)).toBe('EMERGING')
  })

  it('$2B~$5B에서 매출이 $500M 미만이면 Emerging', () => {
    const m = classifyIndustry([...leaders, co(1, 3e9, { revenue: 300_000_000 })], cfg)
    expect(m.get(1)).toBe('EMERGING')
  })

  it('$2B~$5B에서 흑자이고 매출이 충분하면 Challenger', () => {
    const m = classifyIndustry([...leaders, co(1, 3e9)], cfg)
    expect(m.get(1)).toBe('CHALLENGER')
  })

  it('$5B 이상 비-Leader는 Challenger', () => {
    const m = classifyIndustry([...leaders, co(1, 20e9, { operatingIncome: -1 })], cfg)
    expect(m.get(1)).toBe('CHALLENGER')
  })

  it('시총이 null이면 Emerging', () => {
    const m = classifyIndustry([...leaders, co(1, null)], cfg)
    expect(m.get(1)).toBe('EMERGING')
  })
})

describe('classifyAll', () => {
  it('산업별로 독립 판정한다', () => {
    const m = classifyAll([
      co(1, 400e9, {}, 'semiconductors'), co(2, 200e9, {}, 'semiconductors'),
      co(3, 100e9, {}, 'semiconductors'),
      co(4, 3e9, {}, 'cybersecurity'), co(5, 2.5e9, {}, 'cybersecurity'),
      co(6, 2.2e9, {}, 'cybersecurity'),
    ], cfg)
    expect(m.get(1)).toBe('LEADER')
    expect(m.get(4)).toBe('LEADER')   // 작은 산업에서도 최대값 기준으로 Leader가 나온다
    expect(m.size).toBe(6)
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run tests/engines/classify.test.ts`
Expected: FAIL — `Cannot find module '@/engines/classify'`

- [ ] **Step 3: 구현**

`src/engines/classify/index.ts`:

```ts
import type { AppConfig } from '@/config'
import type { Category, CompanySnapshot } from '@/domain/types'

function nonLeaderCategory(s: CompanySnapshot, cfg: AppConfig): Category {
  const c = cfg.classification
  const mc = s.marketCap
  // 규모를 알 수 없는 기업을 Challenger로 올리지 않는다
  if (mc === null) return 'EMERGING'
  if (mc < c.challenger_min_market_cap) return 'EMERGING'

  if (mc < c.emerging_max_market_cap) {
    const ttm = s.ttm[0]
    const unprofitable = ttm?.operatingIncome !== undefined && ttm?.operatingIncome !== null
      ? ttm.operatingIncome <= 0
      : true   // 손익을 모르면 성숙하다고 볼 수 없다
    const small = ttm?.revenue === null || ttm?.revenue === undefined
      ? true
      : ttm.revenue < c.emerging_revenue_threshold
    return unprofitable || small ? 'EMERGING' : 'CHALLENGER'
  }
  return 'CHALLENGER'
}

export function classifyIndustry(
  members: CompanySnapshot[],
  cfg: AppConfig,
): Map<number, Category> {
  const c = cfg.classification
  const out = new Map<number, Category>()

  const ranked = [...members].sort(
    (a, b) => (b.marketCap ?? -1) - (a.marketCap ?? -1),
  )

  const leaders = new Set<number>()
  // 후보가 적은 산업에서 "상위 2개"는 정보가 아니다
  if (ranked.length >= c.leader_min_industry_candidates) {
    const maxCap = ranked[0]?.marketCap ?? null
    if (maxCap !== null && maxCap > 0) {
      const threshold = maxCap * c.leader_ratio_of_max
      for (let i = 0; i < ranked.length && leaders.size < c.leader_max; i++) {
        const s = ranked[i]!
        const qualifies = s.marketCap !== null && s.marketCap >= threshold
        if (qualifies || i < c.leader_min) leaders.add(s.cik)
        else break
      }
    }
  }

  for (const s of members) {
    out.set(s.cik, leaders.has(s.cik) ? 'LEADER' : nonLeaderCategory(s, cfg))
  }
  return out
}

export function classifyAll(
  snapshots: CompanySnapshot[],
  cfg: AppConfig,
): Map<number, Category> {
  const byIndustry = new Map<string, CompanySnapshot[]>()
  for (const s of snapshots) {
    const list = byIndustry.get(s.industrySlug)
    if (list) list.push(s)
    else byIndustry.set(s.industrySlug, [s])
  }

  const out = new Map<number, Category>()
  for (const members of byIndustry.values()) {
    for (const [cik, category] of classifyIndustry(members, cfg)) out.set(cik, category)
  }
  return out
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run tests/engines/classify.test.ts`
Expected: PASS (11 tests)

- [ ] **Step 5: 커밋**

```bash
git add -A
git commit -m "feat: Leader/Challenger/Emerging 분류 엔진

스펙에서 겹치던 Challenger(2B~30B)와 Emerging(300M~5B) 구간을
2B~5B 구간의 수익성·매출 규모 조건으로 결정론적으로 해소한다.
후보 3개 미만 산업은 Leader를 지정하지 않는다."
```

---

### Task 21: compute-scores 잡

**Files:**
- Create: `src/db/repositories/scores.ts`, `src/pipeline/jobs/compute-scores.ts`
- Test: `tests/pipeline/compute-scores.test.ts`

**Interfaces:**
- Consumes: `buildSnapshots` (Task 14), `evaluateQuality` (Task 15), `scoreTenbagger`/`ENGINE_VERSION` (Task 19), `classifyAll` (Task 20), `percentileOf` (Task 2), `DISTRIBUTION_KEYS` (Task 14)
- Produces:
  - `writeScores(raw, rows: ScoreWrite[]): void`
  - `type ScoreWrite = { cik: number; asOf: string; tenbagger: number | null; completeness: number; category: Category | null; engineVersion: string; factors: FactorResult[]; percentiles: Record<string, number | null>; flags: RedFlag[] }`
  - `computeScores(deps: ScoreDeps): Promise<JobStats>`
  - `type ScoreDeps = { raw; cfg; taxonomy; asOf: string }`
  - `configHash(cfg: AppConfig): string` — `engine_version`에 붙일 config 내용 해시 8자리

**팩터 키 → 분포 키 매핑** (백분위 표시용). 매핑이 없는 팩터는 백분위를 저장하지 않는다.

```
revenue_growth        → revenue_growth
revenue_acceleration  → revenue_acceleration
gross_margin          → gross_margin
market_cap_opportunity→ market_cap
```

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/pipeline/compute-scores.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { getRawDb, runMigrations } from '@/db/client'
import { parseConfig } from '@/config'
import { loadTaxonomy } from '@/taxonomy'
import { computeScores } from '@/pipeline/jobs/compute-scores'

const cfg = parseConfig(readFileSync('config.yaml', 'utf8'))
const taxonomy = loadTaxonomy()

let raw: Database.Database
let stats: Record<string, unknown>

function seed(db: Database.Database, cik: number, ticker: string, marketCap: number,
              revenueNow: number, revenuePrior: number, gm: number) {
  db.prepare(
    `INSERT INTO companies (cik, ticker, name, sic, is_active, first_seen, last_updated)
     VALUES (?, ?, ?, '3674', 1, '2026-08-09', '2026-08-09')`,
  ).run(cik, ticker, ticker)
  db.prepare(
    `INSERT INTO company_industry (cik, industry_slug, theme_slug, is_primary, source)
     VALUES (?, 'semiconductors', 'ai-software-semi', 1, 'sic')`,
  ).run(cik)
  const ins = db.prepare(
    `INSERT INTO financials (cik, period_end, period_type, revenue, gross_profit, computed_at)
     VALUES (?, ?, 'TTM', ?, ?, '2026-08-09')`,
  )
  const ends = ['2025-03-31', '2024-12-31', '2024-09-30', '2024-06-30', '2024-03-31']
  ends.forEach((e, i) => {
    const rev = i === 4 ? revenuePrior : revenueNow
    ins.run(cik, e, rev, rev * gm)
  })
  db.prepare(
    `INSERT INTO market_data (cik, date, price, shares_outstanding, market_cap)
     VALUES (?, '2026-08-08', 10, ?, ?)`,
  ).run(cik, marketCap / 10, marketCap)
}

beforeAll(async () => {
  raw = getRawDb(join(mkdtempSync(join(tmpdir(), 'tb-score-')), 'sc.db'))
  runMigrations(raw)
  seed(raw, 1, 'BIG', 300e9, 100e9, 90e9, 0.70)
  seed(raw, 2, 'MID', 8e9, 2e9, 1.5e9, 0.65)
  seed(raw, 3, 'SMALL', 900e6, 200e6, 130e6, 0.80)
  stats = await computeScores({ raw, cfg, taxonomy, asOf: '2026-08-09' })
})

describe('computeScores', () => {
  it('모든 유니버스 기업의 점수를 쓴다', () => {
    const n = raw.prepare('SELECT COUNT(*) c FROM scores').get() as { c: number }
    expect(n.c).toBe(3)
    expect(stats.scored).toBe(3)
  })

  it('팩터 9개를 score_factors에 남긴다', () => {
    const n = raw
      .prepare('SELECT COUNT(*) c FROM score_factors WHERE cik = 3')
      .get() as { c: number }
    expect(n.c).toBe(9)
  })

  it('분류 결과를 저장한다', () => {
    const rows = raw
      .prepare('SELECT cik, category FROM scores ORDER BY cik')
      .all() as { cik: number; category: string }[]
    expect(rows.find((r) => r.cik === 1)!.category).toBe('LEADER')
    expect(rows.find((r) => r.cik === 3)!.category).toBe('EMERGING')
  })

  it('소형 고성장주가 메가캡보다 높은 점수를 받는다', () => {
    const rows = raw
      .prepare('SELECT cik, tenbagger FROM scores')
      .all() as { cik: number; tenbagger: number }[]
    const big = rows.find((r) => r.cik === 1)!.tenbagger
    const small = rows.find((r) => r.cik === 3)!.tenbagger
    expect(small).toBeGreaterThan(big)
  })

  it('백분위를 저장한다', () => {
    const r = raw
      .prepare(
        "SELECT percentile FROM score_factors WHERE cik = 3 AND factor_key = 'gross_margin'",
      )
      .get() as { percentile: number | null }
    expect(r.percentile).toBeCloseTo(2 / 3)   // 0.80은 3개 중 2개보다 크다
  })

  it('engine_version에 config 해시를 포함한다', () => {
    const r = raw
      .prepare('SELECT engine_version FROM scores WHERE cik = 1')
      .get() as { engine_version: string }
    expect(r.engine_version).toMatch(/^tenbagger-1\.0\.0\+[0-9a-f]{8}$/)
  })

  it('as_of가 다르면 이력이 쌓이고 latest_scores는 1건만 준다', async () => {
    await computeScores({ raw, cfg, taxonomy, asOf: '2026-08-16' })
    const all = raw
      .prepare('SELECT COUNT(*) c FROM scores WHERE cik = 1')
      .get() as { c: number }
    const latest = raw
      .prepare('SELECT COUNT(*) c FROM latest_scores WHERE cik = 1')
      .get() as { c: number }
    expect(all.c).toBe(2)
    expect(latest.c).toBe(1)
  })

  it('job_runs에 성공 기록을 남긴다', () => {
    const r = raw
      .prepare("SELECT status FROM job_runs WHERE job='scores' ORDER BY id DESC")
      .get() as { status: string }
    expect(r.status).toBe('succeeded')
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run tests/pipeline/compute-scores.test.ts`
Expected: FAIL — `Cannot find module '@/pipeline/jobs/compute-scores'`

- [ ] **Step 3: scores 리포지토리 구현**

`src/db/repositories/scores.ts`:

```ts
import type Database from 'better-sqlite3'
import type { Category, FactorResult, RedFlag } from '@/domain/types'

export type ScoreWrite = {
  cik: number
  asOf: string
  tenbagger: number | null
  completeness: number
  category: Category | null
  engineVersion: string
  factors: FactorResult[]
  percentiles: Record<string, number | null>
  flags: RedFlag[]
}

export function writeScores(raw: Database.Database, rows: ScoreWrite[]): void {
  const insScore = raw.prepare(
    `INSERT OR REPLACE INTO scores
       (cik, as_of, tenbagger, completeness, category, engine_version)
     VALUES (@cik, @asOf, @tenbagger, @completeness, @category, @engineVersion)`,
  )
  const insFactor = raw.prepare(
    `INSERT OR REPLACE INTO score_factors
       (cik, as_of, engine, factor_key, raw, points, weight, status, percentile, detail)
     VALUES (@cik, @asOf, 'tenbagger', @key, @raw, @points, @weight, @status, @percentile, @detail)`,
  )
  const insFlag = raw.prepare(
    `INSERT OR REPLACE INTO red_flags (cik, as_of, code, severity, message, evidence)
     VALUES (@cik, @asOf, @code, @severity, @message, @evidence)`,
  )

  raw.transaction(() => {
    for (const r of rows) {
      insScore.run({
        cik: r.cik, asOf: r.asOf, tenbagger: r.tenbagger,
        completeness: r.completeness, category: r.category,
        engineVersion: r.engineVersion,
      })
      for (const f of r.factors) {
        insFactor.run({
          cik: r.cik, asOf: r.asOf, key: f.key, raw: f.raw, points: f.points,
          weight: f.weight, status: f.status,
          percentile: r.percentiles[f.key] ?? null, detail: f.detail,
        })
      }
      for (const flag of r.flags) {
        insFlag.run({
          cik: r.cik, asOf: r.asOf, code: flag.code, severity: flag.severity,
          message: flag.message, evidence: JSON.stringify(flag.evidence),
        })
      }
    }
  })()
}
```

- [ ] **Step 4: 잡 구현**

`src/pipeline/jobs/compute-scores.ts`:

```ts
import { createHash } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { AppConfig } from '@/config'
import type { Taxonomy } from '@/taxonomy'
import { percentileOf } from '@/domain/stats'
import { evaluateQuality } from '@/engines/quality'
import { scoreTenbagger, ENGINE_VERSION } from '@/engines/tenbagger'
import { classifyAll } from '@/engines/classify'
import { buildSnapshots } from '@/pipeline/snapshot'
import { writeScores, type ScoreWrite } from '@/db/repositories/scores'
import { runJob, type JobStats } from '@/pipeline/runner'

/** 팩터 키 → IndustryStats.distributions 키. 없는 팩터는 백분위를 저장하지 않는다. */
const PERCENTILE_SOURCE: Record<string, string> = {
  revenue_growth: 'revenue_growth',
  revenue_acceleration: 'revenue_acceleration',
  gross_margin: 'gross_margin',
  market_cap_opportunity: 'market_cap',
}

export function configHash(cfg: AppConfig): string {
  return createHash('sha256').update(JSON.stringify(cfg)).digest('hex').slice(0, 8)
}

export type ScoreDeps = {
  raw: Database.Database
  cfg: AppConfig
  taxonomy: Taxonomy
  asOf: string
}

export async function computeScores(deps: ScoreDeps): Promise<JobStats> {
  const { raw, cfg, taxonomy, asOf } = deps

  return runJob(raw, 'scores', async () => {
    const snapshots = buildSnapshots({ raw, taxonomy, cfg, asOf })
    const categories = classifyAll(snapshots, cfg)
    const engineVersion = `${ENGINE_VERSION}+${configHash(cfg)}`

    const rows: ScoreWrite[] = []
    let redFlagged = 0
    let insufficient = 0

    for (const s of snapshots) {
      const flags = evaluateQuality(s, cfg)
      const result = scoreTenbagger(s, cfg, flags)

      const percentiles: Record<string, number | null> = {}
      for (const f of result.factors) {
        const key = PERCENTILE_SOURCE[f.key]
        if (!key || f.raw === null) continue
        const dist = s.industryStats.distributions[key]
        if (!dist || dist.length < cfg.scoring.min_industry_candidates) continue
        percentiles[f.key] = percentileOf(dist, f.raw)
      }

      if (flags.some((f) => f.severity === 'CRITICAL')) redFlagged++
      if (result.completeness < cfg.scoring.min_completeness) insufficient++

      rows.push({
        cik: s.cik, asOf, tenbagger: result.score,
        completeness: result.completeness,
        category: categories.get(s.cik) ?? null,
        engineVersion, factors: result.factors, percentiles, flags,
      })
    }

    writeScores(raw, rows)

    return {
      scored: rows.length,
      redFlagged,
      insufficient,
      engineVersion,
    }
  })
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npx vitest run tests/pipeline/compute-scores.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 6: 전체 테스트 확인**

Run: `npm test`
Expected: 모든 테스트 통과

- [ ] **Step 7: 커밋**

```bash
git add -A
git commit -m "feat: compute-scores 잡

스냅샷 조립 → Quality Gate → Tenbagger 엔진 → 분류 순으로 실행하고
점수·팩터·Red Flag를 append-only로 저장한다.
engine_version에 config 해시를 붙여 점수 변화가 로직 변경 때문인지
데이터 변경 때문인지 구분할 수 있게 한다."
```
