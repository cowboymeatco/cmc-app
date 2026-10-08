export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { dateLabel } from '@/lib/dates'
import { SHIFT_COLS, jsonError, requireKiosk, shopNow, toShift } from '@/lib/timeclockServer'

// POST /api/timeclock/punch — { action }. Acts only on the signed-in
// employee's own shift, and the time is the server's shop clock, not the
// iPad's. Returns the updated shift and the punch name the photo is filed under.

type Action = 'in' | 'out' | 'break-start' | 'break-end' | 'lunch-start' | 'lunch-end'
const ACTIONS: Action[] = ['in', 'out', 'break-start', 'break-end', 'lunch-start', 'lunch-end']

const refuse = (message: string, status = 409) => NextResponse.json({ error: 'refused', message }, { status })

export async function POST(req: NextRequest) {
  const auth = await requireKiosk(req)
  if (!auth.ok) return auth.response
  try {
    const { action } = await req.json().catch(() => ({})) as { action?: Action }
    if (!action || !ACTIONS.includes(action)) return refuse('Unknown punch.', 400)
    const emp = auth.employee
    const now = shopNow()

    const { data: openRow } = await supabaseAdmin.from('tk_shifts').select(SHIFT_COLS)
      .eq('employee_id', emp.id).is('clock_out', null).maybeSingle()
    const open = openRow ? toShift(openRow) : null
    // A shift left open from an earlier day can't be closed from the kiosk —
    // the clock-out time would be a guess. A manager fixes it on Timesheets.
    if (open && open.date !== now.date) {
      return refuse(`You're still clocked in from ${dateLabel(open.date, { weekday: 'long', month: 'numeric', day: 'numeric' })}. Ask a manager to fix that shift, then clock in.`)
    }
    const onLunch = !!open?.lunchStart && !open.lunchEnd
    const breakIdx = open ? open.breaks.findIndex(b => !b.end) : -1
    const onBreak = breakIdx >= 0

    if (action === 'in') {
      if (open) return refuse(`You're already clocked in (since ${open.clockIn}).`)
      const { data, error } = await supabaseAdmin.from('tk_shifts')
        .insert({ employee_id: emp.id, shop_date: now.date, clock_in: now.time }).select(SHIFT_COLS).single()
      if (error) return refuse(error.code === '23505' ? 'You\'re already clocked in.' : error.message)
      return NextResponse.json({ shift: toShift(data), punch: 'in', now })
    }

    if (!open) return refuse('You\'re not clocked in.')
    let patch: Record<string, unknown>
    let punch: string
    switch (action) {
      case 'out':
        if (onLunch) return refuse('End your lunch first.')
        if (onBreak) return refuse('End your break first.')
        patch = { clock_out: now.time }; punch = 'out'; break
      case 'break-start':
        if (onLunch || onBreak) return refuse('You\'re already off the floor.')
        patch = { breaks: [...open.breaks, { start: now.time, end: null }] }; punch = `break-out-${open.breaks.length}`; break
      case 'break-end':
        if (!onBreak) return refuse('You\'re not on a break.')
        patch = { breaks: open.breaks.map((b, i) => i === breakIdx ? { ...b, end: now.time } : b) }; punch = `break-in-${breakIdx}`; break
      case 'lunch-start':
        if (open.lunchStart) return refuse('You\'ve already taken lunch today.')
        if (onBreak) return refuse('End your break first.')
        patch = { lunch_start: now.time }; punch = 'lunch-out'; break
      case 'lunch-end':
        if (!onLunch) return refuse('You\'re not at lunch.')
        patch = { lunch_end: now.time }; punch = 'lunch-in'; break
    }
    const { data, error } = await supabaseAdmin.from('tk_shifts')
      .update({ ...patch, updated_at: new Date().toISOString() }).eq('id', open.id).select(SHIFT_COLS).single()
    if (error) return refuse(error.message, 500)
    return NextResponse.json({ shift: toShift(data), punch, now })
  } catch (e) {
    return jsonError(e)
  }
}
