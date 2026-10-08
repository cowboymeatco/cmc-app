// Equipment energy log — shared types and the arithmetic that turns a meter
// reading into a monthly figure. Nothing derived is stored; every number on
// the page comes through here so the API, the page and any future report
// agree.

import type { Asset } from './assets'

/** Average hours in a calendar month: 8766 h/yr ÷ 12. */
export const HOURS_PER_MONTH = 730.5

/**
 * A metering window shorter than this is flagged. Refrigeration and heating
 * cycle on and off, and a smoker's draw depends on what's cooking that day,
 * so anything under a few days is a glimpse rather than a measurement.
 */
export const SHORT_WINDOW_HOURS = 72

export const ENERGY_METHODS = ['plug_meter', 'panel_monitor', 'clamp', 'utility_bill'] as const
export type EnergyMethod = typeof ENERGY_METHODS[number]

export const METHOD_LABEL: Record<EnergyMethod, string> = {
  plug_meter:    'Plug-in meter',
  panel_monitor: 'Panel monitor',
  clamp:         'Clamp meter',
  utility_bill:  'Utility bill',
}

export const METHOD_HINT: Record<EnergyMethod, string> = {
  plug_meter:    'Kill A Watt or smart plug between the wall and the machine. Read the kWh total when you unplug it.',
  panel_monitor: 'Emporia, IotaWatt or similar on the breaker panel. Read kWh for the circuit over the window.',
  clamp:         'Amps × volts × hours running. Only as good as your guess at how long it actually ran.',
  utility_bill:  'The whole building. Use it for the total, not for one machine.',
}

export interface EnergyReading {
  id: string
  created_at: string
  asset_id: string
  started_at: string
  ended_at: string
  kwh: number
  method: EnergyMethod
  peak_kw: number | null
  recorded_by: string | null
  notes: string | null
}

export interface EnergyRate {
  id: string
  created_at: string
  effective_on: string
  rate_per_kwh: number
  demand_per_kw: number | null
  utility: string | null
  source: string | null
  recorded_by: string | null
}

/** The slice of an asset the energy screens need. */
export type EnergyAsset = Pick<Asset, 'id' | 'name' | 'make' | 'model' | 'category' | 'status' | 'active'> & {
  rated_watts: number | null
  cleaning_areas?: { id: string; name: string } | null
}

// ── One reading ─────────────────────────────────────────────────────────

export function hoursMetered(r: Pick<EnergyReading, 'started_at' | 'ended_at'>): number {
  return (Date.parse(r.ended_at) - Date.parse(r.started_at)) / 3_600_000
}

/** Average draw over the window, in watts. Null when the window is empty. */
export function avgWatts(r: Pick<EnergyReading, 'started_at' | 'ended_at' | 'kwh'>): number | null {
  const h = hoursMetered(r)
  if (!(h > 0)) return null
  return (r.kwh / h) * 1000
}

/** The reading scaled to an average month. Null when the window is empty. */
export function monthlyKwh(r: Pick<EnergyReading, 'started_at' | 'ended_at' | 'kwh'>): number | null {
  const h = hoursMetered(r)
  if (!(h > 0)) return null
  return (r.kwh / h) * HOURS_PER_MONTH
}

export function isShortWindow(r: Pick<EnergyReading, 'started_at' | 'ended_at'>): boolean {
  return hoursMetered(r) < SHORT_WINDOW_HOURS
}

// ── Cost ────────────────────────────────────────────────────────────────

/**
 * Energy cost for `kwh` under `rate`. Null when there is no rate yet, which
 * is different from zero: the page has to ask for a bill, not show $0.
 */
export function energyCost(kwh: number | null, rate: EnergyRate | null): number | null {
  if (kwh == null || !rate) return null
  return kwh * rate.rate_per_kwh
}

/**
 * Demand charge a machine's peak would attract on its own. Honest only as an
 * upper bound: the bill charges on the building's coincident peak, so two
 * machines that never run together don't add. Shown as "up to".
 */
