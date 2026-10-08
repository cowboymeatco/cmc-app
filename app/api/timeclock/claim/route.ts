export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { EMP_COLS, EmpRow, hashPin, jsonError, startKioskSession, toEmployee, validPin, weakPin } from '@/lib/timeclockServer'

// POST /api/timeclock/claim — { employeeId, pin }. First time on the clock:
// someone with no PIN taps their name and picks one (the kiosk has them type
// it twice). No manager step. Only works while the person has no PIN — after
// that, changing it is Employees → Reset PIN — and the update is conditional
// on that, so two taps racing for the same name can't both win.
export async function POST(req: NextRequest) {
  try {
    const { employeeId, pin } = await req.json().catch(() => ({})) as { employeeId?: string; pin?: unknown }
    const bad = (message: string, status = 400) => NextResponse.json({ error: 'refused', message }, { status })
    if (!employeeId || !/^[0-9a-f-]{36}$/i.test(employeeId)) return bad('Tap your name first.')
    if (!validPin(pin)) return bad('Your PIN has to be 4 digits.')
    if (weakPin(pin)) return bad('That one\'s too easy to guess (like 1111 or 1234). Pick another.')

    const { data, error } = await supabaseAdmin.from('tk_employees')
      .update({ pin_hash: await hashPin(employeeId, pin), pin_set_at: new Date().toISOString() })
      .eq('id', employeeId).eq('active', true).is('pin_hash', null)
      .select(EMP_COLS).maybeSingle()
    if (error) return jsonError(error.message)
    if (!data) return bad('You already have a PIN — go back and enter it. Forgot it? Ask a manager to reset it.', 409)
    const employee = toEmployee(data as EmpRow)
    return NextResponse.json({ token: await startKioskSession(employee.id), employee })
  } catch (e) {
    return jsonError(e)
  }
}
