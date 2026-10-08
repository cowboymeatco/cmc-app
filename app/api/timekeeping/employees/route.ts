export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { requireExec } from '@/lib/execGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { clearPinFailures, hashPin, jsonError, validPin } from '@/lib/timeclockServer'

// POST  /api/timekeeping/employees — add someone to the time clock.
// PATCH /api/timekeeping/employees — edit, set or reset a PIN, or deactivate.
// A PIN is optional: someone without one signs in at the kiosk with the shared
// setup PIN and picks their own. "Reset PIN" (resetPin: true) puts them back
// there — for a forgotten PIN.
// Nobody is ever deleted: their shifts are payroll records.

const ISO = /^\d{4}-\d{2}-\d{2}$/

interface Body {
  id?: string; name?: string; role?: string | null; hireDate?: string; pin?: string; resetPin?: boolean; active?: boolean
  qboEmployeeId?: string | null; ptoOpeningHours?: number; ptoOpeningAsOf?: string
}

async function toRow(b: Body, creating: boolean): Promise<Record<string, unknown> | string> {
  const row: Record<string, unknown> = {}
  if (b.name !== undefined) { if (!b.name.trim()) return 'Name is required.'; row.name = b.name.trim() }
  else if (creating) return 'Name is required.'
  if (b.role !== undefined) row.role = b.role?.trim() || null
  if (b.hireDate !== undefined) { if (!ISO.test(b.hireDate)) return 'Hire date is required.'; row.hire_date = b.hireDate }
  else if (creating) return 'Hire date is required.'
  // The PIN hash is salted with the employee id, so it's written separately once the id is known.
  if (b.pin !== undefined && b.pin !== '' && !validPin(b.pin)) return 'PIN must be 4 digits.'
  if (b.resetPin) { row.pin_hash = null; row.pin_set_at = null }
  if (b.active !== undefined) row.active = !!b.active
  if (b.qboEmployeeId !== undefined) row.qbo_employee_id = b.qboEmployeeId?.trim() || null
  if (b.ptoOpeningHours !== undefined) { const n = Number(b.ptoOpeningHours); if (!Number.isFinite(n)) return 'Opening PTO must be a number.'; row.pto_opening_hours = n }
  if (b.ptoOpeningAsOf !== undefined) { if (!ISO.test(b.ptoOpeningAsOf)) return 'Opening PTO date is required.'; row.pto_opening_as_of = b.ptoOpeningAsOf }
  return row
}

export async function POST(req: NextRequest) {
  const gate = await requireExec(req)
  if (!gate.ok) return gate.response
  try {
    const body = await req.json() as Body
    const row = await toRow(body, true)
    if (typeof row === 'string') return NextResponse.json({ error: row }, { status: 400 })
    const { data, error } = await supabaseAdmin.from('tk_employees').insert(row).select('id').single()
    if (error) return jsonError(error.message)
    if (body.pin) await supabaseAdmin.from('tk_employees').update({ pin_hash: await hashPin(data.id, body.pin) }).eq('id', data.id)
    return NextResponse.json({ id: data.id })
  } catch (e) {
    return jsonError(e)
  }
}

export async function PATCH(req: NextRequest) {
  const gate = await requireExec(req)
  if (!gate.ok) return gate.response
  try {
    const body = await req.json() as Body
    if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 })
    const row = await toRow(body, false)
    if (typeof row === 'string') return NextResponse.json({ error: row }, { status: 400 })
    if (body.pin && !body.resetPin) { row.pin_hash = await hashPin(body.id, body.pin); row.pin_set_at = null }
    const { error } = await supabaseAdmin.from('tk_employees').update(row).eq('id', body.id)
    if (error) return jsonError(error.message)
    // A new or cleared PIN ends any session they had open, and lifts a
    // lockout — the kiosk tells a locked-out person to ask a manager.
    if (body.pin || body.resetPin) {
      await supabaseAdmin.from('tk_kiosk_sessions').delete().eq('employee_id', body.id)
      await clearPinFailures(body.id)
    }
    // Deactivating someone signs them out of the kiosk.
    if (body.active === false) await supabaseAdmin.from('tk_kiosk_sessions').delete().eq('employee_id', body.id)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return jsonError(e)
  }
}
