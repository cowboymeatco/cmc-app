export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { gameCharges, chargeTotal, chargeBuckets, gameYield } from '@/lib/gameBilling'
import { loadRates } from '@/lib/gameRates'
import type { GameIntake, GameOutput, GameAddition, GameEvent } from '@/lib/types'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

// GET /api/game/[id] — one animal and everything hanging off it: what was
// weighed, what we put into it, what it owes, and every time it moved.
//
// The charge lines are computed here rather than stored, so the ticket on the
// screen and the ticket that prints can never disagree. The two subtotals match
// the paper slip: Total Product and Total Other.
export async function GET(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params

  const { data: intake, error } = await supabase
    .from('game_intakes').select('*').eq('id', id).maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!intake) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const [{ data: outputs }, { data: additions }, { data: events }, rates] = await Promise.all([
    supabase.from('game_outputs').select('*').eq('intake_id', id).order('created_at'),
    supabase.from('game_additions').select('*').eq('intake_id', id).order('created_at'),
    supabase.from('game_events').select('*').eq('intake_id', id).order('created_at', { ascending: false }),
    loadRates(),
  ])

  const outs = (outputs ?? []) as GameOutput[]
  const adds = (additions ?? []) as GameAddition[]
  const charges = gameCharges(intake as GameIntake, outs, adds, rates)

  return NextResponse.json({
    intake:    intake as GameIntake,
    outputs:   outs,
    additions: adds,
    events:    (events ?? []) as GameEvent[],
    charges,
    total:     chargeTotal(charges),
    buckets:   chargeBuckets(charges, rates),
    rates:     Object.values(rates),
    yield_pct: gameYield(intake as GameIntake, outs),
  })
}
