export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import type { GameRate } from '@/lib/gameBilling'

export const dynamic = 'force-dynamic'

// The price list, as data.
//
// This route exists so that "Jill is updating pricing today" is a change she
// makes on a screen, not a change somebody deploys. Rates are stamped onto each
// weighed line at weigh-out, so editing here never rewrites a hunter's existing
// ticket — it only changes what the next one is quoted.

// GET /api/game/rates
export async function GET() {
  const { data, error } = await supabase
    .from('game_rates').select('*').order('sort')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

// PATCH /api/game/rates — { key, rate?, cheese_rate?, label?, active?, note?, updated_by? }
export async function PATCH(req: NextRequest) {
  const body = await req.json()
  const { key, rate, cheese_rate, label, active, note, updated_by } = body as {
    key?: string; rate?: number | null; cheese_rate?: number | null
    label?: string; active?: boolean; note?: string; updated_by?: string
  }
  if (!key) return NextResponse.json({ error: 'key required' }, { status: 400 })

  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
    updated_by: updated_by ?? '',
  }
  // A price of zero is a real answer ("we stopped charging for this"), so the
  // guard is on null/undefined rather than on falsiness.
  if (rate !== undefined && rate !== null) {
    if (Number(rate) < 0) return NextResponse.json({ error: 'rate cannot be negative' }, { status: 400 })
    updates.rate = Number(rate)
  }
  // cheese_rate CAN be set back to null — that means "this product has no
  // cheese version", which is different from "cheese costs nothing".
  if (cheese_rate !== undefined) {
    updates.cheese_rate = cheese_rate === null || cheese_rate === ('' as unknown) ? null : Number(cheese_rate)
  }
  if (label !== undefined)  updates.label = label
  if (active !== undefined) updates.active = active
  if (note !== undefined)   updates.note = note

  const { data, error } = await supabase
    .from('game_rates').update(updates).eq('key', key).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data as GameRate)
}
