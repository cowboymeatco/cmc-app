export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { FRACTION } from '@/lib/cutSchedule'

// GET /api/carcass-assignments?harvest_log_ids=a,b,c   (for the Cut Schedule)
//   or /api/carcass-assignments?appointment_id=X        (for the assign modal)
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const apptId = searchParams.get('appointment_id')
  const logIds = searchParams.get('harvest_log_ids')

  let query = supabase.from('carcass_assignments').select('*')
  if (apptId) {
    query = query.eq('appointment_id', apptId)
  } else if (logIds) {
    const ids = logIds.split(',').map(s => s.trim()).filter(Boolean)
    if (ids.length === 0) return NextResponse.json([])
    query = query.in('harvest_log_id', ids)
  } else {
    return NextResponse.json({ error: 'appointment_id or harvest_log_ids required' }, { status: 400 })
  }

  const { data, error } = await query
  if (error) return NextResponse.json([], { status: 200 }) // table may not exist yet → caller falls back to interim
  return NextResponse.json(data ?? [])
}

// POST /api/carcass-assignments — replace the full assignment set for a GROUP of
// appointments (one producer's carcasses on a harvest day, which is how a mixed-up
// tag gets moved from one buyer to another — Jill, 2026-07-28).
// Body: { appointment_ids: [...], harvest_log_ids: [...], assignments: [{ harvest_log_id,
//          appointment_id, appointment_customer_id, customer_name, portion,
//          linked_cutting_instruction_id }] }
// `appointment_id` (singular) is still accepted for a one-appointment save.
export async function POST(req: NextRequest) {
  const body = await req.json()
  const { appointment_id, appointment_ids, harvest_log_ids, assignments } = body as {
    appointment_id?:  string
    appointment_ids?: string[]
    harvest_log_ids?: string[]
    assignments: Array<{
      harvest_log_id:                string
      appointment_id?:               string
      appointment_customer_id:       string
      customer_name:                 string | null
      portion:                       string
      linked_cutting_instruction_id: string | null
    }>
  }

  const apptIds = Array.from(new Set(
    [...(appointment_ids ?? []), ...(appointment_id ? [appointment_id] : [])].filter(Boolean)
  ))
  if (apptIds.length === 0 || !Array.isArray(assignments)) {
    return NextResponse.json({ error: 'appointment_id(s) and assignments required' }, { status: 400 })
  }
  // Every row must belong to the group being replaced, or the delete below would
  // leave an orphan the next save can't see.
  const stray = assignments.find(a => a.appointment_id && !apptIds.includes(a.appointment_id))
  if (stray) {
    return NextResponse.json({ error: `assignment references appointment ${stray.appointment_id} outside this group` }, { status: 400 })
  }

  // Guard: portions assigned to any single carcass must sum to ≤ 1 whole.
  const perCarcass = new Map<string, number>()
  for (const a of assignments) {
    const frac = FRACTION[a.portion]
    if (frac == null) {
      return NextResponse.json({ error: `invalid portion "${a.portion}"` }, { status: 400 })
    }
    const next = (perCarcass.get(a.harvest_log_id) ?? 0) + frac
    perCarcass.set(a.harvest_log_id, next)
    if (next > 1.0001) {
      return NextResponse.json(
        { error: `carcass ${a.harvest_log_id} is over-assigned (portions exceed one whole)` },
        { status: 400 }
      )
    }
  }

  // Replace-all for the group (cleanest upsert for a small, fully-rewritten set).
  // Both sides are cleared: rows owned by these appointments, AND any row sitting
  // on one of these carcasses but written under a sibling appointment — otherwise
  // moving a buyer between two of a producer's animals leaves the old row behind
  // and the carcass reads as double-booked.
  const { error: delError } = await supabase
    .from('carcass_assignments')
    .delete()
    .in('appointment_id', apptIds)
  if (delError) return NextResponse.json({ error: delError.message }, { status: 500 })

  // Only carcasses the caller explicitly claims as part of the group — deriving
  // this from `assignments` would let a single-appointment save wipe a sibling
  // booking's share of a carcass it never meant to touch.
  const logIds = Array.from(new Set(harvest_log_ids ?? []))
  if (logIds.length > 0) {
    const { error: delLogError } = await supabase
      .from('carcass_assignments')
      .delete()
      .in('harvest_log_id', logIds)
    if (delLogError) return NextResponse.json({ error: delLogError.message }, { status: 500 })
  }

  if (assignments.length === 0) return NextResponse.json({ ok: true })

  const rows = assignments.map(a => ({
    harvest_log_id:                a.harvest_log_id,
    appointment_id:                a.appointment_id ?? apptIds[0],
    appointment_customer_id:       a.appointment_customer_id,
    customer_name:                 a.customer_name ?? '',
    portion:                       a.portion,
    linked_cutting_instruction_id: a.linked_cutting_instruction_id ?? null,
  }))

  const { error: insError } = await supabase.from('carcass_assignments').insert(rows)
  if (insError) return NextResponse.json({ error: insError.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
