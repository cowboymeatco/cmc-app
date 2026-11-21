export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { isUuid, jsonError, requireHr } from '@/lib/hrDocsServer'

type Ctx = { params: Promise<{ id: string }> }

// POST /api/carcass-floor/[id] — what the crew does from a carcass's QR page
// (/carcass/[id]). Signed in with the time clock PIN, the same door as the
// handbook, so every move carries the name of whoever made it.
//
//   { action: 'stage' }    moved to the staging cooler (staged_at, staged_by)
//   { action: 'unstage' }  the way back, for a tap on the wrong carcass
//   { action: 'cut' }      off the rail: status 'cut', cut_at, cut_by
//   { action: 'aging', days }  this carcass's aging target; null = default
//
// Staging is deliberately not a status. Capacity, the cut schedule, the cooler
// charts and the processing scan all read 'chilling' as "hanging in the
// building", and a staged carcass still is. Every write is guarded on
// status = 'chilling' so a carcass already cut or delivered can't be moved
// back onto the rail from here.
export async function POST(req: NextRequest, ctx: Ctx) {
  const auth = await requireHr(req)
  if (!auth.ok) return auth.response
  try {
    const { id } = await ctx.params
    if (!isUuid(id)) return NextResponse.json({ error: 'not_found', message: 'Carcass not found.' }, { status: 404 })
    const body = await req.json().catch(() => ({})) as { action?: string; days?: unknown }
    const who = auth.employee.name
    const now = new Date().toISOString()

    let updates: Record<string, unknown>
    switch (body.action) {
      case 'stage':   updates = { staged_at: now, staged_by: who }; break
      case 'unstage': updates = { staged_at: null, staged_by: null }; break
      case 'cut':     updates = { status: 'cut', cut_at: now, cut_by: who }; break
      case 'aging': {
        const d = body.days === null || body.days === '' ? null : Number(body.days)
        if (d !== null && (!Number.isInteger(d) || d < 1 || d > 90)) {
          return NextResponse.json({ error: 'bad_request', message: 'Aging target must be 1 to 90 days, or blank for the default.' }, { status: 400 })
        }
        updates = { aging_target_days: d }
        break
      }
      default:
        return NextResponse.json({ error: 'bad_request', message: 'Unknown action.' }, { status: 400 })
    }

    const { data, error } = await supabaseAdmin
      .from('harvest_log')
      .update(updates)
      .eq('id', id)
      .eq('status', 'chilling')
      .select('*')
    if (error) throw new Error(error.message)
    if (!data || data.length === 0) {
      return NextResponse.json({ error: 'off_rail', message: 'This carcass is already off the rail (cut or delivered).' }, { status: 409 })
    }
    return NextResponse.json({ log: data[0] }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return jsonError(e)
  }
}
