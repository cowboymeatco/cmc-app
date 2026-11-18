// ──────────────────────────────────────────────────────────────────────────────
// Register payments → QuickBooks Receive Payment. SERVER-ONLY.
//
// The register sync puts an open ticket on Clover for every open invoice
// ("ROB ERICKSON — INV 2980C"). When a customer pays that ticket at the
// counter, nothing told QuickBooks: the invoice stayed open until someone keyed
// a Receive Payment by hand, and until then the card deposit (lib/qboDeposits)
// couldn't be built because the payment wasn't in Undeposited Funds.
//
// This records that payment. Rules (Charlie, 2026-11-17):
//   - every tender: card, cash, check, gift card. On account is never money in.
//   - into Undeposited Funds, with the tender's payment method, so the card
//     batch and the cash/check slip deposit it exactly as before.
//   - a ticket paid short is recorded for what was paid; the rest stays open.
//
// It reads the same DaySummary as the Daily Sales page (lib/cloverSales), so
// the money it records is the money that page shows as "Receive $X against …".
//
// TEST MODE is the default. Until RINGUP_PAYMENTS_POSTING_FROM is set to a
// date, everything here only plans: it reads Clover and QuickBooks and says
// what it WOULD record, and writes nothing anywhere.
//
// Live, every payment is protected three ways against being recorded twice:
//   1. ringup_payment_log, unique on (order, line, tender), claimed BEFORE the
//      QuickBooks write;
//   2. a QuickBooks requestid built from the same key, so a retried request
//      returns the original payment instead of making a second;
//   3. a marker in the payment memo, checked against the customer's recent
//      payments, so the app finds its own work even if its log were lost.
// And right before posting, the invoice balance is read again: an invoice
// someone already marked paid by hand is skipped.
//
// Anything it can't be sure of is flagged for a person, never guessed:
// a ticket that also carries hand-keyed or gift-card lines, a split ticket
// paying two invoices short, an unknown tender, an invoice number that matches
// zero or several invoices, a balance lower than the ticket (likely already
// recorded by hand).
// ──────────────────────────────────────────────────────────────────────────────

import { qboFetch } from '@/lib/qbo'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { readCloverDay, TENDER_LABEL, type DaySummary, type DayMoneyLine, type TenderKind } from '@/lib/cloverSales'
import { ACCOUNTS, PAYMENT_METHODS } from '@/lib/qboDailySales'

export const LOG_TABLE = 'ringup_payment_log'

const RECORDABLE: TenderKind[] = ['card', 'cash', 'check', 'gift_card']

/** First shop day the app records live. Unset = test mode. */
export function ringUpPostingFrom(): string | null {
  const v = process.env.RINGUP_PAYMENTS_POSTING_FROM?.trim()
  return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null
}

export function isLive(date: string): boolean {
  const from = ringUpPostingFrom()
  return !!from && date >= from
}

export type PaymentAction = 'record' | 'skip' | 'flag'

export interface RingUpPaymentDecision {
  date: string
  orderId: string
  lineId: string
  docNumber: string
  customerName: string | null
  tender: TenderKind
  tenderLabel: string
  amountCents: number          // what would be (or was) recorded
  ticketCents: number          // what the register line said
  paidCents: number            // what the register took for this invoice on this tender
  invoiceId: string | null
  customerId: string | null
  balanceCents: number | null  // QuickBooks balance when read
  action: PaymentAction
  reason: string
  key: string                  // order:line:tender — the duplicate key
  requestId: string
  marker: string
}

interface QueryRes<T> { QueryResponse: Record<string, T[] | undefined> }
const q = (s: string) => `query?query=${encodeURIComponent(s)}`
const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
const fmt = (c: number) => `$${(c / 100).toFixed(2)}`
const dollars = (c: number) => Math.round(c) / 100

interface QboInvoiceLite {
  Id: string
  DocNumber?: string
  CustomerRef: { value: string; name?: string }
  Balance: number
  TotalAmt: number
}

interface QboPaymentLite {
  Id: string
  TxnDate: string
  TotalAmt: number
  PrivateNote?: string
}

