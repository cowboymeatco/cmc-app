export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// ── Master ERP calendar feed ───────────────────────────────────────────────────
// One flat list of dated events across every operational lane — receiving,
// harvest, processing, smokehouse — so the /calendar page can pivot them into a
// month grid and filter by asset class. Read-only aggregation over tables that
// already carry their own dates; nothing is written here.
//
// GET /api/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD

type Lane = 'receiving' | 'harvest' | 'processing' | 'smokehouse'

interface CalEvent {
  id:        string
  lane:      Lane
  date:      string          // YYYY-MM-DD (the day it sits on the calendar)
  title:     string
  subtitle?: string
  status?:   string
}

const day = (v: string | null | undefined): string => (v ? String(v).slice(0, 10) : '')

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const from = searchParams.get('from') ?? ''
  const to   = searchParams.get('to')   ?? ''
  if (!from || !to) return NextResponse.json({ error: 'from and to required' }, { status: 400 })

  const events: CalEvent[] = []

  const [animals, boxes, appts, sessions, vaJobs] = await Promise.all([
    // Receiving — animals in
    supabase.from('animal_receiving_log')
      .select('id, received_at, ear_tag, sex, breed, status')
      .gte('received_at', `${from}T00:00:00`).lte('received_at', `${to}T23:59:59`),
    // Receiving — box product in
    supabase.from('box_receiving_log')
      .select('id, received_at, vendor, product, quantity, status')
      .gte('received_at', from).lte('received_at', to),
    // Harvest — booked kill days
    supabase.from('harvest_appointments')
      .select('id, harvest_date, species, head_count, status')
      .gte('harvest_date', from).lte('harvest_date', to),
    // Processing — packing sessions
    supabase.from('processing_sessions')
      .select('id, session_date, customer_name, status')
      .gte('session_date', from).lte('session_date', to),
    // Smokehouse — value-add jobs (scheduled by requested date; fall back to completed)
    supabase.from('value_add_jobs')
      .select('id, requested_date, completed_date, customer_name, batch_count, status')
      .or(`and(requested_date.gte.${from},requested_date.lte.${to}),and(completed_date.gte.${from},completed_date.lte.${to})`),
  ])

  for (const r of animals.data ?? []) {
    const d = day(r.received_at as string)
    if (!d) continue
    const who = [r.sex, r.breed].filter(Boolean).join(' ')
    events.push({
      id: `animal-${r.id}`, lane: 'receiving', date: d,
      title: `🐄 Animal in${r.ear_tag ? ` · ${r.ear_tag}` : ''}`,
      subtitle: who || undefined, status: (r.status as string) ?? undefined,
    })
  }

  for (const r of boxes.data ?? []) {
    const d = day(r.received_at as string)
    if (!d) continue
    events.push({
      id: `box-${r.id}`, lane: 'receiving', date: d,
      title: `📦 ${r.vendor || 'Box product'}`,
      subtitle: [r.product, r.quantity ? `×${r.quantity}` : ''].filter(Boolean).join(' ') || undefined,
      status: (r.status as string) ?? undefined,
    })
  }

  for (const r of appts.data ?? []) {
    const d = day(r.harvest_date as string)
    if (!d) continue
    const head = r.head_count ? `${r.head_count} ` : ''
    events.push({
      id: `appt-${r.id}`, lane: 'harvest', date: d,
      title: `${head}${r.species || 'Harvest'}`.trim(),
      status: (r.status as string) ?? undefined,
    })
  }

  for (const r of sessions.data ?? []) {
    const d = day(r.session_date as string)
    if (!d) continue
    events.push({
      id: `sess-${r.id}`, lane: 'processing', date: d,
      title: (r.customer_name as string) || 'Processing',
      status: (r.status as string) ?? undefined,
    })
  }

  for (const r of vaJobs.data ?? []) {
    // Prefer the scheduled (requested) date; a completed-only job lands on its
    // completed date so nothing scheduled goes missing from the calendar.
    const reqIn  = day(r.requested_date as string)
    const compIn = day(r.completed_date as string)
    const d = (reqIn >= from && reqIn <= to) ? reqIn : compIn
    if (!d || d < from || d > to) continue
    events.push({
      id: `va-${r.id}`, lane: 'smokehouse', date: d,
      title: `🔥 ${r.customer_name || 'Smokehouse'}`,
      subtitle: r.batch_count ? `${r.batch_count} batch` : undefined,
      status: (r.status as string) ?? undefined,
    })
  }

  events.sort((a, b) => a.date.localeCompare(b.date) || a.lane.localeCompare(b.lane))
  return NextResponse.json(events)
}
