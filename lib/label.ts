export interface BoxScan   { id: string; item_name: string; plu_number: string; weight_lbs: number; quantity: number }
export interface BoxRecord { id: string; customer_name: string; pack_date: string; box_number: number; is_closed: boolean; is_final: boolean; total_weight_lbs: number; total_cuts: number; serial_number?: string; box_label?: string | null; notes?: string | null; wip_intent_key?: string | null; wip_intent_label?: string | null }
// not_for_human: product going out as animal food. It carries the required
// "NOT FOR HUMAN CONSUMPTION" statement and must NOT bear the mark of
// inspection, so it is the one flag that suppresses the USDA bug outright.
// Independent of not_for_sale — pet food is sold, and a custom-exempt animal's
// pet food is both.
export interface LabelFlags { usda_bug: boolean; retail_exempt: boolean; not_for_sale: boolean; not_for_human: boolean }

export const DEFAULT_FLAGS: LabelFlags = { usda_bug: true, retail_exempt: false, not_for_sale: false, not_for_human: false }

// The one rule for whether a label may bear the mark of inspection, shared by
// every label we print so the surfaces cannot drift apart.
//
// retail_exempt is an exemption FROM inspection — it is why the product was not
// inspected — so a label claiming inspection alongside a RETAIL EXEMPT badge
// contradicts itself (Chris/Charlie, 2026-08-12: "We retail exempt to bypass
// USDA inspection"). Unlike custom-exempt it is still SOLD, so it suppresses
// the mark without adding NOT FOR SALE.
export function marksInspection(flags: LabelFlags): boolean {
  return flags.usda_bug && !flags.not_for_human && !flags.retail_exempt
}

// CMC's USDA establishment number — appears in the center of the mark of
// inspection (from the Grant of Inspection). If blank the stamp prints "EST. ____".
export const USDA_EST_NUMBER = '47648'

// Official USDA mark of inspection: a circular legend reading
// "U.S. INSPECTED AND PASSED BY DEPARTMENT OF AGRICULTURE" with the
// establishment number in the center. Rendered as inline SVG so it prints
// crisp (vector) at the small size the box label uses.
export function usdaMarkSVG(est: string): string {
  const num = est || '____'
  // Text rides an arc of radius 33 (inside the r=40 inner ring). Top arc runs
  // ~200°→340° over the top; bottom arc ~160°→20° under the bottom, both
  // centered on the vertical axis. Font 5 keeps the full legend inside the arc.
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100" style="display:block;width:100%;height:auto">
    <defs>
      <path id="usda-top" d="M17.5,44.3 A33,33 0 0 1 82.5,44.3" fill="none"/>
      <path id="usda-bot" d="M17.5,55.7 A33,33 0 0 0 82.5,55.7" fill="none"/>
    </defs>
    <circle cx="50" cy="50" r="47" fill="#fff" stroke="#000" stroke-width="2.5"/>
    <circle cx="50" cy="50" r="40" fill="none" stroke="#000" stroke-width="1"/>
    <text font-family="Arial, sans-serif" font-weight="bold" font-size="5" fill="#000">
      <textPath href="#usda-top" startOffset="50%" text-anchor="middle">U.S. INSPECTED AND PASSED BY</textPath>
    </text>
    <text font-family="Arial, sans-serif" font-weight="bold" font-size="5" fill="#000">
      <textPath href="#usda-bot" startOffset="50%" text-anchor="middle">DEPARTMENT OF AGRICULTURE</textPath>
    </text>
    <text x="50" y="48" text-anchor="middle" font-family="Arial, sans-serif" font-weight="bold" font-size="7" fill="#000">EST.</text>
    <text x="50" y="62" text-anchor="middle" font-family="Arial, sans-serif" font-weight="bold" font-size="13" fill="#000">${num}</text>
  </svg>`
}

// Code 39 barcode — supports 0-9 and A-Z (covers all CMCxxxxxxxx serial chars)
export function makeCode39Barcode(text: string): string {
  const P: Record<string, string> = {
    '*':'010010100','0':'000110100','1':'100100001','2':'001100001','3':'101100000',
    '4':'000110001','5':'100110000','6':'001110000','7':'000100101','8':'100100100',
    '9':'001100100','A':'100001001','B':'001001001','C':'101001000','D':'000011001',
    'E':'100011000','F':'001011000','G':'000001101','H':'100001100','I':'001001100',
    'J':'000011100','K':'100000011','L':'001000011','M':'101000010','N':'000010011',
    'O':'100010010','P':'001010010','Q':'000000111','R':'100000110','S':'001000110',
    'T':'000010110','U':'110000001','V':'011000001','W':'111000000','X':'010010001',
    'Y':'110010000','Z':'011010000','-':'010000101','.':'110000100',
  }
  const N = 2, W = 6, H = 60
  const chars = ('*' + text.toUpperCase() + '*').split('')
  let x = 0, rects = ''
  for (let ci = 0; ci < chars.length; ci++) {
    const pat = P[chars[ci]]
    if (!pat) continue
    for (let i = 0; i < 9; i++) {
      const w = pat[i] === '1' ? W : N
      if (i % 2 === 0) rects += `<rect x="${x}" y="0" width="${w}" height="${H}"/>`
      x += w
    }
    if (ci < chars.length - 1) x += N
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${x} ${H}" width="${x}" height="${H}" style="display:block;max-width:100%;height:auto;margin:0 auto"><g fill="#000">${rects}</g></svg>`
}

