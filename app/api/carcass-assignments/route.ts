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

// POST /api/carcass-assignments — replace the full assignment set for one appointment.
// Body: { appointment_id, assignments: [{ harvest_log_id, appointment_customer_id,
//          customer_name, portion, linked_cutting_instruction_id }] }
export async function POST(req: NextRequest) {
  const body = await req.json()
  const { appointment_id, assignments } = body as {
    appointment_id: string
    assignments: Array<{
      harvest_log_id:                string
      appointment_customer_id:       string
      customer_name:                 string | null
      portion:                       string
      linked_cutting_instruction_id: string | null
    }>
  }

  if (!appointment_id || !Array.isArray(assignments)) {
    return NextResponse.json({ error: 'appointment_id and assignments required' }, { status: 400 })
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

  // Replace-all for this appointment (cleanest upsert for a small, fully-rewritten set).
  const { error: delError } = await supabase
    .from('carcass_assignments')
    .delete()
    .eq('appointment_id', appointment_id)
  if (delError) return NextResponse.json({ error: delError.message }, { status: 500 })

  if (assignments.length === 0) return NextResponse.json({ ok: true })

  const rows = assignments.map(a => ({
    harvest_log_id:                a.harvest_log_id,
    appointment_id,
    appointment_customer_id:       a.appointment_customer_id,
    customer_name:                 a.customer_name ?? '',
    portion:                       a.portion,
    linked_cutting_instruction_id: a.linked_cutting_instruction_id ?? null,
  }))

  const { error: insError } = await supabase.from('carcass_assignments').insert(rows)
  if (insError) return NextResponse.json({ error: insError.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
