// ──────────────────────────────────────────────────────────────────────────────
// Clover day → QuickBooks. SERVER-ONLY. Reads a DaySummary from
// lib/cloverSales.ts and turns it into the entry Jill has been keying by hand,
// shows it for approval, and posts it once.
//
// The entry has the SAME SHAPE as Jill's, so the books, the reports and the
// deposit routine don't change under whoever takes over from her:
//
//   1. an Invoice to customer CMC, one line per QuickBooks item sold, plus a
//      Discounts line — like her 2843C / 2846C. Item lines, not a journal
//      entry, because the retail items are Inventory items: an entry that
//      skipped them would stop relieving inventory and booking COGS.
//   2. one Payment against it per tender (card, cash, check, gift card) into
//      Undeposited Funds. Separate payments are what let the bank deposit be
//      built the way it is now: the card batch less Clover Loan Payable and
//      Clover POS Processing Fee, checks and cash on their own slip, gift card
//      redemptions zeroed against Clover Gift Cards Payable.
//   3. a Journal Entry only when gift cards were SOLD (or tips taken):
//      Undeposited Funds / Clover Gift Cards Payable — her SOS-1700.
//
// A SalesReceipt was the other candidate. It carries one tender, and a day
// (and sometimes a single order) takes several, so it would have forced either
// one receipt per tender with items split across them or a single deposit
// line that doesn't match the bank.
//
// NOT posted, only listed: ring-up payments of existing invoices (INV …) and
// hand-keyed name amounts ("Joe F"). Those are payments against invoices that
// are already income in QuickBooks; booking them as sales would count the
// revenue twice. Processing fees aren't here either: Clover's API doesn't
// report them, and they're booked from the deposit, as they are today.
//
// Dates: the entry is dated the day the sales happened. (Jill dated hers the
// morning after. The duplicate check looks at both days.)
// ──────────────────────────────────────────────────────────────────────────────

import { qboFetch } from '@/lib/qbo'
import { getAllQboItems, type QboApiItem } from '@/lib/qboSync'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { addDaysISO, isoDate, isoDateTime } from '@/lib/dates'
import type { DaySummary, TenderKind } from '@/lib/cloverSales'

// Looked up by name at run time, like lib/freight.ts. Ids as of 2026-09-26:
// CMC customer, Undeposited Funds 33, Discounts 63, Clover Gift Cards Payable
// 205, Clover Tips 200.
export const CMC_CUSTOMER = 'CMC'
export const ACCOUNTS = {
  undeposited: 'Undeposited Funds',
  discounts: 'Discounts',
  giftCards: 'Clover Gift Cards Payable',
  tips: 'Clover Tips',
} as const

// Jill's payment methods for each tender (her CMC payments, September 2026).
// On account has none: those orders never get a payment here.
export const PAYMENT_METHODS: Partial<Record<TenderKind, string>> = {
  card: 'Credit Card', cash: 'Cash', check: 'Check', gift_card: 'Clover Gift Card', other: 'Other Payment',
}

// A day can be posted once the shop has closed, not only after midnight:
// with Jill gone, cash and checks are deposited in QuickBooks at close of
// business (Charlie, 2026-09-27), and QuickBooks can only deposit payments
// that are already in Undeposited Funds. Anything rung up after the day was
// posted changes its Clover numbers, and the day is flagged "changed after
// posting" on the next read — the next-morning card deposit re-reads it too.
export const SHOP_CLOSE = '17:00'
export const SHOP_CLOSE_LABEL = '5:00 PM'

export function dayClosed(date: string, now: Date = new Date()): boolean {
  const today = isoDate(now)
  if (date < today) return true
  return date === today && isoDateTime(now).slice(11) >= SHOP_CLOSE
}

// Every invoice this app writes carries this in its memo — how a re-run finds
// its own entry even if the app's database were lost.
export const entryMarker = (date: string) => `[clover-sales ${date}]`

// ── Item mapping ───────────────────────────────────────────────────────────
// Clover item → QuickBooks item, first match wins:
//   'map'  — a person chose it on the screen (clover_qbo_item_map)
//   'plu'  — the PLU record links both (plu_items)
//   'name' — the names are the same once case and punctuation are ignored
// Anything else stops the day until someone picks the item.
export type MapSource = 'map' | 'plu' | 'name'

export interface QboItemRef { id: string; name: string; fullName: string; type: string }

export interface ItemMapping {
  cloverItemId: string
  cloverName: string
  qbo: QboItemRef | null
  source: MapSource | null
  suggestions: QboItemRef[]
}

const SELLABLE = new Set(['Inventory', 'NonInventory', 'Service'])

function norm(s: string): string {
  return s.toUpperCase().replace(/&/g, ' AND ').replace(/[^A-Z0-9%]+/g, ' ').trim().replace(/\s+/g, ' ')
}

