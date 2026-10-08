export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { requireExec } from '@/lib/execGate'
import { addDaysISO } from '@/lib/dates'
import { jsonError, listEmployees, listRequests, listSchedule, listShifts, photoUrls, setupPinIsSet, shopNow } from '@/lib/timeclockServer'

// GET /api/timekeeping/data — everything the manager tabs show. Shifts go back
// to the earliest PTO go-live date (the balances need them) or 8 weeks,
// whichever is further; the schedule runs 3 weeks back to 9 weeks out.
export async function GET(req: NextRequest) {
  const gate = await requireExec(req)
  if (!gate.ok) return gate.response
  try {
    const now = shopNow()
    const employees = await listEmployees(true)
    const eightWeeks = addDaysISO(now.date, -56)
    const from = employees.reduce((m, e) => (e.ptoOpeningAsOf < m ? e.ptoOpeningAsOf : m), eightWeeks)
    const [shifts, schedule, requests] = await Promise.all([
      listShifts(from, now.date),
      listSchedule(addDaysISO(now.date, -21), addDaysISO(now.date, 63)),
      listRequests(),
    ])
    const recent = addDaysISO(now.date, -14)
    const photos = await photoUrls(shifts.filter(s => s.date >= recent).map(s => s.id))
    return NextResponse.json({ employees, shifts, schedule, requests, photos, now, shiftsFrom: from, setupPinSet: await setupPinIsSet() })
  } catch (e) {
    return jsonError(e)
  }
}
