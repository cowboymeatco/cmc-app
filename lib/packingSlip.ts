// Packing slip — the paper that rides with a delivery.
//
// Charlie (2026-09-09): "On the delivery could I get a packing slip on those
// that I can print after they are scanned in?" Load Out scans every box onto
// the truck and logs one delivery_scans row; this turns that row back into a
// sheet the driver hands over — every box on the load, what's in it, what it
// weighs, and a line for whoever takes it to sign. Black on white, letter
// paper, grouped by the packing session each box came from so a multi-stop
// haul reads one customer at a time.

import { shortItemName } from './itemName'

export interface SlipBox {
  id:               string
  serial_number:    string | null
  customer_name:    string
  pack_date:        string
  box_number:       number
  is_final:         boolean
  box_label:        string | null
  total_weight_lbs: number | null
  scans:            { item_name: string | null; plu_number: string | null; weight_lbs: number | null; quantity: number | null }[]
}

// Anything scanned onto the delivery that isn't one of our boxes — a package
// off the scale (EAN-13 with the weight in it), a carcass tag, a receiving
// box — listed as packages, rolled up by name.
export interface SlipLoose { label: string; count: number; weightLbs: number | null }

// A hanging carcass on the load — no boxes behind it, so it prints its own
// line off the carcass tag the driver scanned (Charlie, 2026-09-11).
export interface SlipCarcass {
  code:         string
  species:      string | null
  carcass_tag:  string | null
  producer:     string | null
  owner:        string | null
  harvest_date: string | null
  side:         'L' | 'R' | null
  weightLbs:    number | null
}

export interface SlipDelivery {
  id:           string | null
  delivered_at: string
  driver:       string
  customer:     string
  notes:        string
  destination:  string
}

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Denver' })
const fmtPack = (d: string) =>
  new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

// Where the slip says it came from. The shop address, once, the same one the
// portal prints (Charlie, 2026-09-09).
const SHOP = { name: 'Cowboy Meat Co', line1: '1109 Front St', line2: 'Forsyth, MT 59327', est: 'USDA EST. 47648' }

// One box's contents rolled up by cut — "(4) Ribeye Steak · 6.20 lb" — heaviest
// first, so the sheet reads the way the box was packed.
function rollUp(scans: SlipBox['scans']) {
  const grouped: Record<string, { count: number; weight: number }> = {}
  for (const s of scans) {
    const key = shortItemName(s.item_name) || (s.plu_number || 'Unknown').trim()
    if (!grouped[key]) grouped[key] = { count: 0, weight: 0 }
    grouped[key].count  += s.quantity ?? 1
    grouped[key].weight += Number(s.weight_lbs) || 0
  }
  return Object.entries(grouped)
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.weight - a.weight)
}