function similarity(a: string, b: string): number {
  const ta = new Set(norm(a).split(' ')), tb = new Set(norm(b).split(' '))
  let common = 0
  for (const t of ta) if (tb.has(t)) common++
  return common / (ta.size + tb.size - common || 1)
}

function ref(i: QboApiItem): QboItemRef {
  return { id: i.Id, name: i.Name, fullName: i.FullyQualifiedName, type: i.Type }
}

export async function loadSellableItems(): Promise<QboApiItem[]> {
  return (await getAllQboItems()).filter(i => i.Active && SELLABLE.has(i.Type))
}

export async function mapItems(
  items: { cloverItemId: string; name: string }[],
  sellable: QboApiItem[],
): Promise<ItemMapping[]> {
  const ids = items.map(i => i.cloverItemId)
  const byId = new Map(sellable.map(i => [i.Id, i]))
  const byName = new Map<string, QboApiItem[]>()
  for (const i of sellable) byName.set(norm(i.Name), [...(byName.get(norm(i.Name)) ?? []), i])

  const [mapRes, pluRes] = await Promise.all([
    ids.length
      ? supabaseAdmin.from('clover_qbo_item_map').select('clover_item_id, qbo_item_id').in('clover_item_id', ids)
      : Promise.resolve({ data: [], error: null }),
    ids.length
      ? supabaseAdmin.from('plu_items').select('clover_item_id, quickbooks_item_id').in('clover_item_id', ids).neq('quickbooks_item_id', '')
      : Promise.resolve({ data: [], error: null }),
  ])
  // A missing map table (not migrated yet) degrades to PLU + name matching.
  const chosen = new Map((mapRes.data ?? []).map(r => [r.clover_item_id as string, r.qbo_item_id as string]))
  const viaPlu = new Map<string, Set<string>>()
  for (const r of pluRes.data ?? []) {
    const s = viaPlu.get(r.clover_item_id as string) ?? new Set<string>()
    s.add(r.quickbooks_item_id as string)
    viaPlu.set(r.clover_item_id as string, s)
  }

  const retail = sellable.filter(i => i.FullyQualifiedName.startsWith('RETAIL SALES:'))
  return items.map(({ cloverItemId, name }) => {
    const out: ItemMapping = { cloverItemId, cloverName: name, qbo: null, source: null, suggestions: [] }
    const m = chosen.get(cloverItemId)
    const plu = [...(viaPlu.get(cloverItemId) ?? [])].filter(id => byId.has(id))
    const named = byName.get(norm(name)) ?? []
    if (m && byId.has(m)) { out.qbo = ref(byId.get(m)!); out.source = 'map' }
    // Two PLUs linking one Clover item to different QBO items is ambiguous.
    else if (plu.length === 1) { out.qbo = ref(byId.get(plu[0])!); out.source = 'plu' }
    else if (named.length === 1) { out.qbo = ref(named[0]); out.source = 'name' }
    if (!out.qbo) {
      out.suggestions = retail
        .map(i => ({ i, s: similarity(name, i.Name) }))
        .filter(x => x.s > 0)
        .sort((a, b) => b.s - a.s)
        .slice(0, 4)
        .map(x => ref(x.i))
    }
    return out
  })
}

export async function saveItemMapping(opts: {
  cloverItemId: string; cloverName: string; qboItemId: string; qboItemName: string; by: string
}): Promise<void> {
  const { error } = await supabaseAdmin.from('clover_qbo_item_map').upsert({
    clover_item_id: opts.cloverItemId,
    clover_name: opts.cloverName,
    qbo_item_id: opts.qboItemId,
    qbo_item_name: opts.qboItemName,
    updated_by: opts.by,
    updated_at: new Date().toISOString(),
  })
  if (error) throw new Error(`Saving the item match failed: ${error.message}`)
}

// ── Lookups ─────────────────────────────────────────────────────────────────
interface QueryRes<T> { QueryResponse: Record<string, T[] | undefined> }
const q = (s: string) => `query?query=${encodeURIComponent(s)}`
const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")

export interface QboRefs {
  cmcCustomerId: string
  accounts: Record<keyof typeof ACCOUNTS, { id: string; name: string }>
  paymentMethods: Partial<Record<TenderKind, string>>
}

