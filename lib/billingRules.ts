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
export const EXCLUDED_PRODUCERS = ['CMC']
export const isExcludedProducer = (name: string) =>
  EXCLUDED_PRODUCERS.includes(name.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim())

// Kill fee for one carcass share. Beef/hog are $/lb on carcass weight;
// lamb is flat per head — the $50 applies to KILL-ONLY lambs; when a lamb
// is fully processed the detector supersedes it with the $180 all-in flat
// fee at cut time. Goat kill is inside the flat processing fee -> null.
export function killFeeCharge(species: string, carcassLbs: number | null, fraction: number, tag: string): BillingCharge | null {
  const frac = ` (${fraction === 1 ? 'whole' : fraction === 0.5 ? 'half' : fraction === 0.25 ? 'quarter' : fraction} share)`
  if (species === 'Beef' || species === 'Hog') {
    if (!carcassLbs || carcassLbs <= 0) return null // no weight recorded yet
    const item = species === 'Beef' ? QBO_SERVICE_ITEMS.beefKill : QBO_SERVICE_ITEMS.hogKill
    const qty = round2(carcassLbs * fraction)
    return {
      ruleKey: 'kill_fee', qboItemId: item.id, qboItemName: item.name,
      description: `${item.name} — carcass ${tag}, ${qty} lbs${fraction < 1 ? frac : ''}`,
      qty, unit: 'lb', rate: item.rate, amount: round2(qty * item.rate),
    }
  }
  if (species === 'Lamb') {
    const item = QBO_SERVICE_ITEMS.lambKill
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
export function cutWrapCharge(species: string, carcassLbs: number | null, fraction: number, tag: string): BillingCharge | null {
  if (species === 'Beef') {
    if (!carcassLbs || carcassLbs <= 0) return null
    const item = fraction === 0.25 ? QBO_SERVICE_ITEMS.procQuarters : QBO_SERVICE_ITEMS.procWholeHalf
    const qty = round2(carcassLbs * fraction)
    return {
      ruleKey: 'cut_wrap', qboItemId: item.id, qboItemName: item.name,
      description: `${item.name} — carcass ${tag}, ${qty} lbs`,
      qty, unit: 'lb', rate: item.rate, amount: round2(qty * item.rate),
    }
  }
  if (species === 'Hog') {
    if (!carcassLbs || carcassLbs <= 0) return null
    const item = QBO_SERVICE_ITEMS.hogProcessing
    const qty = round2(carcassLbs * fraction)
    return {
      ruleKey: 'cut_wrap', qboItemId: item.id, qboItemName: item.name,
      description: `${item.name} — carcass ${tag}, ${qty} lbs`,
      qty, unit: 'lb', rate: item.rate, amount: round2(qty * item.rate),
    }
  }
  if (species === 'Lamb' || species === 'Goat') {
    const item = species === 'Lamb' ? QBO_SERVICE_ITEMS.lambSheepFlat : QBO_SERVICE_ITEMS.goatFlat
    return {
      ruleKey: 'cut_wrap', qboItemId: item.id, qboItemName: item.name,
      description: `${item.name} — carcass ${tag}${fraction < 1 ? ` (${fraction} share)` : ''}`,
      qty: fraction, unit: 'ea', rate: item.rate, amount: round2(item.rate * fraction),
    }
  }
  return null
}
