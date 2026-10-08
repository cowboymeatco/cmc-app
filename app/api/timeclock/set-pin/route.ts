export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { checkSetupPin, hashPin, jsonError, requireKiosk, validPin, weakPin } from '@/lib/timeclockServer'

// POST /api/timeclock/set-pin — { pin }. First sign-in only: someone who came
// in on the shared setup PIN picks their own. Once they have one, changing it
// is a manager's job (Employees → Reset PIN), so a borrowed session can't
// lock the owner out.
export async function POST(req: NextRequest) {
  const auth = await requireKiosk(req, true)
  if (!auth.ok) return auth.response
  try {
    if (auth.employee.hasPin) return NextResponse.json({ error: 'refused', message: 'You already have a PIN. Ask a manager to reset it.' }, { status: 409 })
    const { pin } = await req.json().catch(() => ({}))
    const bad = (message: string) => NextResponse.json({ error: 'refused', message }, { status: 400 })
    if (!validPin(pin)) return bad('Your PIN has to be 4 digits.')
    if (weakPin(pin)) return bad('That one\'s too easy to guess (like 1111 or 1234). Pick another.')
    if (await checkSetupPin(pin)) return bad('That\'s the setup PIN everyone uses. Pick your own.')
    const { error } = await supabaseAdmin.from('tk_employees')
      .update({ pin_hash: await hashPin(auth.employee.id, pin), pin_set_at: new Date().toISOString() }).eq('id', auth.employee.id)
    if (error) return jsonError(error.message)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return jsonError(e)
  }
}