export async function loadRefs(): Promise<QboRefs> {
  const names = Object.values(ACCOUNTS).map(n => `'${esc(n)}'`).join(', ')
  const [cust, acct, pm] = await Promise.all([
    qboFetch<QueryRes<{ Id: string; DisplayName: string }>>(q(`select Id, DisplayName from Customer where DisplayName = '${esc(CMC_CUSTOMER)}'`)),
    qboFetch<QueryRes<{ Id: string; Name: string; FullyQualifiedName: string; Active: boolean }>>(q(`select Id, Name, FullyQualifiedName, Active from Account where Name in (${names})`)),
    qboFetch<QueryRes<{ Id: string; Name: string; Active: boolean }>>(q('select Id, Name, Active from PaymentMethod')),
  ])
  const c = cust.QueryResponse.Customer ?? []
  if (c.length !== 1) throw new Error(`Expected one QuickBooks customer named "${CMC_CUSTOMER}", found ${c.length}`)
  const accounts = {} as QboRefs['accounts']
  for (const [key, name] of Object.entries(ACCOUNTS) as [keyof typeof ACCOUNTS, string][]) {
    // Name alone can repeat under different parents; the top-level one is meant.
    const hits = (acct.QueryResponse.Account ?? []).filter(a => a.Active && a.FullyQualifiedName === name)
    if (hits.length !== 1) throw new Error(`Expected one active QuickBooks account "${name}", found ${hits.length}`)
    accounts[key] = { id: hits[0].Id, name }
  }
  // A missing payment method just leaves it blank on the payment.
  const paymentMethods: QboRefs['paymentMethods'] = {}
  for (const [kind, name] of Object.entries(PAYMENT_METHODS) as [TenderKind, string][]) {
    const m = (pm.QueryResponse.PaymentMethod ?? []).find(x => x.Active && x.Name === name)
    if (m) paymentMethods[kind] = m.Id
  }
  return { cmcCustomerId: c[0].Id, accounts, paymentMethods }
}

// Invoice numbers here are typed, not automatic (CustomTxnNumbers is on), and
// every invoice — processing bills and Jill's CMC day invoices alike — shares
// one "####C" run. An API invoice sent without a number stays unnumbered, so
// the posting takes the next one in the run, the way Jill does, and checks it
// is still free the moment before it writes.
export async function nextInvoiceNumber(): Promise<string> {
  const res = await qboFetch<QueryRes<{ DocNumber?: string }>>(q('select DocNumber from Invoice orderby MetaData.CreateTime desc maxresults 200'))
  let max = 0
  for (const i of res.QueryResponse.Invoice ?? []) {
    const m = i.DocNumber?.match(/^(\d+)C$/)
    if (m) max = Math.max(max, Number(m[1]))
  }
  if (!max) throw new Error('Could not find the "####C" invoice number run to continue')
  for (let n = max + 1; n < max + 20; n++) {
    const taken = await qboFetch<QueryRes<{ Id: string }>>(q(`select Id from Invoice where DocNumber = '${n}C'`))
    if (!(taken.QueryResponse.Invoice ?? []).length) return `${n}C`
  }
  throw new Error('No free invoice number after the current run')
}

interface QboInvoiceLite {
  Id: string; DocNumber?: string; TxnDate: string; TotalAmt: number; Balance: number
  PrivateNote?: string; CustomerRef: { value: string; name?: string }
}

/** CMC invoices on the day or the morning after — Jill's hand entries and
 *  anything this app already posted. */
async function cmcInvoicesAround(date: string, cmcId: string): Promise<QboInvoiceLite[]> {
  const res = await qboFetch<QueryRes<QboInvoiceLite>>(q(
    `select * from Invoice where CustomerRef = '${cmcId}' and TxnDate >= '${date}' and TxnDate <= '${addDaysISO(date, 1)}'`,
  ))
  return res.QueryResponse.Invoice ?? []
}

// ── Candidate invoice payments (listed, never posted) ───────────────────────
export interface InvoiceCandidate {
  lineId: string
  label: string                 // what the register line said
  amountCents: number
  tender: TenderKind
  kind: 'ring-up' | 'hand-keyed'
  matches: { id: string; docNumber: string; customer: string; totalAmt: number; balance: number; txnDate: string }[]
  note: string
}

