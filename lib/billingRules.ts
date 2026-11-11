// Billing rules: which service gets charged when, at what rate, to whom.
// Rates and item ids come from the QBO service items (single source of truth
// for pricing). Splits: kill fee and cut & wrap divide across the
// appointment's portions; a portion whose payment_responsibility is
// 'customer' bills to that customer, everything else rolls to the producer.
// Quarter billing weight = carcass weight / 4 (Charlie 2026-07-11).

export interface BillingCharge {
  ruleKey: string
  qboItemId: string
  qboItemName: string
  description: string
  qty: number          // heads or lbs
  unit: 'ea' | 'lb'
  rate: number
  amount: number
}

// QBO service items (SERVICE INCOME:CUSTOM KILL & PROCESSING) — ids resolved
// live from QuickBooks 2026-07-11; rates re-checked 2026-08-10 against both the
// QBO item list and the rates actually billed on invoices since 2026-06-01.
// These had drifted low (beef kill .33, whole/half 1.07, hog processing 1.10,
// flat fees 175) while QBO had already moved up, so every generated charge was
// undercutting the invoice. Re-verify here whenever QBO pricing changes.
export const QBO_SERVICE_ITEMS = {
  beefKill:        { id: '1215', name: 'Custom Beef Kill', rate: 0.38 },          // $/lb carcass
  hogKill:         { id: '1247', name: 'Custom Hog Kill', rate: 0.58 },           // $/lb carcass
  lambKill:        { id: '1298', name: 'Lamb Kill Only', rate: 50 },              // flat per head
  procWholeHalf:   { id: '1214', name: 'Custom Processing-Whole, Half', rate: 1.17 }, // $/lb carcass
  procQuarters:    { id: '1216', name: 'Custom Processing-Quarters', rate: 1.22 },    // $/lb carcass
  hogProcessing:   { id: '138',  name: 'Custom Hog Processing', rate: 1.17 },     // $/lb carcass
  goatFlat:        { id: '134',  name: 'Goat Processing Flat Fee', rate: 180 },   // flat per head
  lambSheepFlat:   { id: '105',  name: 'Custom Lamb/Sheep Flat Fee', rate: 180 }, // flat per head
} as const

export const PORTION_FRACTION: Record<string, number> = {
  Whole: 1,
  Half: 0.5,
  Quarter: 0.25,
}

const round2 = (n: number) => Math.round(n * 100) / 100

// Producers whose animals are never invoiced (own animals — opportunity
// cost, not a receivable). Compared on normalized name.
//
// 'CMC' was the only entry until 2026-08-27, and nothing in harvest_log has
// ever been recorded under it: the harvest screen writes the producer's full
// account name, so our own animals come through as "Cowboy Meat Company" —
// 49 head in the last four months, every one of them a charge waiting to be
// raised against ourselves. Both spellings stay listed.
export const EXCLUDED_PRODUCERS = ['CMC', 'COWBOY MEAT COMPANY', 'COWBOY MEAT CO']
export const isExcludedProducer = (name: string) =>
  EXCLUDED_PRODUCERS.includes(name.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim())

// ── Which rate a charge uses ────────────────────────────────────────────────
// QBO_SERVICE_ITEMS above is the FALLBACK book for ESTIMATES only (booked
// dollars, pipeline value, revenue recognition), which run on every page load.
// Real charges are priced from the price list (lib/priceBook.ts) by
// lib/billingDetect.ts, never from here. Keep these in step with /price-book.

export type ServiceKey = keyof typeof QBO_SERVICE_ITEMS
export interface ServiceRate { id: string; name: string; rate: number }
export type RateBook = Partial<Record<ServiceKey, ServiceRate>>

/** Per-animal negotiated $/lb from the cut card (kill_price_per_lb,
 *  processing_price_per_lb). Only per-lb lines take them; flat-fee species
 *  (lamb, goat) ignore them. */
export interface RateOverride { kill?: number | null; proc?: number | null }

const rateFor = (key: ServiceKey, rates?: RateBook): ServiceRate | null =>
  rates ? rates[key] ?? null : QBO_SERVICE_ITEMS[key]

function perLb(
  ruleKey: string, item: ServiceRate, override: number | null | undefined,
  carcassLbs: number, fraction: number, tag: string, suffix: string,
): BillingCharge {
  const negotiated = override != null && override > 0
  const rate = negotiated ? override! : item.rate
  const qty = round2(carcassLbs * fraction)
  return {
    ruleKey, qboItemId: item.id, qboItemName: item.name,
    description: `${item.name} — carcass ${tag}, ${qty} lbs${suffix}${negotiated ? ' (negotiated rate)' : ''}`,
    qty, unit: 'lb', rate, amount: round2(qty * rate),
  }
}

// Kill fee for one carcass share. Beef/hog are $/lb on carcass weight;
// lamb is flat per head — the $50 applies to KILL-ONLY lambs; when a lamb
// is fully processed the detector supersedes it with the $180 all-in flat
// fee at cut time. Goat kill is inside the flat processing fee -> null.
export function killFeeCharge(
  species: string, carcassLbs: number | null, fraction: number, tag: string,
  rates?: RateBook, override?: RateOverride,
): BillingCharge | null {
  const frac = ` (${fraction === 1 ? 'whole' : fraction === 0.5 ? 'half' : fraction === 0.25 ? 'quarter' : fraction} share)`
  if (species === 'Beef' || species === 'Hog') {
    if (!carcassLbs || carcassLbs <= 0) return null // no weight recorded yet
    const item = rateFor(species === 'Beef' ? 'beefKill' : 'hogKill', rates)
    if (!item) return null
    return perLb('kill_fee', item, override?.kill, carcassLbs, fraction, tag, fraction < 1 ? frac : '')
  }
  if (species === 'Lamb') {
    const item = rateFor('lambKill', rates)
    if (!item) return null
    return {
      ruleKey: 'kill_fee', qboItemId: item.id, qboItemName: item.name,
      description: `${item.name} — carcass ${tag}${fraction < 1 ? frac : ''}`,
      qty: fraction, unit: 'ea', rate: item.rate, amount: round2(item.rate * fraction),
    }
  }
  return null // Goat: kill is inside the flat processing fee (charged at cut)
}

// Cut & wrap for one portion. Beef rates depend on portion size (quarters
// cost more per lb); hog is one rate; lamb and goat are flat per head.
export function cutWrapCharge(
  species: string, carcassLbs: number | null, fraction: number, tag: string,
  rates?: RateBook, override?: RateOverride,
): BillingCharge | null {
  if (species === 'Beef' || species === 'Hog') {
    if (!carcassLbs || carcassLbs <= 0) return null
    const key: ServiceKey = species === 'Hog' ? 'hogProcessing' : fraction === 0.25 ? 'procQuarters' : 'procWholeHalf'
    const item = rateFor(key, rates)
    if (!item) return null
    return perLb('cut_wrap', item, override?.proc, carcassLbs, fraction, tag, '')
  }
  if (species === 'Lamb' || species === 'Goat') {
    const item = rateFor(species === 'Lamb' ? 'lambSheepFlat' : 'goatFlat', rates)
    if (!item) return null
    return {
      ruleKey: 'cut_wrap', qboItemId: item.id, qboItemName: item.name,
      description: `${item.name} — carcass ${tag}${fraction < 1 ? ` (${fraction} share)` : ''}`,
      qty: fraction, unit: 'ea', rate: item.rate, amount: round2(item.rate * fraction),
    }
  }
  return null
}
