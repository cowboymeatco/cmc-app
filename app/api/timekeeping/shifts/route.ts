export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { requireExec } from '@/lib/execGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { toMin } from '@/lib/timekeeping'
import { jsonError } from '@/lib/timeclockServer'

// Manager corrections to punches — a forgotten clock-out, a missed lunch punch,
// a shift that never got punched at all. Every correction is stamped with when
// and why, and the timesheet shows it as edited.
//
// POST   /api/timekeeping/shifts — { employeeId, date, clockIn, clockOut, lunchStart, lunchEnd, breaks, note }
// PATCH  /api/timekeeping/shifts — { id, …same fields }
// DELETE /api/timekeeping/shifts?id=…&note=… — a shift punched by mistake.

const ISO = /^\d{4}-\d{2}-\d{2}$/
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

interface Body {
  id?: string; employeeId?: string; date?: string
  clockIn?: string; clockOut?: string | null; lunchStart?: string | null; lunchEnd?: string | null
  breaks?: { start: string; end: string | null }[]; note?: string
}

function validate(b: Body): string | null {
  if (!b.note?.trim()) return 'Say why you\'re changing it — it goes on the record.'
  if (!b.clockIn || !HHMM.test(b.clockIn)) return 'Clock-in time is required.'
  const times = [b.clockOut, b.lunchStart, b.lunchEnd, ...(b.breaks ?? []).flatMap(x => [x.start, x.end])]
  if (times.some(t => t != null && t !== '' && !HHMM.test(t))) return 'Times must look like 07:30.'
  if (b.clockOut && toMin(b.clockOut) <= toMin(b.clockIn)) return 'Clock-out must be after clock-in (overnight shifts aren\'t supported yet).'
  if (!!b.lunchStart !== !!b.lunchEnd && b.clockOut) return 'Lunch needs both a start and an end.'
  if (b.lunchStart && b.lunchEnd && toMin(b.lunchEnd) < toMin(b.lunchStart)) return 'Lunch ends before it starts.'
  for (const x of b.breaks ?? []) if (x.end && toMin(x.end) < toMin(x.start)) return 'A break ends before it starts.'
  return null
}

const row = (b: Body) => ({
  clock_in: b.clockIn, clock_out: b.clockOut || null, lunch_start: b.lunchStart || null, lunch_end: b.lunchEnd || null,
  breaks: (b.breaks ?? []).filter(x => x.start).map(x => ({ start: x.start, end: x.end || null })),
  edited_at: new Date().toISOString(), edit_note: b.note!.trim().slice(0, 300), updated_at: new Date().toISOString(),
})

export async function POST(req: NextRequest) {
  const gate = await requireExec(req)
  if (!gate.ok) return gate.response
  try {
    const b = await req.json() as Body
    if (!b.employeeId || !b.date || !ISO.test(b.date)) return NextResponse.json({ error: 'Employee and date are required.' }, { status: 400 })
    const bad = validate(b)
    if (bad) return NextResponse.json({ error: bad }, { status: 400 })
    const { error } = await supabaseAdmin.from('tk_shifts').insert({ employee_id: b.employeeId, shop_date: b.date, ...row(b) })
    if (error) return NextResponse.json({ error: error.code === '23505' ? 'They already have an open shift — close that one first.' : error.message }, { status: 400 })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return jsonError(e)
  }
}

export async function PATCH(req: NextRequest) {
  const gate = await requireExec(req)
  if (!gate.ok) return gate.response
  try {
    const b = await req.json() as Body
    if (!b.id) return NextResponse.json({ error: 'id required' }, { status: 400 })
    const bad = validate(b)
    if (bad) return NextResponse.json({ error: bad }, { status: 400 })
    const { error } = await supabaseAdmin.from('tk_shifts').update(row(b)).eq('id', b.id)
    if (error) return jsonError(error.message)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return jsonError(e)
  }
}

export async function DELETE(req: NextRequest) {
  const gate = await requireExec(req)
  if (!gate.ok) return gate.response
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const { error } = await supabaseAdmin.from('tk_shifts').delete().eq('id', id)
  if (error) return jsonError(error.message)
  return NextResponse.json({ ok: true })
}
