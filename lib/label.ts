export interface BoxScan   { id: string; item_name: string; plu_number: string; weight_lbs: number; quantity: number }
export interface BoxRecord { id: string; customer_name: string; pack_date: string; box_number: number; is_closed: boolean; is_final: boolean; total_weight_lbs: number; total_cuts: number; serial_number?: string }
export interface LabelFlags { usda_bug: boolean; retail_exempt: boolean; not_for_sale: boolean }

export const DEFAULT_FLAGS: LabelFlags = { usda_bug: true, retail_exempt: false, not_for_sale: false }

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

export function generateLabel(box: BoxRecord, scans: BoxScan[], flags: LabelFlags = DEFAULT_FLAGS): string {
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
  const boxLabel    = `Box ${box.box_number}${box.is_final ? ' ★' : ''}`
  const dateStr     = new Date(box.pack_date + 'T12:00:00').toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })

  const itemRows = items.map(([name, v]) =>
    `<div class="item-row"><span><b>(${v.count})</b> ${name}</span><span>${v.weight.toFixed(2)} lb</span></div>`
  ).join('')

  const usdaHTML = flags.usda_bug ? `
    <div class="usda-bug">
      <div style="font-size:7pt;font-weight:bold;letter-spacing:0.08em">USDA</div>
      <div style="font-size:5.5pt;letter-spacing:0.04em">INSPECTED &amp; PASSED</div>
    </div>` : ''
  const exemptHTML     = flags.retail_exempt ? `<div class="badge">RETAIL EXEMPT</div>` : ''
  const notForSaleHTML = flags.not_for_sale   ? `<div class="nfs">★ NOT FOR SALE ★</div>` : ''

  const barcodeHTML = box.serial_number ? `
  <hr>
  <div class="serial">SERIAL: ${box.serial_number}</div>
  <div class="barcode">${makeCode39Barcode(box.serial_number)}</div>` : ''

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Box Label — ${box.customer_name} ${boxLabel}</title>
<style>
  @page { size: 4in auto; margin: 0.15in; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { width: 3.7in; font-family: Arial, sans-serif; color: #000; background: #fff; }
  .top-bar  { display: flex; justify-content: space-between; align-items: flex-start; }
  .company  { font-family: 'Arial Narrow', Arial, sans-serif; font-size: 9pt; font-weight: bold; text-align: center; letter-spacing: 0.05em; margin-bottom: 2px; flex: 1; }
  .usda-bug { border: 1.5px solid #000; border-radius: 50%; padding: 3px 5px; text-align: center; line-height: 1.25; flex-shrink: 0; }
  .customer { font-size: 20pt; font-weight: bold; text-align: center; line-height: 1.1; margin: 4px 0; }
  .box-num  { font-size: 14pt; font-weight: bold; text-align: center; margin-bottom: 2px; }
  .date     { font-family: 'Arial Narrow', Arial, sans-serif; font-size: 9pt; text-align: center; margin-bottom: 4px; }
  hr        { border: none; border-top: 1px solid #000; margin: 5px 0; }
  .item-row { display: flex; justify-content: space-between; align-items: baseline;
              font-family: 'Arial Narrow', Arial, sans-serif; font-size: 11pt; padding: 1px 0; }
  .footer   { font-family: 'Arial Narrow', Arial, sans-serif; font-size: 10pt; font-weight: bold; text-align: center; margin-top: 2px; }
  .badge    { text-align: center; font-size: 7.5pt; font-weight: bold; border: 1px solid #000; border-radius: 2px; padding: 1px 4px; display: inline-block; margin: 2px auto; letter-spacing: 0.06em; }
  .nfs      { text-align: center; font-size: 9pt; font-weight: bold; letter-spacing: 0.1em; margin: 3px 0; }
  .barcode  { text-align: center; margin: 6px 0 2px; }
  .barcode svg { max-width: 100%; height: auto; display: block; margin: 0 auto; }
  .serial   { text-align: center; font-size: 10pt; font-family: monospace; letter-spacing: 0.1em; font-weight: bold; margin: 4px 0 2px; }
  @media print { html, body { width: 4in; } }
</style>
</head>
<body>
  <div class="top-bar">
    <div style="flex:1;text-align:center">
      <img src="/cmc-horns.jpg" alt="" style="height:32px;display:block;margin:0 auto 2px">
      <div class="company">COWBOY MEAT COMPANY</div>
    </div>
    ${usdaHTML}
  </div>
  ${notForSaleHTML}
  ${exemptHTML ? `<div style="text-align:center">${exemptHTML}</div>` : ''}
  <div class="customer">${box.customer_name.toUpperCase()}</div>
  <div class="box-num">${boxLabel}</div>
  <div class="date">${dateStr}</div>
  <hr>
  ${itemRows}
  <hr>
  <div class="footer">${totalCuts} cut${totalCuts !== 1 ? 's' : ''} | ${totalWeight.toFixed(2)} lbs total</div>
  ${barcodeHTML}
  <script>window.onload = () => setTimeout(() => window.print(), 250)</script>
</body>
</html>`
}
