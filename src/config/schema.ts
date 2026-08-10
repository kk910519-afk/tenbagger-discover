import { z } from 'zod'

const curve = z
  .array(z.tuple([z.number(), z.number()]))
  .min(2)
  .refine(
    (pts) => pts.every((p, i) => i === 0 || p[0] > pts[i - 1]![0]),
    { message: '곡선의 x 좌표는 오름차순이어야 합니다' },
  )

const factorBase = z.object({ weight: z.number().nonnegative() }).strict()

export const configSchema = z
  .object({
    universe: z
      .object({
        exchanges: z.array(z.string()),
        min_market_cap: z.number().nonnegative(),
        min_avg_dollar_volume: z.number().nullable(),
        exclude_financial_status: z.array(z.string()),
        exclude_sic: z.array(z.string()),
        security_name_include: z.array(z.string()),
        security_name_exclude: z.array(z.string()),
      })
      .strict(),
    ingest: z
      .object({
        bulk_quarters: z.number().int().positive(),
        sec_user_agent: z.string().min(1),
        sec_rate_limit_per_sec: z.number().positive(),
        finnhub_rate_limit_per_sec: z.number().positive(),
        cache_dir: z.string(),
        normalize_failure_rate_threshold: z.number().min(0).max(1),
        normalize_failure_min_sample: z.number().int().positive(),
        thin_coverage_min_facts: z.number().int().positive(),
      })
      .strict(),
    classification: z
      .object({
        leader_ratio_of_max: z.number(),
        leader_max: z.number().int(),
        leader_min: z.number().int(),
        leader_min_industry_candidates: z.number().int(),
        challenger_min_market_cap: z.number(),
        emerging_max_market_cap: z.number(),
        emerging_revenue_threshold: z.number(),
      })
      .strict(),
    staleness: z
      .object({
        price_days: z.number().int(),
        financials_days: z.number().int(),
        scores_days: z.number().int(),
        tam_days: z.number().int(),
      })
      .strict(),
    scoring: z
      .object({
        min_completeness: z.number(),
        wacc_assumption: z.number(),
        tax_rate: z.number(),
        min_industry_candidates: z.number().int(),
        // 투하자본이 |총부채|+|자본|+|현금| 대비 최소로 차지해야 하는 비율. 0이면 부호
        // 검사만 남아 큰 수들의 상쇄 잔차가 ROIC 분모로 인정된다(리뷰 Finding 2).
        min_invested_capital_ratio: z.number().min(0).max(1),
        // x=TTM 매출(USD), y=revenue_growth·revenue_acceleration에 남는 비율.
        revenue_scale_damping: z.object({ curve }).strict(),
        factors: z
          .object({
            revenue_growth: factorBase
              .extend({
                blend: z.object({ ttm_yoy: z.number(), cagr_3y: z.number() }).strict(),
                curve,
              })
              .strict(),
            revenue_acceleration: factorBase.extend({ curve }).strict(),
            tam_industry_growth: factorBase
              .extend({
                blend: z.object({ tam_cagr: z.number(), penetration: z.number() }).strict(),
                cagr_curve: curve,
                penetration_curve: curve,
              })
              .strict(),
            gross_margin: factorBase
              .extend({
                blend: z.object({ level: z.number(), trend: z.number() }).strict(),
                level_curve: curve,
                trend_curve: curve,
              })
              .strict(),
            operating_leverage: factorBase
              .extend({
                blend: z.object({ margin_delta: z.number(), growth_gap: z.number() }).strict(),
                margin_delta_curve: curve,
                growth_gap_curve: curve,
              })
              .strict(),
            market_cap_opportunity: factorBase
              .extend({
                bands: z.array(
                  z.object({ max: z.number().nullable(), points: z.number() }).strict(),
                ),
                gate: z
                  .object({
                    zero_if_revenue_growth_below: z.number(),
                    zero_if_revenue_below: z.number(),
                    warning_multiplier: z.number(),
                    // 최신 TTM 매출이 null일 때 게이트의 규모 조건에 쓸 대체 관측치를
                    // 찾는 범위(TTM → 연간 순). 0이면 대체하지 않는다.
                    revenue_fallback_periods: z.number().int().nonnegative(),
                  })
                  .strict(),
              })
              .strict(),
            competitive_advantage: factorBase
              .extend({
                min_signals: z.number().int().min(1),
                // x=신호 커버리지 비율(계산된 신호 / 평가 가능했어야 할 신호)
                coverage_curve: curve,
                signals: z
                  .object({
                    roic_spread: curve,
                    gm_stability: curve,
                    gm_vs_industry: curve,
                    rd_intensity: curve,
                  })
                  .strict(),
              })
              .strict(),
            balance_sheet: factorBase
              .extend({
                min_signals: z.number().int().min(1),
                // x=신호 커버리지 비율(계산된 신호 / 평가 가능했어야 할 신호)
                coverage_curve: curve,
                profitable_blend: z
                  .object({ net_cash: z.number(), leverage: z.number() })
                  .strict(),
                net_cash_curve: curve,
                leverage_curve: curve,
                runway_curve: curve,
              })
              .strict(),
            institutional_insider: factorBase.extend({ implemented: z.literal(false) }).strict(),
          })
          .strict(),
      })
      .strict(),
    quality_gate: z
      .object({
        revenue_decline_years: z.number().int(),
        extreme_dilution: z.number(),
        dilution_warning: z.number(),
        gm_collapse_bps: z.number(),
        sbc_of_revenue: z.number(),
        debt_to_ebitda: z.number(),
        runway_critical_quarters: z.number(),
        runway_low_quarters: z.number(),
      })
      .strict(),
    valuation: z
      .object({
        projection_years: z.number().int().positive(),
        terminal_growth_rate: z.number(),
        // 명시적 예측이 주장하는 매출 확대 배수(projection_years 뒤 매출 / 현재 매출)의
        // 상한. 넘으면 값을 깎지 않고 INSUFFICIENT_DATA로 돌린다. 1 이하면 성장하는 어떤
        // 기업도 값을 낼 수 없으므로 1 초과를 강제한다.
        max_implied_revenue_multiple: z.number().gt(1),
        // x = 예측 연차(1..projection_years), y = 초기값(성장률/마진)에 남아있는 가중치(1=초기값 그대로,
        // 0=터미널/성숙값으로 완전 수렴). 성장률 페이드와 FCF마진 페이드가 같은 스케줄을 공유한다.
        fade_curve: curve,
        // 성숙 FCF마진은 전역 상수가 아니라 각 기업이 보여준 마진의 중앙값이다.
        // 여기 있는 것은 그 중앙값을 "측정으로 인정할 최소 조건"뿐이다 — 조건을 못
        // 채우면 대체값을 쓰지 않고 INSUFFICIENT_DATA(MARGIN_NOT_ANCHORABLE)로 돌린다.
        mature_margin: z
          .object({
            lookback_periods: z.number().int().positive(),
            min_periods: z.number().int().positive(),
            // median(|xᵢ − median|) / median의 상한. 1.00 = 흩어짐이 수준과 같아지는 항등점.
            max_dispersion: z.number().positive(),
          })
          .strict(),
        price_to_fair_value: z
          .object({
            undervalued_max_ratio: z.number().positive(),
            overvalued_min_ratio: z.number().positive(),
          })
          .strict(),
        moat: z
          .object({
            lookback_periods: z.number().int().positive(),
            min_periods_required: z.number().int().positive(),
            persistent_clear_ratio: z.number().min(0).max(1),
            intermittent_clear_ratio: z.number().min(0).max(1),
          })
          .strict(),
        uncertainty: z
          .object({
            growth_lookback_quarters: z.number().int().positive(),
            min_periods: z.number().int().positive(),
            // x=측정된 드라이버 / 측정 가능했어야 할 드라이버, y=측정 평균에 주는 가중치.
            // 나머지 (1−y)는 최대 위험(1.0)으로 채운다(리뷰 Finding 4).
            coverage_curve: curve,
            revenue_predictability_curve: curve,
            operating_margin_volatility_curve: curve,
            data_completeness_curve: curve,
            level_thresholds: z
              .object({
                moderate: z.number().min(0).max(1),
                elevated: z.number().min(0).max(1),
                severe: z.number().min(0).max(1),
              })
              .strict(),
          })
          .strict(),
      })
      .strict(),
  })
  .strict()
  .refine((cfg) => cfg.valuation.terminal_growth_rate < cfg.scoring.wacc_assumption, {
    message: 'valuation.terminal_growth_rate는 scoring.wacc_assumption보다 작아야 합니다',
    path: ['valuation', 'terminal_growth_rate'],
  })

export type AppConfig = z.infer<typeof configSchema>
