export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { requireExec } from '@/lib/execGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { hashPin, jsonError, validPin } from '@/lib/timeclockServer'

// POST  /api/timekeeping/employees — add someone to the time clock.
// PATCH /api/timekeeping/employees — edit, set a new PIN, or deactivate.
// Nobody is ever deleted: their shifts are payroll records.

const ISO = /^\d{4}-\d{2}-\d{2}$/

interface Body {
  id?: string; name?: string; role?: string | null; hireDate?: string; pin?: string; active?: boolean
  qboEmployeeId?: string | null; ptoOpeningHours?: number; ptoOpeningAsOf?: string
}

async function toRow(b: Body, creating: boolean): Promise<Record<string, unknown> | string> {
  const row: Record<string, unknown> = {}
  if (b.name !== undefined) { if (!b.name.trim()) return 'Name is required.'; row.name = b.name.trim() }
  else if (creating) return 'Name is required.'
  if (b.role !== undefined) row.role = b.role?.trim() || null
  if (b.hireDate !== undefined) { if (!ISO.test(b.hireDate)) return 'Hire date is required.'; row.hire_date = b.hireDate }
  else if (creating) return 'Hire date is required.'
  if (b.pin !== undefined && b.pin !== '') { if (!validPin(b.pin)) return 'PIN must be 4 digits.'; row.pin_hash = await hashPin(b.pin) }
  else if (creating) return 'Give them a 4-digit PIN.'
  if (b.active !== undefined) row.active = !!b.active
  if (b.qboEmployeeId !== undefined) row.qbo_employee_id = b.qboEmployeeId?.trim() || null
  if (b.ptoOpeningHours !== undefined) { const n = Number(b.ptoOpeningHours); if (!Number.isFinite(n)) return 'Opening PTO must be a number.'; row.pto_opening_hours = n }
  if (b.ptoOpeningAsOf !== undefined) { if (!ISO.test(b.ptoOpeningAsOf)) return 'Opening PTO date is required.'; row.pto_opening_as_of = b.ptoOpeningAsOf }
  return row
}

function dbError(message: string, code?: string) {
  if (code === '23505') return NextResponse.json({ error: 'That PIN is already someone else\'s. Pick another.' }, { status: 409 })
  return NextResponse.json({ error: message }, { status: 500 })
}

export async function POST(req: NextRequest) {
  const gate = await requireExec(req)
  if (!gate.ok) return gate.response
  try {
    const row = await toRow(await req.json(), true)
    if (typeof row === 'string') return NextResponse.json({ error: row }, { status: 400 })
    const { data, error } = await supabaseAdmin.from('tk_employees').insert(row).select('id').single()
    if (error) return dbError(error.message, error.code)
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
    const { error } = await supabaseAdmin.from('tk_employees').update(row).eq('id', body.id)
    if (error) return dbError(error.message, error.code)
    // Deactivating someone signs them out of the kiosk.
    if (body.active === false) await supabaseAdmin.from('tk_kiosk_sessions').delete().eq('employee_id', body.id)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return jsonError(e)
  }
}
