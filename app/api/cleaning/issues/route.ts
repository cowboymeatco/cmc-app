export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { isoDate } from '@/lib/dates'
import { shiftDateFor } from '@/lib/cleaning'

// The shared inbox between the day production crew and the night cleaning crew.
//
// GET    ?status=open|all      → the inbox
// POST                         → file one (day crew, from anywhere in the app)
// PATCH  { id, action }        → schedule onto a night, resolve, or decline
//
// One table, two intents: 'heads_up' ("the grinder auger has buildup, get it
// tonight") and 'miss' ("the saw wasn't clean this morning"). Keeping them
// together matters — a person noticing a problem shouldn't have to classify
// their own complaint correctly to be heard, and both end up as work for the
// same crew.

export async function GET(req: NextRequest) {
  const url    = new URL(req.url)
  const status = url.searchParams.get('status') ?? 'open'

  let q = supabase.from('cleaning_issues').select('*').order('created_at', { ascending: false })
  // 'open' means anything still needing attention, which includes issues
  // already scheduled onto a night but not yet confirmed done.
  if (status === 'open') q = q.in('status', ['open', 'scheduled'])
  else if (status !== 'all') q = q.eq('status', status)

  const { data, error } = await q.limit(300)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const {
    description, reported_by, intent, area_id, asset_id,
    severity, photo_url, page_url,
  } = body as Record<string, string | undefined>

  if (!description?.trim()) {
    return NextResponse.json({ error: 'Say what the problem is.' }, { status: 400 })
  }
  if (!reported_by?.trim()) {
    return NextResponse.json({ error: 'Add your name so the crew can ask you about it.' }, { status: 400 })
  }

  // Snapshot the names alongside the ids: an issue from three months ago should
  // still read correctly after a machine is renamed or retired.
  let areaName:  string | null = null
  let equipName: string | null = null
  if (area_id) {
    const { data } = await supabase.from('cleaning_areas').select('name').eq('id', area_id).single()
    areaName = (data?.name as string) ?? null
  }
  if (asset_id) {
    const { data } = await supabase
      .from('assets').select('name, area_id, cleaning_areas(name)')
      .eq('id', asset_id).single()
    equipName = (data?.name as string) ?? null
    if (!areaName && data?.cleaning_areas) {
      const a = data.cleaning_areas as { name: string } | { name: string }[]
      areaName = (Array.isArray(a) ? a[0]?.name : a?.name) ?? null
    }
  }

  const { data, error } = await supabase
    .from('cleaning_issues')
    .insert([{
      description:    description.trim(),
      reported_by:    reported_by.trim(),
      intent:         intent === 'miss' ? 'miss' : 'heads_up',
      severity:       severity === 'urgent' ? 'urgent' : 'normal',
      area_id:        area_id ?? null,
      asset_id:   asset_id ?? null,
      area_name:      areaName,
      equipment_name: equipName,
      photo_url:      photo_url ?? null,
      page_url:       page_url ?? null,
    }])
    .select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Urgent issues page out immediately; normal ones wait to be read off the
  // inbox. Reusing the feedback webhook keeps this to zero new plumbing, and a
  // failure here must never lose the report that's already saved.
  if (severity === 'urgent' && process.env.ZAPIER_FEEDBACK_WEBHOOK) {
    fetch(process.env.ZAPIER_FEEDBACK_WEBHOOK, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type:        '🧽 Urgent cleaning issue',
        submitter:   reported_by.trim(),
        page_url:    [areaName, equipName].filter(Boolean).join(' · ') || 'unspecified',
        description: description.trim(),
      }),
    }).catch(() => { /* already saved; the inbox is the source of truth */ })
  }

  return NextResponse.json(data)
}

export async function PATCH(req: NextRequest) {
  const body = await req.json()
  const { id, action, by, note } = body as {
    id?: string; action?: string; by?: string; note?: string
  }
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const { data: issue, error: findErr } = await supabase
    .from('cleaning_issues').select('*').eq('id', id).single()
  if (findErr || !issue) return NextResponse.json({ error: 'issue not found' }, { status: 404 })

  // Put it on a night's list. This is the step that actually closes the loop:
  // the reporter can see their report became a real item on a real shift.
  if (action === 'schedule') {
    const dateISO = (body as { date?: string }).date || shiftDateFor(new Date(), isoDate())

    const { data: shift } = await supabase
      .from('cleaning_shifts').select('id, status').eq('shift_date', dateISO).maybeSingle()
    if (!shift) {
      return NextResponse.json(
        { error: "That night hasn't been opened yet — open the shift first." },
        { status: 400 },
      )
    }
    if (shift.status === 'closed') {
      return NextResponse.json({ error: 'That shift is already closed.' }, { status: 409 })
    }

    const { data: last } = await supabase
      .from('cleaning_shift_items').select('sort_order')
      .eq('shift_id', shift.id).order('sort_order', { ascending: false }).limit(1)

    const { data: item, error: itemErr } = await supabase
      .from('cleaning_shift_items')
      .insert([{
        shift_id:       shift.id,
        asset_id:   issue.asset_id,
        title:          issue.description,
        detail:         `Reported by ${issue.reported_by}`,
        area_name:      issue.area_name || 'Reported',
        equipment_name: issue.equipment_name,
        source:         'issue',
        sort_order:     ((last?.[0]?.sort_order as number) ?? 0) + 10,
      }])
      .select().single()
    if (itemErr) return NextResponse.json({ error: itemErr.message }, { status: 500 })

    const { data, error } = await supabase
      .from('cleaning_issues')
      .update({ status: 'scheduled', shift_item_id: item.id })
      .eq('id', id).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ...data, shift_item: item })
  }

  if (action === 'resolve' || action === 'decline') {
    if (!by?.trim()) {
      return NextResponse.json({ error: 'Add your name to close this out.' }, { status: 400 })
    }
    const { data, error } = await supabase
      .from('cleaning_issues')
      .update({
        status:          action === 'resolve' ? 'resolved' : 'declined',
        resolved_at:     new Date().toISOString(),
        resolved_by:     by.trim(),
        resolution_note: note?.trim() || null,
      })
      .eq('id', id).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(data)
  }

  return NextResponse.json({ error: 'action must be schedule, resolve, or decline' }, { status: 400 })
}
