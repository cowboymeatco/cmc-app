export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// ── Master ERP calendar feed ───────────────────────────────────────────────────
// One flat list of dated events across every operational lane — receiving,
// harvest, processing, smokehouse, retail — so the /calendar page can pivot them
// into week/month/quarter views and filter by asset class. Read-only aggregation
// over tables that already carry their own dates; nothing is written here.
//
// GET /api/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD

type Lane = 'receiving' | 'harvest' | 'processing' | 'smokehouse' | 'retail'

interface CalEvent {
  id:        string
  lane:      Lane
  date:      string          // YYYY-MM-DD (the day it sits on the calendar)
  title:     string
  subtitle?: string
  status?:   string
  href?:     string          // where the most relevant info for this item lives
}

// Where clicking an event takes you — the page that holds the most relevant
// info for that lane (Charlie: "clicking should take us to where the most
// relevant information for that order is").
const LANE_HREF: Record<Lane, string> = {
  receiving:  '/receiving',
  harvest:    '/schedule',
  processing: '/scanner',
  smokehouse: '/value-add',
  retail:     '/orders',
}

const day = (v: string | null | undefined): string => (v ? String(v).slice(0, 10) : '')

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const from = searchParams.get('from') ?? ''
  const to   = searchParams.get('to')   ?? ''
  if (!from || !to) return NextResponse.json({ error: 'from and to required' }, { status: 400 })

  const events: CalEvent[] = []

  const [animals, boxes, appts, sessions, vaJobs, retail] = await Promise.all([
    supabase.from('animal_receiving_log')
      .select('id, received_at, ear_tag, sex, breed, status, appointment_id')
      .gte('received_at', `${from}T00:00:00`).lte('received_at', `${to}T23:59:59`),
    supabase.from('box_receiving_log')
      .select('id, received_at, vendor, product, quantity, status')
      .gte('received_at', from).lte('received_at', to),
    supabase.from('harvest_appointments')
      .select('id, harvest_date, source, species, head_count, status')
      .gte('harvest_date', from).lte('harvest_date', to),
    supabase.from('processing_sessions')
      .select('id, session_date, customer_name, status')
      .gte('session_date', from).lte('session_date', to),
    supabase.from('value_add_jobs')
      .select('id, requested_date, completed_date, customer_name, batch_count, status')
      .or(`and(requested_date.gte.${from},requested_date.lte.${to}),and(completed_date.gte.${from},completed_date.lte.${to})`),
    supabase.from('retail_orders')
      .select('id, due_date, customer_name, fulfillment_type, status')
      .gte('due_date', from).lte('due_date', to),
  ])

  // A received animal carries no producer of its own — resolve it through the
  // harvest appointment it came in on (Charlie: show the producer name, not
  // "Animal in", which is implied).
  const apptIds = [...new Set((animals.data ?? []).map(r => r.appointment_id).filter(Boolean) as string[])]
  const producerByAppt = new Map<string, string>()
  if (apptIds.length) {
    const { data } = await supabase.from('harvest_appointments').select('id, source').in('id', apptIds)
    for (const a of data ?? []) if (a.source) producerByAppt.set(String(a.id), a.source as string)
  }

  for (const r of animals.data ?? []) {
    const d = day(r.received_at as string)
    if (!d) continue
    const producer = (r.appointment_id && producerByAppt.get(String(r.appointment_id))) || ''
    const detail = [r.sex, r.breed, r.ear_tag].filter(Boolean).join(' ')
    events.push({
      id: `animal-${r.id}`, lane: 'receiving', date: d,
      title: producer ? `🐄 ${producer}` : `🐄 ${r.ear_tag || 'Animal in'}`,
      subtitle: detail || undefined, status: (r.status as string) ?? undefined, href: LANE_HREF.receiving,
    })
  }

  for (const r of boxes.data ?? []) {
    const d = day(r.received_at as string)
    if (!d) continue
    events.push({
      id: `box-${r.id}`, lane: 'receiving', date: d,
      title: `📦 ${r.vendor || 'Box product'}`,
      subtitle: [r.product, r.quantity ? `×${r.quantity}` : ''].filter(Boolean).join(' ') || undefined,
      status: (r.status as string) ?? undefined, href: LANE_HREF.receiving,
    })
  }

  for (const r of appts.data ?? []) {
    const d = day(r.harvest_date as string)
    if (!d) continue
    // Title is the producer / appointment name; species + head count ride along
    // as the subtitle (Charlie: "the appointment name for the producer").
    const head = r.head_count ? `${r.head_count} ` : ''
    events.push({
      id: `appt-${r.id}`, lane: 'harvest', date: d,
      title: (r.source as string) || (r.species as string) || 'Harvest',
      subtitle: `${head}${r.species || ''}`.trim() || undefined,
      status: (r.status as string) ?? undefined, href: LANE_HREF.harvest,
    })
  }

  for (const r of sessions.data ?? []) {
    const d = day(r.session_date as string)
    if (!d) continue
    events.push({
      id: `sess-${r.id}`, lane: 'processing', date: d,
      title: (r.customer_name as string) || 'Processing',
      status: (r.status as string) ?? undefined, href: LANE_HREF.processing,
    })
  }

  for (const r of vaJobs.data ?? []) {
    const reqIn  = day(r.requested_date as string)
    const compIn = day(r.completed_date as string)
    const d = (reqIn >= from && reqIn <= to) ? reqIn : compIn
    if (!d || d < from || d > to) continue
    events.push({
      id: `va-${r.id}`, lane: 'smokehouse', date: d,
      title: `🔥 ${r.customer_name || 'Smokehouse'}`,
      subtitle: r.batch_count ? `${r.batch_count} batch` : undefined,
      status: (r.status as string) ?? undefined, href: LANE_HREF.smokehouse,
    })
  }

  for (const r of retail.data ?? []) {
    const d = day(r.due_date as string)
    if (!d) continue
    events.push({
      id: `retail-${r.id}`, lane: 'retail', date: d,
      title: `🛒 ${r.customer_name || 'Retail order'}`,
      subtitle: (r.fulfillment_type as string) ?? undefined,
      status: (r.status as string) ?? undefined, href: LANE_HREF.retail,
    })
  }

  events.sort((a, b) => a.date.localeCompare(b.date) || a.lane.localeCompare(b.lane))
  return NextResponse.json(events)
}
