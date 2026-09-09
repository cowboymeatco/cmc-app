export const runtime = 'edge'
import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { fetchAnimalProgress, STAGE_RANK, type AnimalStage } from '@/lib/animalProgress'
import { getInvoicesSince, type DatedInvoice } from '@/lib/qboInvoices'
import { nameKey } from '@/lib/nameKey'

export const dynamic = 'force-dynamic'

// GET /api/pipeline — every account with animals in the building, where each
// one is and how long it has been here.
//
// Charlie (2026-09-09): "a gantt chart of every account that is active in
// the facility ... what stage they are in and how long they have been there
// ... what animals are closest to the finish line to get paid."
//
// One row per harvest appointment that has been received and not picked up.
// Stage is DERIVED from the records the crew writes anyway (receiving log,
// harvest log, cut schedule, packing session) — see lib/animalProgress.ts.
// Appointments the paper trail stopped on (harvested weeks ago, never scanned
// into a session) are flagged trail_cold rather than shown as still hanging.

// What QuickBooks says about the money on this animal. 'none' is "no invoice
// found", which is not "paid" — the status says which it is, and a QBO outage
// comes back as 'unknown' rather than a page full of "not invoiced".
export interface PipelineBilling {
  status: 'paid' | 'open' | 'none' | 'unknown'
  invoices: number
  total: number
  balance: number
  doc_numbers: string[]
  latest_date: string | null
  matched_by: 'link' | 'name' | null
}

export interface PipelineRow {
  id: string
  account: string
  customers: string[]
  species: string
  head_count: number
  harvest_date: string | null
  appointment_status: string
  stage: AnimalStage
  stage_rank: number
  received_at: string | null
  harvested_at: string | null
  cut_date: string | null
  cut_date_planned: boolean
  session_at: string | null
  ready_at: string | null
  hanging_weight_lbs: number | null
  days_in: number | null
  trail_cold: boolean
  sessions: { customer_name: string; session_date: string; status: string }[]
  billing: PipelineBilling
}

// Invoices for the window, indexed two ways: by QBO customer id (exact, via
// producer_qbo_links / customer_qbo_links) and by name key (the same
// normalisation the receivables view uses). Read once per request.
async function loadInvoiceIndex(sinceISO: string) {
  const byId = new Map<string, DatedInvoice[]>()
  const byName = new Map<string, DatedInvoice[]>()
  let ok = true
  try {
    const invoices = await getInvoicesSince(sinceISO)
    for (const inv of invoices) {
      if (inv.customerId) (byId.get(inv.customerId) ?? byId.set(inv.customerId, []).get(inv.customerId)!).push(inv)
      const k = nameKey(inv.customerName)
      if (k) (byName.get(k) ?? byName.set(k, []).get(k)!).push(inv)
    }
  } catch (e) {
    console.error('pipeline: QBO invoices unavailable —', e instanceof Error ? e.message : e)
    ok = false
  }
  const linkByProducer = new Map<string, string>()
  const linkByCustomer = new Map<string, string>()
  try {
    const [p, c] = await Promise.all([
      supabaseAdmin.from('producer_qbo_links').select('producer_name, qbo_customer_id'),
      supabaseAdmin.from('customer_qbo_links').select('customer_name, qbo_customer_id'),
    ])
    for (const r of (p.data ?? []) as { producer_name: string; qbo_customer_id: string }[]) linkByProducer.set(nameKey(r.producer_name), r.qbo_customer_id)
    for (const r of (c.data ?? []) as { customer_name: string; qbo_customer_id: string }[]) linkByCustomer.set(nameKey(r.customer_name), r.qbo_customer_id)
  } catch { /* links are a bonus; names still match */ }
  return { ok, byId, byName, linkByProducer, linkByCustomer }
}

