export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// Planned delivery runs — the schedule, not the log.
//
// delivery_scans records a run that already happened (boxes, barcodes, who
// signed for it). This is the day BEFORE that: a date, a route, a driver and
// the stops the truck is meant to make. Charlie (2026-08-25) asked for a
// delivery schedule that shows on /calendar, and the calendar's delivery lane
// reads this table.

// GET /api/delivery/runs
//   ?from=YYYY-MM-DD&to=YYYY-MM-DD  — a window (what the calendar asks for)
//   ?upcoming=1                     — today onward (what the Schedule tab shows)
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const from     = searchParams.get('from')
  const to       = searchParams.get('to')
  const upcoming = searchParams.get('upcoming')

  let query = supabase.from('delivery_runs').select('*').order('run_date', { ascending: true })
  if (from) query = query.gte('run_date', from)
  if (to)   query = query.lte('run_date', to)
  if (upcoming) {
    // A run that went out yesterday is still worth seeing this morning, so the
    // tab reaches back a week rather than cutting off at today.
    const since = new Date(Date.now() - 7 * 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Denver' })
    query = query.gte('run_date', since)
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

type Stop = { customer?: string; town?: string; note?: string }

// Stops are typed in by hand and a half-filled row is how a plan gets built —
// keep anything with a name on it and drop the rest.
function cleanStops(raw: unknown): Stop[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map(s => ({
      customer: String((s as Stop)?.customer ?? '').trim(),
      town:     String((s as Stop)?.town     ?? '').trim(),
      note:     String((s as Stop)?.note     ?? '').trim(),
    }))
    .filter(s => s.customer || s.town)
}

// POST /api/delivery/runs — schedule a run
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  const runDate = String(body?.run_date ?? '').slice(0, 10)
  if (!runDate) return NextResponse.json({ error: 'run_date required' }, { status: 400 })

  const { data, error } = await supabase
    .from('delivery_runs')
    .insert([{
      run_date:    runDate,
      route:       String(body?.route  ?? '').trim(),
      driver:      String(body?.driver ?? '').trim(),
      depart_time: String(body?.depart_time ?? '').trim() || null,
      stops:       cleanStops(body?.stops),
      notes:       String(body?.notes ?? '').trim(),
      status:      'planned',
    }])
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// PATCH /api/delivery/runs — edit a run, or move it along its status
export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  const id = String(body?.id ?? '')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if ('run_date' in body!)    updates.run_date    = String(body!.run_date).slice(0, 10)
  if ('route' in body!)       updates.route       = String(body!.route ?? '').trim()
  if ('driver' in body!)      updates.driver      = String(body!.driver ?? '').trim()
  if ('depart_time' in body!) updates.depart_time = String(body!.depart_time ?? '').trim() || null
  if ('notes' in body!)       updates.notes       = String(body!.notes ?? '').trim()
  if ('stops' in body!)       updates.stops       = cleanStops(body!.stops)
  if ('status' in body!)      updates.status      = String(body!.status ?? 'planned')

  const { data, error } = await supabase
    .from('delivery_runs')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// DELETE /api/delivery/runs?id=… — a run that was never going to happen.
// Cancelling is the softer option and stays on the calendar; this removes it.
export async function DELETE(req: NextRequest) {
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const { error } = await supabase.from('delivery_runs').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
