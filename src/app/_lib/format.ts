import { compactMagnitude } from '@/domain/display'

export { compactMagnitude }

const DASH = '—'
const DAY_MS = 86_400_000

export function formatUsd(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return DASH
  const sign = v < 0 ? '-' : ''
  const abs = Math.abs(v)
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(2)}T`
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`
  if (abs >= 1e8) return `${sign}$${(abs / 1e6).toFixed(0)}M`
  return `${sign}$${(abs / 1e6).toFixed(2)}M`
}

export function formatPct(v: number | null, digits = 1): string {
  if (v === null || !Number.isFinite(v)) return DASH
  const sign = v > 0 ? '+' : ''
  return `${sign}${compactMagnitude(v * 100, digits)}%`
}

export function formatScore(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return DASH
  return String(Math.round(v))
}

export function formatDate(v: string | null): string {
  if (!v) return DASH
  return v.slice(0, 10)
}

export type Staleness = 'FRESH' | 'STALE' | 'UNKNOWN'

export function stalenessOf(
  dateIso: string | null,
  asOf: string,
  thresholdDays: number,
): Staleness {
  if (!dateIso) return 'UNKNOWN'
  const age = (Date.parse(asOf) - Date.parse(dateIso.slice(0, 10))) / DAY_MS
  if (!Number.isFinite(age)) return 'UNKNOWN'
  return age > thresholdDays ? 'STALE' : 'FRESH'
}