export const paymentKey = (orderId: string, lineId: string, tender: TenderKind) => `${orderId}:${lineId}:${tender}`
// QuickBooks caps requestid at 50 characters; Clover ids are 13.
const requestIdOf = (orderId: string, lineId: string, tender: TenderKind) => `rup-${orderId}-${lineId}-${tender}`.slice(0, 50)
const markerOf = (key: string) => `[clover-ringup ${key}]`

// ── Step 1: what the register took for each invoice, by tender ──────────────
interface Part { line: DayMoneyLine; tender: TenderKind; paidCents: number }
interface Problem { line: DayMoneyLine; reason: string }

function splitByTender(s: DaySummary): { parts: Part[]; problems: Problem[] } {
  const parts: Part[] = []
  const problems: Problem[] = []

  const byOrder = new Map<string, DayMoneyLine[]>()
  for (const l of s.invoicePayments) byOrder.set(l.orderId, [...(byOrder.get(l.orderId) ?? []), l])

  const otherNonSale = new Set([...s.handKeyed, ...s.giftCardsSold].map(l => l.orderId))

  for (const [orderId, lines] of byOrder) {
    const flagAll = (reason: string) => { for (const line of lines) problems.push({ line, reason }) }

    // The day summary already said this order needs a person (paid short with
    // retail on it, split on account, overcharged …). Don't second-guess it.
    const personWarning = s.warnings.find(w => new RegExp(`^Order ${orderId}[\\s:(]`).test(w) && w.includes('needs a person'))
    if (personWarning) { flagAll(personWarning.replace(/^Order \S+:?\s*/, '')); continue }

    if (otherNonSale.has(orderId)) {
      flagAll('the ticket also carries hand-keyed or gift-card lines, so the invoice share is unclear — needs a person')
      continue
    }

    const alloc = s.orderNonSale[orderId]
    if (!alloc) { flagAll('could not tell what the register took for this ticket — needs a person'); continue }

    const tenders = (Object.entries(alloc) as [TenderKind, number][]).filter(([, c]) => c > 0)
    const bad = tenders.filter(([k]) => !RECORDABLE.includes(k))
    if (bad.length) {
      flagAll(`paid partly by ${bad.map(([k]) => TENDER_LABEL[k].toLowerCase()).join(', ')} — needs a person`)
      continue
    }
    if (!tenders.length) { flagAll('nothing was taken for this ticket'); continue }

    if (lines.length === 1) {
      for (const [tender, cents] of tenders) parts.push({ line: lines[0], tender, paidCents: cents })
      continue
    }

    // Several invoices on one ticket. Only safe when paid exactly: then each
    // invoice gets its own line amount, filled from the largest tender first
    // (the same order the Daily Sales split uses).
    const paid = tenders.reduce((x, [, c]) => x + c, 0)
    const owed = lines.reduce((x, l) => x + l.amountCents, 0)
    if (paid !== owed) {
      flagAll(`${lines.length} invoices on one ticket, paid ${fmt(paid)} against ${fmt(owed)} — which invoice gets what needs a person`)
      continue
    }
    const left = tenders.sort((a, b) => b[1] - a[1]).map(([k, c]) => ({ k, c }))
    for (const line of lines) {
      let need = line.amountCents
      for (const t of left) {
        if (!need) break
        const take = Math.min(t.c, need)
        if (take > 0) { parts.push({ line, tender: t.k, paidCents: take }); t.c -= take; need -= take }
      }
    }
  }
  return { parts, problems }
}

// ── Step 2: match each to its QuickBooks invoice and decide ─────────────────
async function invoicesByDoc(docs: string[]): Promise<Map<string, QboInvoiceLite[]>> {
  const out = new Map<string, QboInvoiceLite[]>()
  const unique = [...new Set(docs.filter(Boolean))]
  for (let i = 0; i < unique.length; i += 50) {
    const chunk = unique.slice(i, i + 50)
    const res = await qboFetch<QueryRes<QboInvoiceLite>>(q(`select * from Invoice where DocNumber in (${chunk.map(d => `'${esc(d)}'`).join(', ')})`))
    for (const inv of res.QueryResponse.Invoice ?? []) {
      const d = inv.DocNumber ?? ''
      out.set(d, [...(out.get(d) ?? []), inv])
    }
  }
  return out
}