function billingFor(
  idx: Awaited<ReturnType<typeof loadInvoiceIndex>>,
  account: string, customers: string[], harvestDate: string | null,
): PipelineBilling {
  const none: PipelineBilling = { status: idx.ok ? 'none' : 'unknown', invoices: 0, total: 0, balance: 0, doc_numbers: [], latest_date: null, matched_by: null }
  if (!idx.ok) return none

  // Only invoices written for THIS animal: nothing dated more than a week
  // before it was harvested. An old open invoice on the same producer is real
  // money but a different job, and would mislabel a fresh animal as unpaid.
  const floor = harvestDate ? new Date(new Date(harvestDate + 'T12:00:00').getTime() - 7 * 86400000).toLocaleDateString('en-CA') : null

  const names = [account, ...customers].map(nameKey).filter(Boolean)
  const linked = [...new Set([
    ...(names.map(n => idx.linkByProducer.get(n)).filter(Boolean) as string[]),
    ...(names.map(n => idx.linkByCustomer.get(n)).filter(Boolean) as string[]),
  ])]

  let hits: DatedInvoice[] = linked.flatMap(id => idx.byId.get(id) ?? [])
  let matchedBy: PipelineBilling['matched_by'] = hits.length ? 'link' : null
  if (!hits.length) {
    hits = names.flatMap(n => idx.byName.get(n) ?? [])
    matchedBy = hits.length ? 'name' : null
  }
  const seen = new Set<string>()
  hits = hits.filter(h => (!floor || h.txnDate >= floor) && !seen.has(h.id) && seen.add(h.id))
  if (!hits.length) return none

  const total = hits.reduce((s, h) => s + (h.total || 0), 0)
  const balance = hits.reduce((s, h) => s + (h.balance || 0), 0)
  return {
    status: balance > 0.005 ? 'open' : 'paid',
    invoices: hits.length,
    total: Math.round(total * 100) / 100,
    balance: Math.round(balance * 100) / 100,
    doc_numbers: hits.map(h => h.docNumber),
    latest_date: hits.map(h => h.txnDate).sort().pop() ?? null,
    matched_by: matchedBy,
  }
}

type ApptRow = {
  id: string; harvest_date: string | null; species: string | null; head_count: number | null
  source: string | null; status: string | null; customers: { customer_name?: string; portion?: string }[] | null
}

export async function GET() {
  // Six months back covers anything still in a cooler or freezer; older than
  // that with no pickup is a records gap, not an animal.
  const since = new Date(Date.now() - 180 * 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Denver' })
  const { data, error } = await supabase
    .from('harvest_appointments')
    .select('id, harvest_date, species, head_count, source, status, customers')
    .in('status', ['AnimalIn', 'Processing', 'Complete'])
    .gte('harvest_date', since)
    .order('harvest_date', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const appts = (data ?? []) as ApptRow[]
  const [progress, invoiceIdx] = await Promise.all([
    fetchAnimalProgress(supabase, appts.map(a => ({ id: a.id, harvest_date: a.harvest_date }))),
    // A week before the oldest harvest in the window, so a deposit invoice
    // written ahead of the kill still counts.
    loadInvoiceIndex(new Date(Date.parse(since + 'T12:00:00') - 7 * 86400000).toLocaleDateString('en-CA')),
  ])

  const now = Date.now()
  const rows: PipelineRow[] = []
  for (const a of appts) {
    const p = progress.get(a.id)
    if (!p) continue
    if (p.stage === 'picked_up') continue
    // Booked but never received (status flipped by hand) — not in the building.
    if (p.stage === 'scheduled') continue

    const startIso = p.receivedAt ?? p.harvestedAt ?? (a.harvest_date ? a.harvest_date + 'T12:00:00' : null)
    const daysIn = startIso ? Math.max(0, Math.floor((now - Date.parse(startIso)) / 86400000)) : null
    const customers = (a.customers ?? []).map(c => (c.customer_name ?? '').trim()).filter(Boolean)

    rows.push({
      id: a.id,
      account: (a.source ?? '').trim() || customers[0] || 'Unnamed',
      customers,
      species: a.species ?? '',
      head_count: Number(a.head_count) || 0,
      harvest_date: a.harvest_date,
      appointment_status: a.status ?? '',
      stage: p.stage,
      stage_rank: STAGE_RANK.indexOf(p.stage),
      received_at: p.receivedAt,
      harvested_at: p.harvestedAt,
      cut_date: p.cutDate,
      cut_date_planned: p.cutDatePlanned,
      session_at: p.sessionAt,
      ready_at: p.readyAt,
      hanging_weight_lbs: p.hangingWeightLbs,
      days_in: daysIn,
      trail_cold: p.trailCold,
      sessions: p.sessions,
      billing: billingFor(invoiceIdx, (a.source ?? '').trim(), customers, a.harvest_date),
    })
  }

  // Closest to the finish line first, then the ones that have waited longest.
  rows.sort((x, y) => (y.stage_rank - x.stage_rank) || ((y.days_in ?? 0) - (x.days_in ?? 0)))
  return NextResponse.json({ generated_at: new Date().toISOString(), qbo_ok: invoiceIdx.ok, rows })
}
