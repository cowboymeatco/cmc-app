export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { compareScales, type AppPlu, type AppProducerSet, type ScaleRead } from '@/lib/scaleReads'

// GET  /api/scale-reads → the latest read of each scale, set against the app
//                         (lib/scaleReads), plus the last few read requests.
// POST /api/scale-reads → ask the kiosk for a fresh read of every scale.
//
// See scripts/2026-09-26_scale_reads.sql and scripts/kiosk/READ_REQUESTS.md.

interface ReadRow { id: string; created_at: string; scale_ip: string; what: 'plu' | 'label' }

export async function GET() {
  try {
    const { data: reads, error } = await supabaseAdmin
      .from('scale_reads')
      .select('id, created_at, scale_ip, what')
      .eq('ok', true)
      .order('created_at', { ascending: false })
      .limit(200)
    if (error) throw new Error(error.message)

    // Newest good read of each kind per scale.
    const latest = new Map<string, ReadRow>()
    for (const r of (reads ?? []) as ReadRow[]) {
      const k = `${r.scale_ip}|${r.what}`
      if (!latest.has(k)) latest.set(k, r)
    }
    const ips = [...new Set([...latest.values()].map(r => r.scale_ip))].sort()

    // One query per read: a scale holds ~400 PLUs, and a single query across
    // three scales would run past the 1,000-row page.
    const scaleReads: ScaleRead[] = await Promise.all(ips.map(async ip => {
      const pr = latest.get(`${ip}|plu`)
      const lr = latest.get(`${ip}|label`)
      const [plus, formats] = await Promise.all([
        pr ? supabaseAdmin.from('scale_plu_records').select('plu_number, item_name, label_format').eq('read_id', pr.id) : null,
        lr ? supabaseAdmin.from('scale_label_formats').select('format_number, internal_name, texts').eq('read_id', lr.id) : null,
      ])
      return {
        scale_ip: ip,
        plu_read_at: pr?.created_at ?? null,
        label_read_at: lr?.created_at ?? null,
        plus: plus ? (plus.data ?? []) : null,
        formats: formats ? (formats.data ?? []).map(f => ({ ...f, texts: f.texts ?? [] })) : null,
      }
    }))

    const [app, sets, items, requests] = await Promise.all([
      supabaseAdmin.from('plu_items').select('plu_number, item_name, active, price, scale_l1:ht_skeleton->>l1'),
      supabaseAdmin.from('producer_labels').select('id, name, label_format, loaded_at'),
      supabaseAdmin.from('producer_plu_items').select('producer_label_id, plu_number, house_plu'),
      supabaseAdmin.from('scale_read_requests').select('*').order('created_at', { ascending: false }).limit(5),
    ])
    const appPlus: AppPlu[] = (app.data ?? []).map(p => ({
      plu_number: String(p.plu_number), item_name: p.item_name ?? '', active: p.active !== false,
      price: p.price == null ? null : Number(p.price), scale_l1: (p as { scale_l1?: string | null }).scale_l1 ?? null,
    }))
    const producerSets: AppProducerSet[] = (sets.data ?? []).map(s => ({
      name: s.name, label_format: s.label_format, loaded_at: s.loaded_at,
      plus: (items.data ?? []).filter(i => i.producer_label_id === s.id).map(i => ({ plu_number: i.plu_number, house_plu: i.house_plu })),
    }))

    return NextResponse.json({
      ...compareScales(scaleReads, appPlus, producerSets),
      requests: requests.data ?? [],
    })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as { requested_by?: string }
  // One at a time — a second click while the kiosk is still reading would
  // just read the same scales twice.
  const { data: open } = await supabaseAdmin
    .from('scale_read_requests')
    .select('*')
    .in('status', ['pending', 'running'])
    .order('created_at', { ascending: false })
    .limit(1)
  if (open?.length) return NextResponse.json({ ok: true, request: open[0], already: true })

  const { data, error } = await supabaseAdmin
    .from('scale_read_requests')
    .insert({ requested_by: String(body.requested_by ?? 'app').slice(0, 60) })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, request: data })
}
