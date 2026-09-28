export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export const dynamic = 'force-dynamic'

// "Box is empty": whatever the system still thinks is in the box is gone from
// the physical box — pulled without being scanned out (Charlie, 2026-09-28).
// Record it as a write-off, never a silent delete, then retire the box so it
// stops counting as stock. Unlike Repack, the weight does NOT become a session
// input: it's missing meat, not raw material.
//
// POST { box_id, reason: 'missing'|'damaged'|'other', note?, by? }

const REASONS = new Set(['missing', 'damaged', 'other'])

export async function POST(req: NextRequest) {
  const { box_id, reason, note, by } = await req.json() as { box_id?: string; reason?: string; note?: string | null; by?: string | null }
  if (!box_id || !reason || !REASONS.has(reason)) {
    return NextResponse.json({ error: 'box_id and a reason (missing, damaged or other) are required' }, { status: 400 })
  }

  const { data: box, error: bErr } = await supabaseAdmin.from('boxes')
    .select('id, serial_number, customer_name, pack_date, box_number, picked_up_at, delivery_id')
    .eq('id', box_id).single()
  if (bErr || !box) return NextResponse.json({ error: 'Box not found' }, { status: 404 })
  if (box.picked_up_at) return NextResponse.json({ error: `Box ${box.box_number} was already picked up.` }, { status: 409 })
  if (box.delivery_id)  return NextResponse.json({ error: `Box ${box.box_number} is loaded on a delivery — pull it off the load first.` }, { status: 409 })

  const { data: lines, error: lErr } = await supabaseAdmin.from('box_scans').select('*').eq('box_id', box_id)
  if (lErr) return NextResponse.json({ error: lErr.message }, { status: 500 })
  const rows   = lines ?? []
  const weight = Math.round(rows.reduce((s, l) => s + (Number(l.weight_lbs) || 0), 0) * 100) / 100
  const cuts   = rows.reduce((s, l) => s + (Number(l.quantity) || 1), 0)

  // The write-off row is the audit trail, so it lands before anything is removed.
  const { data: wo, error: wErr } = await supabaseAdmin.from('box_writeoffs').insert([{
    box_id, box_serial: box.serial_number, customer_name: box.customer_name, pack_date: box.pack_date,
    box_number: box.box_number, reason, note: note?.trim() || null, written_off_by: by?.trim() || null,
    cuts, weight_lbs: weight, lines: rows,
  }]).select().single()
  if (wErr) return NextResponse.json({ error: wErr.message }, { status: 500 })

  const { error: dsErr } = await supabaseAdmin.from('box_scans').delete().eq('box_id', box_id)
  if (dsErr) return NextResponse.json({ error: dsErr.message }, { status: 500 })
  const { error: dbErr } = await supabaseAdmin.from('boxes').delete().eq('id', box_id)
  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 })

  return NextResponse.json({ ok: true, writeoff: wo })
}
