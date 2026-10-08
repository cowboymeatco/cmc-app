export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { requireExec } from '@/lib/execGate'
import { jsonError, saveSetupPin, validPin, weakPin } from '@/lib/timeclockServer'

// PUT /api/timekeeping/setup-pin — { pin }: the shared setup ("dummy") PIN
// that anyone not set up yet signs in with once, to pick their own.
export async function PUT(req: NextRequest) {
  const gate = await requireExec(req)
  if (!gate.ok) return gate.response
  try {
    const { pin } = await req.json().catch(() => ({}))
    if (!validPin(pin)) return NextResponse.json({ error: 'The setup PIN has to be 4 digits.' }, { status: 400 })
    if (weakPin(pin)) return NextResponse.json({ error: 'Pick something less obvious than 1111 or 1234 — anyone who guesses it can claim a new hire\'s account.' }, { status: 400 })
    await saveSetupPin(pin)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return jsonError(e)
  }
}