export function generatePackingSlip(
  delivery: SlipDelivery,
  boxes: SlipBox[],
  loose: SlipLoose[] = [],
  carcasses: SlipCarcass[] = [],
): string {
  // Group by packing session (customer + pack date), sessions in the order
  // their first box appears, boxes by number inside each.
  const order: string[] = []
  const groups: Record<string, SlipBox[]> = {}
  for (const b of boxes) {
    const k = `${b.customer_name}|${b.pack_date}`
    if (!groups[k]) { groups[k] = []; order.push(k) }
    groups[k].push(b)
  }

  let grandBoxes = 0, grandWeight = 0, grandCuts = 0

  const sections = order.map(k => {
    const list = [...groups[k]].sort((a, b) => a.box_number - b.box_number)
    const first = list[0]
    let sessWeight = 0, sessCuts = 0

    const rows = list.map(b => {
      const items  = rollUp(b.scans)
      const cuts   = items.reduce((s, i) => s + i.count, 0)
      const scanned = items.reduce((s, i) => s + i.weight, 0)
      const weight = Number(b.total_weight_lbs) > 0 ? Number(b.total_weight_lbs) : scanned
      sessWeight += weight; sessCuts += cuts
      const contents = items.length
        ? items.map(i => `<span class="item"><b>(${i.count})</b> ${esc(i.name)} <span class="lb">${i.weight.toFixed(2)} lb</span></span>`).join('')
        : '<span class="item muted">no packages scanned into this box</span>'
      return `
      <tr>
        <td class="num">Box ${b.box_number}${b.is_final ? ' ★' : ''}${b.box_label ? `<div class="for">FOR: ${esc(b.box_label)}</div>` : ''}<div class="serial">${esc(b.serial_number ?? '')}</div></td>
        <td class="contents">${contents}</td>
        <td class="cuts">${cuts}</td>
        <td class="wt">${weight > 0 ? weight.toFixed(2) : '—'}</td>
        <td class="chk">☐</td>
      </tr>`
    }).join('')

    grandBoxes += list.length; grandWeight += sessWeight; grandCuts += sessCuts

    return `
    <section>
      <div class="sess">
        <div class="sess-name">${esc(first.customer_name)}</div>
        <div class="sess-meta">packed ${fmtPack(first.pack_date)} · ${list.length} box${list.length !== 1 ? 'es' : ''} · ${sessCuts} package${sessCuts !== 1 ? 's' : ''} · ${sessWeight.toFixed(1)} lb</div>
      </div>
      <table>
        <thead><tr><th class="num">Box</th><th>Contents</th><th class="cuts">Pkgs</th><th class="wt">Lbs</th><th class="chk">Rec’d</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </section>`
  }).join('')

  // Loose packages get their own table after the boxes, and count toward the totals.
  let looseHTML = ''
  if (loose.length) {
    const looseCount  = loose.reduce((n, l) => n + l.count, 0)
    const looseWeight = loose.reduce((n, l) => n + (l.weightLbs ?? 0), 0)
    grandCuts += looseCount; grandWeight += looseWeight
    looseHTML = `
    <section>
      <div class="sess">
        <div class="sess-name">Packages (not boxed)</div>
        <div class="sess-meta">${looseCount} package${looseCount !== 1 ? 's' : ''}${looseWeight > 0 ? ` · ${looseWeight.toFixed(1)} lb` : ''}</div>
      </div>
      <table>
        <thead><tr><th>Item</th><th class="cuts">Pkgs</th><th class="wt">Lbs</th><th class="chk">Rec’d</th></tr></thead>
        <tbody>${loose.map(l => `
        <tr><td>${esc(l.label)}</td><td class="cuts">${l.count}</td><td class="wt">${l.weightLbs != null ? l.weightLbs.toFixed(2) : '—'}</td><td class="chk">☐</td></tr>`).join('')}
        </tbody>
      </table>
    </section>`
  }

  // Carcasses hang first on the sheet: a whole animal is the biggest thing on
  // the truck, and it's the line the customer signs for by weight.
  let carcassHTML = ''
  let grandCarcasses = 0
  if (carcasses.length) {
    const cWeight = carcasses.reduce((n, c) => n + (c.weightLbs ?? 0), 0)
    grandCarcasses = carcasses.length
    grandWeight += cWeight
    carcassHTML = `
    <section>
      <div class="sess">
        <div class="sess-name">Hanging carcasses</div>
        <div class="sess-meta">${carcasses.length} piece${carcasses.length !== 1 ? 's' : ''}${cWeight > 0 ? ` · ${cWeight.toFixed(1)} lb hanging` : ''}</div>
      </div>
      <table>
        <thead><tr><th class="num">Tag</th><th>Animal</th><th class="wt">Lbs</th><th class="chk">Rec’d</th></tr></thead>
        <tbody>${carcasses.map(c => {
          const what = [
            c.species ?? 'Carcass',
            c.side ? `${c.side} half` : 'whole carcass',
          ].join(' · ')
          const who = [c.owner, c.producer && c.producer !== c.owner ? `producer ${c.producer}` : '']
            .filter(Boolean).join(' · ')
          const killed = c.harvest_date ? `killed ${fmtPack(c.harvest_date)}` : ''
          const detail = [who, killed].filter(Boolean).join(' · ')
          return `
        <tr>
          <td class="num">${esc(c.carcass_tag ?? '—')}<div class="serial">${esc(c.code)}</div></td>
          <td class="contents">${esc(what)}${detail ? `<div class="lb">${esc(detail)}</div>` : ''}</td>
          <td class="wt">${c.weightLbs != null ? c.weightLbs.toFixed(1) : '—'}</td>
          <td class="chk">☐</td>
        </tr>`
        }).join('')}
        </tbody>
      </table>
    </section>`
  }

  const dest = delivery.destination === 'baker_storage' ? 'Baker Storage · 706 Daniels St, Billings, MT 59101' : ''

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Packing Slip — ${esc(delivery.customer)} ${fmtDate(delivery.delivered_at)}</title>
<style>
  @page { size: letter; margin: 0.5in; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #000; background: #fff; margin: 0; padding: 0.4in; font-size: 10.5pt; }
  @media print { body { padding: 0; } .noprint { display: none; } }
  .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #000; padding-bottom: 8px; margin-bottom: 12px; }
  .brand { display: flex; gap: 12px; align-items: center; }
  .brand img { height: 52px; width: auto; }
  .brand .name { font-family: Georgia, serif; font-weight: bold; font-size: 15pt; letter-spacing: 0.04em; }
  .brand .addr { font-size: 9pt; line-height: 1.3; color: #222; }
  .title { text-align: right; }
  .title h1 { margin: 0; font-size: 20pt; letter-spacing: 0.12em; }
  .title .when { font-size: 10pt; margin-top: 2px; }
  .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 24px; margin-bottom: 14px; font-size: 10.5pt; }
  .meta .k { font-size: 8pt; text-transform: uppercase; letter-spacing: 0.1em; color: #444; }
  .meta .v { font-weight: bold; font-size: 12pt; }
  .meta .notes { grid-column: 1 / -1; }
  .meta .notes .v { font-weight: normal; font-style: italic; font-size: 10.5pt; }
  section { margin-bottom: 16px; page-break-inside: avoid; }
  .sess { display: flex; justify-content: space-between; align-items: baseline; background: #000; color: #fff; padding: 5px 8px; }
  .sess-name { font-weight: bold; font-size: 12pt; text-transform: uppercase; letter-spacing: 0.03em; }
  .sess-meta { font-size: 9pt; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: 8pt; text-transform: uppercase; letter-spacing: 0.08em; border-bottom: 1px solid #000; padding: 4px 6px; }
  td { border-bottom: 1px solid #bbb; padding: 5px 6px; vertical-align: top; }
  td.num { width: 1.35in; font-weight: bold; white-space: nowrap; }
  td.num .for { font-weight: bold; font-size: 9pt; white-space: normal; }
  td.num .serial { font-family: monospace; font-weight: normal; font-size: 8pt; color: #444; letter-spacing: 0.05em; }
  td.contents .item { display: inline-block; margin: 0 14px 2px 0; white-space: nowrap; }
  td.contents .lb { color: #444; font-size: 9pt; }
  td.contents .muted { color: #777; font-style: italic; }
  th.cuts, td.cuts { width: 0.55in; text-align: right; }
  th.wt, td.wt { width: 0.75in; text-align: right; font-variant-numeric: tabular-nums; }
  th.chk, td.chk { width: 0.5in; text-align: center; font-size: 13pt; }
  .totals { display: flex; justify-content: flex-end; gap: 28px; border-top: 2px solid #000; padding-top: 8px; margin-top: 4px; font-size: 11pt; }
  .totals b { font-size: 13pt; }
  .sign { display: grid; grid-template-columns: 1fr 1fr; gap: 32px; margin-top: 34px; }
  .sign .line { border-top: 1px solid #000; padding-top: 4px; font-size: 8.5pt; text-transform: uppercase; letter-spacing: 0.1em; color: #333; }
  .foot { margin-top: 18px; font-size: 8pt; color: #555; text-align: center; }
  .noprint { position: fixed; top: 8px; right: 8px; }
  .noprint button { font: inherit; padding: 6px 14px; cursor: pointer; }
</style>
</head>
<body>
  <div class="noprint"><button onclick="window.print()">🖨 Print</button></div>
  <div class="head">
    <div class="brand">
      <img src="/cmc-logo.png" alt="">
      <div>
        <div class="name">${SHOP.name.toUpperCase()}</div>
        <div class="addr">${SHOP.line1}<br>${SHOP.line2}<br>${SHOP.est}</div>
      </div>
    </div>
    <div class="title">
      <h1>PACKING SLIP</h1>
      <div class="when">${fmtDate(delivery.delivered_at)}</div>
    </div>
  </div>

  <div class="meta">
    <div><div class="k">Deliver to</div><div class="v">${esc(delivery.customer)}</div>${dest ? `<div>${esc(dest)}</div>` : ''}</div>
    <div><div class="k">${delivery.destination === 'baker_storage' ? 'Driver' : 'Released by'}</div><div class="v">${esc(delivery.driver || '—')}</div></div>
    ${delivery.notes ? `<div class="notes"><div class="k">Notes</div><div class="v">${esc(delivery.notes)}</div></div>` : ''}
  </div>

  ${carcassHTML}${sections}${looseHTML}${!sections && !looseHTML && !carcassHTML ? '<p><i>Nothing scanned on this delivery.</i></p>' : ''}

  <div class="totals">
    ${grandCarcasses ? `<span>Carcasses <b>${grandCarcasses}</b></span>` : ''}
    <span>Boxes <b>${grandBoxes}</b></span>
    <span>Packages <b>${grandCuts}</b></span>
    <span>Total <b>${grandWeight.toFixed(1)} lb</b></span>
  </div>

  <div class="sign">
    <div class="line">Received by (print &amp; sign)</div>
    <div class="line">Date</div>
  </div>
  <div class="foot">Check each box off as it comes off the truck. Weights are the packed box weights off the scale.${delivery.id ? ` · Delivery ${esc(delivery.id.slice(0, 8))}` : ''}</div>
  <script>
    // Print straight away when opened from the app, same as the box label.
    window.addEventListener('load', function () { setTimeout(function () { window.print() }, 250) })
  </script>
</body>
</html>`
}
