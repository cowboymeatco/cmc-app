export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export const dynamic = 'force-dynamic'

// GET /api/delivery/pallet-sign?load=<json>
//   load = { to?: string, date?: YYYY-MM-DD, pallets: { n?: number, stop?: string, date?: YYYY-MM-DD, orders: { c: customer_name, d: YYYY-MM-DD, b?: box_numbers[] }[] }[] }
//   stop is where that pallet is going ("Baker Storage / US Foods") and prints big.
//   date is the day the pallet left (the run date), printed big as CHECK-IN so
//   Baker's clerk and the driver read it off the pallet, not off a slip. A
//   pallet's own date wins over the load's; neither given → nothing printed.
//
// One sheet per pallet, every customer on it named big enough to read from
// across a freezer (Charlie, 2026-09-24: several small orders share one
// pallet to save space, and Baker has to tell who is who at check-in). An
// order with no box numbers lists every box of it still in our freezer.

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))

// An order off the freezer (c + d + box numbers), or — for a pallet rebuilt
// from logged deliveries — just a name and how many boxes.
interface OrderRef { c: string; d?: string; b?: number[]; count?: number }

export async function GET(req: NextRequest) {
  let load: { to?: string; date?: string; pallets?: { n?: number; stop?: string; date?: string; orders?: OrderRef[] }[] }
  try { load = JSON.parse(new URL(req.url).searchParams.get('load') ?? '') } catch { load = {} }
  const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
  const loadDate = ISO_DAY.test(String(load.date ?? '')) ? String(load.date) : ''
  const sheets = (load.pallets ?? [])
    .map((p, i) => ({
      n: Number(p?.n) || i + 1,
      stop: String(p?.stop ?? '').trim(),
      date: ISO_DAY.test(String(p?.date ?? '')) ? String(p?.date) : loadDate,
      orders: (Array.isArray(p?.orders) ? p.orders : []).filter(o => o?.c && (o.count != null || /^\d{4}-\d{2}-\d{2}$/.test(o.d ?? ''))),
    }))
    .filter(p => p.orders.length)
  const pallets = sheets.map(p => p.orders)
  if (!pallets.length) return NextResponse.json({ error: 'load with at least one order required' }, { status: 400 })

  // Every box of every order named, in one query per order (a load is a handful).
  const orders = new Map<string, { box_number: number; total_weight_lbs: number | null; picked_up_at: string | null }[]>()
  for (const o of pallets.flat()) {
    if (o.count != null) continue
    const k = `${o.c}|${o.d}`
    if (orders.has(k)) continue
    const { data, error } = await supabaseAdmin
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

  // Names as big as the sheet allows. Arial bold caps run about 0.68em a
  // character and the sheet is ~9.4in (677pt) wide by ~7.2in tall; after the
  // header, the stop bar and the check-in band about 320pt of height is left
  // for the customers. Try sizes from the cap down until every name wraps
  // between words (never inside one) and the whole stack fits that height.
  const WIDTH = 677
  const wrapLines = (name: string, pt: number): number | null => {
    const w = (t: string) => t.length * 0.74 * pt
    let lines = 1, used = 0
    for (const word of name.split(/\s+/).filter(Boolean)) {
      if (w(word) > WIDTH) return null
      const need = used ? used + w(' ') + w(word) : w(word)
      if (need <= WIDTH) used = need
      else { lines++; used = w(word) }
    }
    return lines
  }
  const fitSizes = (names: string[], hasLine: boolean, hasStop: boolean) => {
    const cap = names.length === 1 ? 120 : names.length === 2 ? 80 : names.length <= 4 ? 60 : 44
    const budget = 330 - (hasStop ? 58 : 0)
    for (let pt = cap; pt >= 20; pt -= 2) {
      const count = Math.max(18, Math.min(40, Math.round(pt * 0.45)))
      let h = 0, ok = true
      for (const n of names) {
        const lines = wrapLines(n, pt)
        if (lines == null) { ok = false; break }
        h += lines * pt * 1.02 + count * 1.05 + (hasLine ? 20 : 0) + 20
      }
      if (ok && h <= budget) return { name: pt, count }
    }
    return { name: 20, count: 18 }
  }
  const checkIn = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  // The foot band holds the date on the left and the case total on the right
  // on one line; size both to the longer pair so "Sept 30, 2026" and "128
  // CASES" can't run into each other (Charlie, 2026-10-18: they overlapped).
  const bandPt = (left: string, right: string) =>
    Math.max(22, Math.min(44, Math.floor(677 / (0.72 * (left.length + right.length + 3)))))

  const pages = pallets.map((p, i) => {
    const size = fitSizes(p.map(o => o.c), p.some(o => o.count == null), !!sheets[i].stop)
    const rows = p.map(o => {
      if (o.count != null) return `
      <div class="cust">
        <div class="name" style="font-size:${size.name}pt">${esc(o.c)}</div>
        <div class="count" style="font-size:${size.count}pt">${o.count} CASE${o.count !== 1 ? 'S' : ''}</div>
      </div>`
      const all  = orders.get(`${o.c}|${o.d}`) ?? []
      const want = new Set(o.b ?? [])
      const on   = want.size ? all.filter(b => want.has(b.box_number)) : all.filter(b => !b.picked_up_at)
      const lbs  = on.reduce((s, b) => s + (Number(b.total_weight_lbs) || 0), 0)
      return `
      <div class="cust">
        <div class="name" style="font-size:${size.name}pt">${esc(o.c)}</div>
        <div class="count" style="font-size:${size.count}pt">${on.length}${on.length !== all.length ? ` OF ${all.length}` : ''} CASE${on.length !== 1 ? 'S' : ''}</div>
        <div class="line">
          <span>${on.length ? `Box ${on.map(b => b.box_number).join(' · ')}` : ''}</span>
          <span>${lbs > 0 ? `${lbs.toFixed(1)} lb &nbsp;·&nbsp; ` : ''}packed ${esc(fmt(o.d!))}</span>
        </div>
      </div>`
    }).join('')
    const boxes = p.reduce((n, o) => {
      if (o.count != null) return n + o.count
      const all = orders.get(`${o.c}|${o.d}`) ?? []
      return n + (o.b?.length ? all.filter(b => o.b!.includes(b.box_number)).length : all.filter(b => !b.picked_up_at).length)
    }, 0)
    const date = sheets[i].date
    const dateText  = date ? checkIn(date) : ''
    const casesText = `${boxes} CASE${boxes !== 1 ? 'S' : ''}`
    const big = bandPt(dateText || '          ', casesText)
    const cap = p.length === 1 ? 120 : p.length === 2 ? 80 : p.length <= 4 ? 60 : 44
    return `
  <div class="sheet" data-cap="${cap}">
    <div class="top">
      <span>Cowboy Meat Co.${to ? ` &rarr; ${esc(to)}` : ''}</span>
      <span>Pallet ${sheets[i].n} of ${Math.max(...sheets.map(x => x.n))}</span>
    </div>
    ${sheets[i].stop ? `<div class="dest">&rarr; ${esc(sheets[i].stop)}</div>` : ''}
    ${rows}
    <div class="band">
      <div class="cell">
        <div class="lbl">Check-in</div>
        <div class="big" style="font-size:${big}pt">${date ? esc(dateText) : '<span class="blank">&nbsp;</span>'}</div>
      </div>
      <div class="cell right">
        <div class="lbl">${p.length} customer${p.length !== 1 ? 's' : ''}</div>
        <div class="big" style="font-size:${big}pt">${casesText}</div>
      </div>
    </div>
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
  .sheet { border: 6px solid #000; padding: 0.3in 0.4in; height: 7.2in; overflow: hidden; display: flex; flex-direction: column; page-break-after: always; margin-bottom: 0.4in; }
  .sheet:last-child { page-break-after: auto; }
  .top { display: flex; justify-content: space-between; font-size: 16pt; font-weight: bold; letter-spacing: 0.12em; text-transform: uppercase; border-bottom: 4px solid #000; padding-bottom: 8px; margin-bottom: 6px; }
  .dest { font-size: 30pt; font-weight: 900; text-transform: uppercase; background: #000; color: #fff; padding: 6px 12px; margin: 4px 0 6px; white-space: nowrap; overflow: hidden; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .cust { border-bottom: 2px solid #000; padding: 10px 0 8px; page-break-inside: avoid; }
  .name { font-weight: 900; line-height: 1.02; text-transform: uppercase; word-break: normal; overflow-wrap: normal; }
  .count { font-size: 40pt; font-weight: 900; line-height: 1.05; margin-top: 2px; }
  .line { display: flex; justify-content: space-between; gap: 24px; font-size: 15pt; margin-top: 4px; }
  .band { margin-top: auto; display: flex; justify-content: space-between; align-items: flex-end; gap: 24px; border-top: 4px solid #000; padding-top: 10px; page-break-inside: avoid; }
  .cell { min-width: 0; }
  .cell.right { text-align: right; }
  .lbl { font-size: 14pt; font-weight: bold; letter-spacing: 0.12em; text-transform: uppercase; }
  .big { font-size: 44pt; font-weight: 900; line-height: 1.05; text-transform: uppercase; white-space: nowrap; }
  .blank { display: inline-block; width: 4.2in; border-bottom: 3px solid #000; }
  .noprint { position: fixed; top: 8px; right: 8px; }
  .noprint button { font: inherit; padding: 6px 14px; cursor: pointer; }
</style>
</head>
<body>
  <div class="noprint"><button onclick="window.print()">🖨 Print</button></div>
  ${pages}
  <script>
  // The sizes above are estimates made without the font. Once the page has
  // the real glyphs, shrink anything that doesn't fit: a single word wider
  // than the sheet (EVA HOLLENBECK broke as HOLLENBE/CK — Charlie, 2026-10-18),
  // a street address in the stop bar, the check-in band, and finally a sheet
  // taller than its page. Nothing ever breaks inside a word or spills over.
  (function () {
    function px(el) { return parseFloat(getComputedStyle(el).fontSize) }
    function fitWidth(el, minPx) {
      var s = px(el), guard = 0
      while (el.scrollWidth > el.clientWidth + 1 && s > minPx && guard++ < 200) { s -= 1; el.style.fontSize = s + 'px' }
    }
    function run() {
      document.querySelectorAll('.sheet').forEach(function (sheet) {
        sheet.querySelectorAll('.dest').forEach(function (el) { fitWidth(el, 18) })
        sheet.querySelectorAll('.big').forEach(function (el) { fitWidth(el, 20) })
        var names  = Array.prototype.slice.call(sheet.querySelectorAll('.name'))
        var counts = Array.prototype.slice.call(sheet.querySelectorAll('.count'))
        if (!names.length) return
        var capPx = (parseFloat(sheet.getAttribute('data-cap')) || 44) * 96 / 72
        function setAll(sz) {
          names.forEach(function (el) { el.style.fontSize = sz + 'px' })
          counts.forEach(function (el) { el.style.fontSize = Math.max(24, Math.min(53, Math.round(sz * 0.45))) + 'px' })
        }
        // Fits = no single word wider than the sheet (names wrap only at
        // spaces, so a word that doesn't fit is the only way a name gets
        // wider than its box) and the sheet not taller than its page.
        function fits() {
          if (sheet.scrollHeight > sheet.clientHeight + 1) return false
          return names.every(function (el) { return el.scrollWidth <= el.clientWidth + 1 })
        }
        // Grow every name on the sheet in step until the cap or the page
        // stops it — the server sized them blind, usually small.
        var sz = px(names[0]), guard = 0
        while (guard++ < 200 && sz + 2 <= capPx) {
          setAll(sz + 2)
          if (!fits()) { setAll(sz); break }
          sz += 2
        }
        // Then back off until everything fits, whatever the starting point.
        guard = 0
        while (guard++ < 200 && !fits() && sz > 24) { sz -= 2; setAll(sz) }
      })
    }
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(run); else run()
    window.addEventListener('beforeprint', run)
  })()
  </script>
</body>
</html>`
  return new NextResponse(html, { headers: { 'Content-Type': 'text/html;charset=utf-8', 'Cache-Control': 'no-store' } })
}
