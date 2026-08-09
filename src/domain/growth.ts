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