async function invoiceCandidates(s: DaySummary): Promise<InvoiceCandidate[]> {
  const out: InvoiceCandidate[] = []
  const docs = [...new Set(s.invoicePayments.map(l => l.docNumber).filter(Boolean) as string[])]
  const byDoc = new Map<string, QboInvoiceLite[]>()
  if (docs.length) {
    const res = await qboFetch<QueryRes<QboInvoiceLite>>(q(`select * from Invoice where DocNumber in (${docs.map(d => `'${esc(d)}'`).join(', ')})`))
    for (const inv of res.QueryResponse.Invoice ?? []) byDoc.set(inv.DocNumber ?? '', [...(byDoc.get(inv.DocNumber ?? '') ?? []), inv])
  }
  const lite = (i: QboInvoiceLite) => ({
    id: i.Id, docNumber: i.DocNumber ?? i.Id, customer: i.CustomerRef.name ?? i.CustomerRef.value,
    totalAmt: i.TotalAmt, balance: i.Balance, txnDate: i.TxnDate,
  })
  for (const l of s.invoicePayments) {
    const matches = (byDoc.get(l.docNumber ?? '') ?? []).map(lite)
    const m = matches[0]
    out.push({
      lineId: l.lineId, label: l.name, amountCents: l.amountCents, tender: l.tender, kind: 'ring-up', matches,
      note: !m ? `No QuickBooks invoice numbered ${l.docNumber}`
        : m.balance === 0 ? 'Already marked paid in QuickBooks'
        : Math.round(m.balance * 100) === l.amountCents ? `Receive $${(l.amountCents / 100).toFixed(2)} against ${m.docNumber}`
        : `Open balance is $${m.balance.toFixed(2)} — the register took $${(l.amountCents / 100).toFixed(2)}`,
    })
  }
  // A hand-keyed amount carries only a name ("Joe F"), so the best clue is an
  // invoice for exactly that total in the last few months.
  const since = addDaysISO(s.date, -120)
  for (const l of s.handKeyed.slice(0, 12)) {
    const amt = (l.amountCents / 100).toFixed(2)
    let matches: InvoiceCandidate['matches'] = []
    try {
      const res = await qboFetch<QueryRes<QboInvoiceLite>>(q(`select * from Invoice where TotalAmt = '${amt}' and TxnDate >= '${since}' maxresults 10`))
      matches = (res.QueryResponse.Invoice ?? []).map(lite)
        .sort((a, b) => similarity(l.name, b.customer) - similarity(l.name, a.customer))
    } catch { /* a lookup miss shouldn't hide the line */ }
    out.push({
      lineId: l.lineId, label: l.name, amountCents: l.amountCents, tender: l.tender, kind: 'hand-keyed', matches,
      note: matches.length ? 'Keyed by name — most likely a payment on one of these invoices' : 'Keyed by name — no invoice for exactly this amount',
    })
  }
  return out
}

// ── The proposal ────────────────────────────────────────────────────────────
export interface ProposedItemLine {
  qboItemId: string | null
  qboItemName: string | null
  description: string
  cloverItemIds: string[]
  qty: number
  amountCents: number
}

export interface ProposedPayment { tender: TenderKind; label: string; amountCents: number; refNum: string; paymentMethodId: string | null }

export interface ProposedJournalLine { posting: 'Debit' | 'Credit'; accountId: string; accountName: string; amountCents: number; description: string }

export interface Proposal {
  date: string
  marker: string
  invoice: null | {
    customerId: string
    customerName: string
    txnDate: string
    lines: ProposedItemLine[]
    discountCents: number
    discountAccountId: string
    totalCents: number
  }
  payments: ProposedPayment[]
  depositAccountId: string
  journal: null | { lines: ProposedJournalLine[] }
  // Where every dollar Clover took in on the day went. Adds to the day's net.
  reconciliation: { label: string; amountCents: number }[]
  balanced: boolean
  blockers: string[]
  handEntered: null | { id: string; docNumber: string; txnDate: string; totalAmt: number }
  alreadyPosted: null | { id: string; docNumber: string }
}

export interface DayProposal {
  proposal: Proposal
  mappings: ItemMapping[]
  candidates: InvoiceCandidate[]
  retailItems: QboItemRef[]      // for the mapping picker on the screen
}

const TENDER_REF: Record<TenderKind, string> = { card: 'CARD', cash: 'CASH', check: 'CHECK', gift_card: 'GIFT', on_account: 'ACCT', other: 'OTHER' }

