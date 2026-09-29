export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { addDaysISO, dateLabel } from '@/lib/dates'
import { offOn, ptoSummary, requestDaysFromSchedule } from '@/lib/timeclock'
import { jsonError, listRequests, listSchedule, listShifts, requireKiosk, shiftWindowStart, shopNow } from '@/lib/timeclockServer'

// POST /api/timeclock/request — { type, from, to, partial, note }.
// The server works out the days from the schedule and re-checks everything the
// kiosk checked: future dates only, scheduled days only, no double-booking,
// and never more PTO than the employee has free.
const ISO = /^\d{4}-\d{2}-\d{2}$/

export async function POST(req: NextRequest) {
  const auth = await requireKiosk(req)
  if (!auth.ok) return auth.response
  try {
    const body = await req.json().catch(() => ({})) as { type?: string; from?: string; to?: string; partial?: number | null; note?: string }
    const type = body.type === 'Unpaid' ? 'Unpaid' : body.type === 'PTO' ? 'PTO' : null
    const { from, to } = body
    const note = String(body.note ?? '').slice(0, 300).trim()
    const partial = typeof body.partial === 'number' && body.partial > 0 ? body.partial : null
    const bad = (message: string) => NextResponse.json({ error: 'refused', message }, { status: 400 })
    if (!type || !from || !to || !ISO.test(from) || !ISO.test(to)) return bad('Pick the dates and the kind of time off.')

    const e = auth.employee
    const now = shopNow()
    if (from <= now.date) return bad('Pick a day after today.')
    if (to < from) return bad('The end date is before the start date.')

    const [schedule, requests, shifts] = await Promise.all([
      listSchedule(from, to, e.id), listRequests(e.id), listShifts(shiftWindowStart(e, now.date), now.date, e.id),
    ])
    const { days } = requestDaysFromSchedule(e.id, schedule, from, to, partial, addDaysISO)
    if (!days.length) return bad('You aren\'t scheduled any of those days.')
    const clash = days.filter(d => offOn(e.id, d.date, requests))
    if (clash.length) return bad(`You already have a request for ${clash.map(d => dateLabel(d.date, { weekday: 'short', month: 'numeric', day: 'numeric' })).join(', ')}.`)
    const total = days.reduce((t, d) => t + d.hours, 0)
    if (type === 'PTO') {
      const pto = ptoSummary(e, shifts, requests, now.date, now.time)
      if (total > pto.free + 1e-9) return bad(`That's ${total.toFixed(2)} h and you have ${pto.free.toFixed(2)} h of PTO free.`)
    }
    const { data, error } = await supabaseAdmin.from('tk_time_off_requests')
      .insert({ employee_id: e.id, type, days, note, submitted_on: now.date }).select('id').single()
    if (error) return jsonError(error.message)
    return NextResponse.json({ id: data.id, days, total })
  } catch (err) {
    return jsonError(err)
  }
}
