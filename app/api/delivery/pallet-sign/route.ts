export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// GET /api/delivery/pallet-sign?customer=<session name>&date=YYYY-MM-DD[&boxes=1,2,5]
//
// A full sheet for the side of a staged pallet — whose it is, readable from
// across the freezer (Charlie, 2026-09-23: "can I get pallet signs"). With
// ?boxes= it names just those boxes (what's on this load); without, every box
// of the order still in the freezer.

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const customer = (searchParams.get('customer') ?? '').trim()
  const date     = (searchParams.get('date') ?? '').trim()
  if (!customer || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'customer and date required' }, { status: 400 })
  }
  const only = new Set((searchParams.get('boxes') ?? '').split(',').map(s => parseInt(s, 10)).filter(n => n > 0))

  const { data, error } = await supabase
    .from('boxes')
    .select('box_number, total_weight_lbs, picked_up_at')
    .eq('customer_name', customer)
    .eq('pack_date', date)
    .order('box_number', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const all = data ?? []
  if (!all.length) return NextResponse.json({ error: 'no boxes for that order' }, { status: 404 })

  const onPallet = only.size ? all.filter(b => only.has(b.box_number)) : all.filter(b => !b.picked_up_at)
  const lbs = onPallet.reduce((s, b) => s + (Number(b.total_weight_lbs) || 0), 0)
  const packed = new Date(date + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  // A long name steps down so it still fits one sheet.
  const nameSize = customer.length > 28 ? 60 : customer.length > 18 ? 80 : 104

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Pallet — ${esc(customer)}</title>
<style>
  @page { size: letter landscape; margin: 0.4in; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #000; background: #fff; margin: 0; padding: 0.4in; }
  @media print { body { padding: 0; } .noprint { display: none; } }
  .sheet { border: 6px solid #000; padding: 0.35in 0.45in; min-height: 7.2in; display: flex; flex-direction: column; }
  .top { display: flex; justify-content: space-between; font-size: 16pt; font-weight: bold; letter-spacing: 0.14em; text-transform: uppercase; }
  .name { font-size: ${nameSize}pt; font-weight: 900; line-height: 1.02; text-transform: uppercase; margin: 0.25in 0 0.15in; word-break: break-word; }
  .packed { font-size: 22pt; }
  .boxes { margin-top: auto; border-top: 4px solid #000; padding-top: 0.2in; display: flex; justify-content: space-between; align-items: flex-end; gap: 0.4in; }
  .k { font-size: 11pt; letter-spacing: 0.14em; text-transform: uppercase; color: #333; }
  .count { font-size: 64pt; font-weight: 900; line-height: 1; }
  .nums { font-size: 20pt; font-weight: bold; margin-top: 6px; }
  .lbs { font-size: 34pt; font-weight: bold; text-align: right; }
  .pallet { font-size: 22pt; font-weight: bold; text-align: right; margin-top: 10px; white-space: nowrap; }
  .noprint { position: fixed; top: 8px; right: 8px; }
  .noprint button { font: inherit; padding: 6px 14px; cursor: pointer; }
</style>
</head>
<body>
  <div class="noprint"><button onclick="window.print()">🖨 Print</button></div>
  <div class="sheet">
    <div class="top"><span>Cowboy Meat Co.</span><span>Pallet</span></div>
    <div class="name">${esc(customer)}</div>
    <div class="packed">Packed ${esc(packed)}</div>
    <div class="boxes">
      <div>
        <div class="k">Boxes on this pallet</div>
        <div class="count">${onPallet.length}${onPallet.length !== all.length ? ` <span style="font-size:28pt">of ${all.length}</span>` : ''}</div>
        <div class="nums">${onPallet.length ? 'Box ' + onPallet.map(b => b.box_number).join(' · ') : '—'}</div>
      </div>
      <div>
        ${lbs > 0 ? `<div class="lbs">${lbs.toFixed(1)} lb</div>` : ''}
        <div class="pallet">Pallet ____ of ____</div>
      </div>
    </div>
  </div>
</body>
</html>`
  return new NextResponse(html, { headers: { 'Content-Type': 'text/html;charset=utf-8', 'Cache-Control': 'no-store' } })
}
