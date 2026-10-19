// ──────────────────────────────────────────────────────────────────────────────
// Clover register SALES — one Mountain Time business day, summarized. SERVER-ONLY
// (reads the Clover token via lib/clover creds).
//
// This file knows nothing about QuickBooks on purpose. It answers "what did the
// register take in on this day, and what was it for", and the destination —
// QuickBooks today (lib/qboDailySales.ts), maybe Ambrook from 2027 — is a
// separate step that reads the DaySummary this returns.
//
// What the API token can and cannot see shaped all of it (probed 2026-09-26):
//   - orders + their line items: yes (expand=lineItems only; every other expand
//     answers 403 "Invalid permissions for expandable fields")
//   - payments: only per order (/orders/{id}/payments). The merchant-wide
//     /payments, /refunds, /credits and /tenders all answer 401.
//   - so tender NAMES are unknown — only ids. See CLOVER_TENDERS.
//   - refunds show only as `refunded: true` on a line item; the refund's own
//     date and amount can't be read. A refund therefore takes its line out of
//     the day the order was paid, and a refund that lands AFTER that day was
//     posted shows up as the day's numbers changing (the "changed after
//     posting" flag), not as a refund on the day it happened.
//   - processing fees: not in the REST API at all. Clover nets them (and the
//     Clover loan holdback) out of the bank deposit, which is where the books
//     already record them.
//   - tax: the merchant has one rate, NO_TAX_APPLIED (Montana). Tax is still
//     read, and any non-zero tax stops the day for a person.
//
// Checked against Jill's hand entry for 2026-09-24 and 2026-09-25 (her CMC
// invoices 2843C and 2846C, dated the day after) — see the PR notes.
// ──────────────────────────────────────────────────────────────────────────────

import { creds, cloverFetch } from '@/lib/clover'
import { parseRingUpDocNumber } from '@/lib/cloverOrders'
import { addDaysISO } from '@/lib/dates'

const SHOP_TZ = 'America/Denver'

// ── Tenders ───────────────────────────────────────────────────────────────────
// The token can't read /tenders, so tender ids are identified from how Jill
// booked them (September 2026 deposits and CMC invoice payments):
//   QJ5J… + 1VHK… together = the Clover card batch (9/24: $304.59 + $105.80 =
//     the $410.39 card payment on 2843C)
//   A8ZG… = check (the payment note carries the check number; $24.47 on 9/25
//     is the check payment on 2846C)
//   JJY9… = cash (Clover sets cashTendered)
//   ZZA9… = gift card (an external payment; Jill offsets it to Clover Gift
//     Cards Payable in a $0 deposit)
//   TRZC… = seen once (Troy Sams, $1,201.60), deposited with the checks
//   WZBC… = on account (Charlie, 2026-09-29: the $43.70 on 9/28). No money
//     changes hands — the customer is billed later — so these orders are kept
//     out of the day's takings and listed for a person to invoice.
// Anything else is 'other' and flagged. cashTendered wins over the table.
export type TenderKind = 'card' | 'cash' | 'check' | 'gift_card' | 'on_account' | 'other'

export const CLOVER_TENDERS: Record<string, { kind: TenderKind; label: string }> = {
  QJ5JQ08ZHT3KG: { kind: 'card', label: 'Card' },
  '1VHKRV7MNEW4Y': { kind: 'card', label: 'Card' },
  A8ZGZK18DNW9G: { kind: 'check', label: 'Check' },
  JJY92FKW32K2G: { kind: 'cash', label: 'Cash' },
  ZZA958ENMHJHP: { kind: 'gift_card', label: 'Gift card' },
  TRZCAJFFXHTSR: { kind: 'check', label: 'Check (2nd tender)' },
  WZBCHC2FTT7CR: { kind: 'on_account', label: 'On account' },
}

export const TENDER_LABEL: Record<TenderKind, string> = {
  card: 'Card', cash: 'Cash', check: 'Check', gift_card: 'Gift card', on_account: 'On account', other: 'Other',
}

// ── Raw Clover shapes (only the fields used) ────────────────────────────────
export interface CloverSaleLine {
  id: string
  name?: string
  price?: number           // cents; per lb for weighed items
  unitQty?: number         // thousandths (450 = 0.450 lb); absent = one unit
  unitName?: string
  item?: { id: string }    // absent = a hand-keyed custom amount
  refunded?: boolean
  isRevenue?: boolean
}

