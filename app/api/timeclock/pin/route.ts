export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import {
  EMP_COLS, EmpRow, KIOSK_HEADER, LOCKOUT_MESSAGE, checkEmployeePin, clearPinFailures, endKioskSession,
  jsonError, pinLocked, recordPinFailure, startKioskSession, toEmployee, validPin,
} from '@/lib/timeclockServer'

// POST /api/timeclock/pin — { employeeId, pin }. The kiosk's second screen:
// you've tapped your name on the roster, this checks your PIN against you
// alone. (Someone with no PIN yet picks one instead: /api/timeclock/claim.)
// Five wrong PINs for one person in 15 minutes lock that person out.
export async function POST(req: NextRequest) {
  try {
    const { employeeId, pin } = await req.json().catch(() => ({})) as { employeeId?: string; pin?: unknown }
    if (!employeeId || !/^[0-9a-f-]{36}$/i.test(employeeId)) return NextResponse.json({ error: 'bad_request', message: 'Tap your name first.' }, { status: 400 })
    if (!validPin(pin)) return NextResponse.json({ error: 'bad_pin', message: 'PIN not recognized.' }, { status: 401 })

    const { data } = await supabaseAdmin.from('tk_employees').select(EMP_COLS).eq('id', employeeId).eq('active', true).maybeSingle()
    if (!data) return NextResponse.json({ error: 'bad_request', message: 'Tap your name first.' }, { status: 400 })
    const row = data as EmpRow
    if (await pinLocked(row.id)) return NextResponse.json({ error: 'locked', message: LOCKOUT_MESSAGE }, { status: 423 })

    if (!row.pin_hash) return NextResponse.json({ error: 'no_pin', message: 'You don\'t have a PIN yet. Go back and tap your name to pick one.' }, { status: 409 })
    const ok = await checkEmployeePin(row.id, row.pin_hash, pin)

    if (!ok) {
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
    const { data: fresh } = await supabaseAdmin.from('tk_employees').select(EMP_COLS).eq('id', row.id).single()
    const employee = toEmployee((fresh ?? row) as EmpRow)
    return NextResponse.json({ token: await startKioskSession(employee.id), employee })
  } catch (e) {
    return jsonError(e)
  }
}

// DELETE /api/timeclock/pin — sign out ("Done", or the idle timer).
export async function DELETE(req: NextRequest) {
  const token = req.headers.get(KIOSK_HEADER)
  if (token) await endKioskSession(token).catch(() => {})
  return NextResponse.json({ ok: true })
}
