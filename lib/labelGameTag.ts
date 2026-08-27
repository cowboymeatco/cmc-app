import { makeCode39Barcode } from './label'
import { dateLabel } from './dates'
import { summariseSheet, type GameSheet } from './gameCuts'
import { cheeseLabel, type RateMap } from './gameBilling'
import { rulesFor } from './gameRules'
import type { GameIntake } from './types'

// The claim tag, and the hunter's copy of it.
//
// Two halves of one sheet, torn apart at the drop-off window. The top half is
// zip-tied to the animal and is the only thing tying that carcass to a name for
// the next three weeks. The bottom half goes home in a truck.
//
// Everything on the animal half is what somebody needs at 6am with cold hands:
// the claim number big enough to read across a cooler, whose it is, and what
// the meat is. On a boned-out drop-off — which is nearly all of them — "what it
// is" means the base material, because there is no carcass left to recognise: a
// cooler of elk trim and a cooler of deer trim look identical. The order prints
// on the work order (below), not on the tag; a tag that has to be unfolded to
// read is a tag nobody reads.
//
// NOT FOR SALE is on both halves and is not optional. Game is not amenable: it
// carries no mark of inspection, it cannot enter commerce, and the tag is the
// first place that gets said.

const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))

const fmtDate = (iso: string | null | undefined) =>
  iso ? dateLabel(iso.slice(0, 10), { month: 'short', day: 'numeric', year: 'numeric' }) : '—'

/** Things going home that are not meat — the reason hunters drive back. */
function returnsLine(intake: GameIntake): string {
  const wants: string[] = []
  if (intake.cape_requested)   wants.push('CAPE')
  if (intake.antlers_returned) wants.push('ANTLERS')
  if (intake.hide_returned)    wants.push('HIDE')
  return wants.join(' · ')
}

