export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { isoDate } from '@/lib/dates'

export const dynamic = 'force-dynamic'

// POST — repack: move scan lines from one box into another box (or a brand-new
// one), within the same session.
//
// This exists so a mis-scanned box gets CORRECTED rather than RE-SCANNED.
// Re-scanning is what double-counts: the bad weight stays on the old box and
// the good weight lands on the new one, and every downstream total (session
// lbs, yield %, WIP allocation, delivery load, value-add weight-out) adds both.
// Moving the existing box_scans rows conserves weight by construction — nothing
// is created or destroyed, only re-parented — and both boxes' cached
// total_weight_lbs / total_cuts are recomputed from the surviving scan rows so
// the box header can never drift from its contents.
//
// Body: { scan_ids: string[], target: { box_id } | { new_box: true, is_final?, box_label? } }
export async function POST(req: NextRequest) {
  const body = await req.json()
  const { scan_ids, target } = body as {
    scan_ids?: string[]
    target?: { box_id?: string; new_box?: boolean; is_final?: boolean; box_label?: string }
  }

  if (!Array.isArray(scan_ids) || scan_ids.length === 0) {
    return NextResponse.json({ error: 'scan_ids required' }, { status: 400 })
  }
  if (!target?.box_id && !target?.new_box) {
    return NextResponse.json({ error: 'target {box_id} or {new_box:true} required' }, { status: 400 })
  }

  // ── The scans being moved, and the boxes they come from ────────────────────
  const { data: scans, error: sErr } = await supabase
    .from('box_scans')
    .select('id, box_id, weight_lbs')
    .in('id', scan_ids)
  if (sErr) return NextResponse.json({ error: sErr.message }, { status: 500 })
  if (!scans || scans.length === 0) {
    return NextResponse.json({ error: 'no matching scans' }, { status: 404 })
  }
  if (scans.length !== scan_ids.length) {
    // Someone deleted a line out from under this repack — bail rather than move
    // a partial set the operator did not confirm.
    return NextResponse.json({ error: 'some scans no longer exist — reload the box and try again' }, { status: 409 })
  }

  const sourceIds = Array.from(new Set(scans.map(s => s.box_id).filter(Boolean))) as string[]
  if (sourceIds.length === 0) {
    return NextResponse.json({ error: 'scans have no source box' }, { status: 400 })
  }

  const { data: sourceBoxes, error: sbErr } = await supabase
    .from('boxes')
    .select('id, customer_name, pack_date, box_number, is_closed')
    .in('id', sourceIds)
  if (sbErr) return NextResponse.json({ error: sbErr.message }, { status: 500 })
  if (!sourceBoxes || sourceBoxes.length === 0) {
    return NextResponse.json({ error: 'source box not found' }, { status: 404 })
  }

  // One session per repack. Cross-session movement is what /api/boxes/reassign
  // is for, and it renumbers + reprints; silently mixing the two would strand a
  // box in a session whose label it does not carry.
  const session = { customer_name: sourceBoxes[0].customer_name, pack_date: sourceBoxes[0].pack_date }
  if (sourceBoxes.some(b => b.customer_name !== session.customer_name || b.pack_date !== session.pack_date)) {
    return NextResponse.json({ error: 'scans span more than one session' }, { status: 400 })
  }

  // ── Resolve the target box ─────────────────────────────────────────────────
  let targetBoxId: string
  let createdBox: Record<string, unknown> | null = null

  if (target.box_id) {
    const { data: tgt, error: tErr } = await supabase
      .from('boxes')
      .select('id, customer_name, pack_date')
      .eq('id', target.box_id)
      .maybeSingle()
    if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 })
    if (!tgt) return NextResponse.json({ error: 'target box not found' }, { status: 404 })
    if (tgt.customer_name !== session.customer_name || tgt.pack_date !== session.pack_date) {
      return NextResponse.json({ error: 'target box is in a different session — use Reassign instead' }, { status: 400 })
    }
    if (sourceIds.length === 1 && sourceIds[0] === tgt.id) {
      return NextResponse.json({ error: 'those cuts are already in that box' }, { status: 400 })
    }
    targetBoxId = tgt.id
  } else {
    const { data: sessionBoxes, error: nErr } = await supabase
      .from('boxes')
      .select('box_number')
      .eq('customer_name', session.customer_name)
      .eq('pack_date', session.pack_date)
    if (nErr) return NextResponse.json({ error: nErr.message }, { status: 500 })
    const nextNum = (sessionBoxes ?? []).reduce((m, b) => Math.max(m, Number(b.box_number) || 0), 0) + 1
    const dateStr = isoDate().slice(2).replace(/-/g, '')
    const rand = Math.random().toString(36).substring(2, 6).toUpperCase()

    const { data: made, error: cErr } = await supabase
      .from('boxes')
      .insert([{
        customer_name: session.customer_name,
        pack_date:     session.pack_date,
        box_number:    nextNum,
        is_closed:     false,
        is_final:      target.is_final ?? false,
        box_label:     target.box_label?.trim() || null,
        serial_number: `CMC${dateStr}${rand}`,
      }])
      .select()
      .single()
    if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 })
    targetBoxId = made.id
    createdBox = made
  }

  // ── The move itself ────────────────────────────────────────────────────────
  const { error: mErr } = await supabase
    .from('box_scans')
    .update({ box_id: targetBoxId })
    .in('id', scan_ids)
  if (mErr) return NextResponse.json({ error: mErr.message }, { status: 500 })

  // ── Re-derive both sides' cached totals from the scans that actually remain ─
  const affectedIds = Array.from(new Set([...sourceIds, targetBoxId]))
  const { data: freshScans, error: fErr } = await supabase
    .from('box_scans')
    .select('box_id, weight_lbs')
    .in('box_id', affectedIds)
  if (fErr) return NextResponse.json({ error: fErr.message }, { status: 500 })

  const totals = new Map<string, { lbs: number; cuts: number }>()
  for (const id of affectedIds) totals.set(id, { lbs: 0, cuts: 0 })
  for (const s of freshScans ?? []) {
    const t = totals.get(s.box_id as string)
    if (!t) continue
    t.lbs += Number(s.weight_lbs) || 0
    t.cuts += 1
  }

  const boxesAfter: Record<string, unknown>[] = []
  for (const id of affectedIds) {
    const t = totals.get(id)!
    const { data: upd, error: uErr } = await supabase
      .from('boxes')
      .update({ total_weight_lbs: Math.round(t.lbs * 100) / 100, total_cuts: t.cuts })
      .eq('id', id)
      .select()
      .single()
    if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 })
    boxesAfter.push(upd)
  }

  // A closed box carries a printed label stating its weight and cut count. If
  // repacking changed either, that label is now a lie — tell the caller which
  // ones to reprint, and which boxes are left holding nothing.
  const relabel = boxesAfter.filter(b => b.is_closed).map(b => b.id as string)
  const emptied = boxesAfter.filter(b => (b.total_cuts as number) === 0).map(b => b.id as string)

  return NextResponse.json({
    ok: true,
    moved: scans.length,
    moved_lbs: Math.round(scans.reduce((s, sc) => s + (Number(sc.weight_lbs) || 0), 0) * 100) / 100,
    target_box_id: targetBoxId,
    created_box: createdBox,
    boxes: boxesAfter,
    relabel,
    emptied,
  })
}
