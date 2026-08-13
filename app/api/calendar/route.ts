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

type Lane = 'receiving' | 'harvest' | 'processing' | 'smokehouse' | 'retail' | 'pickup'

interface CalEvent {
  id:        string
  lane:      Lane
  date:      string          // YYYY-MM-DD (the day it sits on the calendar)
  title:     string
  subtitle?: string
  status?:   string
  href?:     string          // where the most relevant info for this item lives
  planned?:  boolean         // a scheduled/planned item (vs an actual record)
  // Clock times, on the lanes that have them (smokehouse cooks). 84 of our 414
  // logged cooks cross midnight in Mountain time, so a lane keyed only on the
  // start day showed a 10pm cook as a Tuesday item and left Wednesday morning
  // looking idle
  // (Charlie, 2026-08-13). These drive the overnight marker and the hourly
  // week timeline.
  startsAt?: string          // ISO timestamp
  endsAt?:   string          // ISO timestamp; absent while a cook is still running
  nights?:   number          // midnights crossed; 0/absent for a same-day item
  carriedIn?: boolean        // the tail of a cook that started on an earlier day
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
  pickup:     '/scanner',
}

const day = (v: string | null | undefined): string => (v ? String(v).slice(0, 10) : '')

// Calendar-day arithmetic on YYYY-MM-DD strings, done in local time so a cook
// lands on the day the crew would say it ran.
const shiftDay = (iso: string, delta: number): string => {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, (m ?? 1) - 1, (d ?? 1) + delta)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}
const dayBefore = (iso: string) => shiftDay(iso, -1)
const localDay = (ts: string): string => {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const clock = (ts: string): string =>
  new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(' ', '').toLowerCase()

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const from = searchParams.get('from') ?? ''
  const to   = searchParams.get('to')   ?? ''
  if (!from || !to) return NextResponse.json({ error: 'from and to required' }, { status: 400 })

  const events: CalEvent[] = []

  const [recvAppts, boxes, appts, sessions, cooks, retail, planned, pickups, cutPlan] = await Promise.all([
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
    // Reach back a day before the window: a cook lit at 9pm the night before
    // `from` is still in the smokehouse for most of the first morning shown, and
    // keying the fetch to started_at alone hid it entirely.
    supabase.from('smokehouse_cook')
      .select('id, started_at, ended_at, batch, operator, profile_key')
      .gte('started_at', `${dayBefore(from)}T00:00:00`).lte('started_at', `${to}T23:59:59`),
    supabase.from('retail_orders')
      .select('id, due_date, customer_name, fulfillment_type, status')
      .gte('due_date', from).lte('due_date', to),
    // Planned smokehouse cooks — the schedule built on /value-add. Shown as a
    // distinct "planned" layer alongside the actual cook cycles (Phase B).
    supabase.from('value_add_jobs')
      .select('id, scheduled_start, requested_date, profile_key, batch_count, customer_name, status')
      .or(`and(requested_date.gte.${from},requested_date.lte.${to}),and(scheduled_start.gte.${from}T00:00:00,scheduled_start.lte.${to}T23:59:59)`),
    // Pickups — when a finished order is scheduled to be collected (and paid).
    supabase.from('processing_sessions')
      .select('id, customer_name, pickup_date, status')
      .gte('pickup_date', from).lte('pickup_date', to),
    // Planned cuts — the cut schedule built on /processing. Not date-filtered
    // here: the plan is ONE ordered list saved under a single schedule_date and
    // split across days by its break rows, so which day a carcass falls on can
    // only be worked out by walking the list (see below). A plan is a few dozen
    // rows; 500 always covers the newest one.
    supabase.from('cut_schedule_items')
      .select('*')
      .order('schedule_date', { ascending: false })
      .order('manual_rank', { ascending: true })
      .limit(500),
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
    if (!r.started_at) continue
    const startISO = r.started_at as string
    const endISO   = (r.ended_at as string) || ''
    const d = localDay(startISO)
    // Duration off the log; a cook with no end time is still running.
    const start = new Date(startISO).getTime()
    const end   = endISO ? new Date(endISO).getTime() : 0
    const hours = start && end && end > start ? Math.round((end - start) / 360000) / 10 : 0
    // Show the tagged recipe when the crew has set one; else the batch name; else generic.
    const recipe = r.profile_key ? recipeByKey.get(String(r.profile_key)) : ''
    const title  = `🔥 ${recipe || r.batch || 'Cook'}`
    // Midnights crossed. An unfinished cook is counted against right now, so a
    // pit that has been running since yesterday reads as overnight while it runs.
    const endDay = endISO ? localDay(endISO) : localDay(new Date().toISOString())
    let nights = 0
    for (let probe = d; probe < endDay && nights < 7; probe = shiftDay(probe, 1)) nights++

    const sub = [
      r.operator,
      hours ? `${hours}h` : '',
      // The times only earn their space once a cook leaves the day it started.
      nights > 0 ? `${clock(startISO)} → ${endISO ? clock(endISO) : 'still running'}` : '',
    ].filter(Boolean).join(' · ')

    if (d >= from && d <= to) {
      events.push({
        id: `cook-${r.id}`, lane: 'smokehouse', date: d,
        title: nights > 0 ? `${title} ↗` : title,
        subtitle: sub || undefined,
        status: endISO ? 'complete' : 'active', href: LANE_HREF.smokehouse,
        startsAt: startISO, endsAt: endISO || undefined, nights,
      })
    }
    // A cook that runs past midnight also belongs to the mornings it runs into,
    // or those days read as empty while the smokehouse was working.
    for (let i = 1; i <= nights; i++) {
      const contDay = shiftDay(d, i)
      if (contDay < from || contDay > to) continue
      events.push({
        id: `cook-${r.id}-n${i}`, lane: 'smokehouse', date: contDay,
        title: `${title} ↳`,
        subtitle: [`from ${clock(startISO)} ${i === 1 ? 'yesterday' : `${i}d ago`}`,
                   endISO ? `ends ${clock(endISO)}` : 'still running'].join(' · '),
        status: endISO ? 'complete' : 'active', href: LANE_HREF.smokehouse,
        startsAt: startISO, endsAt: endISO || undefined, nights, carriedIn: true,
      })
    }
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

  for (const r of pickups.data ?? []) {
    const d = day(r.pickup_date as string)
    if (!d) continue
    const collected = (r.status as string) === 'picked_up'
    events.push({
      id: `pickup-${r.id}`, lane: 'pickup', date: d,
      title: `💵 ${r.customer_name || 'Pickup'}`,
      subtitle: collected ? 'collected ✓' : 'pickup',
      status: (r.status as string) ?? undefined, href: LANE_HREF.pickup,
    })
  }

  // ── Planned cuts, off the cut schedule ──────────────────────────────────────
  // The processing lane used to show only processing_sessions — work already
  // scanned. Charlie (2026-08-03): "pull this information from the processing
  // planner also." So the plan layers in the same way planned cooks do.
  //
  // The plan is one ordered list saved under a single schedule_date, with
  // 'break' rows marking where a day of cutting ends: everything before the
  // first break is cut on schedule_date, everything after a break is cut on
  // that break's break_date. Walking the list in manual_rank order is the only
  // way to know a carcass's day.
  const allPlan = cutPlan.data ?? []
  const planDate = allPlan[0]?.schedule_date as string | undefined
  const plan = planDate ? allPlan.filter(r => r.schedule_date === planDate) : []

  if (plan.length > 0) {
    // Same rule the planner and crew view use (lib/cutSchedule planIsLive): a
    // plan is live through the last day it describes. Past that it's a stale
    // sequence, not a schedule, and must not be drawn on the calendar.
    let lastDay = planDate ?? ''
    for (const r of plan) {
      const bd = day(r.break_date as string)
      if (r.kind === 'break' && bd > lastDay) lastDay = bd
    }
    const todayISO = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Denver' })

    if (lastDay >= todayISO) {
      // Carcass rows key on harvest_log_id (the column is named appointment_id
      // for back-compat — see lib/cutSchedule ScheduleEntry).
      const logIds = Array.from(new Set(
        plan.filter(r => r.kind !== 'break' && r.appointment_id).map(r => r.appointment_id as string)
      ))
      const { data: planLogs } = logIds.length
        ? await supabase.from('harvest_log')
            .select('id, producer, species, carcass_tag, appointment_id')
            .in('id', logIds)
        : { data: [] }
      const logById = new Map((planLogs ?? []).map(l => [l.id as string, l]))

      // Buyer names live on the appointment's customers JSON, keyed by the
      // customer slot id the plan row carries.
      const planApptIds = Array.from(new Set(
        (planLogs ?? []).map(l => l.appointment_id as string).filter(Boolean)
      ))
      const { data: planAppts } = planApptIds.length
        ? await supabase.from('harvest_appointments').select('id, customers').in('id', planApptIds)
        : { data: [] }
      const custName = new Map<string, string>()
      for (const a of planAppts ?? []) {
        for (const c of (a.customers as { id?: string; customer_name?: string }[] | null) ?? []) {
          if (c?.id) custName.set(c.id, (c.customer_name ?? '').trim())
        }
      }

      // A split carcass is ONE plan row carrying one buyer's slot id, so
      // naming the event off that id alone would drop the other half's buyer.
      // The assignments know every portion — use them when there's more than
      // one, so the calendar says what the schedule says.
      const { data: planAssigns } = logIds.length
        ? await supabase.from('carcass_assignments')
            .select('harvest_log_id, customer_name')
            .in('harvest_log_id', logIds)
        : { data: [] }
      const assignedNames = new Map<string, string[]>()
      for (const a of planAssigns ?? []) {
        const key = a.harvest_log_id as string
        const nm  = ((a.customer_name as string) ?? '').trim()
        if (!key || !nm) continue
        const bucket = assignedNames.get(key)
        if (bucket) { if (!bucket.includes(nm)) bucket.push(nm) }
        else assignedNames.set(key, [nm])
      }

      let cutDay = planDate ?? ''
      for (const r of plan) {
        if (r.kind === 'break') {
          const bd = day(r.break_date as string)
          if (bd) cutDay = bd
          continue
        }
        if (!cutDay || cutDay < from || cutDay > to) continue
        const log    = logById.get(r.appointment_id as string)
        const shared = assignedNames.get(r.appointment_id as string) ?? []
        const name   = shared.length > 1
          ? [...shared].sort((a, b) => a.localeCompare(b)).join(' + ')
          : custName.get(r.appointment_customer_id as string) || (log?.producer as string) || ''
        events.push({
          id: `cut-${r.id}`, lane: 'processing', date: cutDay, planned: true,
          title: `📋 ${name || 'Planned cut'}`,
          subtitle: [log?.species, log?.carcass_tag ? `#${log.carcass_tag}` : '', 'planned']
            .filter(Boolean).join(' · '),
          href: '/processing',
        })
      }
    }
  }

  events.sort((a, b) => a.date.localeCompare(b.date) || a.lane.localeCompare(b.lane))

  // ── Is the smokehouse feed still alive? ─────────────────────────────────────
  // Cooks don't originate here — the controller pushes its Data Files to
  // ftp_server.py on the packaging kiosk, which imports them into
  // smokehouse_cook. When that import stops, the Smokehouse lane just goes
  // quiet, and a quiet lane is indistinguishable from a week nobody cooked.
  // Charlie ran a pulled pork and a hot dog cycle on 2026-08-10/11 and filed
  // this as a calendar bug; the calendar was right, the feed had been dead
  // since 08-07. Report the last import so the silence names itself.
  const { data: lastCook } = await supabase
    .from('smokehouse_cook')
    .select('started_at, created_at')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return NextResponse.json({
    events,
    smokehouseFeed: {
      lastCookAt:   (lastCook?.started_at as string) ?? null,
      lastImportAt: (lastCook?.created_at as string) ?? null,
    },
  })
}
