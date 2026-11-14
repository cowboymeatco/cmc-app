// The handbook and role documents (/handbook): shapes, the small markdown
// renderer the pages are written in, and the printout. Safe to import from
// client components — no database access here (see lib/hrDocsServer.ts).
//
// Pages are plain markdown so Charlie can edit them in a text box: headings,
// bold and italic, lists, tables, links and rules. The renderer escapes
// everything first and only then adds its own tags, so a document can never
// carry markup of its own onto the page.

export type HrAudience = 'everyone' | 'assigned'

/** What an employee sees: the newest published copy of a document. */
export interface HrDocSummary {
  id:              string
  title:           string
  audience:        HrAudience
  version:         number
  publishedAt:     string          // ISO timestamp
  acknowledgedAt:  string | null   // this employee, this version
}
export interface HrDoc extends HrDocSummary { body: string }

/** The manager's view of a document: the draft and where publishing stands. */
export interface HrManageDoc {
  id:                string
  title:             string
  audience:          HrAudience
  body:              string        // working draft
  publishedVersion:  number        // 0 = never published
  publishedAt:       string | null
  /** The draft differs from what's published (or nothing is published yet). */
  dirty:             boolean
  archived:          boolean
  updatedAt:         string
  assignedTo:        string[]      // employee ids ('assigned' documents)
  /** Who has to read the published version, and who has. */
  readers:           { employeeId: string; name: string; acknowledgedAt: string | null }[]
}

export const AUDIENCE_LABEL: Record<HrAudience, string> = {
  everyone: 'Everyone (handbook)',
  assigned: 'Assigned people only (role document)',
}

// ── Markdown ────────────────────────────────────────────────────────────────

export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