/** Log status by key, for keys the app has touched live. A missing table
 *  (test mode) reads as none. */
async function loggedKeys(keys: string[]): Promise<Map<string, string>> {
  if (!keys.length) return new Map()
  const { data, error } = await supabaseAdmin.from(LOG_TABLE).select('key, status').in('key', keys)
  if (error) return new Map()
  return new Map((data ?? []).map(r => [r.key as string, r.status as string]))
}

/** The app's own payments for a customer since a date, by memo marker. */
async function markersFor(customerId: string, sinceISO: string): Promise<Set<string>> {
  const res = await qboFetch<QueryRes<QboPaymentLite>>(q(`select * from Payment where CustomerRef = '${esc(customerId)}' and TxnDate >= '${sinceISO}' maxresults 200`))
  const found = new Set<string>()
  for (const p of res.QueryResponse.Payment ?? []) {
    for (const m of (p.PrivateNote ?? '').matchAll(/\[clover-ringup ([^\]]+)\]/g)) found.add(m[1])
  }
  return found
}

export async function planRingUpPayments(s: DaySummary): Promise<RingUpPaymentDecision[]> {
  const { parts, problems } = splitByTender(s)
  const docs = [...parts, ...problems].map(p => p.line.docNumber ?? '')
  const [invoices, done] = await Promise.all([
    invoicesByDoc(docs),
    loggedKeys(parts.map(p => paymentKey(p.line.orderId, p.line.lineId, p.tender))),
  ])
  const markers = new Map<string, Set<string>>()

  const base = (line: DayMoneyLine, tender: TenderKind, paidCents: number) => {
    const key = paymentKey(line.orderId, line.lineId, tender)
    const matches = invoices.get(line.docNumber ?? '') ?? []
    const inv = matches.length === 1 ? matches[0] : null
    return {
      date: s.date, orderId: line.orderId, lineId: line.lineId, docNumber: line.docNumber ?? '',
      customerName: inv?.CustomerRef.name ?? null, tender, tenderLabel: TENDER_LABEL[tender],
      amountCents: 0, ticketCents: line.amountCents, paidCents,
      invoiceId: inv?.Id ?? null, customerId: inv?.CustomerRef.value ?? null,
      balanceCents: inv ? Math.round(inv.Balance * 100) : null,
      key, requestId: requestIdOf(line.orderId, line.lineId, tender), marker: markerOf(key),
    }
  }

  const out: RingUpPaymentDecision[] = []
  for (const p of problems) {
    out.push({ ...base(p.line, p.line.tender, 0), action: 'flag', reason: p.reason })
  }

  // Parts for the same invoice are judged together against its balance.
  const byLine = new Map<string, Part[]>()
  for (const p of parts) byLine.set(p.line.lineId, [...(byLine.get(p.line.lineId) ?? []), p])

  for (const group of byLine.values()) {
    const line = group[0].line
    const matches = invoices.get(line.docNumber ?? '') ?? []
    const decide = (p: Part, action: PaymentAction, reason: string, amountCents = 0): RingUpPaymentDecision =>
      ({ ...base(p.line, p.tender, p.paidCents), action, reason, amountCents })

    if (matches.length !== 1) {
      const why = matches.length ? `${matches.length} QuickBooks invoices are numbered ${line.docNumber}` : `no QuickBooks invoice numbered ${line.docNumber}`
      for (const p of group) out.push(decide(p, 'flag', `${why} — needs a person`))
      continue
    }
    const inv = matches[0]

    // Already recorded by the app (log, or memo marker as the backstop).
    let mine = markers.get(inv.CustomerRef.value)
    if (!mine) {
      try { mine = await markersFor(inv.CustomerRef.value, s.date) } catch { mine = new Set() }
      markers.set(inv.CustomerRef.value, mine)
    }
    const fresh: Part[] = []
    for (const p of group) {
      const key = paymentKey(p.line.orderId, p.line.lineId, p.tender)
      if (done.get(key) === 'recorded' || mine.has(key)) out.push(decide(p, 'skip', 'already recorded by the app', p.paidCents))
      // A claim with no result: a run died mid-write. QuickBooks may or may not
      // have it, so a person checks rather than the app guessing.
      else if (done.get(key) === 'posting') out.push(decide(p, 'flag', 'an earlier run started recording this and did not finish — check QuickBooks; needs a person'))
      else fresh.push(p)
    }
    if (!fresh.length) continue

    const balance = Math.round(inv.Balance * 100)
    const paid = fresh.reduce((x, p) => x + p.paidCents, 0)

    if (balance <= 0) {
      for (const p of fresh) out.push(decide(p, 'skip', `invoice ${line.docNumber} is already paid in QuickBooks`))
      continue
    }
    if (paid <= balance) {
      const rest = balance - paid
      const split = fresh.length > 1 ? ` (part of ${fmt(paid)} split across tenders)` : ''
      for (const p of fresh) {
        out.push(decide(p, 'record',
          `${fmt(p.paidCents)} ${TENDER_LABEL[p.tender].toLowerCase()}${split}${rest > 0 ? `; ${fmt(rest)} stays open` : ', pays it off'}`,
          p.paidCents))
      }
      continue
    }
    // The register took more than QuickBooks says is owed.
    if (balance === line.amountCents && fresh.length === 1) {
      // Customer paid over the ticket. Record the balance; the extra is for a person.
      const p = fresh[0]
      out.push(decide(p, 'record', `paid ${fmt(paid)} on a ${fmt(balance)} balance — recording ${fmt(balance)}; the extra ${fmt(paid - balance)} needs a person`, balance))
      continue
    }
    for (const p of fresh) {
      out.push(decide(p, 'flag', `QuickBooks balance is ${fmt(balance)} but the register took ${fmt(paid)} — maybe already recorded by hand; needs a person`))
    }
  }

  const rank: Record<PaymentAction, number> = { flag: 0, record: 1, skip: 2 }
  return out.sort((a, b) => rank[a.action] - rank[b.action] || a.docNumber.localeCompare(b.docNumber))
}

