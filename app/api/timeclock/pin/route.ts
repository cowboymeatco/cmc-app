export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import {
  KIOSK_HEADER, endKioskSession, hashPin, jsonError, pinLocked, recordPinFailure, startKioskSession, toEmployee, validPin,
} from '@/lib/timeclockServer'

// POST /api/timeclock/pin — the kiosk keypad. PIN in, short-lived session out.
// There's no name picker: the PIN is who you are, so it can only ever act for
// the person it belongs to. Three wrong PINs in 30 seconds lock the keypad.
export async function POST(req: NextRequest) {
  try {
    if (await pinLocked()) {
      return NextResponse.json({ error: 'locked', message: 'Too many wrong PINs. Wait 30 seconds and try again.' }, { status: 423 })
    }
    const { pin } = await req.json().catch(() => ({}))
    if (!validPin(pin)) return NextResponse.json({ error: 'bad_pin', message: 'PIN not recognized.' }, { status: 401 })
    const { data } = await supabaseAdmin.from('tk_employees')
      .select('id, name, role, hire_date, active, pin_hash, qbo_employee_id, pto_opening_hours, pto_opening_as_of')
      .eq('pin_hash', await hashPin(pin)).eq('active', true).maybeSingle()
    if (!data) {
      await recordPinFailure()
      // Flat delay keeps a guessing loop slow on top of the lockout.
      await new Promise(r => setTimeout(r, 400))
      const locked = await pinLocked()
      return NextResponse.json(
        { error: locked ? 'locked' : 'bad_pin', message: locked ? 'Too many wrong PINs. Keypad locked for 30 seconds.' : 'PIN not recognized.' },
        { status: locked ? 423 : 401 },
      )
    }
    const employee = toEmployee(data)
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
