// Central Montana Beef (CMB) US Foods case label — replicates the 4x6 Brother
// P-touch label ("Central Montana Beef Mandy Printer.lbx") so cases packed in
// the scanner print the correct label the first time, no relabeling.
//
// Layout (from the .lbx): CMB logo top-left, USDA mark top-right, Forsyth MT
// address, product description (from CMB's GS1 registry), Net Wt / Packed On /
// Lot / "Keep Refrigerated or Frozen", GS1-128 barcode of the GTIN-14.
// Case spec: 40 lb ± 20% (32.0–48.0 lb) — the screen shows a pass/fail pill.

import { BoxRecord, BoxScan, usdaMarkSVG, USDA_EST_NUMBER } from './label'

export interface CMBProduct { desc: string; gtin: string }

// From "CMB Product List.xlsx" (ExportAllProducts) — CMB's registered GS1
// descriptions and GTIN-14s. Descriptions must stay EXACTLY as registered.
export const CMB_PRODUCTS: CMBProduct[] = [
  { desc: 'Beef, Chuck Roll, Grass Fed CMB',                 gtin: '00850050788211' },
  { desc: 'Beef, Ground, 80/20, 4/5 lbs, Grass Fed, CMB',    gtin: '00850050788225' },
  { desc: 'Beef, Top Round, Grass Fed, CMB',                 gtin: '00850050788235' },
  { desc: 'Beef, Eye of Round, Grass Fed, CMB',              gtin: '00850050788273' },
  { desc: 'Beef, Roast, Bottom Round, Grass Fed, CMB',       gtin: '00850050788242' },
  { desc: 'Beef, Roast, Top Sirloin, Grass Fed, CMB',        gtin: '00850050788259' },
  { desc: 'Beef, Tri Tip, Grass Fed, CMB',                   gtin: '00850050788280' },
  { desc: 'Beef, Diced, Grass Fed, CMB',                     gtin: '00850050788266' },
  { desc: 'Beef, Strip Loin, Grass Fed, CMB',                gtin: '00850050788297' },
  { desc: 'Beef, Tender Loin, Grass Fed, CMB',               gtin: '00850050788303' },
  { desc: 'Beef, Short Ribs, Grass Fed, CMB',                gtin: '00850050788310' },
  { desc: 'Beef, Ribeye, Grass Fed, CMB',                    gtin: '00850050788327' },
  { desc: 'Beef, Flank Steak, Grass Fed, CMB',               gtin: '00850050788334' },
  { desc: 'Beef, Brisket, Grass Fed, CMB',                   gtin: '00850050788372' },
  { desc: 'Beef, Bones, Grass Fed, CMB',                     gtin: '00850050788341' },
  { desc: 'Beef, Organs, Grass Fed, CMB',                    gtin: '00850050788171' },
  { desc: 'Beef, Osso Bucco, Grassfed, CMB',                 gtin: '00850050788365' },
  { desc: 'Beef, Ground Beef Patties, 3:1, CMB',             gtin: '00850050788389' },
]

export const CMB_TARGET_LB = 40
export const CMB_TOLERANCE = 0.20   // ± 20% → 32.0–48.0 lb

// ── Scan-name → CMB product matching ─────────────────────────────────────────
// Scale PLU names are ALL CAPS ("BEEF BONELESS RIBEYE STEAK"). Rules run in
// order; specific cuts before generic words (RIBEYE before BONE, so
// "BONELESS RIBEYE" doesn't land on Bones).
const MATCH_RULES: Array<[RegExp, number]> = [
  [/PATT/, 17],
  [/GROUND|GRIND|BURGER/, 1],
  [/RIBEYE|RIB ?EYE/, 11],
  [/NEW YORK|STRIP/, 8],
  [/FILET|TENDER ?LOIN/, 9],
  [/SIRLOIN/, 5],
  [/CHUCK/, 0],
  [/EYE OF ROUND/, 3],
  [/BOTTOM ROUND/, 4],
  [/TOP ROUND/, 2],
  [/TRI ?TIP/, 6],
  [/DICED|STEW/, 7],
  [/SHORT ?RIB/, 10],
  [/FLANK/, 12],
  [/BRISKET/, 13],
  [/OSSO|SHANK/, 16],
  [/ORGAN|LIVER|HEART|TONGUE|KIDNEY/, 15],
  [/BONES?\b|MARROW/, 14],   // \b keeps "BONELESS …" from landing on Bones
]