export async function proposeDay(s: DaySummary): Promise<DayProposal> {
  const [sellable, refs] = await Promise.all([loadSellableItems(), loadRefs()])
  const [mappings, candidates, around] = await Promise.all([
    mapItems(s.retailItems.map(i => ({ cloverItemId: i.cloverItemId, name: i.name })), sellable),
    invoiceCandidates(s),
    cmcInvoicesAround(s.date, refs.cmcCustomerId),
  ])
  const blockers: string[] = []
  const mapById = new Map(mappings.map(m => [m.cloverItemId, m]))

  // Merge Clover items that land on the same QuickBooks item.
  const lines = new Map<string, ProposedItemLine>()
  for (const it of s.retailItems) {
    const m = mapById.get(it.cloverItemId)
    const key = m?.qbo?.id ?? `unmapped:${it.cloverItemId}`
    const l = lines.get(key) ?? {
      qboItemId: m?.qbo?.id ?? null, qboItemName: m?.qbo?.name ?? null,
      description: '', cloverItemIds: [], qty: 0, amountCents: 0,
    }
    l.cloverItemIds.push(it.cloverItemId)
    l.description = l.description ? `${l.description} + ${it.name}` : it.name
    l.qty += it.qty
    l.amountCents += it.amountCents
    lines.set(key, l)
  }
  const unmapped = mappings.filter(m => !m.qbo)
  if (unmapped.length) blockers.push(`${unmapped.length} Clover item(s) need a QuickBooks item: ${unmapped.map(m => m.cloverName).join(', ')}`)

  const t = s.totals
  const itemLines = [...lines.values()].sort((a, b) => b.amountCents - a.amountCents)
  const grossCents = itemLines.reduce((x, l) => x + l.amountCents, 0)
  const invoiceTotal = grossCents - t.discountsCents

  // Payments: each tender's retail money. Retail by tender is computed per
  // order in cloverSales, so it adds to the invoice total by construction —
  // checked anyway below, because an unbalanced proposal must never post.
  const payments: ProposedPayment[] = s.byTender
    .filter(x => x.retailCents !== 0)
    .map(x => ({
      tender: x.kind, label: x.label, amountCents: x.retailCents,
      refNum: `CLV ${TENDER_REF[x.kind]} ${s.date.slice(5)}`,
      paymentMethodId: refs.paymentMethods[x.kind] ?? null,
    }))
  if (payments.some(p => p.amountCents < 0)) blockers.push('A tender comes out negative — see the warnings')

  const journalLines: ProposedJournalLine[] = []
  const jeTotal = t.giftCardsSoldCents + t.tipsCents
  if (jeTotal > 0) {
    journalLines.push({ posting: 'Debit', accountId: refs.accounts.undeposited.id, accountName: refs.accounts.undeposited.name, amountCents: jeTotal, description: `Clover ${s.date} gift cards sold / tips` })
    if (t.giftCardsSoldCents) journalLines.push({ posting: 'Credit', accountId: refs.accounts.giftCards.id, accountName: refs.accounts.giftCards.name, amountCents: t.giftCardsSoldCents, description: `Gift cards sold ${s.date}` })
    if (t.tipsCents) journalLines.push({ posting: 'Credit', accountId: refs.accounts.tips.id, accountName: refs.accounts.tips.name, amountCents: t.tipsCents, description: `Tips ${s.date}` })
  }

  const payTotal = payments.reduce((x, p) => x + p.amountCents, 0)
  const debits = journalLines.filter(l => l.posting === 'Debit').reduce((x, l) => x + l.amountCents, 0)
  const credits = journalLines.filter(l => l.posting === 'Credit').reduce((x, l) => x + l.amountCents, 0)
  const reconciliation = [
    { label: 'Retail sales (invoice to CMC, paid by tender)', amountCents: invoiceTotal },
    { label: 'Gift cards sold (journal entry)', amountCents: t.giftCardsSoldCents },
    { label: 'Tips (journal entry)', amountCents: t.tipsCents },
    { label: 'Invoice ring-ups (not posted — payments on existing invoices)', amountCents: t.invoicePaymentsCents },
    { label: 'Hand-keyed amounts (not posted — likely invoice payments)', amountCents: t.handKeyedCents },
    { label: 'Invoice payments taken short (−) or over (+) at the counter', amountCents: t.nonSaleDiffCents },
    { label: 'Sales tax (not posted — needs a person)', amountCents: t.taxCents },
  ]
  const accounted = reconciliation.reduce((x, r) => x + r.amountCents, 0)
  const balanced = invoiceTotal === payTotal && debits === credits && accounted === t.netCents && invoiceTotal === t.retailNetCents
  if (!balanced) {
    blockers.push(
      `Entry does not balance: invoice $${(invoiceTotal / 100).toFixed(2)} vs payments $${(payTotal / 100).toFixed(2)}, ` +
      `journal ${debits}/${credits}, accounted $${(accounted / 100).toFixed(2)} vs Clover net $${(t.netCents / 100).toFixed(2)}`,
    )
  }
  if (t.taxCents !== 0) blockers.push('Clover recorded sales tax — the register should have none')
  if (s.warnings.some(w => w.includes('needs a person'))) blockers.push('Clover data has something a person needs to look at — see the warnings')

  const marker = entryMarker(s.date)
  const mine = around.find(i => (i.PrivateNote ?? '').includes(marker))
  // Jill's entry: a CMC invoice on the day or the next whose total is exactly
  // the day's retail. A same-total invoice for a different day is possible but
  // rare enough that a person confirming it is the right trade.
  const hand = !mine ? around.find(i => Math.round(i.TotalAmt * 100) === invoiceTotal && invoiceTotal > 0) : undefined
  if (mine) blockers.push(`Already posted to QuickBooks (invoice ${mine.DocNumber ?? mine.Id})`)
  if (hand) blockers.push(`Looks already entered by hand: CMC invoice ${hand.DocNumber ?? hand.Id} dated ${hand.TxnDate} for the same $${hand.TotalAmt.toFixed(2)}`)

  if (!dayClosed(s.date)) blockers.push(`The shop hasn't closed yet — the day can be posted from ${SHOP_CLOSE_LABEL} Mountain Time`)

  return {
    proposal: {
      date: s.date,
      marker,
      invoice: invoiceTotal > 0 || itemLines.length ? {
        customerId: refs.cmcCustomerId, customerName: CMC_CUSTOMER, txnDate: s.date,
        lines: itemLines, discountCents: t.discountsCents, discountAccountId: refs.accounts.discounts.id, totalCents: invoiceTotal,
      } : null,
      payments,
      depositAccountId: refs.accounts.undeposited.id,
      journal: journalLines.length ? { lines: journalLines } : null,
      reconciliation,
      balanced,
      blockers,
      handEntered: hand ? { id: hand.Id, docNumber: hand.DocNumber ?? hand.Id, txnDate: hand.TxnDate, totalAmt: hand.TotalAmt } : null,
      alreadyPosted: mine ? { id: mine.Id, docNumber: mine.DocNumber ?? mine.Id } : null,
    },
    mappings,
    candidates,
    retailItems: sellable.filter(i => i.FullyQualifiedName.startsWith('RETAIL SALES:')).map(ref).sort((a, b) => a.name.localeCompare(b.name)),
  }
}