const STYLE = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { background: #fff; font-family: Arial, Helvetica, sans-serif; color: #000; }
  body { width: 4in; padding: 0.15in; }
  .half { page-break-inside: avoid; break-inside: avoid; }
  .brand { text-align: center; font-size: 7.5pt; letter-spacing: 0.14em; text-transform: uppercase; color: #444; }
  .kind  { text-align: center; font-size: 10pt; font-weight: bold; letter-spacing: 0.2em; margin-top: 2px; }
  .tag   { text-align: center; font-family: 'Courier New', monospace; font-size: 26pt; font-weight: bold; letter-spacing: 0.06em; margin: 4px 0 2px; }
  .who   { text-align: center; font-size: 15pt; font-weight: bold; text-transform: uppercase; line-height: 1.1; }
  .phone { text-align: center; font-size: 11pt; margin-top: 1px; }
  .what  { text-align: center; font-size: 12pt; margin: 4px 0; }
  .rows  { font-size: 9.5pt; margin-top: 4px; }
  .row   { display: flex; justify-content: space-between; padding: 1px 0; }
  .k     { color: #555; text-transform: uppercase; letter-spacing: 0.06em; font-size: 8pt; }
  .v     { font-weight: bold; text-align: right; }
  .wants { margin: 5px 0; padding: 3px; border: 2px solid #000; text-align: center;
           font-size: 10pt; font-weight: bold; letter-spacing: 0.08em; }
  .nfs   { margin: 5px 0 2px; padding: 3px; background: #000; color: #fff; text-align: center;
           font-size: 10pt; font-weight: bold; letter-spacing: 0.14em; }
  .barcode { text-align: center; margin: 3px 0 1px; }
  .barcode svg { max-width: 100%; height: 0.5in; }
  .cut   { border-top: 1.5pt dashed #666; margin: 0.16in 0 0.1in; padding-top: 0.1in; }
  .stub  { text-align: center; font-size: 8pt; color: #444; margin-top: 4px; line-height: 1.35; }
  .note  { font-size: 8.5pt; margin-top: 4px; padding-top: 3px; border-top: 0.5pt solid #999; }
`

function half(intake: GameIntake, copy: 'ANIMAL' | 'HUNTER'): string {
  const wants = returnsLine(intake)
  return `
  <div class="half">
    <div class="brand">Cowboy Meat Co · Forsyth MT</div>
    <div class="kind">WILD GAME — ${copy} COPY</div>
    <div class="tag">${esc(intake.tag_number)}</div>
    <div class="barcode">${makeCode39Barcode(intake.tag_number)}</div>
    <div class="who">${esc(intake.hunter_name)}</div>
    ${intake.hunter_phone ? `<div class="phone">${esc(intake.hunter_phone)}</div>` : ''}
    <div class="what">${esc(intake.species)}${intake.sex ? ` · ${esc(intake.sex)}` : ''} · ${esc(intake.condition)}</div>
    <div class="rows">
      ${intake.base_material ? `<div class="row"><span class="k">Base material</span><span class="v">${esc(intake.base_material)}</span></div>` : ''}
      <div class="row"><span class="k">Received</span><span class="v">${fmtDate(intake.received_at)}</span></div>
      <div class="row"><span class="k">Weight in</span><span class="v">${intake.weight_in_lbs ? `${intake.weight_in_lbs} lb` : '—'}</span></div>
      ${intake.finished_product ? `<div class="row"><span class="k">Finished</span><span class="v">${esc(intake.finished_product)}</span></div>` : ''}
      <div class="row"><span class="k">Licence / tag</span><span class="v">${esc(intake.license_tag_no) || '—'}</span></div>
      ${intake.hunting_district ? `<div class="row"><span class="k">District</span><span class="v">${esc(intake.hunting_district)}</span></div>` : ''}
      ${copy === 'ANIMAL' && intake.storage_location
        ? `<div class="row"><span class="k">Location</span><span class="v">${esc(intake.storage_location)}</span></div>` : ''}
    </div>
    ${wants ? `<div class="wants">SAVE: ${esc(wants)}</div>` : ''}
    <div class="nfs">NOT FOR SALE</div>
    ${copy === 'HUNTER'
      ? `<div class="stub">We will call you when it is ready.<br>Bring this stub — it is your claim number.</div>`
      : intake.notes ? `<div class="note">${esc(intake.notes)}</div>` : ''}
  </div>`
}

/** The two-part drop-off tag: animal half + hunter's stub. */
export function generateGameTag(intake: GameIntake): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>${esc(intake.tag_number)}</title>
<style>${STYLE}</style>
</head><body>
${half(intake, 'ANIMAL')}
<div class="cut"></div>
${half(intake, 'HUNTER')}
<script>window.onload = () => setTimeout(() => window.print(), 250)</script>
</body></html>`
}

// ── The work order ────────────────────────────────────────────────────────
// Full sheet, goes on the table with the animal. This is where the cut sheet
// actually prints, in the order the animal is broken.
export function generateGameWorkOrder(intake: GameIntake, sheet: GameSheet, rates?: RateMap): string {
  const sections = summariseSheet(sheet, k => rates?.[k]?.label ?? k, cheeseLabel)
  const wants = returnsLine(intake)
  // The floor's copy of the house rules — jerky comes off roasts, steaked
  // roasts get separated and marked, and so on. They print in a box because
  // a rule buried in a paragraph is a rule nobody follows.
  const rules = rulesFor(sheet, 'floor')

  const body = sections.map(s => `
    <div class="sec">
      <div class="sec-t">${esc(s.title)}</div>
      <ul>${s.lines.map(l => `<li>${esc(l)}</li>`).join('')}</ul>
    </div>`).join('')

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Work order ${esc(intake.tag_number)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, sans-serif; color: #000; background: #fff; padding: 0.5in; font-size: 11pt; }
  .head { display: flex; justify-content: space-between; align-items: flex-start;
          border-bottom: 2.5pt solid #000; padding-bottom: 6px; }
  .tag  { font-family: 'Courier New', monospace; font-size: 30pt; font-weight: bold; letter-spacing: 0.04em; }
  .who  { font-size: 19pt; font-weight: bold; text-transform: uppercase; }
  .sub  { font-size: 10.5pt; color: #333; margin-top: 2px; }
  .nfs  { margin: 10px 0; padding: 6px; background: #000; color: #fff; text-align: center;
          font-size: 13pt; font-weight: bold; letter-spacing: 0.2em; }
  .facts { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 10px 0 4px; }
  .fact  { border: 0.75pt solid #999; padding: 5px 7px; }
  .fk    { font-size: 7.5pt; text-transform: uppercase; letter-spacing: 0.1em; color: #555; }
  .fv    { font-size: 13pt; font-weight: bold; }
  .wants { margin: 8px 0; padding: 6px; border: 2.5pt solid #000; text-align: center;
           font-size: 12pt; font-weight: bold; letter-spacing: 0.1em; }
  .sec   { margin-top: 12px; break-inside: avoid; }
  .sec-t { font-size: 9pt; text-transform: uppercase; letter-spacing: 0.16em;
           border-bottom: 1pt solid #000; padding-bottom: 2px; margin-bottom: 5px; font-weight: bold; }
  ul     { list-style: none; }
  li     { padding: 2.5px 0 2.5px 14px; position: relative; font-size: 11.5pt; }
  li:before { content: "▪"; position: absolute; left: 0; }
  .foot  { margin-top: 18px; padding-top: 6px; border-top: 0.75pt solid #999;
           font-size: 8.5pt; color: #555; display: flex; justify-content: space-between; }
  .rules  { margin-top: 14px; border: 2pt solid #000; padding: 8px 10px; break-inside: avoid; }
  .rules-t{ font-size: 9pt; text-transform: uppercase; letter-spacing: 0.16em; font-weight: bold;
            margin-bottom: 5px; }
  .rule   { margin: 5px 0; }
  .rule-h { font-size: 11pt; font-weight: bold; }
  .rule-d { font-size: 9pt; color: #333; line-height: 1.4; }
</style>
</head><body>
  <div class="head">
    <div>
      <div class="who">${esc(intake.hunter_name)}</div>
      <div class="sub">${esc(intake.hunter_phone)}${intake.hunter_phone && intake.hunting_district ? ' · ' : ''}${intake.hunting_district ? `District ${esc(intake.hunting_district)}` : ''}</div>
    </div>
    <div style="text-align:right">
      <div class="tag">${esc(intake.tag_number)}</div>
      <div class="sub">${esc(intake.species)}${intake.sex ? ` · ${esc(intake.sex)}` : ''}</div>
    </div>
  </div>

  <div class="nfs">NOT FOR SALE — CUSTOMER'S OWN GAME</div>

  <div class="facts">
    <div class="fact"><div class="fk">Received</div><div class="fv">${fmtDate(intake.received_at)}</div></div>
    <div class="fact"><div class="fk">Weight in</div><div class="fv">${intake.weight_in_lbs ? `${intake.weight_in_lbs} lb` : '—'}</div></div>
    <div class="fact"><div class="fk">Base material</div><div class="fv" style="font-size:11pt">${esc(intake.base_material) || esc(intake.condition)}</div></div>
    <div class="fact"><div class="fk">Finished</div><div class="fv" style="font-size:11pt">${esc(intake.finished_product) || '—'}</div></div>
  </div>

  ${wants ? `<div class="wants">SAVE FOR HUNTER: ${esc(wants)}</div>` : ''}
  ${intake.cleaning_hours ? `<div class="sub" style="margin-top:4px">Cleaning fee agreed at drop-off — ${intake.cleaning_hours} hr @ $60/hr.</div>` : ''}

  ${body || '<div class="sec"><div class="sec-t">Order</div><ul><li>No order on file — make nothing until one is taken.</li></ul></div>'}

  ${intake.notes ? `<div class="sec"><div class="sec-t">Notes</div><ul><li>${esc(intake.notes)}</li></ul></div>` : ''}

  ${rules.length ? `<div class="rules">
    <div class="rules-t">Handling rules for this order</div>
    ${rules.map(r => `<div class="rule">
      <div class="rule-h">${r.severity === 'warn' ? '&#9888; ' : ''}${esc(r.title)}</div>
      <div class="rule-d">${esc(r.detail)}</div>
    </div>`).join('')}
  </div>` : ''}

  <div class="foot">
    <span>Cowboy Meat Co · Forsyth MT</span>
    <span>${esc(intake.tag_number)} · printed ${fmtDate(new Date().toISOString())}</span>
  </div>
  <script>window.onload = () => setTimeout(() => window.print(), 250)</script>
</body></html>`
}
