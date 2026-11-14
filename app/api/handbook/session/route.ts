export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import {
  EMP_COLS, EmpRow, LOCKOUT_MESSAGE, checkEmployeePin, clearPinFailures, pinLocked, recordPinFailure, toEmployee, validPin,
} from '@/lib/timeclockServer'
import { HR_HEADER, endHrSession, isUuid, jsonError, startHrSession } from '@/lib/hrDocsServer'

// POST /api/handbook/session — { employeeId, pin }. The handbook's sign-in:
// tap your name (the roster is /api/timeclock/roster), enter your time clock
// PIN. Same check and the same lockout as the kiosk — five wrong PINs for one
// person in 15 minutes locks that person out everywhere.
//
// Unlike the kiosk, there is no "pick a PIN" here. This page is reachable from
// a phone anywhere, and a name with no PIN yet would belong to whoever tapped
// it first. A first PIN is picked at the iPad on site, or set by a manager.
export async function POST(req: NextRequest) {
  try {
    const { employeeId, pin } = await req.json().catch(() => ({})) as { employeeId?: string; pin?: unknown }
    if (!isUuid(employeeId)) return NextResponse.json({ error: 'bad_request', message: 'Tap your name first.' }, { status: 400 })
    if (!validPin(pin)) return NextResponse.json({ error: 'bad_pin', message: 'PIN not recognized.' }, { status: 401 })

    const { data } = await supabaseAdmin.from('tk_employees').select(EMP_COLS).eq('id', employeeId).eq('active', true).maybeSingle()
    if (!data) return NextResponse.json({ error: 'bad_request', message: 'Tap your name first.' }, { status: 400 })
    const row = data as EmpRow
    if (await pinLocked(row.id)) return NextResponse.json({ error: 'locked', message: LOCKOUT_MESSAGE }, { status: 423 })
    if (!row.pin_hash) {
      return NextResponse.json({ error: 'no_pin', message: 'You don\'t have a PIN yet. Pick one at the time clock iPad at work first, then come back.' }, { status: 409 })
    }

    if (!(await checkEmployeePin(row.id, row.pin_hash, pin))) {
      await recordPinFailure(row.id)
      // Flat delay keeps a guessing loop slow on top of the lockout.
      await new Promise(r => setTimeout(r, 400))
      const locked = await pinLocked(row.id)
      return NextResponse.json(
        { error: locked ? 'locked' : 'bad_pin', message: locked ? LOCKOUT_MESSAGE : 'PIN not recognized.' },
        { status: locked ? 423 : 401 },
      )
    }
    await clearPinFailures(row.id)
    const employee = toEmployee(row)
    return NextResponse.json({ token: await startHrSession(employee.id), employee: { id: employee.id, name: employee.name } })
  } catch (e) {
    return jsonError(e)
  }
}

// DELETE /api/handbook/session — sign out.
export async function DELETE(req: NextRequest) {
  const token = req.headers.get(HR_HEADER)
  if (token) await endHrSession(token).catch(() => {})
  return NextResponse.json({ ok: true })
}
