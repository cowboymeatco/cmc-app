export const runtime = 'edge'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { requireExec } from '@/lib/execGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { isoDate, addDaysISO } from '@/lib/dates'
import { hoursBetween, type Priority } from '@/lib/cleaning'

// GET /api/exec/cleaning?days=14 — one row per cleaning shift for the owner's
// review: who was on, hours from Start to close, when P1 finished, how much of
// P2 got done, and how many items rolled to the morning.
//
// Hours is closed_at − started_at, and both stamps are real events now (a
// person pressing Start, a person or the 3 AM clock closing). A row closed by
// 'system' is flagged: its hours are a cap, not a measurement.

interface ShiftRow {
  id: string; shift_date: string; status: string
  started_at: string | null; started_by: string | null
  closed_at: string | null; closed_by: string | null
  p1_complete_at: string | null; crew_ids: string[] | null
}
interface ItemRow { shift_id: string; priority: Priority; status: string }

export async function GET(req: NextRequest) {
  const gate = await requireExec(req)
  if (!gate.ok) return gate.response

  const days  = Math.min(Math.max(Number(new URL(req.url).searchParams.get('days')) || 14, 7), 60)
  const since = addDaysISO(isoDate(), -days)

  const { data: shifts, error } = await supabaseAdmin
    .from('cleaning_shifts')
    .select('id, shift_date, status, started_at, started_by, closed_at, closed_by, p1_complete_at, crew_ids')
    .gte('shift_date', since)
    .order('shift_date', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rows = (shifts ?? []) as ShiftRow[]
  const ids  = rows.map(s => s.id)

  const [{ data: items }, { data: crew }] = await Promise.all([
    ids.length
      ? supabaseAdmin.from('cleaning_shift_items').select('shift_id, priority, status').in('shift_id', ids)
      : Promise.resolve({ data: [] as ItemRow[] }),
    supabaseAdmin.from('cleaning_crew').select('id, name'),
  ])
  const crewName = new Map((crew ?? []).map(c => [c.id as string, c.name as string]))

  const byShift = new Map<string, ItemRow[]>()
  for (const it of (items ?? []) as ItemRow[]) {
    if (!byShift.has(it.shift_id)) byShift.set(it.shift_id, [])
    byShift.get(it.shift_id)!.push(it)
  }

  const out = rows.map(s => {
    const mine  = byShift.get(s.id) ?? []
    const tier  = (p: Priority) => mine.filter(i => i.priority === p)
    const done  = (list: ItemRow[]) => list.filter(i => i.status === 'done' || i.status === 'na').length
    const p1 = tier(1), p2 = tier(2), p3 = tier(3)
    return {
      shift_date:     s.shift_date,
      status:         s.status,
      crew:           (s.crew_ids ?? []).map(id => crewName.get(id) ?? '?'),
      started_by:     s.started_by,
      started_at:     s.started_at,
      closed_at:      s.closed_at,
      closed_by:      s.closed_by,
      auto_closed:    s.closed_by === 'system',
      hours:          hoursBetween(s.started_at, s.closed_at),
      p1_complete_at: s.p1_complete_at,
      p1_done:        done(p1),
      p1_total:       p1.length,
      p2_done:        done(p2),
      p2_total:       p2.length,
      p2_pct:         p2.length ? Math.round((done(p2) / p2.length) * 100) : null,
      p3_done:        done(p3),
      p3_total:       p3.length,
      rolled:         mine.filter(i => i.status === 'rolled').length,
    }
  })

  return NextResponse.json({ days, since, shifts: out })
}
