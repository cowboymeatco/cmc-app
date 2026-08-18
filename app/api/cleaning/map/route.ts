export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { isoDate } from '@/lib/dates'
import {
  shiftDateFor, areaState, areasInUse,
  type ProductionSignal, type CleaningTask, type ItemStatus,
} from '@/lib/cleaning'

// GET  /api/cleaning/map        → everything the plant map draws in one call
// PATCH /api/cleaning/map       → save geometry (the layout editor) or settings
//
// Reads the shift; never opens one. Looking at a map is not starting a night's
// work, and building the list freezes what's on it — see the peek note in the
// shift route. On a night nobody has started, every room simply reads
// "nothing scheduled" rather than the map inventing a list to colour.

interface AreaRow {
  id: string
  name: string
  sort_order: number
  map_x: number | null
  map_y: number | null
  map_w: number | null
  map_h: number | null
  map_color: string | null
}

export async function GET(req: NextRequest) {
  const dateISO = new URL(req.url).searchParams.get('date')
    || shiftDateFor(new Date(), isoDate())

  const [areasRes, settingsRes, shiftRes, tasksRes] = await Promise.all([
    supabase.from('cleaning_areas')
      .select('id, name, sort_order, map_x, map_y, map_w, map_h, map_color')
      .eq('active', true).order('sort_order'),
    supabase.from('cleaning_map_settings').select('*').eq('id', 1).maybeSingle(),
    supabase.from('cleaning_shifts').select('*').eq('shift_date', dateISO).maybeSingle(),
    supabase.from('cleaning_tasks').select('area_id, production_triggers').eq('active', true),
  ])

  const areas = (areasRes.data ?? []) as AreaRow[]
  const shift = shiftRes.data

  // Items only exist once a shift has been opened. The status column is a
  // CHECK-constrained enum in the database but arrives typed as plain string,
  // so it is narrowed here at the boundary rather than cast at each use.
  interface ItemRow { area_name: string; status: ItemStatus; equipment_name: string | null }
  let items: ItemRow[] = []
  if (shift) {
    const { data } = await supabase
      .from('cleaning_shift_items')
      .select('area_name, status, equipment_name')
      .eq('shift_id', shift.id)
    items = (data ?? []) as ItemRow[]
  }

  const signals = (shift?.production_seen ?? []) as ProductionSignal[]
  const inUse   = areasInUse((tasksRes.data ?? []) as Pick<CleaningTask, 'area_id' | 'production_triggers'>[], signals)

  // Items snapshot area_name rather than pointing at the area, so history stays
  // readable after a rename — which means grouping here is by name too.
  const rooms = areas.map(a => {
    const mine = items.filter(i => i.area_name === a.name)
    return {
      id:        a.id,
      name:      a.name,
      x:         a.map_x, y: a.map_y, w: a.map_w, h: a.map_h,
      color:     a.map_color,
      state:     areaState(mine),
      total:     mine.length,
      pending:   mine.filter(i => i.status === 'pending').length,
      flagged:   mine.filter(i => i.status === 'issue').length,
      in_use:    inUse.has(a.id),
      // Rooms nobody has positioned yet still need to appear somewhere, so the
      // map view can lay them out rather than silently dropping them.
      positioned: a.map_x !== null && a.map_y !== null && a.map_w !== null && a.map_h !== null,
    }
  })

  return NextResponse.json({
    date:     dateISO,
    shift:    shift ? { id: shift.id, status: shift.status, production_seen: signals } : null,
    rooms,
    settings: settingsRes.data ?? {
      background_url: null, background_alpha: 0.35, canvas_w: 1000, canvas_h: 700,
    },
  })
}

export async function PATCH(req: NextRequest) {
  const body = await req.json()

  // { settings: {...} } — background image, its opacity, canvas size
  if (body.settings) {
    const s = body.settings as Record<string, unknown>
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
    for (const k of ['background_url', 'background_path', 'background_alpha', 'canvas_w', 'canvas_h']) {
      if (s[k] !== undefined) patch[k] = s[k]
    }
    const { data, error } = await supabase
      .from('cleaning_map_settings').update(patch).eq('id', 1).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(data)
  }

  // { rooms: [{ id, x, y, w, h }] } — a drag or resize from the layout editor
  const rooms = body.rooms
  if (!Array.isArray(rooms) || rooms.length === 0) {
    return NextResponse.json({ error: 'rooms or settings required' }, { status: 400 })
  }

  for (const r of rooms) {
    if (!r?.id) continue
    const patch: Record<string, unknown> = {}
    // Rounded because the editor emits sub-pixel drag positions, and a stored
    // 412.7031 makes the numbers unreadable when someone inspects the row.
    if (r.x !== undefined) patch.map_x = Math.round(Number(r.x))
    if (r.y !== undefined) patch.map_y = Math.round(Number(r.y))
    // Floored at a size that can still be tapped and still fit a label.
    if (r.w !== undefined) patch.map_w = Math.max(60, Math.round(Number(r.w)))
    if (r.h !== undefined) patch.map_h = Math.max(50, Math.round(Number(r.h)))
    if (r.color !== undefined) patch.map_color = r.color || null
    if (Object.keys(patch).length === 0) continue

    const { error } = await supabase.from('cleaning_areas').update(patch).eq('id', r.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ saved: rooms.length })
}
