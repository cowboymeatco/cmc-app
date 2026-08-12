import { makeCode39Barcode, julianYYDDD, displayCustomerName, LabelFlags, DEFAULT_FLAGS, LabelAnimal, BoxRecord, BoxScan, USDA_EST_NUMBER, marksInspection } from './label'

// Work-in-progress tag — rides with the box from the processing room to value
// add. Replaces the handwritten WIP sheet (WEIGHT / CUSTOMER / INTENT / LABEL /
// BATCH), so the things that get lost in handwriting print big: whose product
// it is, what it is supposed to become, and what inspection it came out under.

export interface WIPTagData {
  customer:          string
  keepSeparate:      boolean          // a named customer's own animal, not shelf stock
  sourceDescription: string | null    // what's in the box now — "Trim"
  intent:            string           // what it becomes — "Make snack sticks"
  labelAs:           string | null    // what it gets labeled as when it's done
  weightLbs:         number | null
  assignedTo:        string | null
  date:              string           // ISO date — drives batch + printed date
  code:              string | null    // scannable: box serial or WIP tag code
  notes:             string | null
  items:             { name: string; count: number; weight: number }[]
  producer:          string | null
  // How the intent was reached, when it came off a cut card. A name match is
  // worth showing — it's the one that can pick the wrong customer.
  intentSource?:     string | null
  // The customer's FULL smokehouse order list off the cut card. When they
  // ordered more than one thing (two brat flavors), the tag shows all of them —
  // the intent line says what this box starts, the list says the whole scope,
  // so value add never seasons a single-flavor batch against a two-flavor order
  // (Charlie, 2026-07-30).
  orders?:           { label: string; lbs: number | null; current: boolean }[]
}

export interface WIPJob {
  id:                 string
  tag_code:           string | null
  customer_name:      string | null
  source_description: string | null
  job_type:           string
  description:        string | null
  output_item_name:   string | null
  output_plu:         string | null
  weight_in_lbs:      number | null
  assigned_to:        string | null
  requested_date:     string
  notes:              string | null
}

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))

const JOB_TYPE_WORDS: Record<string, string> = {
  smokehouse: 'Smokehouse',
  patties:    'Patties',
  sausage:    'Sausage',
  other:      'Value Add',
}

// A box is work-in-progress when the crew says so on the box itself. Deliberately
// no bare "VA" — the recipient field often holds a customer name, and a wrong
// match here prints a WIP tag on somebody's finished box.
const WIP_LABEL_RE = /\b(wip|work in progress|value ?add)\b/i

export function isWIPBoxLabel(boxLabel?: string | null): boolean {
  return WIP_LABEL_RE.test(boxLabel || '')
}

// The intent line is the whole point of the tag — "make sticks", "make jerky".
export function wipIntent(job: WIPJob): string {
  const typed = (job.description || '').trim()
  if (typed) return typed
  return JOB_TYPE_WORDS[job.job_type] ?? 'Value Add'
}

// ── Adapters ──────────────────────────────────────────────────────────────────

export function wipDataFromJob(job: WIPJob): WIPTagData {
  const customer = (job.customer_name || '').trim()
  return {
    customer:          customer || 'CMC SHELF STOCK',
    keepSeparate:      !!customer,
    sourceDescription: job.source_description,
    intent:            wipIntent(job),
    labelAs:           [job.output_item_name, job.output_plu ? `(${job.output_plu})` : ''].filter(Boolean).join(' ').trim() || null,
    weightLbs:         job.weight_in_lbs,
    assignedTo:        job.assigned_to,
    date:              job.requested_date,
    code:              job.tag_code,
    notes:             job.notes,
    items:             [],
    producer:          null,
  }
}

