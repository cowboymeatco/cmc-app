export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { requireExec } from '@/lib/execGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { addDaysISO } from '@/lib/dates'
import { toMin } from '@/lib/timekeeping'
import { jsonError } from '@/lib/timeclockServer'

// PUT    /api/timekeeping/schedule — { employeeId, date, start, end }: set a day's shift.
// DELETE /api/timekeeping/schedule?employeeId&date — make it a day off.
// POST   /api/timekeeping/schedule — { copyFrom, copyTo } (Mondays): copy a whole week.

const ISO = /^\d{4}-\d{2}-\d{2}$/
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

export async function PUT(req: NextRequest) {
  const gate = await requireExec(req)
  if (!gate.ok) return gate.response
  try {
    const { employeeId, date, start, end } = await req.json()
    if (!employeeId || !ISO.test(date) || !HHMM.test(start) || !HHMM.test(end) || toMin(end) <= toMin(start)) {
      return NextResponse.json({ error: 'Pick a start and an end after it.' }, { status: 400 })
    }
    const { error } = await supabaseAdmin.from('tk_schedule')
      .upsert({ employee_id: employeeId, shop_date: date, start_time: start, end_time: end, updated_at: new Date().toISOString() })
    if (error) return jsonError(error.message)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return jsonError(e)
  }
}

export async function DELETE(req: NextRequest) {
  const gate = await requireExec(req)
  if (!gate.ok) return gate.response
  const employeeId = req.nextUrl.searchParams.get('employeeId')
  const date = req.nextUrl.searchParams.get('date') ?? ''
  if (!employeeId || !ISO.test(date)) return NextResponse.json({ error: 'employeeId and date required' }, { status: 400 })
  const { error } = await supabaseAdmin.from('tk_schedule').delete().eq('employee_id', employeeId).eq('shop_date', date)
  if (error) return jsonError(error.message)
  return NextResponse.json({ ok: true })
}

export async function POST(req: NextRequest) {
  const gate = await requireExec(req)
  if (!gate.ok) return gate.response
  try {
    const { copyFrom, copyTo } = await req.json()
    if (!ISO.test(copyFrom) || !ISO.test(copyTo)) return NextResponse.json({ error: 'copyFrom and copyTo required' }, { status: 400 })
    const { data, error } = await supabaseAdmin.from('tk_schedule').select('employee_id, shop_date, start_time, end_time')
      .gte('shop_date', copyFrom).lte('shop_date', addDaysISO(copyFrom, 6))
    if (error) return jsonError(error.message)
    const shift = Math.round((Date.parse(copyTo) - Date.parse(copyFrom)) / 86_400_000)
    // The target week becomes an exact copy: clear it, then write the source's days.
    const { error: delErr } = await supabaseAdmin.from('tk_schedule').delete().gte('shop_date', copyTo).lte('shop_date', addDaysISO(copyTo, 6))
    if (delErr) return jsonError(delErr.message)
    const rows = (data ?? []).map(r => ({ ...r, shop_date: addDaysISO(r.shop_date as string, shift), updated_at: new Date().toISOString() }))
    if (rows.length) {
      const { error: insErr } = await supabaseAdmin.from('tk_schedule').insert(rows)
      if (insErr) return jsonError(insErr.message)
    }
    return NextResponse.json({ copied: rows.length })
  } catch (e) {
    return jsonError(e)
  }
}