// ── Posting ─────────────────────────────────────────────────────────────────
// Posting is OFF unless CLOVER_SALES_POSTING_FROM names the first business day
// the app owns. Every day before it was entered by hand, and refusing it here
// is what keeps the handoff from Jill's manual entry from booking a day twice.
// Charlie, 2026-09-26: not to be turned on until Jill is done.
export function postingFrom(): string | null {
  const v = process.env.CLOVER_SALES_POSTING_FROM?.trim()
  return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null
}

export type DayStatus = 'posting' | 'posted' | 'error'

export interface DayRow {
  business_date: string
  status: DayStatus
  fingerprint: string
  last_fingerprint: string | null
  changed_after_post: boolean
  summary: DaySummary
  proposal: Proposal
  qbo_invoice_id: string | null
  qbo_invoice_doc: string | null
  qbo_payment_ids: string[]
  qbo_journal_id: string | null
  approved_by: string | null
  posted_at: string | null
  last_checked_at: string | null
  error: string | null
}

async function log(date: string, step: string, status: 'ok' | 'error', extra: {
  qboId?: string; amountCents?: number; request?: unknown; error?: string; actor?: string
} = {}) {
  const { error } = await supabaseAdmin.from('clover_daily_sales_log').insert({
    business_date: date, step, status,
    qbo_id: extra.qboId ?? null, amount_cents: extra.amountCents ?? null,
    request: extra.request ?? null, error: extra.error ?? null, actor: extra.actor ?? null,
  })
  // The QuickBooks write already happened; a failed log line is reported, not fatal.
  if (error) console.error(`clover_daily_sales_log insert failed (${date} ${step}): ${error.message}`)
}

async function okSteps(date: string): Promise<Map<string, string>> {
  const { data } = await supabaseAdmin
    .from('clover_daily_sales_log')
    .select('step, qbo_id')
    .eq('business_date', date)
    .eq('status', 'ok')
  return new Map((data ?? []).filter(r => r.qbo_id).map(r => [r.step as string, r.qbo_id as string]))
}

const dollars = (c: number) => Math.round(c) / 100

function invoiceBody(p: NonNullable<Proposal['invoice']>, note: string, docNumber: string) {
  const Line: Record<string, unknown>[] = p.lines.map(l => ({
    DetailType: 'SalesItemLineDetail',
    Amount: dollars(l.amountCents),
    Description: l.description,
    SalesItemLineDetail: {
      ItemRef: { value: l.qboItemId },
      Qty: Math.round(l.qty * 1000) / 1000,
      TaxCodeRef: { value: 'NON' },
      // QuickBooks checks Amount = Qty × UnitPrice; Jill's lines carry
      // unrounded unit prices (26.4874652) for the same reason.
      UnitPrice: l.qty ? Math.round((l.amountCents / 100 / (Math.round(l.qty * 1000) / 1000)) * 1e7) / 1e7 : dollars(l.amountCents),
    },
  }))
  if (p.discountCents > 0) {
    Line.push({
      DetailType: 'DiscountLineDetail',
      Amount: dollars(p.discountCents),
      DiscountLineDetail: { PercentBased: false, DiscountAccountRef: { value: p.discountAccountId } },
    })
  }
  return { CustomerRef: { value: p.customerId }, TxnDate: p.txnDate, DocNumber: docNumber, PrivateNote: note, Line }
}