// Returns the CMB_PRODUCTS index whose matching scans carry the most weight,
// or -1 when nothing matches (worker picks from the dropdown).
export function matchCMBProduct(scans: BoxScan[]): number {
  const weightByProduct = new Map<number, number>()
  for (const s of scans) {
    const name = (s.item_name || '').toUpperCase()
    for (const [re, idx] of MATCH_RULES) {
      if (re.test(name)) {
        weightByProduct.set(idx, (weightByProduct.get(idx) ?? 0) + (Number(s.weight_lbs) || 0))
        break
      }
    }
  }
  let best = -1, bestW = 0
  for (const [idx, w] of weightByProduct) if (w > bestW) { best = idx; bestW = w }
  return best
}

// ── GS1-128 barcode (Code 128, subset C, FNC1) ───────────────────────────────
// The Brother label encodes the raw GTIN-14 digits under the EAN128 protocol,
// i.e. StartC + FNC1 + digit pairs + check + stop. Replicated exactly since
// US Foods accepts that symbol. Standard Code 128 element-width table:
const C128 = ('212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 ' +
  '221312 231212 112232 122132 122231 113222 123122 123221 223211 221132 ' +
  '221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 ' +
  '212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 ' +
  '231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 ' +
  '231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 ' +
  '314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 ' +
  '112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 ' +
  '111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 ' +
  '214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 ' +
  '114131 311141 411131 211412 211214 211232').split(' ')
const C128_STOP = '2331112'

