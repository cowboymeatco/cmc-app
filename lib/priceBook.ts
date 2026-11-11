// ──────────────────────────────────────────────────────────────────────────────
// The price book — the app's master list of every chargeable rate. SERVER-ONLY.
//
// Charlie, 2026-11-11: "App has to be master." QuickBooks, Clover and
// cowboymeats.com follow this table; nothing prices a charge off a number
// typed into code any more. See docs/invoicing-spec.md and
// scripts/2026-11-11_invoicing.sql.
//
// Precedence when a charge is priced (most specific wins):
//   1. a negotiated $/lb on the animal's cut card (kill / processing only)
//   2. a customer price (customer_prices) for that QuickBooks customer
//   3. the price book rate
// The office can still change any line on the invoice preview (Phase 2).
// ──────────────────────────────────────────────────────────────────────────────

import { supabaseAdmin } from '@/lib/supabaseAdmin'

export type PriceUnit = 'lb_hcw' | 'lb_in' | 'lb_out' | 'lb_cured' | 'lb' | 'head' | 'flat' | 'day' | 'month' | 'hour' | 'pkg'
export type PriceCategory = 'processing' | 'curing' | 'sausage' | 'smokehouse' | 'fee' | 'cmc_animal' | 'wild_game'

export interface PriceRow {
  key: string
  label: string
  category: PriceCategory
  species: string | null
  rate: number
  unit: PriceUnit
  qbo_item_id: string | null
  qbo_item_name: string | null
  clover_item_id: string | null
  website_section: string | null
  website_label: string | null
  sort_order: number
  auto: boolean
  active: boolean
  updated_at: string
  updated_by: string | null
}

export interface CustomerPrice {
  id: string
  qbo_customer_id: string
  customer_name: string
  price_key: string
  rate: number
  note: string | null
  active: boolean
}

export const UNIT_LABEL: Record<PriceUnit, string> = {
  lb_hcw: 'per lb hanging', lb_in: 'per raw lb in', lb_out: 'per finished lb', lb_cured: 'per cured lb',
  lb: 'per lb', head: 'per head', flat: 'flat', day: 'per day', month: 'per month', hour: 'per hour', pkg: 'per pkg',
}

const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v))

export async function loadPriceRows(): Promise<PriceRow[]> {
  const { data, error } = await supabaseAdmin.from('price_book').select('*').order('sort_order')
  if (error) throw new Error(`price book: ${error.message}`)
  return (data ?? []).map(r => ({ ...r, rate: num(r.rate) })) as PriceRow[]
}

export async function loadCustomerPrices(): Promise<CustomerPrice[]> {
  const { data, error } = await supabaseAdmin.from('customer_prices').select('*').eq('active', true)
  if (error) throw new Error(`customer prices: ${error.message}`)
  return (data ?? []).map(r => ({ ...r, rate: num(r.rate) })) as CustomerPrice[]
}

/** What a charge needs from the book: the rate, the QBO item, and where the rate came from. */
export interface ResolvedPrice {
  key: string
  label: string
  rate: number
  unit: PriceUnit
  qboItemId: string
  qboItemName: string
  source: 'book' | 'customer' | 'card'
}

export class PriceBook {
  private rows: Map<string, PriceRow>
  private deals: Map<string, CustomerPrice>

  constructor(rows: PriceRow[], deals: CustomerPrice[]) {
    this.rows = new Map(rows.map(r => [r.key, r]))
    this.deals = new Map(deals.map(d => [`${d.qbo_customer_id}|${d.price_key}`, d]))
  }

  static async load(): Promise<PriceBook> {
    const [rows, deals] = await Promise.all([loadPriceRows(), loadCustomerPrices()])
    return new PriceBook(rows, deals)
  }

  row(key: string): PriceRow | undefined { return this.rows.get(key) }

  /**
   * The price for one charge, or a reason it can't be priced. A row that is
   * inactive or not yet linked to a QuickBooks item can't become a charge:
   * an invoice line needs the item, and guessing one would put the money on
   * the wrong income line.
   */
  resolve(key: string, qboCustomerId?: string | null, cardRate?: number | null):
    { price: ResolvedPrice } | { problem: string } {
    const r = this.rows.get(key)
    if (!r) return { problem: `no price-book row "${key}"` }
    if (!r.active) return { problem: `${r.label} is switched off in the price list` }
    if (!r.qbo_item_id) return { problem: `${r.label} isn't linked to a QuickBooks item yet — push it from the price list` }
    const base = { key, label: r.label, unit: r.unit, qboItemId: r.qbo_item_id, qboItemName: r.qbo_item_name ?? r.label }
    if (cardRate != null && cardRate > 0) return { price: { ...base, rate: cardRate, source: 'card' } }
    const deal = qboCustomerId ? this.deals.get(`${qboCustomerId}|${key}`) : undefined
    if (deal) return { price: { ...base, rate: deal.rate, source: 'customer' } }
    return { price: { ...base, rate: r.rate, source: 'book' } }
  }
}

export const round2 = (n: number) => Math.round(n * 100) / 100
