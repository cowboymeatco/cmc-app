// Asset register — shared types and the small amount of arithmetic that has to
// give the same answer everywhere.

export const ASSET_CATEGORIES = ['equipment', 'vehicle', 'building', 'software', 'fixture', 'other'] as const
export type AssetCategory = typeof ASSET_CATEGORIES[number]

export const CATEGORY_LABEL: Record<AssetCategory, string> = {
  equipment: 'Equipment',
  vehicle:   'Vehicle',
  building:  'Building & improvements',
  software:  'Software',
  fixture:   'Fixture',
  other:     'Other',
}

export const ASSET_STATUSES = ['in_service', 'down', 'retired', 'spare'] as const
export type AssetStatus = typeof ASSET_STATUSES[number]

export const STATUS_LABEL: Record<AssetStatus, string> = {
  in_service: 'In service',
  down:       'Down',
  retired:    'Retired',
  spare:      'Spare',
}

export interface Asset {
  id: string
  name: string
  make: string | null
  model: string | null
  serial_number: string | null
  asset_tag: string | null
  category: AssetCategory
  area_id: string | null
  cleanable: boolean
  service_interval_days: number | null
  last_serviced_on: string | null
  status: AssetStatus
  purchase_cost: number | null
  purchase_date: string | null
  vendor: string | null
  useful_life_years: number | null
  salvage_value: number | null
  replacement_cost: number | null
  qbo_account_id: string | null
  qbo_account_name: string | null
  photo_url: string | null
  notes: string | null
  active: boolean
}

// ── Book value ──────────────────────────────────────────────────────────

/**
 * Straight-line book value as of `asOfISO`.
 *
 * Computed here rather than read from QuickBooks because QuickBooks holds a
 * single pooled accumulated-depreciation account for the whole company — there
 * is no per-asset figure to read. So this is *our* estimate, and the UI has to
 * label it as such rather than presenting it as the books' number.
 *
 * Returns null when there isn't enough to compute one, which is different from
 * zero and must stay distinguishable: a machine with no purchase date is
 * unknown, not fully depreciated.
 */
export function bookValue(asset: Pick<Asset,
  'purchase_cost' | 'purchase_date' | 'useful_life_years' | 'salvage_value'>,
  asOfISO: string,
): number | null {
  const { purchase_cost: cost, purchase_date: bought, useful_life_years: life } = asset
  if (cost == null || !bought || !life || life <= 0) return null

  const salvage = asset.salvage_value ?? 0
  const years   = (Date.parse(asOfISO) - Date.parse(bought)) / (365.25 * 86_400_000)
  if (years <= 0) return cost

  const depreciable = Math.max(0, cost - salvage)
  const depreciated = Math.min(depreciable, (depreciable / life) * years)
  return Math.round((cost - depreciated) * 100) / 100
}

/** Days until the next service is due; negative means overdue. Null = no schedule. */
export function serviceDueInDays(asset: Pick<Asset,
  'service_interval_days' | 'last_serviced_on'>,
  todayISO: string,
): number | null {
  const { service_interval_days: every, last_serviced_on: last } = asset
  if (!every || every <= 0) return null
  // Never serviced but on a schedule reads as due now rather than as unknown —
  // it is the state most likely to mean "nobody has ever looked at this".
  if (!last) return 0
  const elapsed = (Date.parse(todayISO) - Date.parse(last)) / 86_400_000
  return Math.round(every - elapsed)
}

// ── Reconciliation against the books ────────────────────────────────────

export interface QboAccountBalance { id: string; name: string; balance: number }

export interface Coverage {
  /** Gross fixed-asset value on the balance sheet, excluding accumulated depreciation. */
  booksGross: number
  /** Sum of what the register can actually name. */
  registerNamed: number
  /** Value sitting in pooled accounts with no individual asset behind it. */
  unaccounted: number
  pct: number
  /** Assets carrying a cost — the ones contributing to `registerNamed`. */
  withCost: number
  /**
   * Assets that exist in the register but carry no cost yet.
   *
   * This number exists because closing the gap is two jobs, not one. The plant
   * walk produces the inventory; assigning value out of the pooled accounts is
   * a separate pass at a desk with the books. Without this figure the bar looks
   * stuck after a full day's walking — every machine captured, none of them
   * costed, coverage unmoved — which would read as the walk having achieved
   * nothing.
   */
  awaitingCost: number
}

/**
 * How much of the balance sheet the register can actually put a name to.
 *
 * This is the number that says whether an asset register is worth having. At
 * the time of writing, five machines are itemized in QuickBooks and roughly
 * $429k sits in a single "Machinery & Equipment" line that nobody can break
 * down — so the honest coverage figure is low, and it should be, until someone
 * walks the plant.
 */
export function coverage(
  accounts: QboAccountBalance[],
  assets: Pick<Asset, 'purchase_cost' | 'active'>[],
): Coverage {
  // Accumulated depreciation is a contra-asset and carries a negative balance;
  // including it would understate what there is to account for.
  const booksGross = accounts
    .filter(a => a.balance > 0)
    .reduce((n, a) => n + a.balance, 0)

  const live   = assets.filter(a => a.active)
  const costed = live.filter(a => a.purchase_cost != null)

  const registerNamed = costed.reduce((n, a) => n + (a.purchase_cost ?? 0), 0)
  const unaccounted   = Math.max(0, booksGross - registerNamed)

  return {
    booksGross,
    registerNamed,
    unaccounted,
    pct: booksGross === 0 ? 0 : Math.round((registerNamed / booksGross) * 100),
    withCost:     costed.length,
    awaitingCost: live.length - costed.length,
  }
}

export const money = (n: number | null | undefined): string =>
  n == null ? '—' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