export function gs1_128SVG(digits: string): string {
  if (!/^\d+$/.test(digits) || digits.length % 2 !== 0) return ''
  const values: number[] = [105, 102]                       // StartC, FNC1
  for (let i = 0; i < digits.length; i += 2) values.push(parseInt(digits.slice(i, i + 2), 10))
  let sum = values[0]
  for (let i = 1; i < values.length; i++) sum += values[i] * i
  values.push(sum % 103)
  const widths = values.map(v => C128[v]).join('') + C128_STOP
  const M = 2, H = 80, QUIET = 20                           // module width, bar height, quiet zone
  let x = QUIET, rects = ''
  for (let i = 0; i < widths.length; i++) {
    const w = Number(widths[i]) * M
    if (i % 2 === 0) rects += `<rect x="${x}" y="0" width="${w}" height="${H}"/>`
    x += w
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${x + QUIET} ${H}" preserveAspectRatio="none" style="display:block;width:100%;height:100%"><g fill="#000">${rects}</g></svg>`
}

// ── Label page ────────────────────────────────────────────────────────────────
export interface CMBLabelOpts { productGtin?: string | null; lot?: string | null }

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function generateCMBLabel(box: BoxRecord, scans: BoxScan[], opts: CMBLabelOpts = {}): string {
  const scanWeight = scans.reduce((s, sc) => s + (Number(sc.weight_lbs) || 0), 0)
  const netWt      = scanWeight > 0 ? scanWeight : Number(box.total_weight_lbs) || 0
  const d          = new Date(box.pack_date + 'T12:00:00')
  const packedOn   = `${d.getMonth() + 1}-${d.getDate()}-${d.getFullYear()}`
  const lot        = (opts.lot ?? (box.customer_name.match(/\d{3,}/)?.[0] || '')).trim()
  const explicit   = opts.productGtin ? CMB_PRODUCTS.findIndex(p => p.gtin === opts.productGtin) : -1
  const selected   = explicit >= 0 ? explicit : matchCMBProduct(scans)
  const autoPrint  = explicit >= 0            // only auto-print when the product was passed in explicitly

  const options = CMB_PRODUCTS.map((p, i) =>
    `<option value="${i}"${i === selected ? ' selected' : ''}>${esc(p.desc)}</option>`).join('')
  const barcodes = CMB_PRODUCTS.map(p => gs1_128SVG(p.gtin))
  const cur      = selected >= 0 ? selected : 1              // default view: Ground 80/20

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>CMB Case Label — ${esc(box.customer_name)} Box ${box.box_number}</title>
<style>
  @page { size: 4in 6in; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; color: #000; background: #555; }

  .controls { background: #1d1d1f; color: #eee; padding: 10px 14px; display: flex; flex-wrap: wrap; gap: 10px; align-items: center; font-size: 14px; }
  .controls label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: #999; display: block; margin-bottom: 2px; }
  .controls select, .controls input { font-size: 15px; padding: 6px 8px; border-radius: 4px; border: 1px solid #555; background: #2c2c2e; color: #fff; }
  .controls select { max-width: 340px; }
  .controls input.warn { border-color: #ff453a; }
  .pill { font-size: 12px; font-weight: bold; padding: 4px 10px; border-radius: 999px; }
  .pill.ok   { background: #1d3a24; color: #4cd964; }
  .pill.bad  { background: #3a1d1d; color: #ff6b60; }
  .print-btn { font-size: 16px; font-weight: bold; padding: 10px 26px; border: none; border-radius: 6px; background: #b0703c; color: #fff; cursor: pointer; }
  .std-link { color: #8ab4f8; font-size: 12px; text-decoration: underline; cursor: pointer; }
  .boxinfo { font-size: 12px; color: #999; width: 100%; }

  .sheet { width: 4in; height: 6in; background: #fff; margin: 16px auto; padding: 0.12in; display: flex; flex-direction: column; }
  .hdr   { display: flex; justify-content: space-between; align-items: flex-start; }
  .logo  { width: 1.28in; height: 1.28in; object-fit: contain; }
  .usda  { width: 1.28in; }
  .addr  { font-size: 13pt; line-height: 1.25; margin-top: 0.04in; }
  .desc  { flex: 1; display: flex; align-items: center; justify-content: center; text-align: center; font-size: 26pt; line-height: 1.15; padding: 0.05in 0; }
  .info  { font-size: 14pt; line-height: 1.45; }
  .bars  { height: 0.95in; margin-top: 0.06in; }
  .hr    { font-size: 11pt; letter-spacing: 0.18em; margin-top: 0.02in; }

  @media print {
    body { background: #fff; }
    .controls { display: none; }
    .sheet { margin: 0; }
  }
</style>
</head>
<body>
  <div class="controls">
    <div class="boxinfo">${esc(box.customer_name)} — Box ${box.box_number}${box.is_final ? ' ★' : ''} · packed ${packedOn} · ${scans.length} scans</div>
    <div>
      <label>Product</label>
      <select id="product">${selected < 0 ? '<option value="-1" selected>— pick a product —</option>' : ''}${options}</select>
    </div>
    <div>
      <label>Net Wt (lb)</label>
      <input id="wt" type="number" step="0.01" value="${netWt.toFixed(2)}" style="width:100px">
    </div>
    <div>
      <label>Lot</label>
      <input id="lot" value="${esc(lot)}" style="width:110px">
    </div>
    <span class="pill" id="spec"></span>
    <button class="print-btn" id="go">🖨 Print Label</button>
    <span class="std-link" id="std">print standard CMC label instead</span>
  </div>

  <div class="sheet">
    <div class="hdr">
      <img class="logo" src="/cmb-logo.png" alt="Central Montana Beef">
      <div class="usda">${usdaMarkSVG(USDA_EST_NUMBER)}</div>
    </div>
    <div class="addr">1109 Front St<br>Forsyth, MT 59327</div>
    <div class="desc" id="l-desc"></div>
    <div class="info">
      Net Wt: <b id="l-wt"></b> lb<br>
      Packed On: ${packedOn}<br>
      Lot: <b id="l-lot"></b><br>
      Keep Refrigerated or Frozen
    </div>
    <div class="bars" id="l-bars"></div>
    <div class="hr" id="l-gtin"></div>
  </div>

<script>
  const PRODUCTS  = ${JSON.stringify(CMB_PRODUCTS)}
  const BARCODES  = ${JSON.stringify(barcodes)}
  const MIN_LB = ${(CMB_TARGET_LB * (1 - CMB_TOLERANCE)).toFixed(1)}, MAX_LB = ${(CMB_TARGET_LB * (1 + CMB_TOLERANCE)).toFixed(1)}
  const $ = id => document.getElementById(id)

  function render() {
    const i  = parseInt($('product').value, 10)
    const ok = i >= 0
    $('l-desc').textContent = ok ? PRODUCTS[i].desc : '— pick a product above —'
    $('l-bars').innerHTML   = ok ? BARCODES[i] : ''
    $('l-gtin').textContent = ok ? PRODUCTS[i].gtin : ''
    const w = parseFloat($('wt').value) || 0
    $('l-wt').textContent  = w.toFixed(2)
    $('l-lot').textContent = $('lot').value.trim()
    const inSpec = w >= MIN_LB && w <= MAX_LB
    $('spec').textContent = inSpec ? w.toFixed(2) + ' lb — in spec (' + MIN_LB + '–' + MAX_LB + ')' : w.toFixed(2) + ' lb — OUT OF SPEC (' + MIN_LB + '–' + MAX_LB + ')'
    $('spec').className   = 'pill ' + (inSpec ? 'ok' : 'bad')
    $('lot').className    = $('lot').value.trim() ? '' : 'warn'
    $('go').disabled = !ok
    $('go').style.opacity = ok ? 1 : 0.4
  }
  ;['product','wt','lot'].forEach(id => $(id).addEventListener('input', render))
  $('go').addEventListener('click', () => {
    if (!$('lot').value.trim() && !confirm('Lot is blank — print anyway?')) return
    window.print()
  })
  $('std').addEventListener('click', () => {
    const u = new URL(window.location.href); u.searchParams.set('format', 'std'); window.location.href = u.toString()
  })
  render()
  ${autoPrint ? 'window.onload = () => setTimeout(() => window.print(), 300)' : ''}
</script>
</body>
</html>`
}