// A box headed to value add: the box recipient field carries the intent, the
// box serial is already a scannable code, and the scans say what's inside.
export function wipDataFromBox(box: BoxRecord, scans: BoxScan[], animal?: LabelAnimal, intentOverride?: string | null): WIPTagData {
  const grouped: Record<string, { count: number; weight: number }> = {}
  for (const s of scans) {
    const key = s.item_name || s.plu_number || 'Unknown'
    if (!grouped[key]) grouped[key] = { count: 0, weight: 0 }
    grouped[key].count  += s.quantity ?? 1
    grouped[key].weight += Number(s.weight_lbs) || 0
  }
  const items = Object.entries(grouped)
    .map(([name, v]) => ({ name, count: v.count, weight: v.weight }))
    .sort((a, b) => b.weight - a.weight)

  // Strip the WIP marker out of the recipient field so the intent reads clean:
  // "WIP — snack sticks" prints as "SNACK STICKS".
  const rawLabel = (box.box_label || '').trim()
  const intent = rawLabel.replace(WIP_LABEL_RE, '').replace(/^[\s—–\-:·]+|[\s—–\-:·]+$/g, '').trim()

  const customer = displayCustomerName(box.customer_name, animal?.hangingWeightLbs)
  const isStock  = /^cmc\b/i.test(customer)

  // total_weight_lbs is only written when the box is closed, but a WIP tub gets
  // tagged while it's still open — fall back to what's actually been scanned in
  // so the batch weight is never blank. It's the number the seasoning and the
  // yield both come off of.
  const scanned = items.reduce((sum, i) => sum + i.weight, 0)
  const weight  = box.total_weight_lbs != null && Number(box.total_weight_lbs) > 0
    ? Number(box.total_weight_lbs)
    : (scanned > 0 ? scanned : null)

  return {
    customer:          customer || 'CMC',
    keepSeparate:      !isStock,
    sourceDescription: items.length === 1 ? items[0].name : (items.length > 1 ? `${items.length} items` : null),
    // A resolved order off the cut card beats whatever was scribbled on the box.
    intent:            (intentOverride || '').trim() || intent || 'Value Add',
    labelAs:           null,
    weightLbs:         weight,
    assignedTo:        null,
    date:              box.pack_date,
    code:              box.serial_number ?? null,
    notes:             box.notes || null,
    items,
    producer:          animal?.producer ?? null,
  }
}

// ── Tag ───────────────────────────────────────────────────────────────────────

