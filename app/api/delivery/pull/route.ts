export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// POST /api/delivery/pull — take items off a logged delivery.
// Body: { id, barcodes: string[], by?: string, labels?: string[] }
//
// Charlie (2026-09-09), off the Maddie McGee's Baker run: "I need to pull 3
// cases of Kidney Fat off of this load." A delivery is a record of what left,
// so pulling a box off it is an edit to the record with the audit written into
// the notes, not a silent shrink. If Load Out had stamped the box as picked up
// under this delivery, the stamp comes off too and the box is back in the
// freezer. Session status is left alone — a run that still carries the rest of
// the order is still that run.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  const id = String(body?.id ?? '')
  const pull = [...new Set((Array.isArray(body?.barcodes) ? body!.barcodes : []).map(b => String(b).trim()).filter(Boolean))]
  if (!id)          return NextResponse.json({ error: 'id required' }, { status: 400 })
  if (!pull.length) return NextResponse.json({ error: 'nothing to pull' }, { status: 400 })

  const { data: d, error } = await supabase.from('delivery_scans').select('*').eq('id', id).maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!d)    return NextResponse.json({ error: 'delivery not found' }, { status: 404 })

  const pulledSet = new Set(pull.map(p => p.toUpperCase()))
  const before = (d.barcodes ?? []) as { barcode: string; scannedAt: string }[]
  const after  = before.filter(b => !pulledSet.has(String(b.barcode ?? '').toUpperCase()))
  const removed = before.length - after.length
  if (!removed) return NextResponse.json({ error: 'none of those are on this delivery' }, { status: 404 })

  const labels = Array.isArray(body?.labels) ? (body!.labels as unknown[]).map(String).filter(Boolean) : []
  const when = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Denver' })
  const by   = String(body?.by ?? '').trim()
  const line = `Pulled off load ${when}${by ? ` by ${by}` : ''}: ${labels.length ? labels.join(', ') : `${removed} item${removed !== 1 ? 's' : ''}`}`
  const notes = [String(d.notes ?? '').trim(), line].filter(Boolean).join('\n')

  const { data: updated, error: uErr } = await supabase
    .from('delivery_scans')
    .update({ barcodes: after, notes })
    .eq('id', id)
    .select()
    .single()
  if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 })

  // Boxes Load Out stamped under THIS delivery go back in the freezer.
  const { data: unstamped } = await supabase
    .from('boxes')
    .update({ picked_up_at: null, picked_up_by: null, delivery_id: null })
    .eq('delivery_id', id)
    .in('serial_number', [...pulledSet])
    .select('id')

  return NextResponse.json({ ...updated, pulled: removed, boxes_returned: (unstamped ?? []).length })
}
