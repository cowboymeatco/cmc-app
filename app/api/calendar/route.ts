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
  planned?:  boolean         // a scheduled/planned item (vs an actual record)
}

// Where clicking an event takes you — the page that holds the most relevant
// info for that lane (Charlie: "clicking should take us to where the most
// relevant information for that order is").
const LANE_HREF: Record<Lane, string> = {
  receiving:  '/receiving',
  harvest:    '/schedule',
  processing: '/scanner',
  smokehouse: '/cooks',
  retail:     '/orders',
}

const day = (v: string | null | undefined): string => (v ? String(v).slice(0, 10) : '')

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const from = searchParams.get('from') ?? ''
  const to   = searchParams.get('to')   ?? ''
  if (!from || !to) return NextResponse.json({ error: 'from and to required' }, { status: 400 })

  const events: CalEvent[] = []

  const [recvAppts, boxes, appts, sessions, cooks, retail, planned] = await Promise.all([
    // Receiving — animals scheduled to arrive, off the receiving calendar
    // (appointment.receive_date, default the day before harvest). Charlie:
    // "Receiving should come off of the receiving calendar."
    supabase.from('harvest_appointments')
      .select('id, receive_date, source, species, head_count, status')
      .gte('receive_date', from).lte('receive_date', to),
    supabase.from('box_receiving_log')
      .select('id, received_at, vendor, product, quantity, status')
      .gte('received_at', from).lte('received_at', to),
    supabase.from('harvest_appointments')
      .select('id, harvest_date, source, species, head_count, status')
      .gte('harvest_date', from).lte('harvest_date', to),
    supabase.from('processing_sessions')
      .select('id, session_date, customer_name, status')
      .gte('session_date', from).lte('session_date', to),
    // Smokehouse — actual cook cycles (the real log), tagged with their recipe
    // on /cooks. Scheduling/planned cooks layer in next (Charlie, 2026-07-30).
    supabase.from('smokehouse_cook')
      .select('id, started_at, ended_at, batch, operator, profile_key')
      .gte('started_at', `${from}T00:00:00`).lte('started_at', `${to}T23:59:59`),
    supabase.from('retail_orders')
      .select('id, due_date, customer_name, fulfillment_type, status')
      .gte('due_date', from).lte('due_date', to),
    // Planned smokehouse cooks — the schedule built on /value-add. Shown as a
    // distinct "planned" layer alongside the actual cook cycles (Phase B).
    supabase.from('value_add_jobs')
      .select('id, scheduled_start, requested_date, profile_key, batch_count, customer_name, status')
      .or(`and(requested_date.gte.${from},requested_date.lte.${to}),and(scheduled_start.gte.${from}T00:00:00,scheduled_start.lte.${to}T23:59:59)`),
  ])

  // Recipe names for tagged cooks (small table — one fetch, mapped by key).
  const { data: cookProfiles } = await supabase.from('cook_profile').select('profile_key, display_name')
  const recipeByKey = new Map<string, string>()
  for (const p of cookProfiles ?? []) recipeByKey.set(String(p.profile_key), p.display_name as string)

  for (const r of recvAppts.data ?? []) {
    const d = day(r.receive_date as string)
    if (!d) continue
    const head = r.head_count ? `${r.head_count} ` : ''
    events.push({
      id: `recv-${r.id}`, lane: 'receiving', date: d,
      title: `🐄 ${r.source || r.species || 'Arrival'}`,
      subtitle: `${head}${r.species || ''}`.trim() || undefined,
      status: (r.status as string) ?? undefined, href: LANE_HREF.receiving,
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

  for (const r of cooks.data ?? []) {
    const d = day(r.started_at as string)
    if (!d) continue
    // Duration off the log; a cook with no end time is still running.
    const start = r.started_at ? new Date(r.started_at as string).getTime() : 0
    const end   = r.ended_at   ? new Date(r.ended_at   as string).getTime() : 0
    const hours = start && end && end > start ? Math.round((end - start) / 360000) / 10 : 0
    const sub = [r.operator, hours ? `${hours}h` : ''].filter(Boolean).join(' · ')
    // Show the tagged recipe when the crew has set one; else the batch name; else generic.
    const recipe = r.profile_key ? recipeByKey.get(String(r.profile_key)) : ''
    events.push({
      id: `cook-${r.id}`, lane: 'smokehouse', date: d,
      title: `🔥 ${recipe || r.batch || 'Cook'}`,
      subtitle: sub || undefined,
      status: r.ended_at ? 'complete' : 'active', href: LANE_HREF.smokehouse,
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

  for (const r of planned.data ?? []) {
    // Planned cook date: its scheduled start, else the requested date.
    const d = day(r.scheduled_start as string) || day(r.requested_date as string)
    if (!d || d < from || d > to) continue
    // A completed job's actual cook already shows via smokehouse_cook — keep the
    // planned layer to what's still upcoming/open so the two don't duplicate.
    if ((r.status as string) === 'complete') continue
    const recipe = r.profile_key ? recipeByKey.get(String(r.profile_key)) : ''
    events.push({
      id: `plan-${r.id}`, lane: 'smokehouse', date: d, planned: true,
      title: `📋 ${recipe || r.customer_name || 'Planned cook'}`,
      subtitle: [r.batch_count ? `${r.batch_count} batch` : '', 'planned'].filter(Boolean).join(' · '),
      status: (r.status as string) ?? undefined, href: '/value-add',
    })
  }

  events.sort((a, b) => a.date.localeCompare(b.date) || a.lane.localeCompare(b.lane))
  return NextResponse.json(events)
}