export function demandCost(peakKw: number | null, rate: EnergyRate | null): number | null {
  if (peakKw == null || !rate || rate.demand_per_kw == null) return null
  return peakKw * rate.demand_per_kw
}

/** The rate in force on `isoDate`: newest effective_on at or before it. */
export function rateOn(rates: EnergyRate[], isoDate: string): EnergyRate | null {
  return rates
    .filter(r => r.effective_on <= isoDate)
    .sort((a, b) => b.effective_on.localeCompare(a.effective_on))[0] ?? null
}

// ── Per asset ───────────────────────────────────────────────────────────

export interface AssetEnergy {
  asset: EnergyAsset
  /** Newest first. */
  readings: EnergyReading[]
  /**
   * The reading the figures come from: the most recent one. Latest rather
   * than an average across history, because the reason to re-meter a machine
   * is that something changed (coils cleaned, gasket replaced, compressor
   * failing) and an average would hide exactly that.
   */
  latest: EnergyReading | null
  avgWatts: number | null
  monthlyKwh: number | null
  monthlyCost: number | null
  peakKw: number | null
  /** avgWatts as a fraction of nameplate. Null without both numbers. */
  ofNameplate: number | null
}

export function summarize(
  assets: EnergyAsset[],
  readings: EnergyReading[],
  rate: EnergyRate | null,
): AssetEnergy[] {
  const byAsset = new Map<string, EnergyReading[]>()
  for (const r of readings) {
    const list = byAsset.get(r.asset_id) ?? []
    list.push(r)
    byAsset.set(r.asset_id, list)
  }

  return assets.map(asset => {
    const list = (byAsset.get(asset.id) ?? [])
      .slice()
      .sort((a, b) => b.ended_at.localeCompare(a.ended_at))
    const latest = list[0] ?? null
    const watts  = latest ? avgWatts(latest) : null
    const kwh    = latest ? monthlyKwh(latest) : null
    return {
      asset,
      readings: list,
      latest,
      avgWatts: watts,
      monthlyKwh: kwh,
      monthlyCost: energyCost(kwh, rate),
      peakKw: latest?.peak_kw ?? null,
      ofNameplate: watts != null && asset.rated_watts ? watts / asset.rated_watts : null,
    }
  })
}

export interface EnergyTotals {
  metered: number
  unmetered: number
  monthlyKwh: number
  monthlyCost: number | null
}

export function totals(rows: AssetEnergy[], rate: EnergyRate | null): EnergyTotals {
  const metered = rows.filter(r => r.monthlyKwh != null)
  const kwh = metered.reduce((n, r) => n + (r.monthlyKwh ?? 0), 0)
  return {
    metered:    metered.length,
    unmetered:  rows.length - metered.length,
    monthlyKwh: kwh,
    monthlyCost: energyCost(kwh, rate),
  }
}

// ── Formatting ──────────────────────────────────────────────────────────

/** Dollars, with cents only when the amount is small enough for them to matter. */
export const dollars = (n: number | null | undefined): string =>
  n == null ? '—'
  : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: Math.abs(n) < 20 ? 2 : 0 })

export const kwhFmt = (n: number | null | undefined): string =>
  n == null ? '—' : `${n.toLocaleString('en-US', { maximumFractionDigits: n < 10 ? 1 : 0 })} kWh`

export const wattsFmt = (n: number | null | undefined): string =>
  n == null ? '—'
  : n >= 1000 ? `${(n / 1000).toLocaleString('en-US', { maximumFractionDigits: 2 })} kW`
  : `${Math.round(n)} W`

/** "3d 4h" for a metering window; whole hours under a day. */
export function windowFmt(hours: number): string {
  if (hours < 24) return `${Math.round(hours)}h`
  const d = Math.floor(hours / 24)
  const h = Math.round(hours - d * 24)
  return h ? `${d}d ${h}h` : `${d}d`
}
