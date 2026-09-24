export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// GET /api/delivery/pallet-sign?load=<json>
//   load = { to?: string, pallets: { c: customer_name, d: YYYY-MM-DD, b?: box_numbers[] }[][] }
//
// One sheet per pallet, every customer on it named big enough to read from
// across a freezer (Charlie, 2026-09-24: several small orders share one
// pallet to save space, and Baker has to tell who is who at check-in). An
// order with no box numbers lists every box of it still in our freezer.

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))

interface OrderRef { c: string; d: string; b?: number[] }

export async function GET(req: NextRequest) {
  let load: { to?: string; pallets?: OrderRef[][] }
  try { load = JSON.parse(new URL(req.url).searchParams.get('load') ?? '') } catch { load = {} }
  const pallets = (load.pallets ?? [])
    .map(p => (Array.isArray(p) ? p : []).filter(o => o?.c && /^\d{4}-\d{2}-\d{2}$/.test(o.d)))
    .filter(p => p.length)
  if (!pallets.length) return NextResponse.json({ error: 'load with at least one order required' }, { status: 400 })

  // Every box of every order named, in one query per order (a load is a handful).
  const orders = new Map<string, { box_number: number; total_weight_lbs: number | null; picked_up_at: string | null }[]>()
  for (const o of pallets.flat()) {
    const k = `${o.c}|${o.d}`
    if (orders.has(k)) continue
    const { data, error } = await supabase
      .from('boxes')
      .select('box_number, total_weight_lbs, picked_up_at')
      .eq('customer_name', o.c)
      .eq('pack_date', o.d)
      .order('box_number', { ascending: true })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    orders.set(k, data ?? [])
  }

  const to = (load.to ?? '').trim()
  const fmt = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

  const pages = pallets.map((p, i) => {
    // Fewer customers on the pallet → bigger names.
    const nameSize = p.length === 1 ? 72 : p.length === 2 ? 50 : p.length <= 4 ? 38 : 28
    const rows = p.map(o => {
      const all  = orders.get(`${o.c}|${o.d}`) ?? []
      const want = new Set(o.b ?? [])
      const on   = want.size ? all.filter(b => want.has(b.box_number)) : all.filter(b => !b.picked_up_at)
      const lbs  = on.reduce((s, b) => s + (Number(b.total_weight_lbs) || 0), 0)
      return `
      <div class="cust">
        <div class="name" style="font-size:${o.c.length > 26 ? Math.round(nameSize * 0.75) : nameSize}pt">${esc(o.c)}</div>
        <div class="line">
          <span><b>${on.length}${on.length !== all.length ? ` of ${all.length}` : ''} box${on.length !== 1 ? 'es' : ''}</b>${on.length ? ` &nbsp;·&nbsp; Box ${on.map(b => b.box_number).join(' · ')}` : ''}</span>
          <span>${lbs > 0 ? `${lbs.toFixed(1)} lb &nbsp;·&nbsp; ` : ''}packed ${esc(fmt(o.d))}</span>
        </div>
      </div>`
    }).join('')
    const boxes = p.reduce((n, o) => {
      const all = orders.get(`${o.c}|${o.d}`) ?? []
      return n + (o.b?.length ? all.filter(b => o.b!.includes(b.box_number)).length : all.filter(b => !b.picked_up_at).length)
    }, 0)
    return `
  <div class="sheet">
    <div class="top">
      <span>Cowboy Meat Co.${to ? ` &rarr; ${esc(to)}` : ''}</span>
      <span>Pallet ${i + 1} of ${pallets.length}</span>
    </div>
    ${rows}
    <div class="foot">${p.length} customer${p.length !== 1 ? 's' : ''} &nbsp;·&nbsp; ${boxes} box${boxes !== 1 ? 'es' : ''} on this pallet</div>
  </div>`
  }).join('')

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Pallet Signs${to ? ` — ${esc(to)}` : ''}</title>
<style>
  @page { size: letter landscape; margin: 0.4in; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #000; background: #fff; margin: 0; padding: 0.4in; }
  @media print { body { padding: 0; } .noprint { display: none; } .sheet { margin: 0; } }
  .sheet { border: 6px solid #000; padding: 0.3in 0.4in; min-height: 7.2in; display: flex; flex-direction: column; page-break-after: always; margin-bottom: 0.4in; }
  .sheet:last-child { page-break-after: auto; }
  .top { display: flex; justify-content: space-between; font-size: 16pt; font-weight: bold; letter-spacing: 0.12em; text-transform: uppercase; border-bottom: 4px solid #000; padding-bottom: 8px; margin-bottom: 6px; }
  .cust { border-bottom: 2px solid #000; padding: 10px 0 8px; page-break-inside: avoid; }
  .name { font-weight: 900; line-height: 1.02; text-transform: uppercase; word-break: break-word; }
  .line { display: flex; justify-content: space-between; gap: 24px; font-size: 15pt; margin-top: 4px; }
  .foot { margin-top: auto; padding-top: 10px; font-size: 13pt; letter-spacing: 0.08em; text-transform: uppercase; text-align: right; }
  .noprint { position: fixed; top: 8px; right: 8px; }
  .noprint button { font: inherit; padding: 6px 14px; cursor: pointer; }
</style>
</head>
<body>
  <div class="noprint"><button onclick="window.print()">🖨 Print</button></div>
  ${pages}
</body>
</html>`
  return new NextResponse(html, { headers: { 'Content-Type': 'text/html;charset=utf-8', 'Cache-Control': 'no-store' } })
}
