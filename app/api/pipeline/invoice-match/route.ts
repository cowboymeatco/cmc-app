export const runtime = 'edge'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { fetchAnimalProgress } from '@/lib/animalProgress'
import { getInvoicesSince } from '@/lib/qboInvoices'
import { nameKey } from '@/lib/nameKey'

// Match QuickBooks invoices to an animal by hand — In the Building.
//
// Charlie (2026-09-14): "How do we make it so that the invoices link up with
// the orders? A lot of what I am seeing animals that have been settled out
// already." Every sale is cleared against a QBO invoice in the office, but the
// page could only find it by name, and fair animals are invoiced to the buyer
// ("Prince Inc."), bookings are spelled one way and QBO another ("Jenny
// Stovall" / Jennie Stoval). So a person picks the invoice once, it's stored
// on the appointment, and it wins from then on. Nothing here guesses: the
// candidates are only ranked for the person to choose from.
//
// GET  ?appointment=<id>&q=<search>  → the animal + ranked candidate invoices
// POST { appointment_id, invoices?: [{id, doc_number, customer_id, customer_name}], no_invoice_reason?, picked_up? }
// DELETE ?appointment=<id>&invoice=<qbo id>  → undo one link

interface Candidate {
  id: string
  doc_number: string
  customer_id: string
  customer_name: string
  txn_date: string
  total: number
  balance: number
  score: number
  linked_here: boolean
  linked_to: string | null
}

const tokens = (s: string) => new Set(nameKey(s).split(' ').filter(t => t.length > 1))
// Spaces don't count: QBO's "ROSEBUD CATTLE WOMEN" is the booking's "Rosebud Cattlewomen".
const letters = (s: string) => nameKey(s).replace(/[^A-Z0-9]/g, '').split('').sort().join('')

