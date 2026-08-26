export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

// GET /api/cook-profile — every profile plus the shop-wide house settings.
// The planner needs both in one round trip to lay out a schedule.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const includeInactive = searchParams.get('all') === '1'

  let q = supabase.from('cook_profile').select('*').order('n_observations', { ascending: false })
  if (!includeInactive) q = q.eq('active', true)

  const [{ data: profiles, error }, { data: settings }] = await Promise.all([
    q,
    supabase.from('cook_settings').select('*').eq('id', 1).maybeSingle(),
  ])

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ profiles: profiles ?? [], settings })
}

// PATCH /api/cook-profile — hand-tune a profile (setup/teardown time, batch
// size, or a duration the crew knows better than the history does).
//
// Any hand edit flips source to 'manual', which is what keeps a future reseed
// from the controller logs from quietly overwriting it — the seed only updates
// rows still marked 'history'.
const PROFILE_FIELDS = [
  'display_name', 'job_type', 'active',
  'p10_minutes', 'p50_minutes', 'p90_minutes',
  'setup_minutes', 'teardown_minutes', 'lbs_per_batch',
  'units_per_batch', 'unit_label',
  'ramp_f_per_hr', 'target_core_f',
  'typical_start_hour', 'overnight_pct', 'notes',
] as const

export async function PATCH(req: NextRequest) {
  const body = await req.json()
  const { id, ...rest } = body
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  for (const f of PROFILE_FIELDS) {
    if (rest[f] !== undefined) updates[f] = rest[f]
  }
  // Only a real value change earns the 'manual' stamp — toggling active off a
  // stale profile shouldn't freeze its numbers against the next reseed.
  const touchedNumbers = PROFILE_FIELDS
    .filter(f => f !== 'active' && f !== 'notes')
    .some(f => rest[f] !== undefined)
  if (touchedNumbers) updates.source = 'manual'

  const { data, error } = await supabase
    .from('cook_profile')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// PUT /api/cook-profile — update the shop-wide house settings.
export async function PUT(req: NextRequest) {
  const body = await req.json()
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  for (const f of ['houses', 'changeover_minutes', 'day_start_hour', 'day_end_hour']) {
    if (body[f] !== undefined) updates[f] = body[f]
  }

  const { data, error } = await supabase
    .from('cook_settings')
    .update(updates)
    .eq('id', 1)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
