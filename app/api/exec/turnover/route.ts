export const runtime = 'edge'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { requireExec } from '@/lib/execGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { getInvoicesSince, getInvoicePaidDates } from '@/lib/qboInvoices'

// GET /api/exec/turnover — how long a carcass takes to turn into a bill, and
// then into money.
//
// Charlie's question (2026-08-22): "days from slaughter (first labor) to
// invoice (asking for money) … per species". That's how long the plant's
// money sits in an animal, which is the denominator under profit per head.
// Then (2026-08-24) "can we add a slaughter til invoice paid? That way we know
// when we are getting paid?" — so each animal is followed one step further, to
// the day the invoice that covers it finished being paid.
//
// QuickBooks puts no paid date on an invoice; a zero balance is all it says.
// The date belongs to the Payment that cleared it, read separately and matched
// back through its linked transactions.
//
// The two ends come from different systems with no shared id: the kill date is
// ours, the invoice date is QuickBooks'. They're joined on the payer's NAME,
// normalized the same way exec_name_key() does it for the receivables board —
// upper-cased, trailing hanging weights and tags dropped, words sorted so
// "LAST, FIRST" and "First Last" land together.
//
// Who pays for a carcass, in order of how sure we are:
//   1. the cut customers assigned to that exact carcass
//   2. the customers on its harvest appointment
//   3. the producer, for an animal the plant is buying or a wholesale kill
//
// A payer that's been linked to a QuickBooks customer on /processing joins by
// ID instead, which is exact — so every link Charlie makes there widens this
// number's coverage without anything else changing.
//
// A match is the FIRST invoice to a candidate payer on or after the kill date.
// That is deliberately the earliest ask, not the biggest — but it also means a
// payer we bill constantly (a wholesale account, a retail regular) would match
// some unrelated invoice a day later and report a turnover of ~0. Those are
// dropped rather than averaged in: a payer holding more than BUSY_PAYER
// invoices in the window is reported as ambiguous, not as fast.

const WINDOW_DAYS = 180        // past this an invoice is somebody else's animal
const BUSY_PAYER  = 6          // invoices in the window that make first-after-kill meaningless

/** Same normalization as exec_name_key() in Postgres. Keep the two in step. */
function nameKey(raw: string): string {
  return (raw || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/(\s+[0-9]+[A-Z]?)+\s*$/g, '')
    .trim()
    .split(' ')
    .filter(Boolean)
    .sort()
    .join(' ')
}

const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000)

function median(xs: number[]): number | null {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2)
}

interface ApptCustomer { customer_name?: string }

