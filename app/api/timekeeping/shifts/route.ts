export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { requireExec } from '@/lib/execGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { shiftTimesProblem } from '@/lib/timekeeping'
import { SHIFT_COLS, ShiftRow, jsonError, toShift } from '@/lib/timeclockServer'

// Manager corrections to punches — a forgotten clock-out, a missed lunch punch,
// a shift that never got punched at all. Every correction needs a reason, and
// every one is kept: tk_shift_history holds the punches as they were before
// and after each change, so a wage question a year from now can be answered
// from the record and not from memory. A shift punched by mistake is voided,
// not deleted — it comes off the hours but the row and the reason stay.
//
// GET    /api/timekeeping/shifts?employeeId=…&from=…&to=… — the change log and
//        voided shifts for one person's pay week.
// POST   /api/timekeeping/shifts — { employeeId, date, clockIn, clockOut, lunchStart, lunchEnd, breaks, note }
// PATCH  /api/timekeeping/shifts — { id, …same fields }
// DELETE /api/timekeeping/shifts?id=…&note=… — void a shift.
//
// Times are HH:MM on the shop clock. A clock-out earlier than the clock-in is
// the next morning (the night shift), and the shift counts on the day it began.

const ISO = /^\d{4}-\d{2}-\d{2}$/
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

interface Body {
  id?: string; employeeId?: string; date?: string
  clockIn?: string; clockOut?: string | null; lunchStart?: string | null; lunchEnd?: string | null
  breaks?: { start: string; end: string | null }[]; note?: string
}

/** The punch fields, as they go into the row and into the history. */
type Punches = Pick<ShiftRow, 'shop_date' | 'clock_in' | 'clock_out' | 'lunch_start' | 'lunch_end' | 'breaks'>
const punches = (r: Punches): Punches => ({
  shop_date: r.shop_date, clock_in: r.clock_in, clock_out: r.clock_out, lunch_start: r.lunch_start, lunch_end: r.lunch_end, breaks: r.breaks,
})

function validate(b: Body): string | null {
  if (!b.note?.trim()) return 'Say why you\'re changing it — it goes on the record.'
  if (!b.clockIn || !HHMM.test(b.clockIn)) return 'Clock-in time is required.'
  const times = [b.clockOut, b.lunchStart, b.lunchEnd, ...(b.breaks ?? []).flatMap(x => [x.start, x.end])]
  if (times.some(t => t != null && t !== '' && !HHMM.test(t))) return 'Times must look like 07:30.'
  return shiftTimesProblem({
    clockIn: b.clockIn, clockOut: b.clockOut || null, lunchStart: b.lunchStart || null, lunchEnd: b.lunchEnd || null,
    breaks: (b.breaks ?? []).filter(x => x.start),
  })
}

const row = (b: Body) => ({
  clock_in: b.clockIn!, clock_out: b.clockOut || null, lunch_start: b.lunchStart || null, lunch_end: b.lunchEnd || null,
  breaks: (b.breaks ?? []).filter(x => x.start).map(x => ({ start: x.start, end: x.end || null })),
  edited_at: new Date().toISOString(), edit_note: b.note!.trim().slice(0, 300), updated_at: new Date().toISOString(),
})

async function record(shift: ShiftRow, action: 'add' | 'edit' | 'void', before: Punches | null, after: Punches | null, note: string) {
  const { error } = await supabaseAdmin.from('tk_shift_history').insert({
    shift_id: shift.id, employee_id: shift.employee_id, shop_date: shift.shop_date, action, before, after, note: note.trim().slice(0, 300),
  })
  if (error) throw new Error(`Saved, but couldn't write the change log: ${error.message}`)
}

async function current(id: string): Promise<ShiftRow | null> {
  const { data, error } = await supabaseAdmin.from('tk_shifts').select(SHIFT_COLS).eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  return (data as ShiftRow | null) ?? null
}

export async function GET(req: NextRequest) {
  const gate = await requireExec(req)
  if (!gate.ok) return gate.response
  const p = req.nextUrl.searchParams
  const employeeId = p.get('employeeId'), from = p.get('from'), to = p.get('to')
  if (!employeeId || !from || !to || !ISO.test(from) || !ISO.test(to)) return NextResponse.json({ error: 'employeeId, from and to are required' }, { status: 400 })
  try {
    const [h, v] = await Promise.all([
      supabaseAdmin.from('tk_shift_history').select('id, shift_id, shop_date, action, before, after, note, at')
        .eq('employee_id', employeeId).gte('shop_date', from).lte('shop_date', to).order('at'),
      supabaseAdmin.from('tk_shifts').select(SHIFT_COLS)
        .eq('employee_id', employeeId).gte('shop_date', from).lte('shop_date', to).not('voided_at', 'is', null).order('shop_date'),
    ])
    if (h.error) throw new Error(h.error.message)
    if (v.error) throw new Error(v.error.message)
    return NextResponse.json({ history: h.data ?? [], voided: ((v.data ?? []) as ShiftRow[]).map(toShift) })
  } catch (e) {
    return jsonError(e)
  }
}

export async function POST(req: NextRequest) {
  const gate = await requireExec(req)
  if (!gate.ok) return gate.response
  try {
    const b = await req.json() as Body
    if (!b.employeeId || !b.date || !ISO.test(b.date)) return NextResponse.json({ error: 'Employee and date are required.' }, { status: 400 })
    const bad = validate(b)
    if (bad) return NextResponse.json({ error: bad }, { status: 400 })
    const { data, error } = await supabaseAdmin.from('tk_shifts').insert({ employee_id: b.employeeId, shop_date: b.date, ...row(b) }).select(SHIFT_COLS).single()
    if (error) return NextResponse.json({ error: error.code === '23505' ? 'They already have an open shift — close that one first.' : error.message }, { status: 400 })
    const saved = data as ShiftRow
    await record(saved, 'add', null, punches(saved), b.note!)
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
    const before = await current(b.id)
    if (!before) return NextResponse.json({ error: 'That shift is gone — reload the page.' }, { status: 404 })
    if (before.voided_at) return NextResponse.json({ error: 'That shift was voided. Add a new one instead.' }, { status: 409 })
    const { data, error } = await supabaseAdmin.from('tk_shifts').update(row(b)).eq('id', b.id).select(SHIFT_COLS).single()
    if (error) return NextResponse.json({ error: error.code === '23505' ? 'They already have another open shift — close that one first.' : error.message }, { status: 400 })
    const after = data as ShiftRow
    await record(after, 'edit', punches(before), punches(after), b.note!)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return jsonError(e)
  }
}

/** Void, not delete: the row stays with the reason, and comes off the hours. */
export async function DELETE(req: NextRequest) {
  const gate = await requireExec(req)
  if (!gate.ok) return gate.response
  const id = req.nextUrl.searchParams.get('id')
  const note = req.nextUrl.searchParams.get('note')?.trim() ?? ''
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  if (!note) return NextResponse.json({ error: 'Say why you\'re voiding it — it goes on the record.' }, { status: 400 })
  try {
    const before = await current(id)
    if (!before) return NextResponse.json({ error: 'That shift is gone — reload the page.' }, { status: 404 })
    if (before.voided_at) return NextResponse.json({ ok: true })
    const { error } = await supabaseAdmin.from('tk_shifts')
      .update({ voided_at: new Date().toISOString(), void_note: note.slice(0, 300), updated_at: new Date().toISOString() }).eq('id', id)
    if (error) return jsonError(error.message)
    await record(before, 'void', punches(before), null, note)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return jsonError(e)
  }
}