// ── Step 3: record (live only) ──────────────────────────────────────────────
export interface RunResult {
  date: string
  live: boolean
  decisions: RingUpPaymentDecision[]
  recorded: { key: string; qboPaymentId: string }[]
  errors: { key: string; error: string }[]
}

export class PostingRefused extends Error {}

async function refs(): Promise<{ undepositedId: string; methods: Partial<Record<TenderKind, string>> }> {
  const [acct, pm] = await Promise.all([
    qboFetch<QueryRes<{ Id: string; FullyQualifiedName: string; Active: boolean }>>(q(`select Id, FullyQualifiedName, Active from Account where Name = '${esc(ACCOUNTS.undeposited)}'`)),
    qboFetch<QueryRes<{ Id: string; Name: string; Active: boolean }>>(q('select Id, Name, Active from PaymentMethod')),
  ])
  const uf = (acct.QueryResponse.Account ?? []).filter(a => a.Active && a.FullyQualifiedName === ACCOUNTS.undeposited)
  if (uf.length !== 1) throw new Error(`Expected one active QuickBooks account "${ACCOUNTS.undeposited}", found ${uf.length}`)
  const methods: Partial<Record<TenderKind, string>> = {}
  for (const [kind, name] of Object.entries(PAYMENT_METHODS) as [TenderKind, string][]) {
    const m = (pm.QueryResponse.PaymentMethod ?? []).find(x => x.Active && x.Name === name)
    if (m) methods[kind] = m.Id
  }
  return { undepositedId: uf[0].Id, methods }
}

/**
 * Plan a day and, when live, record what the plan says to record. In test mode
 * this is exactly planRingUpPayments: nothing is written anywhere.
 */
