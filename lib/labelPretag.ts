import { BoxRecord, LabelRoll, rollFrameCSS, rollPrintScript } from './label'

// ══════════════════════════════════════════════════════════════════════════════
// BOX TAG — the sticker that goes inside the lid BEFORE the box is filled.
//
// Charlie, 2026-08-01: "a very simple box number sticker that can go on the
// inside lid so I see what box I am scanning meat into… seasoned chuck roasts
// into 39 and then filling 48 with filets."
//
// The finished box label only prints at close, so while several boxes are open
// on the bench they are physically anonymous. This is pure wayfinding: a number
// big enough to read standing over an open box, and the customer so two
// customers' boxes never get confused on the same bench.
//
// Deliberately NOT a product label. No USDA bug, no NOT FOR SALE, no weight,
// no cut list, no serial barcode — a compliance mark on a tag that gets buried
// under meat and never re-read would be a mark nobody verified. The finished
// label at close is still the only thing that carries any of that, and the
// header says PACKING TAG so a stray one is never mistaken for it.
// ══════════════════════════════════════════════════════════════════════════════

const esc = (s: unknown) =>
  String(s ?? '').replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c] as string))

// "2026-08-01" → "Aug 1, 2026" (noon avoids the UTC-parse off-by-one)
const fmtDay = (iso?: string | null) =>
  iso ? new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''

export function generatePretag(box: BoxRecord, roll: LabelRoll = '4in'): string {
  const num = String(box.box_number ?? '?')
  // Three digits still has to fit the body, so shrink past two. The 62mm
  // Brother roll is 2.2in printable — the numeral is the whole point of this
  // tag, so it takes as much of that as it can and everything else follows.
  const numSize = roll === '62mm'
    ? (num.length >= 3 ? 76 : 100)
    : (num.length >= 3 ? 132 : 168)

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Box Tag — ${esc(box.customer_name)} Box ${esc(num)}</title>
<style>
  ${rollFrameCSS(roll)}
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; color: #000; background: #fff; text-align: center; }
  .kind     { font-size: 10pt; font-weight: bold; letter-spacing: 0.22em; border-bottom: 2px solid #000;
              padding-bottom: 3px; margin-bottom: 2px; }
  .word     { font-size: 15pt; font-weight: bold; letter-spacing: 0.3em; line-height: 1; margin-top: 4px; }
  .num      { font-size: ${numSize}pt; font-weight: bold; line-height: 0.86; letter-spacing: -0.02em; }
  .star     { font-size: 30pt; font-weight: bold; line-height: 1; }
  .customer { font-size: 17pt; font-weight: bold; line-height: 1.05; margin-top: 4px;
              border-top: 2px solid #000; padding-top: 4px; }
  .for      { font-family: 'Arial Narrow', Arial, sans-serif; font-size: 13pt; font-weight: bold; line-height: 1.15; }
  .date     { font-family: 'Arial Narrow', Arial, sans-serif; font-size: 10pt; line-height: 1.2; margin-top: 2px; }
${roll !== '62mm' ? '' : `
  /* Brother 62mm roll — the numeral already shrank above; bring the lines
     around it down in step so nothing out-shouts it. */
  .star     { font-size: 20pt; }
  .customer { font-size: 12pt; }
  .for      { font-size: 10pt; }
`}
</style>
</head>
<body>
  <div class="kind">PACKING TAG</div>
  <div class="word">BOX</div>
  <div class="num">${esc(num)}</div>
  ${box.is_final ? '<div class="star">★ FINAL</div>' : ''}
  <div class="customer">${esc(box.customer_name).toUpperCase()}</div>
  ${box.box_label ? `<div class="for">${esc(box.box_label).toUpperCase()}</div>` : ''}
  <div class="date">${esc(fmtDay(box.pack_date))}</div>
  ${rollPrintScript(roll)}
</body>
</html>`
}
