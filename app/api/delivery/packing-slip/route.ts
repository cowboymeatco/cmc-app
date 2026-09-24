export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { generatePackingSlip, SlipBox, SlipDelivery, SlipLoose, SlipCarcass, SlipPallet } from '@/lib/packingSlip'
import { shortItemName } from '@/lib/itemName'
import { resolveCarcasses } from '@/lib/carcassDelivery'
import { isCarcassTag } from '@/lib/carcassTag'

export const dynamic = 'force-dynamic'

// GET /api/delivery/packing-slip?id=<delivery_scans.id>[,<id>…]
// GET /api/delivery/packing-slip?serials=CMC2607...,CMC2607...&driver=&customer=&notes=
// GET /api/delivery/packing-slip?barcodes=<any mix of box serials and package barcodes>&...
//
// The printable sheet for a delivery: every box on it, contents and weights,
// a line to sign. By delivery id it is the record — Load Out stamps each box
// with delivery_id, and older rows still carry the serials in barcodes. By
// serials it is a preview of the load before Release is pressed.
//
// Pallets (2026-09-24): a delivery whose manifest lines carry pallet + stop
// prints one page per pallet. A preview passes them as
// &pallets=[{"n":1,"stop":"…","serials":["CMC…"]}].

// Manifest lines → pallets, in pallet order.
function palletsFrom(lines: { barcode?: string; pallet?: number; stop?: string }[]): SlipPallet[] {
  const by = new Map<number, SlipPallet>()
  for (const l of lines) {
    const n = Number(l.pallet)
    if (!n || !l.barcode) continue
    const p = by.get(n) ?? { n, stop: '', serials: [] }
    if (!p.stop && l.stop) p.stop = String(l.stop)
    p.serials.push(String(l.barcode))
    by.set(n, p)
  }
  return [...by.values()].sort((a, b) => a.n - b.n)
}

const BOX_COLS = 'id, serial_number, customer_name, pack_date, box_number, is_final, box_label, total_weight_lbs'

type BoxRow = Omit<SlipBox, 'scans'>

async function boxesWithScans(rows: BoxRow[]): Promise<SlipBox[]> {
  if (!rows.length) return []
  const { data: scans } = await supabase
    .from('box_scans')
    .select('box_id, item_name, plu_number, weight_lbs, quantity')
    .in('box_id', rows.map(r => r.id))
  const byBox: Record<string, SlipBox['scans']> = {}
  for (const s of scans ?? []) {
    (byBox[s.box_id] ??= []).push({ item_name: s.item_name, plu_number: s.plu_number, weight_lbs: s.weight_lbs, quantity: s.quantity })
  }
  return rows.map(r => ({ ...r, scans: byBox[r.id] ?? [] }))
}

const SERIAL_RE = /^CMC\d{6}[A-Z0-9]{4}$/

