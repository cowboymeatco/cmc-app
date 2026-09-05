// Form 1 — Receiving Program Log (HACCP form set 02.15.24).
// One print routine, called from /receiving (where the log is filled in)
// and from the /haccp hub (where the inspector's binder gets printed).
import { BoxReceivingLog } from '@/lib/types'

// ── HACCP Receiving Log Report ────────────────────────────────────────────────
export function printReceivingLog(logs: BoxReceivingLog[], reportStart: string, reportEnd: string) {
  const ROWS = 10
  const pages: (BoxReceivingLog | null)[][] = []
  for (let i = 0; i < Math.max(logs.length, 1); i += ROWS) {
    const chunk: (BoxReceivingLog | null)[] = logs.slice(i, i + ROWS)
    while (chunk.length < ROWS) chunk.push(null)
    pages.push(chunk)
  }
  const totalPages = pages.length

  const fmtDate = (d: string) =>
    new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' })
  const fmtRange = (d: string) =>
    new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  const fmtAmt = (log: BoxReceivingLog) => {
    const parts: string[] = []
    if (log.quantity != null) parts.push(`${log.quantity} unit${log.quantity !== 1 ? 's' : ''}`)
    if (log.weight_lbs != null) parts.push(`${log.weight_lbs} lbs`)
    return parts.join(' / ')
  }
  const fmtLot = (log: BoxReceivingLog) =>
    [log.lot_no, log.invoice_no].filter(Boolean).join(' / ')

  const headerHTML = `
    <tr>
      <th style="width:6%">Date</th>
      <th style="width:18%">Product / Item Description</th>
      <th style="width:16%">Company Name &amp; Est. # (If applicable)</th>
      <th style="width:14%">Lot Number or Invoice Number</th>
      <th style="width:10%">Amount (Carcasses / lbs. / gal. / boxes / etc.)</th>
      <th style="width:10%">Receiving Program Procedures Followed?</th>
      <th style="width:9%">Product Temp. (If applicable) (&le;45&deg;F.)</th>
      <th style="width:9%">CAR # (If Appl.)</th>
      <th style="width:8%">Initials</th>
    </tr>`

  const pageHTML = (rows: (BoxReceivingLog | null)[], pageNum: number, isLast: boolean) => `
    <div class="page" ${pageNum > 1 ? 'style="page-break-before:always"' : ''}>
      <table class="hdr">
        <tr><td colspan="4" class="co">Cowboy Meat Co.</td></tr>
        <tr>
          <td><strong>Document Name</strong></td>
          <td><strong>APPROVED BY</strong></td>
          <td><strong>Current Version</strong></td>
          <td><strong>PAGE</strong></td>
        </tr>
        <tr>
          <td><em>Receiving Log</em></td>
          <td><em>HACCP Team</em></td>
          <td><em>02.15.24</em></td>
          <td><em>${pageNum} of ${totalPages}</em></td>
        </tr>
      </table>

      <h2>Receiving Log &nbsp;<span class="sub">(Meat; Ingredients; Chemicals; Packaging Materials)</span></h2>
      <p class="period">Week of ${fmtRange(reportStart)} &ndash; ${fmtRange(reportEnd)}</p>

      <table class="data">
        <thead>${headerHTML}</thead>
        <tbody>
          ${rows.map(log => `
            <tr>
              <td>${log ? fmtDate(log.received_at) : ''}</td>
              <td>${log ? (log.product ?? '') : ''}</td>
              <td>${log ? (log.vendor ?? '') : ''}</td>
              <td>${log ? fmtLot(log) : ''}</td>
              <td>${log ? fmtAmt(log) : ''}</td>
              <td class="yn">${log ? '<span class="circ">Yes</span>&nbsp; No' : 'Yes &nbsp; No'}</td>
              <td>${log && log.temp_f != null ? `${log.temp_f}&deg;F` : ''}</td>
              <td></td>
              <td>${log ? (log.received_by ?? '') : ''}</td>
            </tr>`).join('')}
        </tbody>
      </table>

      ${isLast ? '<div class="comments"><strong>Comments:</strong></div>' : ''}
    </div>`

  const html = `<!DOCTYPE html><html><head>
  <meta charset="utf-8">
  <title>Receiving Log — HACCP — ${fmtRange(reportStart)} to ${fmtRange(reportEnd)}</title>
  <style>
    @page { size: letter; margin: 0.65in 0.6in; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, sans-serif; font-size: 9.5pt; color: #000; }

    /* document header */
    table.hdr { width: 100%; border-collapse: collapse; margin-bottom: 10pt; }
    table.hdr td { border: 1px solid #000; padding: 3px 7px; text-align: center; }
    table.hdr .co { font-weight: bold; font-size: 11pt; }

    h2 { font-size: 13pt; font-weight: bold; margin-bottom: 2pt; }
    .sub { font-weight: normal; font-size: 9.5pt; }
    .period { font-size: 8.5pt; color: #444; margin-bottom: 7pt; }

    /* data table */
    table.data { width: 100%; border-collapse: collapse; font-size: 8pt; }
    table.data th { border: 1px solid #000; padding: 3px 4px; text-align: center; font-size: 7.5pt; background: #f0f0f0; line-height: 1.3; }
    table.data td { border: 1px solid #000; padding: 3px 5px; height: 30pt; vertical-align: middle; }
    .yn { text-align: center; white-space: nowrap; }
    .circ { border: 1.2px solid #000; border-radius: 50%; display: inline-block; padding: 1px 5px; font-weight: bold; }

    /* comments box */
    .comments { border: 1px solid #000; margin-top: 10pt; padding: 7pt 9pt; min-height: 60pt; }

    .page { page-break-inside: avoid; }
  </style>
  </head><body>
  ${pages.map((rows, i) => pageHTML(rows, i + 1, i === pages.length - 1)).join('')}
  <script>window.onload = function() { window.print(); }<\/script>
  </body></html>`

  const w = window.open('', '_blank', 'width=860,height=1100')
  if (w) { w.document.write(html); w.document.close() }
}
