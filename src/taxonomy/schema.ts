import { z } from 'zod'

export const themesSchema = z.array(
  z
    .object({
      slug: z.string().min(1),
      name: z.string().min(1),
      display_order: z.number().int(),
    })
    .strict(),
)

export const industriesSchema = z
  .array(
    z
      .object({
        slug: z.string().min(1),
        theme: z.string().min(1),
        name: z.string().min(1),
        tam_usd: z.number().positive().nullable(),
        tam_cagr: z.number().nullable(),
        tam_source: z.string().nullable(),
        tam_as_of: z.string().nullable(),
      })
      .strict(),
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

export const sicMapSchema = z
  .object({
    map: z.record(z.string(), z.object({ theme: z.string(), industry: z.string() }).strict()),
    unmapped: z.array(z.string()),
    // 잔여(residual) SIC 중 등록기업 증거로 매핑을 정당화한 코드. 생략 가능하다 —
    // 잔여 SIC를 하나도 매핑하지 않는 taxonomy는 이 목록이 비어 있는 것이 정상이다.
    residual_reviewed: z.array(z.string()).default([]),
  })
  .strict()

export const overridesSchema = z.record(
  z.string(),
  z.object({ theme: z.string().optional(), industry: z.string().optional() }).strict(),
)
