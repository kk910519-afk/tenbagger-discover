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
        cache_dir: z.string(),
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
                  })
                  .strict(),
              })
              .strict(),
            competitive_advantage: factorBase
              .extend({
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
  })
  .strict()

export type AppConfig = z.infer<typeof configSchema>