// The animal behind the box, resolved from the carcass scan (harvest record).
// Drives the databased producer/weight and the compliance mark.
export interface LabelAnimal { producer?: string | null; hangingWeightLbs?: number | null; killType?: string | null }

const escLabel = (v: unknown) => String(v ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))

// Crews type the hanging weight into the name ("Scott Ruff 196#"). Once the
// weight prints on its own databased line, strip it from the name — but only
// when we actually have that databased weight to show instead, so an unresolved
// box keeps whatever the crew typed.
export function displayCustomerName(name: string, weightLbs?: number | null): string {
  let n = (name || '').trim()
  if (weightLbs) {
    n = n.replace(/\s*[·\-]?\s*\d{2,4}\s*(#|lbs?)\s*$/i, '').trim()   // "196#", "196 lb"
    const m = n.match(/\s(\d{2,4})$/)                                 // bare trailing number
    if (m && Math.abs(Number(m[1]) - weightLbs) <= 2) n = n.slice(0, m.index).trim()
  }
  return n
}

// Batch code: YYDDD off the pack/processing date (Julian day-of-year). This is
// the number the floor recognizes, not the calendar date.
export function julianYYDDD(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00')
  const start = new Date(d.getFullYear(), 0, 0)
  const day = Math.floor((d.getTime() - start.getTime()) / 86_400_000)
  return String(d.getFullYear()).slice(2) + String(day).padStart(3, '0')
}

export function generateLabel(box: BoxRecord, scans: BoxScan[], flags: LabelFlags = DEFAULT_FLAGS, animal?: LabelAnimal): string {
  const grouped: Record<string, { count: number; weight: number }> = {}
  scans.forEach(s => {
    const key = s.item_name || s.plu_number || 'Unknown'
    if (!grouped[key]) grouped[key] = { count: 0, weight: 0 }
    grouped[key].count  += s.quantity ?? 1
    grouped[key].weight += Number(s.weight_lbs) || 0
  })
  const items = Object.entries(grouped).sort((a, b) => b[1].weight - a[1].weight)
  const totalWeight = items.reduce((s, [, v]) => s + v.weight, 0)
  const totalCuts   = items.reduce((s, [, v]) => s + v.count, 0)
  // The NUMBER carries at a glance, not the word. A packer reading a label from
  // arm's length was misled by a customer whose name ends in a digit ("Prince
  // Inc. 3") — printed at 21pt, that trailing 3 was the biggest numeral on the
  // label while the box number sat smaller underneath, so box 9 read as box 3
  // (AE, 2026-08-05). The digits now outrank anything in the name.
  const boxLabelText = `Box ${box.box_number}${box.is_final ? ' ★' : ''}`
  const boxLabelHTML = `Box <span class="bn">${box.box_number}</span>${box.is_final ? ' ★' : ''}`
  const dateStr     = new Date(box.pack_date + 'T12:00:00').toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })
  const julian      = julianYYDDD(box.pack_date)

  const itemRows = items.map(([name, v]) =>
    `<div class="item-row"><span><b>(${v.count})</b> ${escLabel(name)}</span><span>${v.weight.toFixed(2)} lb</span></div>`
  ).join('')

  // The compliance mark rides on top of the box row, in the open right-hand
  // space, so it never pushes the lines apart. Custom exempt = NOT FOR SALE and
  // no legend; otherwise the approved USDA mark of inspection when the product
  // is actually entitled to it (see marksInspection).
  const markHTML = flags.not_for_sale
    ? `<div class="mark"><div class="nfs">NOT FOR SALE</div></div>`
    : marksInspection(flags)
      ? `<div class="mark up"><img class="usdaimg" src="/usda-legend.png" alt="USDA Inspected EST. 47648"></div>`
      : ''
  // Animal food. Full width rather than tucked in the small mark slot: the
  // statement has to be legible across a delivery, and it is 24 characters.
  const petHTML = flags.not_for_human
    ? `<div class="nfh">NOT FOR HUMAN CONSUMPTION</div>`
    : ''
  const exemptHTML   = flags.retail_exempt ? `<div class="badge">RETAIL EXEMPT</div>` : ''
  const producerHTML = animal?.producer ? `<div class="producer">Producer: <b>${escLabel(animal.producer)}</b></div>` : ''
  const weightHTML   = animal?.hangingWeightLbs ? `<div class="hangwt">Hanging Wt: ${animal.hangingWeightLbs} lb</div>` : ''

  const barcodeHTML = box.serial_number ? `
  <hr>
  <div class="serial">SERIAL: ${escLabel(box.serial_number)}</div>
  <div class="barcode">${makeCode39Barcode(box.serial_number)}</div>` : ''

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Box Label — ${escLabel(box.customer_name)} ${boxLabelText}</title>
<style>
  @page { size: 4in auto; margin: 0.15in; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { width: 3.7in; font-family: Arial, sans-serif; color: #000; background: #fff; }
  .logo     { display: block; width: 100%; max-width: 3.05in; height: auto; margin: 0 auto 3px; }
  .customer { font-size: 21pt; font-weight: bold; text-align: center; line-height: 1.0; margin: 0; }
  .producer { font-family: 'Arial Narrow', Arial, sans-serif; font-size: 11pt; text-align: center; line-height: 1.2; }
  .hangwt   { font-family: 'Arial Narrow', Arial, sans-serif; font-size: 11pt; text-align: center; font-weight: bold; line-height: 1.2; margin-bottom: 1px; }
  .box-for  { font-size: 12pt; font-weight: bold; text-align: center; margin: 2px auto; border: 1.5px solid #000; border-radius: 3px; padding: 1px 4px; }
  /* Box # and date stack tight; the mark floats over the open right space. */
  .boxrow   { position: relative; text-align: center; }
  .box-num  { font-size: 15pt; font-weight: bold; text-align: center; line-height: 1.15; }
  /* Larger than .customer (21pt) so the box number is the biggest numeral on
     the label, whatever the customer is called. Page height is auto, so the
     extra few points push the rows below down rather than clipping. */
  .bn       { font-size: 26pt; line-height: 1; }
  .date     { font-family: 'Arial Narrow', Arial, sans-serif; font-size: 10pt; text-align: center; line-height: 1.2; }
  .mark     { position: absolute; right: 0; top: 50%; transform: translateY(-50%); width: 0.6in; z-index: 2; display: flex; align-items: center; }
  .mark.up  { top: 12%; }
  .usdaimg  { width: 100%; height: auto; display: block; }
  .mark .nfs { border: 2px solid #000; font-size: 8pt; font-weight: bold; text-align: center; letter-spacing: 0.02em; padding: 2px 1px; line-height: 1.1; width: 100%; }
  hr        { border: none; border-top: 1px solid #000; margin: 4px 0; }
  .item-row { display: flex; justify-content: space-between; align-items: baseline;
              font-family: 'Arial Narrow', Arial, sans-serif; font-size: 11pt; padding: 1px 0; }
  .footer   { font-family: 'Arial Narrow', Arial, sans-serif; font-size: 10pt; font-weight: bold; text-align: center; margin-top: 2px; }
  .badge    { text-align: center; font-size: 7.5pt; font-weight: bold; border: 1px solid #000; border-radius: 2px; padding: 1px 4px; display: inline-block; margin: 2px auto; letter-spacing: 0.06em; }
  /* Bordered rather than a solid fill — a black bar this size burns a lot of
     ribbon on the label printer and prints muddy on direct thermal. */
  .nfh      { text-align: center; font-size: 12pt; font-weight: bold; letter-spacing: 0.04em;
              border: 2.5px solid #000; border-radius: 2px; padding: 2px 3px; margin: 3px 0; line-height: 1.1; }
  .barcode  { text-align: center; margin: 4px 0 2px; }
  .barcode svg { max-width: 100%; height: auto; display: block; margin: 0 auto; }
  .serial   { text-align: center; font-size: 10pt; font-family: monospace; letter-spacing: 0.1em; font-weight: bold; margin: 4px 0 2px; }
  @media print { html, body { width: 4in; } }
</style>
</head>
<body>
  <img class="logo" src="/cmc-logo.png" alt="Cowboy Meat Co">
  ${petHTML}
  ${exemptHTML ? `<div style="text-align:center">${exemptHTML}</div>` : ''}
  <div class="customer">${escLabel(displayCustomerName(box.customer_name, animal?.hangingWeightLbs)).toUpperCase()}</div>
  ${producerHTML}
  ${weightHTML}
  ${box.box_label ? `<div class="box-for">FOR: ${escLabel(box.box_label).toUpperCase()}</div>` : ''}
  <div class="boxrow">
    <div class="box-num">${boxLabelHTML}</div>
    <div class="date">${dateStr} &nbsp;&middot;&nbsp; <b style="font-family:monospace;letter-spacing:0.1em">${julian}</b></div>
    ${markHTML}
  </div>
  <hr>
  ${itemRows}
  <hr>
  <div class="footer">${totalCuts} cut${totalCuts !== 1 ? 's' : ''} | ${totalWeight.toFixed(2)} lbs total</div>
  ${barcodeHTML}
  <script>window.onload = () => setTimeout(() => window.print(), 250)</script>
</body>
</html>`
}
