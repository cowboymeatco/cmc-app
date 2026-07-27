import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { requireInspector, logActivity } from '@/lib/inspectorGate'

// GET /api/inspector/records?view=cold-storage&days=30
// GET /api/inspector/records?view=kill-day&date=YYYY-MM-DD
//
// The live side of the portal: the same readings the crew logs, served
// read-only. One route so the gate is applied in one place.
export async function GET(req: NextRequest) {
  const gate = await requireInspector(req)
  if (!gate.ok) return gate.response

  const { searchParams } = new URL(req.url)
  const view = searchParams.get('view') ?? 'cold-storage'

  if (view === 'cold-storage') {
    const days  = Math.min(Number(searchParams.get('days') ?? 30) || 30, 365)
    const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)

    const { data, error } = await supabaseAdmin
      .from('cold_storage_log')
      .select('*')
      .gte('recorded_date', since)
      .order('recorded_date', { ascending: false })
      .order('created_at',    { ascending: false })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    await logActivity(gate.visit.id, 'view_cold_storage', `last ${days} days`)
    return NextResponse.json({ view, days, rows: data })
  }

  if (view === 'kill-day') {
    const date = searchParams.get('date')
    if (!date) return NextResponse.json({ error: 'date required' }, { status: 400 })

    const harvestRes = await supabaseAdmin
      .from('harvest_log')
      .select('id, carcass_tag, species, sex, harvest_date, live_weight_lbs, hot_carcass_weight_lbs, yield_pct, inspector_initials, intervention_applied, intervention_type, intervention_temp_f, final_carcass_temp_f, ccp_pass, performed_by, status, notes')
      .eq('harvest_date', date)
      .order('carcass_tag', { ascending: true })
    if (harvestRes.error) return NextResponse.json({ error: harvestRes.error.message }, { status: 500 })

    // Chill readings are logged the day after the kill, so they are pulled by
    // harvest_log_id and not by date. Carcass tags restart each kill day, so
    // matching on the tag would hang another week's readings on these carcasses.
    const ids = (harvestRes.data ?? []).map(h => h.id as string)
    const { data: chill } = ids.length
      ? await supabaseAdmin
          .from('chill_log')
          .select('harvest_log_id, carcass_tag, checked_at, carcass_temp_f, cooler_temp_f, checked_by, notes')
          .in('harvest_log_id', ids)
          .order('checked_at', { ascending: true })
      : { data: [] }

    await logActivity(gate.visit.id, 'view_kill_day', date)
    return NextResponse.json({ view, date, harvest: harvestRes.data ?? [], chill: chill ?? [] })
  }

  return NextResponse.json({ error: 'unknown view' }, { status: 400 })
}