export interface CloverSaleOrder {
  id: string
  title?: string
  total?: number
  state?: string
  createdTime?: number
  modifiedTime?: number
  lineItems?: { elements?: CloverSaleLine[] }
}

export interface CloverPayment {
  id: string
  amount: number           // cents, includes tax, excludes tip
  taxAmount?: number
  tipAmount?: number
  cashTendered?: number
  externalPaymentId?: string
  tender?: { id: string }
  createdTime: number
  result?: string          // SUCCESS | FAIL | ...
  note?: string
}

export interface CloverDayRaw {
  date: string
  startMs: number
  endMs: number
  orders: { order: CloverSaleOrder; payments: CloverPayment[] }[]
  categoryByItem: Record<string, string>
}

// ── Mountain Time day window ────────────────────────────────────────────────
function denverParts(ms: number): { date: string; hm: string } {
  const d = new Date(ms)
  return {
    date: d.toLocaleDateString('en-CA', { timeZone: SHOP_TZ }),
    hm: d.toLocaleTimeString('en-GB', { timeZone: SHOP_TZ, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }),
  }
}

/** UTC ms of midnight on the shop clock. Denver is UTC−6 (MDT) or UTC−7 (MST),
 *  so exactly one of the two candidates is local midnight on `iso`. */
export function shopMidnightMs(iso: string): number {
  for (const h of [6, 7]) {
    const t = Date.parse(`${iso}T0${h}:00:00Z`)
    const p = denverParts(t)
    if (p.date === iso && p.hm === '00:00') return t
  }
  throw new Error(`Could not place midnight for ${iso} in ${SHOP_TZ}`)
}

export function shopDayWindow(iso: string): { startMs: number; endMs: number } {
  return { startMs: shopMidnightMs(iso), endMs: shopMidnightMs(addDaysISO(iso, 1)) }
}

// ── Reading ─────────────────────────────────────────────────────────────────
// How far back an ordinary (untitled) order can have been opened and still be
// paid on the day. Counter tickets are opened and paid minutes apart; this is
// slack, not a real pattern. Ring-up orders are different — the 5am sync opens
// them days or weeks before the customer walks in — so those are found by
// modifiedTime instead (a payment modifies the order).
const LOOKBACK_MS = 2 * 86_400_000
const PAGE = 1000

async function listOrders(filters: string[]): Promise<CloverSaleOrder[]> {
  const { mid } = creds()
  const out: CloverSaleOrder[] = []
  for (let offset = 0; ; offset += PAGE) {
    const q = [...filters.map(f => `filter=${encodeURIComponent(f)}`), `limit=${PAGE}`, `offset=${offset}`, 'expand=lineItems']
    const data = await cloverFetch(`/merchants/${mid}/orders?${q.join('&')}`)
    const els = (data.elements ?? []) as CloverSaleOrder[]
    out.push(...els)
    if (els.length < PAGE) break
  }
  return out
}

// A day is one payments call per order, and cloverFetch's own retries (under
// 2s in total) aren't enough once the throttle window is full — a second day
// read straight after the first hit a hard 429 in testing. So this waits
// longer between tries before giving up.
async function orderPayments(orderId: string): Promise<CloverPayment[]> {
  const { mid } = creds()
  for (let attempt = 0; ; attempt++) {
    try {
      const data = await cloverFetch(`/merchants/${mid}/orders/${orderId}/payments`)
      return (data.elements ?? []) as CloverPayment[]
    } catch (e) {
      if (attempt >= 3 || !String(e).includes('Clover API 429')) throw e
      await new Promise(r => setTimeout(r, 2000 * 2 ** attempt))
    }
  }
}

// Clover throttles bursts (see lib/clover); cloverFetch backs off on 429, and
// a small pool keeps a busy day from tripping it constantly.
async function pool<T, R>(items: T[], size: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i])
    }
  }))
  return out
}

async function getCategoryByItem(): Promise<Record<string, string>> {
  const { mid } = creds()
  const out: Record<string, string> = {}
  for (let offset = 0; ; offset += PAGE) {
    const data = await cloverFetch(`/merchants/${mid}/items?limit=${PAGE}&offset=${offset}&expand=categories`)
    const els = (data.elements ?? []) as { id: string; categories?: { elements?: { name: string }[] } }[]
    for (const it of els) {
      const cat = it.categories?.elements?.[0]?.name
      if (cat) out[it.id] = cat
    }
    if (els.length < PAGE) break
  }
  return out
}