// Barcodes on a delivery that aren't box serials: packages off the scale
// (EAN-13, weight embedded — same decode as the delivery page), carcass tags,
// receiving boxes. Rolled up by what they are.
async function looseItems(barcodes: string[]): Promise<SlipLoose[]> {
  const decoded: { key: string; label: string; weight: number | null }[] = []
  const plus = new Set<string>()
  for (const raw of barcodes) {
    const b = raw.trim()
    if (!b || SERIAL_RE.test(b.toUpperCase())) continue
    // Carcass tags get their own section with the animal behind them.
    if (isCarcassTag(b)) continue
    if (/^2\d{12}$/.test(b)) {
      const plu = String(parseInt(b.substring(1, 6), 10))
      const w   = parseInt(b.substring(7, 12), 10) / 100
      plus.add(plu)
      decoded.push({ key: `plu:${plu}`, label: `PLU ${plu}`, weight: w > 0 ? w : null })
    } else {
      decoded.push({ key: `raw:${b}`, label: b, weight: null })
    }
  }
  if (!decoded.length) return []

  const names: Record<string, string> = {}
  if (plus.size) {
    const { data } = await supabase.from('plu_items').select('plu_number, item_name').in('plu_number', [...plus])
    for (const r of data ?? []) if (r.plu_number) names[String(r.plu_number)] = shortItemName(r.item_name)
  }

  const grouped: Record<string, SlipLoose> = {}
  for (const d of decoded) {
    // Name plus the PLU number: the unnamed pet-food PLUs all read "NOT FOR
    // HUMAN CONSUMPTION", and the number is what tells six of them apart.
    const plu   = d.key.startsWith('plu:') ? d.key.slice(4) : null
    const label = plu ? (names[plu] ? `${names[plu]} · PLU ${plu}` : d.label) : d.label
    const g = grouped[d.key] ??= { label, count: 0, weightLbs: null }
    g.count += 1
    if (d.weight != null) g.weightLbs = (g.weightLbs ?? 0) + d.weight
  }
  return Object.values(grouped).sort((a, b) => (b.weightLbs ?? 0) - (a.weightLbs ?? 0))
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')

  let delivery: SlipDelivery
  let rows: BoxRow[] = []
  let loose: SlipLoose[] = []
  // Every code on the load, whichever way we were called — carcass tags are
  // picked back out of it below.
  let allCodes: string[] = []
  let pallets: SlipPallet[] = []

  if (id) {
    // Several ids (comma-separated) print as one load — a pallet built after
    // the fact out of deliveries logged one customer at a time (2026-09-24).
    const ids = [...new Set(id.split(',').map(x => x.trim()).filter(Boolean))]
    const { data: ds, error } = await supabase.from('delivery_scans').select('*').in('id', ids)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!ds?.length) return NextResponse.json({ error: 'delivery not found' }, { status: 404 })
    const list = ids.map(x => ds.find(d => d.id === x)).filter(Boolean) as typeof ds
    const uniq = (xs: string[]) => [...new Set(xs.map(x => x.trim()).filter(Boolean))]
    delivery = {
      id:           list.length === 1 ? list[0].id : null,
      delivered_at: list.map(d => d.delivered_at).sort()[0],
      driver:       uniq(list.map(d => d.driver ?? '')).join(' / '),
      customer:     uniq(list.map(d => d.customer ?? '')).join(' / '),
      notes:        uniq(list.map(d => d.notes ?? '')).join(' · '),
      destination:  list.every(d => d.destination === 'baker_storage') ? 'baker_storage' : 'customer',
    }

    const { data: stamped } = await supabase.from('boxes').select(BOX_COLS).in('delivery_id', ids)
    rows = (stamped ?? []) as BoxRow[]

    const lines = list.flatMap(d => (d.barcodes ?? []) as { barcode?: string; pallet?: number; stop?: string }[])
    // A delivery logged before boxes carried delivery_id (or one keyed in by
    // hand on New Delivery) still names its boxes by serial in barcodes.
    const serials = lines
      .map(b => String(b.barcode ?? '').trim().toUpperCase())
      .filter(s => /^CMC\d{6}[A-Z0-9]{4}$/.test(s))
    const have = new Set(rows.map(r => (r.serial_number ?? '').toUpperCase()))
    const missing = serials.filter(s => !have.has(s))
    if (missing.length) {
      const { data: extra } = await supabase.from('boxes').select(BOX_COLS).in('serial_number', missing)
      rows = rows.concat((extra ?? []) as BoxRow[])
    }
    allCodes = lines.map(b => String(b.barcode ?? ''))
    pallets = palletsFrom(lines)
    if (pallets.length) {
      // Packages ride on their pallet's page; only pallet-less lines go loose.
      for (const p of pallets) p.loose = await looseItems(lines.filter(l => Number(l.pallet) === p.n).map(l => String(l.barcode ?? '')))
      loose = await looseItems(lines.filter(l => !Number(l.pallet)).map(l => String(l.barcode ?? '')))
    } else {
      loose = await looseItems(allCodes)
    }
  } else {
    // ?serials= is box serials only (Load Out); ?barcodes= is whatever the New
    // Delivery gun read — serials print as boxes, the rest as loose packages.
    const codes = [...new Set(
      ((searchParams.get('serials') ?? '') + ',' + (searchParams.get('barcodes') ?? ''))
        .split(',').map(s => s.trim()).filter(Boolean)
    )]
    if (!codes.length) return NextResponse.json({ error: 'id, serials or barcodes required' }, { status: 400 })
    const serials = codes.map(c => c.toUpperCase()).filter(c => SERIAL_RE.test(c))
    if (serials.length) {
      const { data, error } = await supabase.from('boxes').select(BOX_COLS).in('serial_number', serials)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      rows = (data ?? []) as BoxRow[]
    }
    allCodes = codes
    try {
      const raw = JSON.parse(searchParams.get('pallets') ?? '[]')
      if (Array.isArray(raw)) pallets = raw
        .map((p: { n?: unknown; stop?: unknown; serials?: unknown }) => ({
          n: Number(p?.n) || 0, stop: String(p?.stop ?? ''),
          serials: Array.isArray(p?.serials) ? p.serials.map(String) : [],
        }))
        .filter((p: SlipPallet) => p.n && p.serials.length)
    } catch { /* no pallets — one sheet */ }
    loose = await looseItems(codes)
    const customer = (searchParams.get('customer') ?? '').trim()
      || [...new Set(rows.map(r => r.customer_name))].join(' / ')
    delivery = {
      id: null,
      delivered_at: new Date().toISOString(),
      driver:       (searchParams.get('driver') ?? '').trim(),
      customer,
      notes:        (searchParams.get('notes') ?? '').trim(),
      destination:  searchParams.get('destination') === 'baker_storage' ? 'baker_storage' : 'customer',
    }
  }

  const boxes = await boxesWithScans(rows)
  const carcasses: SlipCarcass[] = (await resolveCarcasses(allCodes))
    .filter(c => c.harvest_log_id)
    .map(c => ({
      code: c.code, species: c.species, carcass_tag: c.carcass_tag,
      producer: c.producer, owner: c.owner, harvest_date: c.harvest_date,
      side: c.side, weightLbs: c.weight_lbs,
    }))
  return new NextResponse(generatePackingSlip(delivery, boxes, loose, carcasses, pallets), {
    headers: { 'Content-Type': 'text/html;charset=utf-8', 'Cache-Control': 'no-store' },
  })
}