export async function runRingUpPayments(date: string, triggeredBy: 'cron' | 'manual'): Promise<RunResult> {
  const s = await readCloverDay(date)
  const decisions = await planRingUpPayments(s)
  const result: RunResult = { date, live: isLive(date), decisions, recorded: [], errors: [] }
  if (!result.live) return result

  const todo = decisions.filter(d => d.action === 'record')
  if (!todo.length) return result
  const r = await refs()

  for (const d of todo) {
    if (!d.invoiceId || !d.customerId) continue
    // Claim first. The unique key means a second run (or a second press) can't
    // get past this line for the same payment.
    const { error: claimErr } = await supabaseAdmin.from(LOG_TABLE).insert({
      key: d.key, business_date: d.date, clover_order_id: d.orderId, clover_line_id: d.lineId, tender: d.tender,
      doc_number: d.docNumber, qbo_invoice_id: d.invoiceId, qbo_customer_id: d.customerId, customer_name: d.customerName,
      amount_cents: d.amountCents, status: 'posting', reason: d.reason, triggered_by: triggeredBy,
    })
    if (claimErr) {
      if (claimErr.code !== '23505') {
        // No table, no permission: stop before anything reaches QuickBooks.
        throw new PostingRefused(`Could not write ${LOG_TABLE} (${claimErr.message}) — nothing recorded`)
      }
      // Already claimed. Only a failed earlier attempt may be taken over, and
      // only by flipping it error → posting, so two runs can't both win.
      const { data: retaken } = await supabaseAdmin.from(LOG_TABLE)
        .update({ status: 'posting', error: null, amount_cents: d.amountCents, triggered_by: triggeredBy, updated_at: new Date().toISOString() })
        .eq('key', d.key).eq('status', 'error').select('key')
      if (!retaken?.length) continue
    }

    try {
      // Balance re-read right before the write: someone may have just keyed it.
      const fresh = (await qboFetch<QueryRes<QboInvoiceLite>>(q(`select * from Invoice where Id = '${esc(d.invoiceId)}'`))).QueryResponse.Invoice?.[0]
      const bal = fresh ? Math.round(fresh.Balance * 100) : 0
      if (bal < d.amountCents) throw new Error(`balance is now ${fmt(bal)}, less than ${fmt(d.amountCents)} — not recorded, needs a person`)

      const body = {
        CustomerRef: { value: d.customerId },
        TxnDate: d.date,
        TotalAmt: dollars(d.amountCents),
        DepositToAccountRef: { value: r.undepositedId },
        ...(r.methods[d.tender] ? { PaymentMethodRef: { value: r.methods[d.tender] } } : {}),
        PaymentRefNum: `CLV ${d.orderId}`.slice(0, 21),
        PrivateNote: `${d.marker} ${d.tenderLabel} taken on the Clover register ${d.date} for INV ${d.docNumber}. Recorded by the CMC app.`,
        Line: [{ Amount: dollars(d.amountCents), LinkedTxn: [{ TxnId: d.invoiceId, TxnType: 'Invoice' }] }],
      }
      const res = await qboFetch<{ Payment: { Id: string } }>(`payment?requestid=${encodeURIComponent(d.requestId)}`, { method: 'POST', body: JSON.stringify(body) })
      result.recorded.push({ key: d.key, qboPaymentId: res.Payment.Id })
      await supabaseAdmin.from(LOG_TABLE).update({ status: 'recorded', qbo_payment_id: res.Payment.Id, updated_at: new Date().toISOString() }).eq('key', d.key)
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      result.errors.push({ key: d.key, error })
      // Left as 'error': the next run may take it over (see the claim above).
      await supabaseAdmin.from(LOG_TABLE).update({ status: 'error', error, updated_at: new Date().toISOString() }).eq('key', d.key)
    }
  }
  return result
}

/** Orders whose payment the app has recorded — lets the register sync put a
 *  partly paid invoice's remaining balance back on the register. */
export async function ordersWithRecordedPayment(orderIds: string[]): Promise<Set<string>> {
  if (!orderIds.length) return new Set()
  const { data, error } = await supabaseAdmin.from(LOG_TABLE).select('clover_order_id').in('clover_order_id', orderIds).eq('status', 'recorded')
  if (error) return new Set()
  return new Set((data ?? []).map(r => r.clover_order_id as string))
}