export class PostRefused extends Error {}

/**
 * Post one approved day. Each QuickBooks write is logged; a failure part-way
 * leaves the day in 'error' and a second approval resumes from the first step
 * that didn't land (never repeats one that did). QuickBooks' requestid makes a
 * retried request return the original result instead of writing again.
 */
export async function postDay(opts: {
  summary: DaySummary
  built: DayProposal
  approvedFingerprint: string
  approvedBy: string
}): Promise<DayRow> {
  const { summary: s, built, approvedFingerprint, approvedBy } = opts
  const p = built.proposal
  const from = postingFrom()
  if (!from) throw new PostRefused('Posting to QuickBooks is switched off (CLOVER_SALES_POSTING_FROM is not set). Register sales are still entered by hand.')
  if (s.date < from) throw new PostRefused(`${s.date} is before ${from}, the first day the app posts — earlier days were entered by hand.`)
  if (s.fingerprint !== approvedFingerprint) throw new PostRefused('Clover\'s numbers for this day changed since the page loaded. Reload and review again.')
  if (p.blockers.length) throw new PostRefused(`Not ready to post: ${p.blockers.join(' · ')}`)

  // Claim the day. business_date is the primary key, so two presses (or two
  // people) can't both get here; an 'error' row may be resumed by its owner.
  const { data: existing, error: readErr } = await supabaseAdmin
    .from('clover_daily_sales').select('*').eq('business_date', s.date).maybeSingle()
  if (readErr) throw new Error(`Can't read the posting record: ${readErr.message}`)
  if (existing && existing.status !== 'error') throw new PostRefused(`${s.date} is already ${existing.status}.`)
  if (existing && existing.fingerprint !== s.fingerprint) {
    throw new PostRefused(`${s.date} failed part-way on different Clover numbers — a person needs to finish it in QuickBooks, not a re-post.`)
  }
  const claim = {
    business_date: s.date, status: 'posting' as const, fingerprint: s.fingerprint, last_fingerprint: s.fingerprint,
    summary: s, proposal: p, approved_by: approvedBy, error: null, updated_at: new Date().toISOString(),
  }
  const { error: claimErr } = existing
    ? await supabaseAdmin.from('clover_daily_sales').update(claim).eq('business_date', s.date).eq('status', 'error')
    : await supabaseAdmin.from('clover_daily_sales').insert(claim)
  if (claimErr) throw new PostRefused(`Could not claim ${s.date} for posting (${claimErr.message}) — someone else may be posting it.`)
  await log(s.date, 'claim', 'ok', { actor: approvedBy, request: { fingerprint: s.fingerprint } })

  const done = await okSteps(s.date)
  const note = `${p.marker} Clover register sales for ${s.date} (Mountain Time). Posted by the CMC app, approved by ${approvedBy}. Clover fingerprint ${s.fingerprint}.`
  const rid = (step: string) => `clv-${s.date}-${step}-${s.fingerprint.slice(0, 8)}`
  let invoiceId = done.get('invoice') ?? null
  let invoiceDoc: string | null = null
  const paymentIds: string[] = []
  let journalId = done.get('journal') ?? null
  let step = 'invoice'

  try {
    if (p.invoice && !invoiceId) {
      const body = invoiceBody(p.invoice, note, await nextInvoiceNumber())
      const res = await qboFetch<{ Invoice: { Id: string; DocNumber?: string; TotalAmt: number } }>(`invoice?requestid=${rid('invoice')}`, { method: 'POST', body: JSON.stringify(body) })
      invoiceId = res.Invoice.Id
      invoiceDoc = res.Invoice.DocNumber ?? null
      await log(s.date, 'invoice', 'ok', { qboId: invoiceId, amountCents: p.invoice.totalCents, request: body, actor: approvedBy })
      // Automated sales tax is on in this company. Montana has none, and the
      // lines go in as NON, but if QuickBooks added anything the payments
      // would no longer match — stop before they go on.
      if (Math.round(res.Invoice.TotalAmt * 100) !== p.invoice.totalCents) {
        throw new Error(`QuickBooks totalled invoice ${invoiceDoc ?? invoiceId} at $${res.Invoice.TotalAmt.toFixed(2)}, not $${(p.invoice.totalCents / 100).toFixed(2)} — fix it in QuickBooks before payments are applied`)
      }
    }
    for (const pay of p.payments) {
      step = `payment:${pay.tender}`
      const prior = done.get(step)
      if (prior) { paymentIds.push(prior); continue }
      if (!invoiceId) throw new Error('No invoice to apply the payment to')
      const body = {
        CustomerRef: { value: p.invoice!.customerId },
        TxnDate: s.date,
        TotalAmt: dollars(pay.amountCents),
        DepositToAccountRef: { value: p.depositAccountId },
        ...(pay.paymentMethodId ? { PaymentMethodRef: { value: pay.paymentMethodId } } : {}),
        PaymentRefNum: pay.refNum.slice(0, 21),
        PrivateNote: `${p.marker} ${pay.label} taken on the Clover register ${s.date}.`,
        Line: [{ Amount: dollars(pay.amountCents), LinkedTxn: [{ TxnId: invoiceId, TxnType: 'Invoice' }] }],
      }
      const res = await qboFetch<{ Payment: { Id: string } }>(`payment?requestid=${rid(`pay-${pay.tender}`)}`, { method: 'POST', body: JSON.stringify(body) })
      paymentIds.push(res.Payment.Id)
      await log(s.date, step, 'ok', { qboId: res.Payment.Id, amountCents: pay.amountCents, request: body, actor: approvedBy })
    }
    if (p.journal && !journalId) {
      step = 'journal'
      const body = {
        TxnDate: s.date,
        PrivateNote: note,
        Line: p.journal.lines.map(l => ({
          DetailType: 'JournalEntryLineDetail',
          Amount: dollars(l.amountCents),
          Description: l.description,
          JournalEntryLineDetail: { PostingType: l.posting, AccountRef: { value: l.accountId } },
        })),
      }
      const res = await qboFetch<{ JournalEntry: { Id: string } }>(`journalentry?requestid=${rid('journal')}`, { method: 'POST', body: JSON.stringify(body) })
      journalId = res.JournalEntry.Id
      await log(s.date, 'journal', 'ok', { qboId: journalId, amountCents: p.journal.lines.filter(l => l.posting === 'Debit').reduce((x, l) => x + l.amountCents, 0), request: body, actor: approvedBy })
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await log(s.date, step, 'error', { error: msg, actor: approvedBy })
    await supabaseAdmin.from('clover_daily_sales').update({
      status: 'error', error: `${step} failed: ${msg}`,
      qbo_invoice_id: invoiceId, ...(invoiceDoc ? { qbo_invoice_doc: invoiceDoc } : {}), qbo_payment_ids: paymentIds, qbo_journal_id: journalId, updated_at: new Date().toISOString(),
    }).eq('business_date', s.date)
    throw new Error(`Posting ${s.date} stopped at ${step}: ${msg}. What did post is logged; press Approve again to finish the rest.`)
  }

  const now = new Date().toISOString()
  const row = {
    status: 'posted' as const, error: null, posted_at: now, last_checked_at: now, changed_after_post: false,
    qbo_invoice_id: invoiceId, qbo_invoice_doc: invoiceDoc, qbo_payment_ids: paymentIds, qbo_journal_id: journalId, updated_at: now,
  }
  const { data, error } = await supabaseAdmin.from('clover_daily_sales').update(row).eq('business_date', s.date).select('*').single()
  if (error) throw new Error(`Posted to QuickBooks, but saving the record failed: ${error.message}. Do NOT post again — the QuickBooks entries carry ${p.marker}.`)
  await log(s.date, 'posted', 'ok', { qboId: invoiceId ?? journalId ?? undefined, amountCents: s.totals.netCents, actor: approvedBy })
  return data as DayRow
}

/** Re-read of a day: if it was posted and Clover's numbers have since moved
 *  (a late refund, an edited ticket), flag it for a person. Never re-posts. */
export async function noteRecheck(s: DaySummary): Promise<DayRow | null> {
  const { data } = await supabaseAdmin.from('clover_daily_sales').select('*').eq('business_date', s.date).maybeSingle()
  if (!data) return null
  const row = data as DayRow
  const changed = row.status === 'posted' && row.fingerprint !== s.fingerprint
  const now = new Date().toISOString()
  if (changed && !row.changed_after_post) {
    await log(s.date, 'changed-after-post', 'ok', { amountCents: s.totals.netCents - row.summary.totals.netCents, request: { was: row.fingerprint, now: s.fingerprint } })
  }
  await supabaseAdmin.from('clover_daily_sales').update({
    last_fingerprint: s.fingerprint, last_checked_at: now, changed_after_post: changed,
  }).eq('business_date', s.date)
  return { ...row, last_fingerprint: s.fingerprint, last_checked_at: now, changed_after_post: changed }
}

export async function listDays(fromISO: string, toISO: string): Promise<DayRow[]> {
  const { data, error } = await supabaseAdmin
    .from('clover_daily_sales')
    .select('business_date, status, fingerprint, last_fingerprint, changed_after_post, qbo_invoice_id, qbo_invoice_doc, qbo_payment_ids, qbo_journal_id, approved_by, posted_at, last_checked_at, error, summary')
    .gte('business_date', fromISO).lte('business_date', toISO)
    .order('business_date', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []) as DayRow[]
}
