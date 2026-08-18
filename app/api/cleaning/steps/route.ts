export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { PHASES, type Phase } from '@/lib/cleaning'

// Procedure steps: how a machine comes apart, gets cleaned, and goes back
// together. Ordered within each phase.
//
// POST   add a step (appends to the end of its phase)
// PATCH  edit one, or reorder with { id, move: 'up' | 'down' }
// DELETE remove one and close the gap in the numbering

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { equipment_id, phase, instruction } = body as Record<string, string | undefined>

  if (!equipment_id || !instruction?.trim()) {
    return NextResponse.json({ error: 'equipment_id and instruction required' }, { status: 400 })
  }
  if (!phase || !PHASES.includes(phase as Phase)) {
    return NextResponse.json({ error: `phase must be one of ${PHASES.join(', ')}` }, { status: 400 })
  }

  const { data: last } = await supabase
    .from('cleaning_steps').select('step_no')
    .eq('equipment_id', equipment_id).eq('phase', phase)
    .order('step_no', { ascending: false }).limit(1)

  const { data, error } = await supabase
    .from('cleaning_steps')
    .insert([{
      equipment_id,
      phase,
      step_no:     ((last?.[0]?.step_no as number) ?? 0) + 1,
      instruction: instruction.trim(),
      photo_url:   body.photo_url ?? null,
      caution:     body.caution?.trim() || null,
    }])
    .select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function PATCH(req: NextRequest) {
  const body = await req.json()
  const { id, move, ...updates } = body as Record<string, unknown> & { id?: string; move?: string }
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  if (move === 'up' || move === 'down') return reorder(id, move)

  updates.updated_at = new Date().toISOString()
  const { data, error } = await supabase
    .from('cleaning_steps').update(updates).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

/**
 * Swap a step with its neighbour in the same phase.
 *
 * (equipment_id, phase, step_no) is unique, so the two rows can't simply trade
 * numbers — the first update would collide with the row still holding the
 * target number. Parking one at a number nothing else uses makes the swap
 * legal at every intermediate state.
 */
async function reorder(id: string, dir: 'up' | 'down') {
  const { data: step } = await supabase
    .from('cleaning_steps').select('id, equipment_id, phase, step_no').eq('id', id).single()
  if (!step) return NextResponse.json({ error: 'step not found' }, { status: 404 })

  const { data: neighbour } = await supabase
    .from('cleaning_steps')
    .select('id, step_no')
    .eq('equipment_id', step.equipment_id).eq('phase', step.phase)
    [dir === 'up' ? 'lt' : 'gt']('step_no', step.step_no)
    .order('step_no', { ascending: dir !== 'up' })
    .limit(1).maybeSingle()

  // Already at the end of its phase — a no-op, not an error.
  if (!neighbour) return NextResponse.json(step)

  const park = -Math.abs(step.step_no as number) - 1000
  await supabase.from('cleaning_steps').update({ step_no: park }).eq('id', step.id)
  await supabase.from('cleaning_steps').update({ step_no: step.step_no }).eq('id', neighbour.id)
  const { data, error } = await supabase
    .from('cleaning_steps').update({ step_no: neighbour.step_no }).eq('id', step.id)
    .select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(req: NextRequest) {
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const { data: step } = await supabase
    .from('cleaning_steps').select('equipment_id, phase, step_no').eq('id', id).single()

  const { error } = await supabase.from('cleaning_steps').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Close the gap so the crew never reads "step 1, 2, 4". Renumbering upward
  // one at a time is safe because the deleted number is now free.
  if (step) {
    const { data: after } = await supabase
      .from('cleaning_steps').select('id, step_no')
      .eq('equipment_id', step.equipment_id).eq('phase', step.phase)
      .gt('step_no', step.step_no)
      .order('step_no', { ascending: true })
    for (const s of after ?? []) {
      await supabase.from('cleaning_steps')
        .update({ step_no: (s.step_no as number) - 1 }).eq('id', s.id)
    }
  }

  return NextResponse.json({ ok: true })
}