/** Everything Clover holds for one shop day: every order whose first
 *  successful payment falls inside the Mountain Time day, with its payments. */
export async function getCloverDay(date: string): Promise<CloverDayRaw> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`Bad date "${date}" — expected YYYY-MM-DD`)
  const { startMs, endMs } = shopDayWindow(date)

  const [touched, categoryByItem] = await Promise.all([
    // Any order paid on the day was modified at or after the payment.
    listOrders([`modifiedTime>=${startMs}`, `createdTime<${endMs}`]),
    getCategoryByItem(),
  ])

  const candidates = touched.filter(o =>
    o.state !== 'deleted' &&
    ((o.createdTime ?? 0) >= startMs - LOOKBACK_MS || lineItemsOf(o).some(l => parseRingUpDocNumber(l.name)) || parseRingUpDocNumber(o.title))
  )

  const withPayments = await pool(candidates, 2, async order => ({ order, payments: await orderPayments(order.id) }))

  const orders = withPayments.filter(({ payments }) => {
    const first = firstSuccess(payments)
    return first != null && first >= startMs && first < endMs
  })

  return { date, startMs, endMs, orders, categoryByItem }
}

function lineItemsOf(o: CloverSaleOrder): CloverSaleLine[] {
  return o.lineItems?.elements ?? []
}

function firstSuccess(payments: CloverPayment[]): number | null {
  const ok = payments.filter(p => p.result === 'SUCCESS').map(p => p.createdTime)
  return ok.length ? Math.min(...ok) : null
}

// ── Summarizing (pure — no I/O, so it can be tested on saved data) ─────────
export interface DayItem {
  cloverItemId: string
  name: string
  category: string
  weighed: boolean
  qty: number            // lb for weighed items, else count
  amountCents: number
  lineCount: number
}

export interface DayMoneyLine {
  orderId: string
  lineId: string
  name: string
  amountCents: number
  tender: TenderKind
  paidAt: string          // Mountain Time, HH:MM
  docNumber?: string      // invoice ring-ups only
}

export interface TenderTotal {
  kind: TenderKind
  label: string
  tenderIds: string[]
  collectedCents: number  // successful payments (incl. tax, excl. tips)
  tipsCents: number
  refundsCents: number    // refunded lines on orders this tender paid
  retailCents: number     // what of this tender's money was retail sales
}

// An order charged to a customer's account. Nothing was taken in, so it is not
// in the day's collected money, retail sales or the CMC invoice: the goods go
// on that customer's own invoice, which a person makes.
export interface OnAccountSale {
  orderId: string
  title: string | null    // the order's title in Clover, often the customer
  paidAt: string          // Mountain Time, HH:MM
  amountCents: number     // what was charged to the account
  lines: { name: string; amountCents: number }[]
}

export interface DaySummary {
  date: string
  window: { startUtc: string; endUtc: string }
  orderCount: number
  paymentCount: number
  totals: {
    collectedCents: number      // every successful payment (incl. tax, excl. tips)
    tipsCents: number
    taxCents: number
    refundsCents: number        // refunded lines on the day's orders
    netCents: number            // collected + tips − refunds: what should reach the bank
    retailGrossCents: number    // retail lines at shelf price
    discountsCents: number      // retail gross − what was actually charged for it
    retailNetCents: number      // retail sales, after discounts: the sales number
    invoicePaymentsCents: number
    handKeyedCents: number
    giftCardsSoldCents: number
    nonSaleDiffCents: number    // invoice/hand-keyed lines paid short (−) or over (+)
    onAccountCents: number      // charged on account — not taken in, not in the above
    feesCents: null             // not available from Clover's API — see header
  }
  byTender: TenderTotal[]
  retailItems: DayItem[]
  categories: { name: string; amountCents: number }[]
  invoicePayments: DayMoneyLine[]
  handKeyed: DayMoneyLine[]
  giftCardsSold: DayMoneyLine[]
  refundedLines: DayMoneyLine[]
  onAccount: OnAccountSale[]
  // Order id → the invoice / hand-keyed / gift-card money it took, by tender
  // (what was actually paid — a ring-up paid short shows the short amount).
  orderNonSale: Record<string, Partial<Record<TenderKind, number>>>
  warnings: string[]
  fingerprint: string
}

