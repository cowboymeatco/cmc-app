export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

// Crew corrections to a written procedure.
//
// The people who tear a machine down every night know where the write-up is
// wrong. This lets them say so from the procedure screen without being able to
// edit the procedure directly — the correction is captured, and applying it
// stays a deliberate act by whoever owns the document.

export async function GET(req: NextRequest) {
  const status = new URL(req.url).searchParams.get('status') ?? 'open'

  let q = supabase
    .from('cleaning_step_suggestions')
    .select('*, cleaning_equipment(id, name), cleaning_steps(step_no, phase, instruction)')
    .order('created_at', { ascending: false })
  if (status !== 'all') q = q.eq('status', status)

  const { data, error } = await q.limit(200)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { equipment_id, step_id, suggestion, suggested_by, photo_url } = body as Record<string, string | undefined>

  if (!equipment_id || !suggestion?.trim()) {
    return NextResponse.json({ error: 'equipment_id and suggestion required' }, { status: 400 })
  }
  if (!suggested_by?.trim()) {
    return NextResponse.json({ error: 'Add your name so we can ask you about it.' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('cleaning_step_suggestions')
    .insert([{
      equipment_id,
      // Null when the note is about the procedure as a whole rather than one
      // step — "there's a step missing here" is the most useful kind.
      step_id:      step_id ?? null,
      suggestion:   suggestion.trim(),
      suggested_by: suggested_by.trim(),
      photo_url:    photo_url ?? null,
    }])
    .select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function PATCH(req: NextRequest) {
  const body = await req.json()
  const { id, action, by } = body as { id?: string; action?: string; by?: string }
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  if (action !== 'applied' && action !== 'declined') {
    return NextResponse.json({ error: 'action must be applied or declined' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('cleaning_step_suggestions')
    .update({
      status:      action,
      reviewed_at: new Date().toISOString(),
      reviewed_by: by?.trim() || null,
    })
    .eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
