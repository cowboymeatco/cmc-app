'use client'
import { useEffect, useMemo, useState, useCallback } from 'react'
import Link from 'next/link'
import { isoDate } from '@/lib/dates'

const C = {
  dark:       '#1A0A04',
  darkBrown:  '#351E0E',
  medBrown:   '#75471B',
  lightBrown: '#A6785A',
  tan:        '#C9A882',
  cream:      '#F2E8D9',
  green:      '#4CAF50',
  amber:      '#E8883A',
  blue:       '#60A5FA',
}

const INPUT: React.CSSProperties = {
  background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(166,120,90,0.35)',
  borderRadius: 3, padding: '0.45rem 0.7rem', color: C.cream, fontSize: '0.88rem',
  outline: 'none', boxSizing: 'border-box',
}

interface VAItem { product: string; category: string; detail?: string; qty?: number }
interface Sheet {
  id:            string
  customer_name: string
  species:       string | null
  date:          string | null
  portion:       string | null
  // Whole-carcass hanging weights, as they print on the cut card — one entry
  // per animal the sheet is linked to, carrying its id so a split animal is
  // counted once in the column total.
  carcasses:     { id: string; lbs: number | null }[]
  products:      VAItem[]
  // Seal tags actually riding through the cure cooler for this customer —
  // shown in the cell under what the sheet ordered, so an ordered ham with no
  // tag next to it reads as a piece that never got tagged in.
  cure_tags:     { tag_number: string; product: string; status: string }[]
}

// A cure tag whose customer name matches no cut sheet at all. Reported rather
// than resolved: an abbreviation the floor uses ("MVML KRISTIN") can't be tied
// to the office's spelling ("MT Veterans Meat Locker Kristin") by any rule, and
// guessing would put one customer's ham on another's slip.
interface UnmatchedTagGroup {
  key:    string
  names:  string[]
  curing: number
  tags:   { tag_number: string; product: string; status: string }[]
}

// A tag's product → the column its ordered counterpart lives in.
const TAG_COL: Record<string, string> = {
  'Ham':            'Cured & Smoked Ham',
  'Bacon':          'Bacon',
  'Shoulder Bacon': 'Shoulder Bacon',
  'Bone-In Loin':   'Smoked Chops',
  'Hocks':          'Cured & Smoked Hocks',
  'Fresh Side':     'Fresh Side Pork',
}

const tagsFor = (s: Sheet, col: string) =>
  (s.cure_tags ?? []).filter(t => (TAG_COL[t.product] ?? t.product) === col)

// "🏷 0341981✓ · 0341982" — done gets the check, in-cure rides bare. A tag
// drawn on more than one sheet carries a * : it isn't pinned to an animal, so
// it prints on EVERY sheet its customer has, and without the mark a two-hog
// customer reads four bacon seals on each hog's row (Charlie, 2026-09-01 —
// "how are some hogs having more than 2 bacons scanned in?").
const tagText = (tags: { tag_number: string; status: string }[], seen?: Map<string, number>) =>
  tags.map(t => `${t.tag_number}${t.status === 'done' ? '✓' : ''}${(seen?.get(t.tag_number) ?? 0) > 1 ? '*' : ''}`).join(' · ')

const HAM_COL = 'Cured & Smoked Ham'

// One line per physical ham, keyed by the seal tag the crew reads off the piece.
// Charlie's ask (2026-08-28): standing at the rack you have a tag number in your
// hand, not a customer name, and what you need off it is how to cut that ham.
interface HamRow {
  tag:       string | null   // null = the sheet ordered it, nothing tagged in yet
  status:    string | null   // 'curing' | 'done'
  customer:  string
  date:      string | null
  cut:       string          // how to process it, straight off the cut sheet
  ambiguous: boolean         // sheet carries two ham styles — can't say which tag is which
  note:      string
}

// Column order for the value-add matrix — the way the cut walks the hog, ending
// with the smokehouse. Anything not listed sorts after, alphabetically.
const COL_ORDER = [
  'Bacon', 'Shoulder Bacon', 'Fresh Side Pork', 'Cured & Smoked Ham', 'Cured & Smoked Hocks',
  'Smoked Chops', 'Pulled Pork',
  'Pork Sausage', 'Pork Sausage Links', 'Pork Sausage Patties',
  'Italian Sausage', 'Italian Sausage Links', 'Italian Sausage Patties',
  'Jumpstart Spicy Sausage', 'Jumpstart Spicy Sausage Links', 'Jumpstart Spicy Sausage Patties',
  'Brots', 'Snack Sticks', 'Summer Sausage', 'Jerky', 'Hot Dogs',
]
const colRank = (p: string) => { const i = COL_ORDER.indexOf(p); return i === -1 ? 999 : i }

// Hanging weight is the WHOLE carcass, same as the cut card — so a partial
// share gets its size called out next to the number rather than the weight
// being scaled down. A whole share adds nothing and stays quiet.
const PORTION_TAG: Record<string, string> = {
  half: '½', 'half-ab': '½', quarter: '¼',
  'three-quarter': '¾', 'three-quarter-abc': '¾',
}
const hangLbs = (s: Sheet) => {
  const known = s.carcasses.filter(c => c.lbs != null)
  return known.length ? known.reduce((n, c) => n + (c.lbs as number), 0) : null
}
const fmtLbs = (n: number) => String(Math.round(n * 10) / 10)
// Cell/CSV text: "412" — or "412 · ½" on a share, "2 hd · 950" on a customer
// taking more than one animal.
const hangText = (s: Sheet) => {
  const lbs = hangLbs(s)
  if (lbs == null) return ''
  const tag  = PORTION_TAG[s.portion ?? ''] ?? ''
  const head = s.carcasses.length > 1 ? `${s.carcasses.length} hd · ` : ''
  return `${head}${fmtLbs(lbs)}${tag ? ` · ${tag}` : ''}`
}

const speciesEmoji = (s: string | null) =>
  s === 'Pork' ? '🐷' : s === 'Beef' ? '🐄' : s === 'Lamb' ? '🐑' : s === 'Goat' ? '🐐' : '🥩'