/** Bold, italic and links inside one line. Input is raw text; output is safe HTML. */
function inline(raw: string): string {
  let s = esc(raw)
  // [text](https://…) — web and mail links only, so a document can't smuggle in a script URL.
  s = s.replace(/\[([^\]]+)\]\(((?:https?:\/\/|mailto:)[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
  s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
  s = s.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<i>$2</i>')
  return s
}

const isRule    = (l: string) => /^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(l)
const isHeading = (l: string) => /^#{1,4}\s+\S/.test(l)
const isBullet  = (l: string) => /^\s*[-*•]\s+\S/.test(l)
const isOrdered = (l: string) => /^\s*\d+[.)]\s+\S/.test(l)
const isCheck   = (l: string) => /^\s*[-*]\s+\[[ xX]\]\s+/.test(l)
const isTableRow = (l: string) => /^\s*\|.*\|\s*$/.test(l)
const isTableSep = (l: string) => /^\s*\|[\s:|-]+\|\s*$/.test(l) && l.includes('-')
const cells = (l: string) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim())

/** A document's markdown as HTML. Everything in it is escaped; the only tags are the ones built here. */
export function renderMarkdown(md: string): string {
  const lines = md.replace(/\r\n?/g, '\n').split('\n')
  const out: string[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) { i++; continue }

    if (isRule(line)) { out.push('<hr>'); i++; continue }

    if (isHeading(line)) {
      const level = line.match(/^#+/)![0].length
      out.push(`<h${level}>${inline(line.replace(/^#+\s+/, '').replace(/\s+#+\s*$/, ''))}</h${level}>`)
      i++; continue
    }

    if (isTableRow(line) && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const head = cells(line)
      i += 2
      const rows: string[][] = []
      while (i < lines.length && isTableRow(lines[i])) { rows.push(cells(lines[i])); i++ }
      out.push(
        '<table><thead><tr>' + head.map(c => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>' +
        rows.map(r => '<tr>' + head.map((_, k) => `<td>${inline(r[k] ?? '')}</td>`).join('') + '</tr>').join('') +
        '</tbody></table>',
      )
      continue
    }

    if (isBullet(line) || isOrdered(line)) {
      const ordered = !isBullet(line)
      const items: string[] = []
      while (i < lines.length && (ordered ? isOrdered(lines[i]) : isBullet(lines[i]))) {
        const l = lines[i]
        if (isCheck(l)) {
          const done = /\[[xX]\]/.test(l)
          items.push(`<li class="check">${done ? '☑' : '☐'} ${inline(l.replace(/^\s*[-*]\s+\[[ xX]\]\s+/, ''))}</li>`)
        } else {
          items.push(`<li>${inline(l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, ''))}</li>`)
        }
        i++
      }
      out.push(`<${ordered ? 'ol' : 'ul'}>${items.join('')}</${ordered ? 'ol' : 'ul'}>`)
      continue
    }

    // A paragraph runs until a blank line or the start of another block.
    const para: string[] = []
    while (
      i < lines.length && lines[i].trim() && !isRule(lines[i]) && !isHeading(lines[i]) &&
      !isBullet(lines[i]) && !isOrdered(lines[i]) &&
      !(isTableRow(lines[i]) && i + 1 < lines.length && isTableSep(lines[i + 1]))
    ) { para.push(lines[i].trim()); i++ }
    out.push(`<p>${para.map(inline).join('<br>')}</p>`)
  }
  return out.join('\n')
}

/** Styles for a rendered document. `ink`/`rule` let the screen (cream on brown) and the printout (black on white) share it. */
export function docCss(scope: string, ink: string, muted: string, rule: string): string {
  return `
    ${scope} { color: ${ink}; font-size: 0.95rem; line-height: 1.6; overflow-wrap: anywhere; }
    ${scope} h1 { font-family: Georgia, serif; font-size: 1.5rem; margin: 1.4rem 0 0.6rem; }
    ${scope} h2 { font-family: Georgia, serif; font-size: 1.2rem; margin: 1.4rem 0 0.5rem; padding-bottom: 0.2rem; border-bottom: 1px solid ${rule}; }
    ${scope} h3 { font-size: 1.02rem; margin: 1.1rem 0 0.4rem; }
    ${scope} h4 { font-size: 0.95rem; margin: 1rem 0 0.3rem; color: ${muted}; }
    ${scope} p { margin: 0 0 0.7rem; }
    ${scope} ul, ${scope} ol { margin: 0 0 0.8rem; padding-left: 1.4rem; }
    ${scope} li { margin-bottom: 0.25rem; }
    ${scope} li.check { list-style: none; margin-left: -1.2rem; }
    ${scope} hr { border: none; border-top: 1px solid ${rule}; margin: 1.2rem 0; }
    ${scope} a { color: inherit; }
    ${scope} table { border-collapse: collapse; width: 100%; margin: 0 0 1rem; font-size: 0.9rem; }
    ${scope} th, ${scope} td { border: 1px solid ${rule}; padding: 0.4rem 0.55rem; text-align: left; vertical-align: top; }
    ${scope} th { font-weight: 700; }
  `
}

// ── Printout ────────────────────────────────────────────────────────────────

const stamp = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { timeZone: 'America/Denver', year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
export const stampMT = (iso: string) => `${stamp(iso)} MT`
export const dayMT = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { timeZone: 'America/Denver', year: 'numeric', month: 'long', day: 'numeric' })

export interface PrintOpts {
  title:       string
  body:        string
  /** "Version 3 · published November 13, 2026", or "DRAFT — not published". */
  versionLine: string
  /** Print a wet-signature block for this person (the paper copy kept on site). */
  signFor?:    string
  /** In-app acknowledgments to list at the end. */
  acks?:       { name: string; acknowledgedAt: string }[]
}

/** A document as a standalone page for Print → Save as PDF. Opens in its own tab. */
export function buildPrintHTML(o: PrintOpts): string {
  const sign = o.signFor === undefined ? '' : `
    <div class="sign">
      <p>I have read this document and understand it. It describes policies and duties and is not a contract; it may change as the business needs.</p>
      <table class="sig">
        <tr><td>${esc(o.signFor || 'Team member')}</td><td></td><td></td></tr>
        <tr class="cap"><td>Name</td><td>Signature</td><td>Date</td></tr>
        <tr><td>Charlie Hollenbeck, President &amp; CEO</td><td></td><td></td></tr>
        <tr class="cap"><td>Name</td><td>Signature</td><td>Date</td></tr>
      </table>
    </div>`
  const acks = !o.acks?.length ? '' : `
    <div class="acks">
      <h3>Acknowledged in the app</h3>
      <table><thead><tr><th>Team member</th><th>Acknowledged</th></tr></thead><tbody>
        ${o.acks.map(a => `<tr><td>${esc(a.name)}</td><td>${esc(stampMT(a.acknowledgedAt))}</td></tr>`).join('')}
      </tbody></table>
    </div>`
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(o.title)}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    @page { size: letter; margin: 0.75in; }
    body { font-family: Arial, Helvetica, sans-serif; color: #111; margin: 0; padding: 24px; }
    .sheet { max-width: 7in; margin: 0 auto; }
    .brand { font: 700 11px Arial, sans-serif; letter-spacing: 0.18em; text-transform: uppercase; color: #555; }
    h1.title { font-family: Georgia, serif; font-size: 24px; margin: 4px 0 2px; }
    .ver { font-size: 11px; color: #555; margin-bottom: 14px; padding-bottom: 8px; border-bottom: 2px solid #111; }
    ${docCss('.doc', '#111', '#444', '#999')}
    h2, h3 { break-after: avoid; } tr, li { break-inside: avoid; }
    .sign, .acks { margin-top: 28px; break-inside: avoid; font-size: 13px; }
    table.sig { width: 100%; border-collapse: collapse; }
    table.sig td { width: 33%; padding: 26px 8px 2px 0; border-bottom: 1px solid #111; font-size: 13px; }
    table.sig tr.cap td { border-bottom: none; padding: 2px 8px 0 0; font-size: 10px; color: #555; text-transform: uppercase; letter-spacing: 0.08em; }
    .acks table { border-collapse: collapse; width: 100%; } .acks th, .acks td { border: 1px solid #999; padding: 5px 8px; text-align: left; font-size: 12px; }
    .bar { position: fixed; top: 12px; right: 12px; display: flex; gap: 8px; }
    .bar button { background: #1A0A04; color: #F2E8D9; border: none; border-radius: 8px; padding: 12px 18px; font: 700 15px Arial, sans-serif; cursor: pointer; }
    @media print { .bar { display: none !important; } body { padding: 0; } }
  </style></head><body>
  <div class="bar"><button type="button" onclick="window.print()">Print / Save as PDF</button><button type="button" onclick="window.close()">Close</button></div>
  <div class="sheet">
    <div class="brand">Cowboy Meat Company · Forsyth, Montana</div>
    <h1 class="title">${esc(o.title)}</h1>
    <div class="ver">${esc(o.versionLine)}</div>
    <div class="doc">${renderMarkdown(o.body)}</div>
    ${sign}${acks}
  </div></body></html>`
}

/** Open a printout in its own tab. Returns false if the browser blocked the pop-up. */
export function openPrint(html: string): boolean {
  const w = window.open('', '_blank')
  if (!w) return false
  w.document.open(); w.document.write(html); w.document.close()
  return true
}
