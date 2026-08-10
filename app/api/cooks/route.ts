export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// ── Cook tagging feed ───────────────────────────────────────────────────────────
// The smokehouse controller logs each cook cycle (start/end/temps) but never
// what was in it, so the crew tags a cook with its recipe here. That recipe
// then shows on the master calendar's Smokehouse lane. This is the "actual"
// half of smokehouse scheduling (planned cooks come next).

// GET /api/cooks?days=45 — recent cooks, newest first, with their recipe name.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const days = Math.min(Math.max(parseInt(searchParams.get('days') ?? '45', 10) || 45, 1), 365)
  const cutoff = searchParams.get('since') || new Date(Date.now() - days * 86_400_000).toISOString()

  const q = supabase
    .from('smokehouse_cook')
    .select('id, started_at, ended_at, batch, operator, profile_key')
    .gte('started_at', cutoff)
    .order('started_at', { ascending: false })
    .limit(300)

  const [{ data: cooks, error }, { data: profiles }, { data: rhFaults }] = await Promise.all([
    q,
    supabase.from('cook_profile').select('profile_key, display_name').eq('active', true),
    // Humidity sensor health, derived from the readings themselves — this works
    // with no help from the controller's alarm log.
    supabase
      .from('smokehouse_rh_fault_v')
      .select('cook_id, stuck_value, stuck_samples, stuck_started_at, mean_abs_rh_err')
      .eq('suspect', true),
  ])
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const nameByKey = new Map<string, string>()
  for (const p of profiles ?? []) nameByKey.set(String(p.profile_key), p.display_name as string)

  const faultByCook = new Map<string, Record<string, unknown>>()
  for (const f of rhFaults ?? []) faultByCook.set(String(f.cook_id), f)

  const rows = (cooks ?? []).map(c => {
    const start = c.started_at ? new Date(c.started_at as string).getTime() : 0
    const end   = c.ended_at   ? new Date(c.ended_at   as string).getTime() : 0
    const hours = start && end && end > start ? Math.round((end - start) / 360000) / 10 : null
    const fault = faultByCook.get(String(c.id))
    return {
      id:           c.id,
      started_at:   c.started_at,
      ended_at:     c.ended_at,
      hours,
      profile_key:  (c.profile_key as string) ?? null,
      recipe:       c.profile_key ? nameByKey.get(String(c.profile_key)) ?? null : null,
      operator:     (c.operator as string) ?? null,
      rh_fault:     fault
        ? {
            stuck_value:     Number(fault.stuck_value),
            stuck_samples:   Number(fault.stuck_samples),
            stuck_started_at: fault.stuck_started_at as string,
            mean_abs_rh_err: Number(fault.mean_abs_rh_err),
          }
        : null,
    }
  })

  return NextResponse.json({ cooks: rows, days })
}

// PATCH /api/cooks — tag a cook with its recipe. { id, profile_key } — a null or
// empty profile_key clears the tag.
export async function PATCH(req: NextRequest) {
  const body = await req.json()
  const { id, profile_key } = body
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const { data, error } = await supabase
    .from('smokehouse_cook')
    .update({ profile_key: profile_key || null })
    .eq('id', id)
    .select('id, profile_key')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