const TH: React.CSSProperties = {
  textAlign: 'left', padding: '0.6rem 0.85rem', color: C.tan, fontWeight: 700,
  whiteSpace: 'nowrap', fontSize: '0.76rem', textTransform: 'uppercase', letterSpacing: '0.05em',
}
const TD: React.CSSProperties = { padding: '0.55rem 0.85rem', color: C.cream, verticalAlign: 'top' }

function toCSV(rows: Record<string, unknown>[]): string {
  if (!rows.length) return ''
  const headers = Object.keys(rows[0])
  const esc = (v: unknown) => {
    const s = v == null ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [headers.join(','), ...rows.map(r => headers.map(h => esc(r[h])).join(','))].join('\n')
}

const escHtml = (v: unknown) =>
  String(v ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))

// "2026-07-30" → "Jul 30, 2026" (noon avoids the UTC-parse off-by-one)
const fmtDay = (iso: string) =>
  iso ? new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'

function download(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/csv' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click()
  document.body.removeChild(a); URL.revokeObjectURL(url)
}


export default function ValueAddReport() {
  const today = isoDate()
  const yearStart = today.slice(0, 4) + '-01-01'

  const [from, setFrom] = useState(yearStart)
  const [to,   setTo]   = useState(today)
  const [sheets, setSheets] = useState<Sheet[]>([])
  const [unmatched, setUnmatched] = useState<UnmatchedTagGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  const [mode,    setMode]    = useState<'all' | 'ham'>('all')
  // Hams the sheet ordered with no seal on them yet. Off by default: over a
  // year they outnumber the tagged ones three to one — every ham cut before we
  // started tagging is one — and this page is read to look a tag UP.
  const [withUntagged, setWithUntagged] = useState(false)
  const [species, setSpecies] = useState('Pork') // hogs first
  const [search,  setSearch]  = useState('')
  const [sortKey, setSortKey] = useState<'date' | 'customer'>('date')


  useEffect(() => {
    let cancelled = false
    setLoading(true); setErr('')
    const p = new URLSearchParams({ type: 'value_add', from, to })
    fetch(`/api/reports?${p}`)
      .then(r => r.json())
      .then(d => {
        if (cancelled) return
        // The route used to return a bare array and now returns { rows,
        // unmatchedTags }; read both so a stale tab doesn't blank the report.
        setSheets(Array.isArray(d) ? d : (d?.rows ?? []))
        setUnmatched(Array.isArray(d) ? [] : (d?.unmatchedTags ?? []))
      })
      .catch(() => { if (!cancelled) setErr('Could not load the report.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [from, to])

  // How many sheets each seal is drawn on — over the whole fetch, not the
  // filtered rows, so flipping the species filter doesn't change what a tag
  // claims about itself. >1 sighting = unpinned on a multi-sheet customer.
  const tagSeen = useMemo(() => {
    const m = new Map<string, number>()
    for (const s of sheets) for (const t of s.cure_tags ?? []) m.set(t.tag_number, (m.get(t.tag_number) ?? 0) + 1)
    return m
  }, [sheets])

  const speciesList = useMemo(
    () => [...new Set(sheets.map(s => s.species).filter(Boolean))].sort() as string[],
    [sheets],
  )

  // Cured ham only comes off a hog (lib/cureLoad PORK_ONLY_CURE_PRODUCTS), so the
  // ham view pins the species rather than letting a leftover Beef selection draw
  // an empty page that reads as "no hams".
  const effSpecies = mode === 'ham' ? 'Pork' : species

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    const out = sheets.filter(s => {
      if (effSpecies !== 'all' && s.species !== effSpecies) return false
      if (q && !s.customer_name.toLowerCase().includes(q)) return false
      return true
    })
    out.sort((a, b) =>
      sortKey === 'customer'
        ? a.customer_name.localeCompare(b.customer_name) || (a.date ?? '').localeCompare(b.date ?? '')
        : (b.date ?? '').localeCompare(a.date ?? '') || a.customer_name.localeCompare(b.customer_name),
    )
    return out
  }, [sheets, effSpecies, search, sortKey])

  // Columns present in the filtered rows, in cut order. Cell = the detail
  // (brats "German · 25 lb") when the sheet carries it, else a plain check.
  const cols = useMemo(() => {
    const set = new Set<string>()
    for (const s of rows) for (const p of s.products) set.add(p.product)
    return [...set].sort((a, b) => (colRank(a) - colRank(b)) || a.localeCompare(b))
  }, [rows])

  const itemsFor = (s: Sheet, col: string): VAItem[] => s.products.filter(p => p.product === col)
  const qtyOf    = (it: VAItem) => it.qty ?? 1
  const rowQty   = (s: Sheet) => s.products.reduce((n, p) => n + qtyOf(p), 0)
  // Cell text: a bare quantity for plain products ("2"), qty×detail for the ones
  // that carry a spec ("2× Cut in Half", "German · 25 lb"), joined when a product
  // has more than one variant on the sheet. Ham always carries its count — even a
  // single one reads "1×" — so the expected quantity is explicit (Charlie).
  const cellText = (items: VAItem[]) =>
    items.map(it => {
      if (!it.detail) return String(qtyOf(it))
      const showQty = qtyOf(it) > 1 || it.product === 'Cured & Smoked Ham'
      return showQty ? `${qtyOf(it)}× ${it.detail}` : it.detail
    }).join('  /  ')
  const colTotals = useMemo(
    () => cols.map(c => rows.reduce((n, s) => n + itemsFor(s, c).reduce((m, it) => m + qtyOf(it), 0), 0)),
    [cols, rows],
  )
  // Pounds on the rail behind these sheets. A split animal shows on two sheets
  // but is ONE carcass — keyed by carcass id so it's counted once.
  const hangTotal = useMemo(() => {
    const byCarcass = new Map<string, number>()
    for (const s of rows) for (const c of s.carcasses) if (c.lbs != null) byCarcass.set(c.id, c.lbs)
    return [...byCarcass.values()].reduce((a, b) => a + b, 0)
  }, [rows])

  // The ham list, keyed by the seal number — one line per physical ham.
  //
  // Keyed, not listed: a cure tag knows whose ham it is, not which of that
  // customer's animals, so an unpinned tag draws against EVERY sheet that
  // customer has (see the cure_tags note in app/api/reports). Building a row per
  // sheet printed one Montana Veterans ham four times under four different
  // instructions — worse than useless at the rack. So every sighting of a tag is
  // merged first, and the row says only what all of them agree on.
  const hamRows = useMemo<HamRow[]>(() => {
    interface Acc {
      tag: string; status: string
      customers: Set<string>; dates: Set<string>; cuts: Set<string>
      // Each distinct "what this sheet orders" the tag was drawn against, kept
      // as an expanded list in sheet order — ['Cut in Quarters', 'Steaks'] for a
      // hog whose two hams are cut two ways. Keyed by its own text, so two
      // sheets ordering the same thing collapse to one entry.
      orders: Map<string, string[]>
      sheetsOrdering: number
      /** The one cut this seal is to be given, once it can be settled. */
      assigned?: string
    }
    const byTag = new Map<string, Acc>()
    const untagged: HamRow[] = []

    for (const s of rows) {
      const items = itemsFor(s, HAM_COL)
      const tags  = tagsFor(s, HAM_COL)
      if (!items.length && !tags.length) continue
      // One entry per ham the sheet orders, in the order the sheet lists them.
      const expanded = items.flatMap(it => Array<string>(qtyOf(it)).fill(it.detail ?? ''))
      for (const t of tags) {
        const a = byTag.get(t.tag_number) ?? {
          tag: t.tag_number, status: t.status, customers: new Set<string>(),
          dates: new Set<string>(), cuts: new Set<string>(),
          orders: new Map<string, string[]>(), sheetsOrdering: 0,
        }
        // Collapsed whitespace, not just trimmed: the office has this customer
        // filed twice with a double space inside the name, and a raw Set kept
        // both, printing one customer three times across a single ham's row.
        a.customers.add(String(s.customer_name ?? '').replace(/\s+/g, ' ').trim())
        if (s.date) a.dates.add(s.date)
        for (const d of expanded) if (d) a.cuts.add(d)
        if (expanded.length) { a.orders.set(expanded.join('|'), expanded); a.sheetsOrdering++ }
        byTag.set(t.tag_number, a)
      }
      // Ordered but unaccounted for: what the sheet asked for, less the seals
      // actually hanging. These are the hams still to be tagged in.
      for (let i = tags.length; i < expanded.length; i++) {
        untagged.push({
          tag: null, status: null, date: s.date,
          customer: String(s.customer_name ?? '').replace(/\s+/g, ' ').trim(),
          cut: [...new Set(expanded.filter(Boolean))].join('  /  '),
          ambiguous: new Set(expanded.filter(Boolean)).size > 1,
          note: 'Not tagged into the cure cooler yet',
        })
      }
    }

    // Which physical ham gets which cut, where the sheet alone cannot say.
    //
    // A hog has two hams and they can be ordered cut two different ways. Both go
    // back to the same customer, so it does not matter which seal takes which —
    // only that each cut is used once. Charlie's call (2026-08-28): deal them out
    // in tag order rather than hand the crew a question at the rack.
    //
    // Only where every sheet the tag was drawn against orders the SAME thing.
    // Sheets that order different cuts are different animals, and those can be
    // different end buyers — Montana Veterans books several hogs under one
    // account. Dealing there would put one person's ham on another's slip, so it
    // stays flagged for someone to pin the tag to its animal.
    const groups = new Map<string, Acc[]>()
    for (const a of byTag.values()) {
      const k = [...a.customers].sort().join('|')
      groups.set(k, [...(groups.get(k) ?? []), a])
    }
    for (const g of groups.values()) {
      const orders = new Map<string, string[]>()
      for (const a of g) for (const [k, v] of a.orders) orders.set(k, v)
      if (orders.size !== 1) continue
      const cuts = [...orders.values()][0]
      // Nothing to settle unless the sheet names more than one cut, and nothing
      // that CAN be settled if one of them came through blank.
      if (cuts.some(c => !c) || new Set(cuts).size < 2) continue
      g.sort((x, y) => x.tag.localeCompare(y.tag))
      g.forEach((a, i) => { a.assigned = cuts[i % cuts.length] })
    }

    const out: HamRow[] = [...byTag.values()].map(a => {
      const cuts = [...a.cuts]
      const ambiguous = !a.assigned && cuts.length > 1
      const note = !a.sheetsOrdering
        ? 'No cured ham on this customer’s cut sheet — ask the office'
        : a.assigned
          ? 'Assigned in tag order — the sheet orders one of each and both hams are this customer’s'
          : ambiguous
            ? a.orders.size > 1
              ? 'This customer’s sheets order different cuts — pin the tag to its animal on Processing → In Cure'
              : 'Two ham styles with nothing to tell them apart — confirm which'
            : ''
      return {
        tag: a.tag, status: a.status,
        customer: [...a.customers].sort().join(' / '),
        // Every kill date this tag could belong to. One when the tag is pinned
        // or the customer has a single sheet, which is the normal case.
        date: [...a.dates].sort().join(' / ') || null,
        cut: a.assigned ?? cuts.join('  /  '), ambiguous, note,
      }
    })

    // Ham seals filed under a name no cut sheet uses. On the matrix these sit in
    // their own banner; here they belong in the list, because the crew looks a
    // tag up BY NUMBER and "not found" reads the same as "not ours".
    const q = search.trim().toLowerCase()
    for (const g of unmatched) {
      if (q && !g.names.some(n => n.toLowerCase().includes(q))) continue
      for (const t of g.tags) {
        if ((TAG_COL[t.product] ?? t.product) !== HAM_COL) continue
        out.push({
          tag: t.tag_number, status: t.status, customer: g.names.join(' / '), date: null,
          cut: '', ambiguous: false,
          note: 'No cut sheet under this name — ask the office before cutting',
        })
      }
    }

    // Tag order, because that is the order the crew reads them in — seals are
    // fixed width with a leading zero, so a string sort IS numeric order. The
    // untagged hams land at the end: there is no number to look them up by.
    out.sort((a, b) => (a.tag ?? '').localeCompare(b.tag ?? '') || a.customer.localeCompare(b.customer))
    untagged.sort((a, b) => a.customer.localeCompare(b.customer) || (a.date ?? '').localeCompare(b.date ?? ''))
    return [...out, ...untagged]
  }, [rows, unmatched, search])

  const hamStats = useMemo(() => ({
    curing:   hamRows.filter(h => h.status === 'curing').length,
    done:     hamRows.filter(h => h.status === 'done').length,
    untagged: hamRows.filter(h => !h.tag).length,
  }), [hamRows])

  const hamShown = useMemo(
    () => withUntagged ? hamRows : hamRows.filter(h => h.tag),
    [hamRows, withUntagged],
  )

  const hasRows = mode === 'ham' ? hamShown.length > 0 : rows.length > 0

  function exportCSV() {
    if (mode === 'ham') {
      download(toCSV(hamShown.map(h => ({
        cure_tag:   h.tag ?? '',
        status:     h.tag ? h.status ?? '' : 'not tagged in',
        customer:   h.customer,
        kill_date:  h.date ?? '',
        how_to_cut: h.cut,
        note:       [h.note, h.ambiguous ? 'Two ham styles on this sheet — confirm which' : ''].filter(Boolean).join(' · '),
      }))), `hams_${from}_to_${to}.csv`)
      return
    }
    const out = rows.map(s => {
      const base: Record<string, unknown> = {
        date: s.date ?? '', customer: s.customer_name, species: s.species ?? '',
        hanging_lbs: hangLbs(s) ?? '', portion: s.portion ?? '', head: s.carcasses.length,
      }
      for (const c of cols) {
        const items = itemsFor(s, c)
        const tags  = tagsFor(s, c)
        base[c] = [items.length ? cellText(items) : '', tags.length ? `🏷 ${tagText(tags, tagSeen)}` : ''].filter(Boolean).join('  ')
      }
      base.total = rowQty(s)
      return base
    })
    download(toCSV(out), `value-add_${species}_${from}_to_${to}.csv`)
  }

  // Print the current filtered matrix — a landscape sheet that mirrors what's on
  // screen (same counts, cut styles and totals), opened in its own window so the
  // page's dark UI chrome never bleeds into the print.
  // The ham sheet — one line per piece, tag number first and big, because it is
  // read off a seal at the rack. Portrait: five columns, not the matrix's thirty.
  function printHams() {
    const bodyRows = hamShown.map(h => {
      const note = h.note ? `<div class="${h.ambiguous || !h.cut ? 'warn' : 'note'}">${h.ambiguous || !h.cut ? '⚠ ' : ''}${escHtml(h.note)}</div>` : ''
      return `<tr>
        <td class="tag">${h.tag ? escHtml(h.tag) : '<span class="untag">— no tag —</span>'}</td>
        <td class="ctr">${h.tag ? (h.status === 'done' ? '✓ Out of cure' : 'In cure') : ''}</td>
        <td class="cust">${escHtml(h.customer)}</td>
        <td class="date">${escHtml(h.date ?? '')}</td>
        <td class="cut">${escHtml(h.cut) || '<span class="untag">not on the sheet</span>'}${note}</td>
      </tr>`
    }).join('')
    const generated = new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Ham Processing — ${escHtml(from)} to ${escHtml(to)}</title>
<style>
  @page { size: letter portrait; margin: 0.5in }
  * { box-sizing: border-box; margin: 0; padding: 0 }
  body { font-family: Arial, sans-serif; color: #000; font-size: 10pt }
  .hdr { text-align: center; margin-bottom: 10px }
  .company { font-size: 15pt; font-weight: bold; letter-spacing: 0.06em; text-transform: uppercase }
  .title { font-size: 12pt; font-weight: bold; letter-spacing: 0.14em; text-transform: uppercase; margin-top: 6px; border-top: 2pt solid #000; border-bottom: 2pt solid #000; padding: 4px 0 }
  .meta { display: flex; justify-content: space-between; margin: 8px 2px; font-size: 9pt; color: #333 }
  table { width: 100%; border-collapse: collapse; font-size: 9pt }
  th, td { border: 0.5pt solid #999; padding: 4px 5px; vertical-align: top }
  th { background: #eee; font-size: 7.5pt; text-transform: uppercase; letter-spacing: 0.04em; text-align: left }
  td.tag { font-family: 'Courier New', monospace; font-size: 13pt; font-weight: bold; letter-spacing: 0.06em; white-space: nowrap }
  td.ctr { text-align: center; white-space: nowrap; font-size: 8pt }
  td.cust { font-weight: bold }
  td.date { white-space: nowrap; font-family: monospace; font-size: 8pt }
  td.cut { font-weight: bold }
  .untag { font-weight: normal; color: #888; font-style: italic }
  .warn { font-weight: normal; font-size: 7.5pt; margin-top: 2px }
  .note { font-weight: normal; font-size: 7.5pt; color: #555; margin-top: 2px }
  tr { page-break-inside: avoid }
  .foot { margin-top: 8px; font-size: 7.5pt; color: #666; text-align: right }
</style></head><body>
  <div class="hdr">
    <div class="company">Cowboy Meat Company</div>
    <div class="title">Ham Processing — by cure tag</div>
  </div>
  <div class="meta">
    <span><strong>${hamShown.length}</strong> ham${hamShown.length === 1 ? '' : 's'} &nbsp;·&nbsp; ${hamStats.curing} in cure &nbsp;·&nbsp; ${hamStats.done} out of cure${withUntagged && hamStats.untagged ? ` &nbsp;·&nbsp; ${hamStats.untagged} not tagged in` : ''}${search.trim() ? ` &nbsp;·&nbsp; <strong>Search:</strong> ${escHtml(search.trim())}` : ''}</span>
    <span><strong>Kill dates:</strong> ${escHtml(fmtDay(from))} – ${escHtml(fmtDay(to))}</span>
  </div>
  <table>
    <thead><tr><th>Cure tag</th><th>Status</th><th>Customer</th><th>Kill date</th><th>How to cut it</th></tr></thead>
    <tbody>${bodyRows}</tbody>
  </table>
  <div class="foot">Cut style is what the customer&rsquo;s cut sheet ordered · Sorted by tag number · Generated ${escHtml(generated)}</div>
  <script>window.onload = () => setTimeout(() => window.print(), 200)</script>
</body></html>`

    const w = window.open('', '_blank')
    if (w) { w.document.write(html); w.document.close() }
  }

  function printReport() {
    if (mode === 'ham') return printHams()
    const speciesLabel = species === 'all' ? 'All species' : `${speciesEmoji(species)} ${species}`
    const headCols = cols.map(c => `<th class="prod">${escHtml(c)}</th>`).join('')
    const bodyRows = rows.map(s => {
      const cells = cols.map(c => {
        const items = itemsFor(s, c)
        const tags  = tagsFor(s, c)
        const tagLine = tags.length ? `<div class="tags">🏷 ${escHtml(tagText(tags, tagSeen))}</div>` : ''
        return `<td class="ctr${items.some(it => it.detail) ? ' det' : ''}">${items.length ? escHtml(cellText(items)) : ''}${tagLine}</td>`
      }).join('')
      return `<tr><td class="cust">${escHtml(s.customer_name)}</td><td class="date">${escHtml(fmtDay(s.date ?? ''))}</td><td class="ctr hang">${escHtml(hangText(s))}</td>${cells}<td class="ctr tot">${rowQty(s)}</td></tr>`
    }).join('')
    const totalsRow = colTotals.map(n => `<td class="ctr">${n}</td>`).join('')
    const generated = new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Value-Add Output — ${escHtml(from)} to ${escHtml(to)}</title>
<style>
  @page { size: letter landscape; margin: 0.5in }
  * { box-sizing: border-box; margin: 0; padding: 0 }
  body { font-family: Arial, sans-serif; color: #000; font-size: 9pt }
  .hdr { text-align: center; margin-bottom: 10px }
  .company { font-size: 15pt; font-weight: bold; letter-spacing: 0.06em; text-transform: uppercase }
  .title { font-size: 12pt; font-weight: bold; letter-spacing: 0.14em; text-transform: uppercase; margin-top: 6px; border-top: 2pt solid #000; border-bottom: 2pt solid #000; padding: 4px 0 }
  .meta { display: flex; justify-content: space-between; margin: 8px 2px; font-size: 9pt; color: #333 }
  table { width: 100%; border-collapse: collapse; font-size: 8pt }
  th, td { border: 0.5pt solid #999; padding: 3px 4px }
  th { background: #eee; font-size: 7.5pt; text-transform: uppercase; letter-spacing: 0.04em }
  th.prod { text-align: center }
  td.ctr { text-align: center }
  td.det { font-size: 7.5pt }
  .tags { font-family: 'Courier New', monospace; font-size: 6.5pt; color: #555; margin-top: 1px; white-space: nowrap }
  td.cust { font-weight: bold; white-space: nowrap }
  td.date { white-space: nowrap; font-family: monospace; font-size: 7.5pt }
  td.hang { white-space: nowrap; font-weight: bold }
  td.tot, th.tot { font-weight: bold }
  tr.totals td { border-top: 1.5pt solid #000; font-weight: bold; background: #f2f2f2 }
  .foot { margin-top: 8px; font-size: 7.5pt; color: #666; text-align: right }
</style></head><body>
  <div class="hdr">
    <div class="company">Cowboy Meat Company</div>
    <div class="title">Value-Add Output</div>
  </div>
  <div class="meta">
    <span><strong>Species:</strong> ${escHtml(speciesLabel)}${search.trim() ? ` &nbsp;·&nbsp; <strong>Search:</strong> ${escHtml(search.trim())}` : ''}</span>
    <span><strong>Kill dates:</strong> ${escHtml(fmtDay(from))} – ${escHtml(fmtDay(to))}</span>
  </div>
  <table>
    <thead><tr><th>Customer</th><th>Kill date</th><th class="prod">Hanging wt</th>${headCols}<th class="tot">Total</th></tr></thead>
    <tbody>${bodyRows}</tbody>
    <tfoot><tr class="totals"><td>Total · ${rows.length}</td><td></td><td class="ctr">${hangTotal ? `${fmtLbs(hangTotal)} lbs` : ''}</td>${totalsRow}<td class="ctr">${rows.reduce((n, s) => n + rowQty(s), 0)}</td></tr></tfoot>
  </table>
  <div class="foot">Hanging weight is the whole carcass (½ / ¾ / ¼ marks a partial share) · 🏷* = seal not pinned to an animal, shown on every sheet its customer has · Built from the cut sheets · Generated ${escHtml(generated)}</div>
  <script>window.onload = () => setTimeout(() => window.print(), 200)</script>
</body></html>`

    const w = window.open('', '_blank')
    if (w) { w.document.write(html); w.document.close() }
  }

  const totalCustomers = rows.length
  const totalItems = rows.reduce((n, s) => n + rowQty(s), 0)

  return (
    <div style={{ minHeight: '100vh', background: C.darkBrown }}>
      <header style={{
        background: C.dark, borderBottom: '1px solid rgba(166,120,90,0.3)',
        padding: '0 2rem', height: 72, display: 'flex', alignItems: 'center', gap: '1rem',
      }}>
        <Link href="/reports" style={{ color: C.lightBrown, textDecoration: 'none', fontSize: '0.82rem' }}>← Reports</Link>
        <span style={{ color: 'rgba(166,120,90,0.3)' }}>|</span>
        <div>
          <h1 style={{ fontFamily: 'Georgia, serif', fontSize: '1.1rem', fontWeight: 700, color: C.cream, textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0 }}>
            Value-Add Output
          </h1>
          <p style={{ fontSize: '0.68rem', color: C.lightBrown, letterSpacing: '0.12em', textTransform: 'uppercase', margin: 0 }}>
            {mode === 'ham'
              ? 'Every cured ham, by the tag number on the seal'
              : 'Who ordered value-add — off the cut sheets, by kill date'}
          </p>
        </div>
      </header>

      <main style={{ padding: '1.5rem 2rem', maxWidth: 1280, margin: '0 auto', boxSizing: 'border-box' }}>


        {/* Two ways to read the same sheets: the matrix by customer, and the ham
            list by cure tag. The tag is what the crew actually holds when they
            need to know how a ham gets cut (Charlie, 2026-08-28). */}
        <div style={{ display: 'flex', gap: 0, marginBottom: '1rem', border: `1px solid ${C.medBrown}`, borderRadius: 3, width: 'fit-content', overflow: 'hidden' }}>
          {([['all', 'All value-add'], ['ham', '🍖 Hams by tag']] as const).map(([m, label]) => (
            <button key={m} onClick={() => setMode(m)} style={{
              background: mode === m ? C.tan : 'transparent', color: mode === m ? C.dark : C.tan,
              border: 'none', padding: '0.45rem 1.1rem', fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer',
            }}>{label}</button>
          ))}
        </div>

        {/* Controls */}
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '1rem' }}>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={{ ...INPUT, width: 150 }} />
          <span style={{ color: C.lightBrown, fontSize: '0.8rem' }}>to</span>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} style={{ ...INPUT, width: 150 }} />
          {/* Ham view pins the species to hogs, so the selector would only ever
              lie about what it's filtering — it goes away with the matrix. */}
          {mode === 'all' && (
            <select value={species} onChange={e => setSpecies(e.target.value)} style={{ ...INPUT, width: 150 }}>
              <option value="Pork">🐷 Hogs (Pork)</option>
              {speciesList.filter(s => s !== 'Pork').map(s => <option key={s} value={s}>{speciesEmoji(s)} {s}</option>)}
              <option value="all">All species</option>
            </select>
          )}
          {mode === 'all' && (
            <select value={sortKey} onChange={e => setSortKey(e.target.value as 'date' | 'customer')} style={{ ...INPUT, width: 150 }}>
              <option value="date">Sort: kill date</option>
              <option value="customer">Sort: customer</option>
            </select>
          )}
          {mode === 'ham' && hamStats.untagged > 0 && (
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: C.tan, fontSize: '0.78rem', cursor: 'pointer', whiteSpace: 'nowrap' }}>
              <input type="checkbox" checked={withUntagged} onChange={e => setWithUntagged(e.target.checked)} />
              Include {hamStats.untagged} ordered but not tagged in
            </label>
          )}
          <input
            placeholder="Search customer…"
            value={search} onChange={e => setSearch(e.target.value)}
            style={{ ...INPUT, flex: 1, minWidth: 160 }}
          />
          <button onClick={printReport} disabled={!hasRows} style={{
            background: 'transparent', color: hasRows ? C.tan : C.medBrown, border: `1px solid ${hasRows ? C.tan : C.medBrown}`, borderRadius: 3,
            padding: '0.5rem 1.1rem', fontSize: '0.82rem', fontWeight: 700, cursor: hasRows ? 'pointer' : 'default',
          }}>🖨 Print</button>
          <button onClick={exportCSV} disabled={!hasRows} style={{
            background: hasRows ? C.tan : C.medBrown, color: C.dark, border: 'none', borderRadius: 3,
            padding: '0.5rem 1.1rem', fontSize: '0.82rem', fontWeight: 700, cursor: hasRows ? 'pointer' : 'default',
          }}>⬇ CSV</button>
        </div>

        {/* Matrix */}
        <div style={{ background: C.dark, border: '1px solid rgba(166,120,90,0.18)', borderRadius: 4, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            {loading ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: C.lightBrown }}>Loading…</div>
            ) : err ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: C.amber }}>{err}</div>
            ) : mode === 'ham' ? (
              !hamShown.length ? (
                <div style={{ padding: '2rem', textAlign: 'center', color: C.lightBrown }}>No cured hams for these filters.</div>
              ) : (
                <table style={{ borderCollapse: 'collapse', fontSize: '0.86rem', width: '100%' }}>
                  <thead>
                    <tr style={{ background: 'rgba(166,120,90,0.14)' }}>
                      <th style={TH}>Cure tag</th>
                      <th style={{ ...TH, textAlign: 'center' }}>Status</th>
                      <th style={TH}>Customer</th>
                      <th style={TH}>Kill date</th>
                      <th style={TH}>How to cut it</th>
                    </tr>
                  </thead>
                  <tbody>
                    {hamShown.map((h, i) => (
                      <tr key={`${h.tag ?? 'x'}-${i}`} style={{ borderTop: '1px solid rgba(166,120,90,0.1)' }}>
                        <td style={{ ...TD, fontFamily: 'monospace', fontSize: '1.05rem', fontWeight: 700, letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>
                          {h.tag ?? <span style={{ color: 'rgba(166,120,90,0.5)', fontSize: '0.8rem', fontStyle: 'italic', fontWeight: 400 }}>— no tag —</span>}
                        </td>
                        <td style={{ ...TD, textAlign: 'center', whiteSpace: 'nowrap', fontSize: '0.76rem', color: h.status === 'done' ? C.green : C.amber }}>
                          {h.tag ? (h.status === 'done' ? '✓ Out of cure' : 'In cure') : ''}
                        </td>
                        <td style={{ ...TD, fontWeight: 600, whiteSpace: 'nowrap' }}>{h.customer}</td>
                        <td style={{ ...TD, color: C.lightBrown, fontFamily: 'monospace', fontSize: '0.78rem', whiteSpace: 'nowrap' }}>{h.date ?? '—'}</td>
                        <td style={TD}>
                          {h.cut
                            ? <span style={{ color: C.cream, fontWeight: 700 }}>{h.cut}</span>
                            : <span style={{ color: 'rgba(166,120,90,0.5)', fontStyle: 'italic' }}>not on the sheet</span>}
                          {/* Amber whenever the row can't be acted on as it
                              stands — two possible cuts, or no cut at all. */}
                          {h.note && (
                            <div style={{ fontSize: '0.7rem', marginTop: 2, color: h.ambiguous || !h.cut ? C.amber : C.lightBrown }}>
                              {h.ambiguous || !h.cut ? '⚠ ' : ''}{h.note}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ borderTop: '2px solid rgba(166,120,90,0.4)', background: 'rgba(166,120,90,0.1)' }}>
                      <td colSpan={5} style={{ padding: '0.55rem 0.85rem', color: C.amber, fontWeight: 800, fontSize: '0.8rem' }}>
                        {hamShown.length} ham{hamShown.length === 1 ? '' : 's'} · {hamStats.curing} in cure · {hamStats.done} out of cure
                        {withUntagged && hamStats.untagged > 0 && ` · ${hamStats.untagged} not tagged in`}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              )
            ) : !rows.length ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: C.lightBrown }}>No value-add orders for these filters.</div>
            ) : (
              <table style={{ borderCollapse: 'collapse', fontSize: '0.82rem', minWidth: '100%' }}>
                <thead>
                  <tr style={{ background: 'rgba(166,120,90,0.14)' }}>
                    <th style={{ position: 'sticky', left: 0, background: '#2a160a', textAlign: 'left', padding: '0.6rem 0.8rem', color: C.tan, fontWeight: 700, whiteSpace: 'nowrap', zIndex: 2 }}>Customer</th>
                    <th style={{ textAlign: 'left', padding: '0.6rem 0.7rem', color: C.tan, fontWeight: 700, whiteSpace: 'nowrap' }}>Kill date</th>
                    <th title="Whole-carcass hanging weight, the way it prints on the cut card" style={{ textAlign: 'right', padding: '0.6rem 0.7rem', color: C.tan, fontWeight: 700, whiteSpace: 'nowrap' }}>Hanging wt</th>
                    {cols.map(c => (
                      <th key={c} style={{ padding: '0.6rem 0.6rem', color: C.cream, fontWeight: 700, whiteSpace: 'nowrap', borderLeft: '1px solid rgba(166,120,90,0.12)', fontSize: '0.76rem' }}>{c}</th>
                    ))}
                    <th style={{ padding: '0.6rem 0.7rem', color: C.tan, fontWeight: 800, textAlign: 'center', borderLeft: '1px solid rgba(166,120,90,0.3)' }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(s => (
                    <tr key={s.id} style={{ borderTop: '1px solid rgba(166,120,90,0.1)' }}>
                      <td style={{ position: 'sticky', left: 0, background: C.dark, padding: '0.45rem 0.8rem', color: C.cream, fontWeight: 600, whiteSpace: 'nowrap', zIndex: 1 }}>{s.customer_name}</td>
                      <td style={{ padding: '0.45rem 0.7rem', color: C.lightBrown, whiteSpace: 'nowrap', fontFamily: 'monospace' }}>{s.date ?? '—'}</td>
                      <td style={{ padding: '0.45rem 0.7rem', textAlign: 'right', whiteSpace: 'nowrap', fontFamily: 'monospace' }}>
                        {hangLbs(s) == null
                          ? <span style={{ color: 'rgba(166,120,90,0.35)' }} title={s.carcasses.length
                              ? 'Carcass linked, but no weight recorded yet'
                              : 'This sheet is not linked to a check-in animal yet'}>—</span>
                          : <>
                              {s.carcasses.length > 1 && <span style={{ color: C.lightBrown, fontSize: '0.72rem' }}>{s.carcasses.length} hd&nbsp;·&nbsp;</span>}
                              <span style={{ color: C.cream, fontWeight: 700 }}>{fmtLbs(hangLbs(s) as number)}</span>
                              {/* Separated by a dot — "182 · ½" can't be misread as 182.5 the way "182½" can. */}
                              {PORTION_TAG[s.portion ?? ''] &&
                                <span style={{ color: C.blue, fontSize: '0.76rem' }} title={`${s.portion} share`}> · {PORTION_TAG[s.portion ?? '']}</span>}
                            </>}
                      </td>
                      {cols.map(c => {
                        const items = itemsFor(s, c)
                        const hasDetail = items.some(it => it.detail)
                        const tags = tagsFor(s, c)
                        return (
                          <td key={c} style={{ padding: '0.45rem 0.6rem', textAlign: 'center', borderLeft: '1px solid rgba(166,120,90,0.08)', whiteSpace: 'nowrap', color: hasDetail ? C.tan : C.green }}>
                            {items.length
                              ? <span style={{ fontSize: hasDetail ? '0.72rem' : '0.86rem', fontWeight: hasDetail ? 400 : 700 }}>{cellText(items)}</span>
                              : tags.length
                                ? null
                                : <span style={{ color: 'rgba(166,120,90,0.18)' }}>·</span>}
                            {tags.length > 0 && (
                              <div style={{ fontFamily: 'monospace', fontSize: '0.66rem', color: C.amber, marginTop: 2 }} title="Seal tags in cure for this customer (✓ = out of cure · * = not pinned to an animal, so it shows on every sheet this customer has)">
                                🏷 {tagText(tags, tagSeen)}
                              </div>
                            )}
                          </td>
                        )
                      })}
                      <td style={{ padding: '0.45rem 0.7rem', textAlign: 'center', color: C.cream, fontWeight: 800, borderLeft: '1px solid rgba(166,120,90,0.3)' }}>{rowQty(s)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ borderTop: '2px solid rgba(166,120,90,0.4)', background: 'rgba(166,120,90,0.1)' }}>
                    <td style={{ position: 'sticky', left: 0, background: '#2a160a', padding: '0.55rem 0.8rem', color: C.tan, fontWeight: 800, whiteSpace: 'nowrap', zIndex: 1 }}>Total · {totalCustomers}</td>
                    <td />
                    <td style={{ padding: '0.55rem 0.7rem', textAlign: 'right', color: C.amber, fontWeight: 800, whiteSpace: 'nowrap', fontFamily: 'monospace' }}>
                      {hangTotal ? `${fmtLbs(hangTotal)} lbs` : ''}
                    </td>
                    {colTotals.map((n, i) => (
                      <td key={i} style={{ padding: '0.55rem 0.6rem', textAlign: 'center', color: C.amber, fontWeight: 800, borderLeft: '1px solid rgba(166,120,90,0.12)' }}>{n}</td>
                    ))}
                    <td style={{ padding: '0.55rem 0.7rem', textAlign: 'center', color: C.amber, fontWeight: 800, borderLeft: '1px solid rgba(166,120,90,0.3)' }}>{totalItems}</td>
                  </tr>
                </tfoot>
              </table>
            )}
          </div>
        </div>

        {/* Tags whose customer name matches no cut sheet. These used to be
            invisible: the matrix draws tags off the sheet, so a name the office
            never typed the same way simply wasn't shown, and the customer's row
            read as a hanging weight with nothing in the cure cooler (Charlie,
            2026-08-27, on MVML Kristin). Naming them is as far as the app can
            honestly go — tying "MVML KRISTIN" to "MT Veterans Meat Locker
            Kristin" is a person's call, not a rule's. */}
        {mode === 'all' && unmatched.length > 0 && (
          <div style={{
            marginTop: '1rem', background: 'rgba(232,136,58,0.07)',
            border: `1px solid ${C.amber}`, borderRadius: 4, padding: '0.9rem 1.1rem',
          }}>
            <div style={{ color: C.amber, fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.4rem' }}>
              🏷 In the cure cooler under a name no cut sheet uses
            </div>
            <div style={{ fontSize: '0.75rem', color: C.tan, marginBottom: '0.6rem', lineHeight: 1.5 }}>
              These pieces are tagged and real, but their customer name doesn&apos;t match any sheet, so they appear in
              nobody&apos;s row above. Usually the floor used a short name the office spelled out in full. Fix it by
              renaming the tag on <strong style={{ color: C.cream }}>Processing → In Cure</strong> to match the sheet
              exactly — spelling it differently is what hid them.
            </div>
            {unmatched.map(g => (
              <div key={g.key} style={{ fontSize: '0.78rem', color: C.cream, padding: '0.3rem 0', borderTop: '1px solid rgba(166,120,90,0.18)' }}>
                <strong>{g.names.join(' / ')}</strong>
                <span style={{ color: C.lightBrown }}>
                  {' '}— {g.tags.length} piece{g.tags.length === 1 ? '' : 's'}
                  {g.curing > 0 && `, ${g.curing} still curing`}:{' '}
                  {g.tags.map(t => `${t.product} ${t.tag_number}${t.status === 'done' ? '✓' : ''}`).join(' · ')}
                </span>
              </div>
            ))}
          </div>
        )}

        {mode === 'ham' ? (
          <p style={{ fontSize: '0.72rem', color: C.lightBrown, marginTop: '0.75rem', lineHeight: 1.6 }}>
            One line per <strong style={{ color: C.tan }}>ham</strong>, in cure-tag order, so a seal read off the piece
            leads straight to <strong style={{ color: C.tan }}>how that ham gets cut</strong> — the cut style comes off
            the customer&apos;s cut sheet. A <strong style={{ color: C.tan }}>— no tag —</strong> line is a ham the sheet
            ordered that nothing has been tagged in for yet; it has no number to look up because the seal hasn&apos;t been
            put on. Where a sheet orders two hams cut two different ways, nothing in the data says which seal got which,
            so both styles print with a <strong style={{ color: C.amber }}>⚠</strong> — that one is a person&apos;s call.
            A tag under a name no cut sheet uses is listed too, rather than silently dropped: fix it by renaming the tag
            on <strong style={{ color: C.cream }}>Processing → In Cure</strong> to match the sheet.
            Hogs only — cured ham comes off nothing else.
          </p>
        ) : (
        <p style={{ fontSize: '0.72rem', color: C.lightBrown, marginTop: '0.75rem', lineHeight: 1.6 }}>
          Built from the <strong style={{ color: C.tan }}>cut sheets</strong> — what each customer ordered, before
          anything is made — one row per sheet. Each cell shows <strong style={{ color: C.tan }}>how many</strong> of that
          product they ordered — a whole hog has two bellies and two hams, so bacon and cured ham often read 2; ham shows
          its cut and smokehouse cells show the lbs and flavor. The <strong style={{ color: C.tan }}>Total</strong> column
          sums a customer&apos;s value-add pieces; the bottom row totals the pieces of each product across all customers.
          Kill date is the linked appointment&apos;s harvest date, or the date on the sheet.
          {' '}<strong style={{ color: C.tan }}>Hanging weight</strong> is the whole carcass off the harvest log — the same
          number that prints on the cut card — so a partial share carries a ½ · ¾ · ¼ mark beside it rather than a scaled
          weight, and a customer taking more than one animal reads &ldquo;2 hd&rdquo; with both added up. A dash means no
          carcass is linked to that sheet yet. The column total counts each carcass once, so a split animal isn&apos;t
          doubled. An amber <strong style={{ color: C.amber }}>🏷 line</strong> under a cell is the actual seal tag
          in the cure cooler for that customer — <strong style={{ color: C.amber }}>✓</strong> means it&apos;s out of
          cure — so an ordered ham with no tag under it hasn&apos;t been tagged in yet. A seal knows whose piece it is,
          not which of their animals — so a tag marked <strong style={{ color: C.amber }}>*</strong> isn&apos;t pinned to
          an animal and prints on <strong style={{ color: C.tan }}>every</strong> sheet its customer has: a two-hog
          customer reads all four bacon seals on each hog&apos;s row, and the * is what says the count is the
          customer&apos;s, not that animal&apos;s. Pin a tag to its animal on
          {' '}<strong style={{ color: C.cream }}>Processing → In Cure</strong> and it moves to that animal&apos;s row
          alone. Beef &amp; lamb currently show the shared smokehouse and ground-sausage items only.
        </p>
        )}

      </main>
    </div>
  )
}