export async function GET(req: NextRequest) {
  const apptId = req.nextUrl.searchParams.get('appointment')
  const q = (req.nextUrl.searchParams.get('q') ?? '').trim().toLowerCase()
  if (!apptId) return NextResponse.json({ error: 'appointment required' }, { status: 400 })

  const { data: appt } = await supabase
    .from('harvest_appointments').select('id, source, customers, harvest_date, species, head_count, no_invoice_reason').eq('id', apptId).maybeSingle()
  if (!appt) return NextResponse.json({ error: 'appointment not found' }, { status: 404 })

  const progress = (await fetchAnimalProgress(supabase, [{ id: appt.id, harvest_date: appt.harvest_date }])).get(appt.id)
  const customers = ((appt.customers ?? []) as { customer_name?: string }[]).map(c => (c.customer_name ?? '').trim()).filter(Boolean)
  const sessionNames = (progress?.sessions ?? []).map(s => s.customer_name)
  const names = [...new Set([String(appt.source ?? '').trim(), ...customers, ...sessionNames].filter(Boolean))]

  // A month before the kill covers a deposit invoice; nothing older is this animal.
  const since = appt.harvest_date
    ? new Date(Date.parse(appt.harvest_date + 'T12:00:00') - 30 * 86400000).toISOString().slice(0, 10)
    : new Date(Date.now() - 180 * 86400000).toISOString().slice(0, 10)
  let invoices
  try {
    invoices = await getInvoicesSince(since)
  } catch (e) {
    return NextResponse.json({ error: `QuickBooks unavailable — ${e instanceof Error ? e.message : e}` }, { status: 502 })
  }
  const { data: links } = await supabaseAdmin.from('appointment_invoice_links').select('appointment_id, qbo_invoice_id')
  const linkedTo = new Map((links ?? []).map(l => [String(l.qbo_invoice_id), String(l.appointment_id)]))

  const want = names.map(tokens)
  const harvest = appt.harvest_date ? Date.parse(appt.harvest_date + 'T12:00:00') : null
  const candidates: Candidate[] = invoices.map(inv => {
    const have = tokens(inv.customerName)
    // Best share of any one of the animal's names found in the invoice's customer.
    const tokenScore = Math.max(0, ...want.map(w => (w.size ? [...w].filter(t => have.has(t)).length / w.size : 0)))
    const sameLetters = names.some(n => letters(n).length >= 6 && letters(n) === letters(inv.customerName))
    const nameScore = sameLetters ? 1 : tokenScore
    const days = harvest ? (Date.parse(inv.txnDate + 'T12:00:00') - harvest) / 86400000 : 0
    const dateScore = days >= -7 && days <= 120 ? 0.3 : 0
    const owner = linkedTo.get(inv.id) ?? null
    return {
      id: inv.id, doc_number: inv.docNumber, customer_id: inv.customerId, customer_name: inv.customerName,
      txn_date: inv.txnDate, total: inv.total, balance: inv.balance,
      score: Math.round((nameScore + dateScore) * 100) / 100,
      linked_here: owner === appt.id,
      linked_to: owner && owner !== appt.id ? owner : null,
    }
  })

  const shown = candidates
    .filter(c => q
      ? `${c.customer_name} ${c.doc_number}`.toLowerCase().includes(q)
      : c.linked_here || c.score >= 0.5)
    .sort((a, b) => Number(b.linked_here) - Number(a.linked_here) || b.score - a.score || a.txn_date.localeCompare(b.txn_date))
    .slice(0, 25)

  return NextResponse.json({
    appointment: {
      id: appt.id, account: String(appt.source ?? '').trim() || customers[0] || '', customers, species: appt.species,
      head_count: appt.head_count, harvest_date: appt.harvest_date, names, sessions: progress?.sessions ?? [],
      no_invoice_reason: appt.no_invoice_reason ?? null,
    },
    candidates: shown,
  })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const apptId = String(body.appointment_id ?? '')
  if (!apptId) return NextResponse.json({ error: 'appointment_id required' }, { status: 400 })
  const done: string[] = []

  const invoices = Array.isArray(body.invoices) ? body.invoices as { id: string; doc_number?: string; customer_id?: string; customer_name?: string }[] : []
  if (invoices.length) {
    const { error } = await supabaseAdmin.from('appointment_invoice_links').upsert(
      invoices.filter(i => i.id).map(i => ({
        appointment_id: apptId, qbo_invoice_id: String(i.id), doc_number: i.doc_number ?? null,
        qbo_customer_id: i.customer_id ?? null, customer_name: i.customer_name ?? null,
      })),
      { onConflict: 'appointment_id,qbo_invoice_id' })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    done.push(`${invoices.length} invoice${invoices.length !== 1 ? 's' : ''} linked`)
  }

  if (body.no_invoice_reason !== undefined) {
    const reason = body.no_invoice_reason ? String(body.no_invoice_reason).trim().slice(0, 120) : null
    const { error } = await supabaseAdmin.from('harvest_appointments').update({ no_invoice_reason: reason }).eq('id', apptId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    done.push(reason ? `no invoice needed (${reason})` : 'no-invoice note cleared')
  }

  // Settled and gone: close its sessions out, or — when nothing was ever
  // packed into a session — mark the appointment handed off.
  if (body.picked_up) {
    const { data: appt } = await supabase.from('harvest_appointments').select('id, harvest_date').eq('id', apptId).maybeSingle()
    const progress = appt ? (await fetchAnimalProgress(supabase, [{ id: appt.id, harvest_date: appt.harvest_date }])).get(appt.id) : null
    const open = (progress?.sessions ?? []).filter(s => s.status !== 'picked_up')
    for (const s of open) {
      await supabase.from('processing_sessions').update({ status: 'picked_up', updated_at: new Date().toISOString() })
        .eq('customer_name', s.customer_name).eq('session_date', s.session_date)
    }
    if (!(progress?.sessions ?? []).length) {
      await supabaseAdmin.from('harvest_appointments')
        .update({ handed_off_at: new Date().toISOString(), handed_off_note: 'Marked picked up when its invoice was matched on In the Building' })
        .eq('id', apptId).is('handed_off_at', null)
    }
    done.push(open.length ? `${open.length} session${open.length !== 1 ? 's' : ''} marked picked up` : 'marked picked up')
  }

  return NextResponse.json({ ok: true, done })
}

export async function DELETE(req: NextRequest) {
  const apptId = req.nextUrl.searchParams.get('appointment')
  const invoiceId = req.nextUrl.searchParams.get('invoice')
  if (!apptId || !invoiceId) return NextResponse.json({ error: 'appointment and invoice required' }, { status: 400 })
  const { error } = await supabaseAdmin.from('appointment_invoice_links').delete().eq('appointment_id', apptId).eq('qbo_invoice_id', invoiceId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
