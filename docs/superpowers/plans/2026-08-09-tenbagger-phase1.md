# Tenbagger Discovery Dashboard — Phase 1 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** SEC EDGAR 실데이터로 미국 성장주 유니버스를 구성하고 Tenbagger Score를 계산해 3개 화면(Growth Opportunity Map / Industry / Stock Detail)으로 탐색할 수 있는 대시보드를 만든다.

**Architecture:** 순수 함수 스코어링 엔진(`src/engines/`)이 `CompanySnapshot` 하나만 받아 점수를 반환한다. 엔진은 DB와 Provider를 import하지 않으며 이 경계는 테스트로 강제한다. 원천 XBRL 사실(`financial_facts`)과 파생 재무(`financials`)를 분리해 스코어 로직 변경 시 재크롤링 없이 재계산한다. Next.js RSC가 SQLite를 직접 읽고 별도 API 계층은 없다.

**Tech Stack:** Next.js 15 (App Router) · React 19 · TypeScript strict · better-sqlite3 + Drizzle ORM · Vitest · Tailwind CSS 4 · zod · yaml

**설계 문서:** [2026-08-09-tenbagger-discovery-dashboard-design.md](../specs/2026-08-09-tenbagger-discovery-dashboard-design.md)

## Global Constraints

- Node.js 24 / npm 12 / Windows. 쉘 명령은 PowerShell 기준으로 검증할 것.
- TypeScript `strict: true`. `any` 금지. 결측은 `null`이며 `0`으로 대체하지 않는다.
- **`src/engines/**`는 `src/db` 또는 `src/providers`를 import할 수 없다.** Task 12의 테스트가 이를 강제한다.
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
  sharesDiluted: number | null
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

/** factorKey → 해당 산업 후보들의 정렬된 원시 지표 배열 */
export type IndustryStats = {
  candidateCount: number
  medianGrossMargin: number | null
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
  shares_diluted REAL, sbc REAL, rd_expense REAL,
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