/** A line's value in cents: price × weight for weighed items. */
export function lineCents(l: CloverSaleLine): number {
  const price = l.price ?? 0
  return l.unitQty != null ? Math.round((price * l.unitQty) / 1000) : price
}

type LineKind = 'retail' | 'invoice' | 'handKeyed' | 'giftCard'

// Ring-up lines first (they are custom lines too), then gift cards (Clover
// marks them isRevenue:false), then any other custom amount — which on this
// register is almost always a processing bill keyed by hand under the
// customer's name ("Joe F", "Troy Sams"), i.e. an invoice payment, not a sale.
export function classifyLine(l: CloverSaleLine): LineKind {
  if (parseRingUpDocNumber(l.name)) return 'invoice'
  if (l.isRevenue === false || /gift\s*card/i.test(l.name ?? '')) return 'giftCard'
  if (!l.item) return 'handKeyed'
  return 'retail'
}

function tenderOf(p: CloverPayment): { id: string; kind: TenderKind } {
  const id = p.tender?.id ?? 'unknown'
  if (p.cashTendered != null) return { id, kind: 'cash' }
  return { id, kind: CLOVER_TENDERS[id]?.kind ?? 'other' }
}

const fmt = (c: number) => `$${(c / 100).toFixed(2)}`

export async function summarizeDay(raw: CloverDayRaw): Promise<DaySummary> {
  const warnings: string[] = []
  const items = new Map<string, DayItem>()
  const tenders = new Map<TenderKind, TenderTotal>()
  const invoicePayments: DayMoneyLine[] = []
  const handKeyed: DayMoneyLine[] = []
  const giftCardsSold: DayMoneyLine[] = []
  const refundedLines: DayMoneyLine[] = []
  const onAccount: OnAccountSale[] = []
  const orderNonSale: Record<string, Partial<Record<TenderKind, number>>> = {}
  let collected = 0, tips = 0, tax = 0, refunds = 0, retailGross = 0, retailCharged = 0, paymentCount = 0, nonSaleDiff = 0

  const tenderRow = (kind: TenderKind) => {
    let t = tenders.get(kind)
    if (!t) {
      t = { kind, label: TENDER_LABEL[kind], tenderIds: [], collectedCents: 0, tipsCents: 0, refundsCents: 0, retailCents: 0 }
      tenders.set(kind, t)
    }
    return t
  }

  for (const { order, payments } of raw.orders) {
    const ok = payments.filter(p => p.result === 'SUCCESS')
    const otherResults = payments.filter(p => p.result !== 'SUCCESS' && p.result !== 'FAIL')
    if (otherResults.length) {
      warnings.push(`Order ${order.id}: payment result ${otherResults.map(p => p.result).join(', ')} — not counted`)
    }
    const outside = ok.filter(p => p.createdTime < raw.startMs || p.createdTime >= raw.endMs)
    if (outside.length) {
      warnings.push(`Order ${order.id} was also paid on another day (${fmt(outside.reduce((s, p) => s + p.amount, 0))}) — counted here, on its first payment's day`)
    }

    // Charged on account: set aside whole, before any of it is counted as money in.
    const kinds = new Set(ok.map(p => tenderOf(p).kind))
    if (kinds.has('on_account') && kinds.size === 1) {
      const amountCents = ok.reduce((s, p) => s + p.amount, 0)
      const title = order.title?.trim() || null
      onAccount.push({
        orderId: order.id, title, amountCents,
        paidAt: denverParts(Math.min(...ok.map(p => p.createdTime))).hm,
        lines: lineItemsOf(order).filter(l => !l.refunded).map(l => ({ name: l.name ?? '(no name)', amountCents: lineCents(l) })),
      })
      tax += ok.reduce((s, p) => s + (p.taxAmount ?? 0), 0)
      if (ok.some(p => p.tipAmount)) warnings.push(`Order ${order.id}: a tip on an on-account charge — needs a person`)
      warnings.push(`Order ${order.id}${title ? ` (${title})` : ''}: ${fmt(amountCents)} charged on account — invoice the customer in QuickBooks`)
      continue
    }
    if (kinds.has('on_account')) warnings.push(`Order ${order.id} was paid partly on account — needs a person`)

    // Money in, by tender. The order's largest tender carries its refunds; its
    // invoice / hand-keyed / gift-card money is taken from the largest tender
    // first and spills to the next (see the allocation below).
    const byKind = new Map<TenderKind, number>()
    for (const p of ok) {
      const t = tenderOf(p)
      const row = tenderRow(t.kind)
      if (!row.tenderIds.includes(t.id)) row.tenderIds.push(t.id)
      row.collectedCents += p.amount
      row.tipsCents += p.tipAmount ?? 0
      byKind.set(t.kind, (byKind.get(t.kind) ?? 0) + p.amount)
      collected += p.amount
      tips += p.tipAmount ?? 0
      tax += p.taxAmount ?? 0
      paymentCount++
      if (t.kind === 'other') warnings.push(`Payment ${p.id} used an unrecognized tender (${t.id}) — check it in the Clover dashboard`)
    }
    const primary = [...byKind.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'other'
    if (byKind.size > 1) warnings.push(`Order ${order.id} was split across ${[...byKind.keys()].join(' + ')} — invoice/hand-keyed money counted from the ${primary} first`)

    const paidAt = denverParts(Math.min(...ok.map(p => p.createdTime))).hm
    const orderCharged = ok.reduce((s, p) => s + p.amount, 0)
    let nonRetail = 0, orderRefunds = 0, orderRetailGross = 0

    for (const l of lineItemsOf(order)) {
      const cents = lineCents(l)
      const base: DayMoneyLine = { orderId: order.id, lineId: l.id, name: l.name ?? '(no name)', amountCents: cents, tender: primary, paidAt }
      if (l.refunded) {
        refundedLines.push(base)
        orderRefunds += cents
        continue
      }
      const kind = classifyLine(l)
      if (kind === 'invoice') {
        invoicePayments.push({ ...base, docNumber: parseRingUpDocNumber(l.name) ?? undefined })
        nonRetail += cents
      } else if (kind === 'giftCard') {
        giftCardsSold.push(base)
        nonRetail += cents
      } else if (kind === 'handKeyed') {
        handKeyed.push(base)
        nonRetail += cents
      } else {
        const id = l.item!.id
        const weighed = l.unitQty != null
        const it = items.get(id) ?? {
          cloverItemId: id, name: l.name ?? id, category: raw.categoryByItem[id] ?? 'Uncategorized',
          weighed, qty: 0, amountCents: 0, lineCount: 0,
        }
        it.qty += weighed ? (l.unitQty ?? 0) / 1000 : 1
        it.amountCents += cents
        it.lineCount++
        items.set(id, it)
        orderRetailGross += cents
      }
    }

    // What the customer actually paid for the retail part of this order. The
    // gap to shelf price is the discount (Clover's line discounts and rewards
    // can't be read directly, but their effect on the charge can).
    //
    // An order with no retail on it can't have a retail discount: when a ring-up
    // is paid for less (or more) than its line says, that difference belongs to
    // the invoice payment. Before this, 9/9 and 9/18 each showed a "discount"
    // ($9.11, $28.07) that was really an invoice paid short at the counter.
    const orderTax = ok.reduce((s, p) => s + (p.taxAmount ?? 0), 0)
    const unexplained = orderCharged - orderRefunds - nonRetail - orderTax
    const orderRetailCharged = orderRetailGross > 0 ? unexplained : 0
    const orderNonSaleDiff = orderRetailGross > 0 ? 0 : unexplained
    if (orderNonSaleDiff !== 0) {
      nonSaleDiff += orderNonSaleDiff
      warnings.push(`Order ${order.id}: paid ${fmt(orderCharged - orderRefunds)} against ${fmt(nonRetail)} of invoice/hand-keyed lines (${orderNonSaleDiff < 0 ? 'short' : 'over'} ${fmt(Math.abs(orderNonSaleDiff))}) — receive what was actually paid`)
    }
    if (orderRetailCharged < 0) {
      warnings.push(`Order ${order.id}: paid ${fmt(orderCharged)} but its non-sale lines come to ${fmt(nonRetail + orderRefunds)} — a partial invoice payment? Needs a person`)
    }
    if (orderRetailCharged - orderRetailGross > 1) {
      warnings.push(`Order ${order.id}: charged ${fmt(orderRetailCharged - orderRetailGross)} more than its lines add up to — needs a person`)
    }

    refunds += orderRefunds
    retailGross += orderRetailGross
    retailCharged += orderRetailCharged
    tenderRow(primary).refundsCents += orderRefunds
    // Retail money by tender. Refunds and tax come off the primary tender; the
    // non-sale money is then taken from the largest tender first, never more
    // than that tender took in. On 8/12 a $208.90 hand-keyed bill was paid
    // $108.90 cash + $100 card, and this is how Jill split it too; putting it
    // all on the cash had made cash retail negative.
    const avail = new Map(byKind)
    avail.set(primary, (avail.get(primary) ?? 0) - orderRefunds - orderTax)
    let toPlace = orderCharged - orderRefunds - orderTax - orderRetailCharged
    const alloc: Partial<Record<TenderKind, number>> = {}
    for (const [kind, amt] of [...avail].sort((a, b) => b[1] - a[1])) {
      const take = Math.max(0, Math.min(amt, toPlace))
      if (take) { alloc[kind] = take; toPlace -= take }
    }
    if (toPlace !== 0) alloc[primary] = (alloc[primary] ?? 0) + toPlace
    for (const [kind, amt] of avail) tenderRow(kind).retailCents += amt - (alloc[kind] ?? 0)
    if (nonRetail + orderNonSaleDiff !== 0) orderNonSale[order.id] = alloc
  }

  if (tax !== 0) warnings.push(`Clover recorded ${fmt(tax)} sales tax — the register is set up with no tax, so this needs a person`)
  for (const t of tenders.values()) {
    if (t.retailCents < 0) warnings.push(`${t.label} retail comes out negative (${fmt(t.retailCents)}) — needs a person`)
  }

  const retailItems = [...items.values()].sort((a, b) => b.amountCents - a.amountCents)
  const catMap = new Map<string, number>()
  for (const it of retailItems) catMap.set(it.category, (catMap.get(it.category) ?? 0) + it.amountCents)
  const discounts = retailGross - retailCharged

  const summary: Omit<DaySummary, 'fingerprint'> = {
    date: raw.date,
    window: { startUtc: new Date(raw.startMs).toISOString(), endUtc: new Date(raw.endMs).toISOString() },
    orderCount: raw.orders.length,
    paymentCount,
    totals: {
      collectedCents: collected,
      tipsCents: tips,
      taxCents: tax,
      refundsCents: refunds,
      netCents: collected + tips - refunds,
      retailGrossCents: retailGross,
      discountsCents: discounts,
      retailNetCents: retailCharged,
      invoicePaymentsCents: invoicePayments.reduce((s, l) => s + l.amountCents, 0),
      handKeyedCents: handKeyed.reduce((s, l) => s + l.amountCents, 0),
      giftCardsSoldCents: giftCardsSold.reduce((s, l) => s + l.amountCents, 0),
      nonSaleDiffCents: nonSaleDiff,
      onAccountCents: onAccount.reduce((s, o) => s + o.amountCents, 0),
      feesCents: null,
    },
    byTender: [...tenders.values()].sort((a, b) => b.collectedCents - a.collectedCents),
    retailItems,
    categories: [...catMap.entries()].map(([name, amountCents]) => ({ name, amountCents })).sort((a, b) => b.amountCents - a.amountCents),
    invoicePayments,
    handKeyed,
    giftCardsSold,
    refundedLines,
    onAccount,
    orderNonSale,
    warnings,
  }
  return { ...summary, fingerprint: await fingerprintOf(summary) }
}

// A stable hash of the money on the day. Re-reading a posted day and getting a
// different fingerprint means Clover's numbers moved after posting (late
// refund, an edited ticket) — the screen flags it for a person.
async function fingerprintOf(s: Omit<DaySummary, 'fingerprint'>): Promise<string> {
  const basis = JSON.stringify({
    t: s.totals,
    tender: s.byTender.map(t => [t.kind, t.collectedCents, t.tipsCents, t.refundsCents, t.retailCents]),
    items: s.retailItems.map(i => [i.cloverItemId, i.amountCents]).sort(),
    onAccount: s.onAccount.map(o => [o.orderId, o.amountCents]).sort(),
    money: [...s.invoicePayments, ...s.handKeyed, ...s.giftCardsSold, ...s.refundedLines].map(l => [l.lineId, l.amountCents]).sort(),
  })
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(basis))
  return Array.from(new Uint8Array(digest)).slice(0, 12).map(b => b.toString(16).padStart(2, '0')).join('')
}

export async function readCloverDay(date: string): Promise<DaySummary> {
  return summarizeDay(await getCloverDay(date))
}
