import { makeCode39Barcode, julianYYDDD } from './label'

// Work-in-progress tag — rides with the tub from the processing room to value
// add. Replaces the handwritten WIP sheet (WEIGHT / CUSTOMER / INTENT / LABEL /
// BATCH), so the two things that get lost in handwriting print big: whose
// product it is, and what it is supposed to become.
export interface WIPJob {
  id:                 string
  tag_code:           string | null
  customer_name:      string | null
  source_description: string | null   // what's in the tub now — "Trim"
  job_type:           string
  description:        string | null   // the intent — "snack sticks"
  output_item_name:   string | null   // what it gets labeled as when it's done
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

// The intent line is the whole point of the tag — "make sticks", "make jerky".
// Prefer what was typed; fall back to the job type so the line is never empty.
export function wipIntent(job: WIPJob): string {
  const typed = (job.description || '').trim()
  if (typed) return typed
  return JOB_TYPE_WORDS[job.job_type] ?? 'Value Add'
}

export function generateWIPLabel(job: WIPJob): string {
  const intent   = wipIntent(job)
  const julian   = julianYYDDD(job.requested_date)
  const dateStr  = new Date(job.requested_date + 'T12:00:00').toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })
  const code     = job.tag_code || ''
  const weight   = job.weight_in_lbs != null ? `${Number(job.weight_in_lbs).toFixed(1)} lb` : '__________'
  // Blank customer means CMC shelf stock. Anything with a name is somebody's
  // own animal and must not get mixed in — that warning earns its ink.
  const customer = (job.customer_name || '').trim()
  const labelAs  = [job.output_item_name, job.output_plu ? `(${job.output_plu})` : ''].filter(Boolean).join(' ').trim()

  const row = (k: string, v: string) =>
    `<div class="row"><span class="k">${k}</span><span class="v">${esc(v) || '<span class=\"blank\"></span>'}</span></div>`

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>WIP Tag — ${esc(customer || 'CMC')} ${esc(intent)}</title>
<style>
  @page { size: 4in auto; margin: 0.15in; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { width: 3.7in; font-family: Arial, sans-serif; color: #000; background: #fff; }
  .logo    { display: block; width: 100%; max-width: 2.6in; height: auto; margin: 0 auto 2px; }
  .title   { font-size: 17pt; font-weight: bold; text-align: center; letter-spacing: 0.06em;
             border: 2.5px solid #000; border-radius: 3px; padding: 2px 0; margin-bottom: 4px; }
  .cust    { font-size: 20pt; font-weight: bold; text-align: center; line-height: 1.05; }
  .stock   { font-size: 13pt; font-weight: bold; text-align: center; letter-spacing: 0.04em; }
  .keepsep { font-size: 9pt; font-weight: bold; text-align: center; letter-spacing: 0.06em;
             border: 1.5px solid #000; padding: 1px 0; margin: 2px 0; }
  /* Intent is what the floor is actually reading off this tag — biggest block. */
  .intent-k { font-size: 8.5pt; font-weight: bold; letter-spacing: 0.14em; text-align: center; margin-top: 2px; }
  .intent  { font-size: 19pt; font-weight: bold; text-align: center; line-height: 1.1;
             border: 2px solid #000; border-radius: 3px; padding: 3px 4px; margin-bottom: 3px; }
  hr       { border: none; border-top: 1px solid #000; margin: 4px 0; }
  .row     { display: flex; align-items: baseline; font-size: 11.5pt; padding: 1.5px 0; }
  .k       { font-family: 'Arial Narrow', Arial, sans-serif; font-weight: bold;
             letter-spacing: 0.08em; width: 1.05in; flex-shrink: 0; }
  .v       { font-weight: bold; flex: 1; border-bottom: 1px solid #000; min-height: 15px; }
  .blank   { display: inline-block; }
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

  ${customer
    ? `<div class="cust">${esc(customer).toUpperCase()}</div>
       <div class="keepsep">CUSTOMER PRODUCT — KEEP SEPARATE</div>`
    : `<div class="stock">CMC SHELF STOCK</div>`}

  <div class="intent-k">INTENT</div>
  <div class="intent">${esc(intent).toUpperCase()}</div>

  ${row('FROM:',   job.source_description || '')}
  ${row('WEIGHT:', weight)}
  ${row('LABEL:',  labelAs)}
  ${row('FOR:',    job.assigned_to || '')}

  <div class="batch">BATCH <b>${julian}</b> &nbsp;&middot;&nbsp; ${dateStr}</div>

  ${code ? `<div class="barcode">${makeCode39Barcode(code)}</div>
  <div class="code">${esc(code)}</div>` : ''}

  ${job.notes ? `<hr><div class="foot">${esc(job.notes)}</div>` : ''}
  <script>window.onload = () => setTimeout(() => window.print(), 250)</script>
</body>
</html>`
}
