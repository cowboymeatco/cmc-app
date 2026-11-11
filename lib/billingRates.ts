// ──────────────────────────────────────────────────────────────────────────────
// Live kill / cut & wrap rates, read from QuickBooks. SERVER-ONLY.
//
// The billing detector used to price every charge off the numbers typed into
// lib/billingRules.ts. Those drifted once already (2026-08-10: beef kill .33
// against .38 in QuickBooks, whole/half 1.07 against 1.17), and every charge
// built in that window undercut the invoice. Anything that becomes a charge now
// prices from the QuickBooks item itself, looked up by its id.
//
// An item that is missing, inactive or has no price is left OUT of the book,
// never filled from the fallback: the detector then reports that charge as
// unbillable instead of writing it at a number nobody can vouch for.
// ──────────────────────────────────────────────────────────────────────────────

import { getAllQboItems } from '@/lib/qboSync'
import { QBO_SERVICE_ITEMS, type RateBook, type ServiceKey } from '@/lib/billingRules'

export interface RateDrift {
  key: ServiceKey
  name: string
  code: number   // the fallback in lib/billingRules.ts
  qbo: number    // what QuickBooks says now
}

export interface LiveRates {
  rates: RateBook
  /** Items the detector can't price — each one blocks its charges. */
  problems: string[]
  /** Fallback rates that no longer match QuickBooks — estimates are off by this. */
  drift: RateDrift[]
}

export async function loadLiveRates(): Promise<LiveRates> {
  const items = await getAllQboItems()
  const byId = new Map(items.map(i => [i.Id, i]))
  const rates: RateBook = {}
  const problems: string[] = []
  const drift: RateDrift[] = []

  for (const key of Object.keys(QBO_SERVICE_ITEMS) as ServiceKey[]) {
    const fallback = QBO_SERVICE_ITEMS[key]
    const item = byId.get(fallback.id)
    if (!item) { problems.push(`${fallback.name} (QBO item ${fallback.id}) not found in QuickBooks`); continue }
    if (!item.Active) { problems.push(`${item.Name} (QBO item ${item.Id}) is inactive in QuickBooks`); continue }
    const price = item.UnitPrice ?? 0
    if (!(price > 0)) { problems.push(`${item.Name} (QBO item ${item.Id}) has no sales price in QuickBooks`); continue }
    rates[key] = { id: item.Id, name: item.Name, rate: price }
    if (Math.round(price * 100) !== Math.round(fallback.rate * 100)) {
      drift.push({ key, name: item.Name, code: fallback.rate, qbo: price })
    }
  }
  return { rates, problems, drift }
}
