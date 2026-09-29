export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { addDaysISO, mondayOfISO } from '@/lib/dates'
import { jsonError, listRequests, listSchedule, listShifts, requireKiosk, shiftWindowStart, shopNow } from '@/lib/timeclockServer'

// GET /api/timeclock/me — everything the signed-in employee sees at the kiosk:
// their shifts (back to their PTO go-live date, which the balance needs),
// this week's and next week's schedule, and their time-off requests.
export async function GET(req: NextRequest) {
  const auth = await requireKiosk(req)
  if (!auth.ok) return auth.response
  try {
    const now = shopNow()
    const monday = mondayOfISO(now.date)
    const e = auth.employee
    const [shifts, schedule, requests] = await Promise.all([
      listShifts(shiftWindowStart(e, now.date), now.date, e.id),
      listSchedule(monday, addDaysISO(monday, 13), e.id),
      listRequests(e.id),
    ])
    return NextResponse.json({ employee: e, shifts, schedule, requests, now })
  } catch (err) {
    return jsonError(err)
  }
}