export function generateWIPLabel(data: WIPTagData, flags: LabelFlags = DEFAULT_FLAGS): string {
  const julian  = julianYYDDD(data.date)
  const dateStr = new Date(data.date + 'T12:00:00').toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })
  const weight  = data.weightLbs != null ? `${Number(data.weightLbs).toFixed(1)} lb` : '__________'

  const row = (k: string, v: string | null) =>
    v ? `<div class="row"><span class="k">${k}</span><span class="v">${esc(v)}</span></div>` : ''

  // What inspection this came out of the processing room under. Custom-exempt
  // product can never carry the mark and must read NOT FOR SALE — printing it
  // as a band, not just the small bug, so nobody has to squint at a tub. Retail
  // exempt falls through to the unmarked band the same way (see marksInspection).
  const inspection = flags.not_for_sale
    ? `<div class="insp nfs">NOT FOR SALE &middot; CUSTOM EXEMPT</div>`
    : marksInspection(flags)
      ? `<div class="insp usda">
           <img class="bug" src="/usda-legend.png" alt="USDA Inspected">
           <span>USDA INSPECTED &middot; EST. ${esc(USDA_EST_NUMBER)}</span>
         </div>`
      : `<div class="insp plain">INSPECTION NOT MARKED</div>`

  const exemptHTML = flags.retail_exempt ? `<div class="exempt">RETAIL EXEMPT</div>` : ''

  // Multiple orders share the big bordered INTENT box, each as its own bold
  // line — same weight as a single intent, not a fine-print list (Charlie,
  // 2026-07-30). The arrow marks the order this box starts.
  const multiOrders = (data.orders?.length ?? 0) > 1
  const intentHTML = multiOrders
    ? `<div class="intent multi">${(data.orders ?? []).map(o =>
        `<div class="iline">${o.current ? '&#9656; ' : ''}${esc(o.label).toUpperCase()}${o.lbs != null ? ` &middot; ${o.lbs} LB` : ''}</div>`
      ).join('')}</div>`
    : `<div class="intent">${esc(data.intent).toUpperCase()}</div>`

  const itemRows = data.items.length > 0
    ? `<hr><div class="items">${data.items.map(i =>
        `<div class="item"><span><b>(${i.count})</b> ${esc(i.name)}</span><span>${i.weight.toFixed(2)} lb</span></div>`
      ).join('')}</div>`
    : ''

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>WIP Tag — ${esc(data.customer)} ${esc(data.intent)}</title>
<style>
  @page { size: 4in auto; margin: 0.15in; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { width: 3.7in; font-family: Arial, sans-serif; color: #000; background: #fff; }
  .logo    { display: block; width: 100%; max-width: 2.6in; height: auto; margin: 0 auto 2px; }
  .title   { font-size: 17pt; font-weight: bold; text-align: center; letter-spacing: 0.06em;
             border: 2.5px solid #000; border-radius: 3px; padding: 2px 0; margin-bottom: 4px; }
  .cust    { font-size: 20pt; font-weight: bold; text-align: center; line-height: 1.05; }
  .keepsep { font-size: 9pt; font-weight: bold; text-align: center; letter-spacing: 0.06em;
             border: 1.5px solid #000; padding: 1px 0; margin: 2px 0; }
  .producer{ font-family: 'Arial Narrow', Arial, sans-serif; font-size: 10pt; text-align: center; }
  .intent-k{ font-size: 8.5pt; font-weight: bold; letter-spacing: 0.14em; text-align: center; margin-top: 2px; }
  .intent  { font-size: 19pt; font-weight: bold; text-align: center; line-height: 1.1;
             border: 2px solid #000; border-radius: 3px; padding: 3px 4px; margin-bottom: 3px; }
  /* Inspection band — the level this came out of the processing room under. */
  .insp    { display: flex; align-items: center; justify-content: center; gap: 5px;
             border: 2px solid #000; border-radius: 3px; padding: 2px 4px; margin: 3px 0;
             font-size: 10.5pt; font-weight: bold; letter-spacing: 0.04em; text-align: center; }
  .insp .bug { width: 0.42in; height: auto; display: block; }
  .insp.nfs  { font-size: 12pt; letter-spacing: 0.06em; }
  .insp.plain{ font-weight: normal; font-style: italic; }
  .exempt  { text-align: center; font-size: 8pt; font-weight: bold; border: 1px solid #000;
             border-radius: 2px; padding: 1px 4px; display: inline-block; letter-spacing: 0.06em; }
  hr       { border: none; border-top: 1px solid #000; margin: 4px 0; }
  .row     { display: flex; align-items: baseline; font-size: 11.5pt; padding: 1.5px 0; }
  .k       { font-family: 'Arial Narrow', Arial, sans-serif; font-weight: bold;
             letter-spacing: 0.08em; width: 1.05in; flex-shrink: 0; }
  .v       { font-weight: bold; flex: 1; border-bottom: 1px solid #000; min-height: 15px; }
  .item    { display: flex; justify-content: space-between; align-items: baseline;
             font-family: 'Arial Narrow', Arial, sans-serif; font-size: 10.5pt; padding: 0.5px 0; }
  .srcnote { font-family: 'Arial Narrow', Arial, sans-serif; font-size: 7.5pt; text-align: center;
             font-style: italic; margin: -1px 0 3px; }
  /* Two-plus orders: same bordered box, one bold line each. Slightly smaller
     than a lone intent so two full flavor names still land on a 3.7in tag. */
  .intent.multi { font-size: 14pt; }
  .intent .iline { padding: 1px 0; }
  .intent .iline + .iline { border-top: 1px solid #000; }
  .batch   { text-align: center; font-size: 10pt; margin-top: 3px; }
  .batch b { font-family: monospace; letter-spacing: 0.1em; font-size: 12pt; }
  .barcode { text-align: center; margin: 3px 0 1px; }
  .barcode svg { max-width: 100%; height: auto; display: block; margin: 0 auto; }
  .code    { text-align: center; font-size: 10pt; font-family: monospace; letter-spacing: 0.12em; font-weight: bold; }
  .foot    { font-family: 'Arial Narrow', Arial, sans-serif; font-size: 8.5pt; text-align: center; margin-top: 3px; }
  @media print { html, body { width: 4in; } }
</style>
</head>
<body>
  <img class="logo" src="/cmc-logo.png" alt="Cowboy Meat Co">
  <div class="title">WORK IN PROGRESS</div>

  <div class="cust">${esc(data.customer).toUpperCase()}</div>
  ${data.keepSeparate ? `<div class="keepsep">CUSTOMER PRODUCT — KEEP SEPARATE</div>` : ''}
  ${data.producer ? `<div class="producer">Producer: <b>${esc(data.producer)}</b></div>` : ''}
  ${exemptHTML ? `<div style="text-align:center">${exemptHTML}</div>` : ''}

  <div class="intent-k">INTENT</div>
  ${intentHTML}
  ${data.intentSource === 'name'
    ? `<div class="srcnote">from cut card matched by name — check it's the right customer</div>`
    : data.intentSource === 'name-multi'
      ? `<div class="srcnote">this customer has more than one cut card — every order from all of them is listed; check which animal this is</div>`
      : data.intentSource
        ? `<div class="srcnote">from ${esc(data.intentSource)}-linked cut card</div>`
        : ''}

  ${inspection}

  ${row('FROM:',   data.sourceDescription)}
  ${row('WEIGHT:', weight)}
  ${row('LABEL:',  data.labelAs)}
  ${row('FOR:',    data.assignedTo)}

  ${itemRows}

  <div class="batch">BATCH <b>${julian}</b> &nbsp;&middot;&nbsp; ${dateStr}</div>

  ${data.code ? `<div class="barcode">${makeCode39Barcode(data.code)}</div>
  <div class="code">${esc(data.code)}</div>` : ''}

  ${data.notes ? `<hr><div class="foot">${esc(data.notes)}</div>` : ''}
  <script>window.onload = () => setTimeout(() => window.print(), 250)</script>
</body>
</html>`
}