export async function GET(req: NextRequest) {
  const gate = await requireExec(req)
  if (!gate.ok) return gate.response

  // ?debug=1 lists the carcasses that couldn't be matched and whether their
  // payer appears in QuickBooks at all — the first thing to look at when the
  // coverage line below reads lower than it should.
  const debug  = new URL(req.url).searchParams.get('debug') === '1'
  const misses: { date: string; species: string; names: string[]; knownPayer: boolean }[] = []
  const months = Math.min(36, Math.max(1, Number(new URL(req.url).searchParams.get('months')) || 12))
  const today  = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Denver' })
  const since  = new Date(Date.parse(today) - months * 30.44 * 86_400_000)
    .toISOString().slice(0, 10)

  try {
    const [logsRes, invoices, paidDates] = await Promise.all([
      supabaseAdmin
        .from('harvest_log')
        .select('id, harvest_date, species, appointment_id, producer')
        .gte('harvest_date', since)
        .order('harvest_date'),
      // Invoices can only be written after the kill, and paid no earlier than
      // they were written, so one window covers both.
      getInvoicesSince(since),
      getInvoicePaidDates(since),
    ])
    if (logsRes.error) throw new Error(logsRes.error.message)

    interface LogRow {
      id: string; harvest_date: string; species: string
      appointment_id: string | null; producer: string | null
    }
    const logs = (logsRes.data ?? []) as LogRow[]
    if (!logs.length) {
      return NextResponse.json({ asOf: today, since, months, species: [], overall: null,
        coverage: { carcasses: 0, matched: 0, ambiguous: 0, unmatched: 0 } })
    }

    const logIds  = logs.map(l => l.id)
    const apptIds = [...new Set(logs.map(l => l.appointment_id).filter(Boolean))] as string[]

    const [assignRes, apptRes, custLinkRes, prodLinkRes] = await Promise.all([
      supabaseAdmin.from('carcass_assignments')
        .select('harvest_log_id, customer_name').in('harvest_log_id', logIds),
      apptIds.length
        ? supabaseAdmin.from('harvest_appointments').select('id, customers').in('id', apptIds)
        : Promise.resolve({ data: [], error: null }),
      supabaseAdmin.from('customer_qbo_links').select('customer_name, qbo_customer_id'),
      supabaseAdmin.from('producer_qbo_links').select('producer_name, qbo_customer_id'),
    ])

    // name → QuickBooks customer id, for anyone who's been linked by hand.
    const linkedId = new Map<string, string>()
    for (const l of (prodLinkRes.data ?? []) as { producer_name: string; qbo_customer_id: string }[]) {
      if (l.producer_name && l.qbo_customer_id) linkedId.set(nameKey(l.producer_name), l.qbo_customer_id)
    }
    for (const l of (custLinkRes.data ?? []) as { customer_name: string; qbo_customer_id: string }[]) {
      if (l.customer_name && l.qbo_customer_id) linkedId.set(nameKey(l.customer_name), l.qbo_customer_id)
    }

    const assignedTo = new Map<string, string[]>()
    for (const a of (assignRes.data ?? []) as { harvest_log_id: string; customer_name: string }[]) {
      if (!a.customer_name) continue
      const list = assignedTo.get(a.harvest_log_id) ?? []
      list.push(a.customer_name)
      assignedTo.set(a.harvest_log_id, list)
    }

    const apptCustomers = new Map<string, string[]>()
    for (const a of (apptRes.data ?? []) as { id: string; customers: unknown }[]) {
      const names = (Array.isArray(a.customers) ? a.customers as ApptCustomer[] : [])
        .map(c => (c.customer_name ?? '').trim())
        .filter(Boolean)
      if (names.length) apptCustomers.set(a.id, names)
    }

    // Invoices by payer, in date order, so the first one after a kill is a scan
    // rather than a sort per carcass. Two indexes: the exact one, on
    // QuickBooks' own customer id, and the name-key one for everyone unlinked.
    interface PayerInvoice { id: string; date: string; balance: number }
    const byId   = new Map<string, PayerInvoice[]>()
    const byName = new Map<string, PayerInvoice[]>()
    for (const inv of invoices) {
      const rec: PayerInvoice = { id: inv.id, date: inv.txnDate, balance: inv.balance }
      if (inv.customerId) {
        const l = byId.get(inv.customerId) ?? []
        l.push(rec)
        byId.set(inv.customerId, l)
      }
      const k = nameKey(inv.customerName)
      if (k) {
        const l = byName.get(k) ?? []
        l.push(rec)
        byName.set(k, l)
      }
    }
    for (const list of byId.values())   list.sort((a, b) => a.date.localeCompare(b.date))
    for (const list of byName.values()) list.sort((a, b) => a.date.localeCompare(b.date))

    /** Every invoice we can attribute to this payer, linked id first. */
    const invoicesFor = (name: string): PayerInvoice[] | undefined => {
      const k = nameKey(name)
      const id = linkedId.get(k)
      const byLink = id ? byId.get(id) : undefined
      return byLink ?? byName.get(k)
    }

    type Outcome = 'matched' | 'ambiguous' | 'unmatched'
    // paidDays is null when the invoice hasn't been settled yet — an animal
    // still waiting on money is not a fast one, and averaging it in as though
    // it had been paid today would flatter the number every time it's read.
    interface Hit { species: string; days: number; paidDays: number | null; open: boolean }
    const hits: Hit[] = []
    const tally: Record<Outcome, number> = { matched: 0, ambiguous: 0, unmatched: 0 }
    const unmatchedBySpecies = new Map<string, number>()

    // Animals with a named cut customer are the ones that turn into an invoice
    // at all. A carcass with nobody but a producer on it is usually the plant's
    // own or a wholesale kill, and it's the honest denominator to report
    // coverage against rather than every head that came through the door.
    let withCustomer = 0

    for (const log of logs) {
      const buyers = assignedTo.get(log.id)
        ?? (log.appointment_id ? apptCustomers.get(log.appointment_id) : undefined)
      if (buyers) withCustomer++
      const names = buyers ?? (log.producer ? [log.producer] : [])

      const windowEnd = new Date(Date.parse(log.harvest_date) + WINDOW_DAYS * 86_400_000)
        .toISOString().slice(0, 10)

      let best: { days: number; inv: PayerInvoice } | null = null
      let busy = false
      for (const name of names) {
        const list = invoicesFor(name)
        if (!list) continue
        const inWindow = list.filter(i => i.date >= log.harvest_date && i.date <= windowEnd)
        if (!inWindow.length) continue
        if (inWindow.length > BUSY_PAYER) { busy = true; continue }
        const days = daysBetween(log.harvest_date, inWindow[0].date)
        if (best === null || days < best.days) best = { days, inv: inWindow[0] }
      }

      const outcome: Outcome = best !== null ? 'matched' : busy ? 'ambiguous' : 'unmatched'
      tally[outcome]++
      if (best !== null) {
        // A paid date is only claimed for an invoice that is actually settled.
        // A part-payment means money arrived but the animal isn't paid for, and
        // a zero balance with no payment behind it — a credit memo, a
        // write-off, a journal entry — is closed with no day money landed. Both
        // are left out of the paid median rather than given a date.
        const open   = best.inv.balance > 0
        const paidOn = open ? undefined : paidDates.get(best.inv.id)
        hits.push({
          species:  log.species,
          days:     best.days,
          paidDays: paidOn ? daysBetween(log.harvest_date, paidOn) : null,
          open,
        })
      } else {
        unmatchedBySpecies.set(log.species, (unmatchedBySpecies.get(log.species) ?? 0) + 1)
        if (debug) misses.push({
          date: log.harvest_date, species: log.species, names,
          knownPayer: names.some(n => !!invoicesFor(n)),
        })
      }
    }

    const speciesNames = [...new Set(logs.map(l => l.species))].sort()
    const species = speciesNames.map(sp => {
      const mine = hits.filter(h => h.species === sp)
      const days = mine.map(h => h.days)
      const paid = mine.map(h => h.paidDays).filter((d): d is number => d !== null)
      // Per carcass, not medianPaid minus medianDays — a difference of medians
      // isn't the median of the differences.
      const collect = mine.filter(h => h.paidDays !== null).map(h => h.paidDays! - h.days)
      const head = logs.filter(l => l.species === sp).length
      const sorted = [...days].sort((a, b) => a - b)
      const sortedPaid = [...paid].sort((a, b) => a - b)
      return {
        species:  sp,
        head,                              // carcasses killed in the window
        matched:  days.length,             // …of those, ones we could date an invoice for
        medianDays: median(days),
        fastest:  sorted[0] ?? null,
        slowest:  sorted[sorted.length - 1] ?? null,
        // …and of THOSE, the ones whose invoice has since been paid off.
        paidCount:  paid.length,
        openCount:  mine.filter(h => h.open).length,
        medianPaidDays: median(paid),
        medianCollectDays: median(collect),
        paidFastest: sortedPaid[0] ?? null,
        paidSlowest: sortedPaid[sortedPaid.length - 1] ?? null,
      }
    }).filter(s => s.head > 0)

    return NextResponse.json({
      asOf: today,
      since,
      months,
      windowDays: WINDOW_DAYS,
      overall: {
        medianDays:     median(hits.map(h => h.days)),
        medianPaidDays: median(hits.map(h => h.paidDays).filter((d): d is number => d !== null)),
        medianCollectDays: median(hits.filter(h => h.paidDays !== null).map(h => h.paidDays! - h.days)),
        paidCount:      hits.filter(h => h.paidDays !== null).length,
        openCount:      hits.filter(h => h.open).length,
        invoicesRead:   invoices.length,
        paymentsRead:   paidDates.size,
      },
      coverage: {
        carcasses:    logs.length,
        withCustomer,
        matched:      tally.matched,
        ambiguous:    tally.ambiguous,
        unmatched:    tally.unmatched,
      },
      species,
      ...(debug ? { misses: misses.slice(0, 40), missCount: misses.length,
                    missKnownPayer: misses.filter(m => m.knownPayer).length } : {}),
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
