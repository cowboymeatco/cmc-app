'use client'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { isoDate } from '@/lib/dates'
import { drainScans } from '@/lib/hobartBarcode'
import {
  COUNT_LOCATIONS, IDLE_GAP_MINUTES, tallyByPlu, totals, liveLines, laborByPerson,
  type CountLine, type InventoryCount,
} from '@/lib/inventoryCount'

// Physical inventory count, run off the barcode gun.
//
// Two kinds of label, one field (Charlie, 2026-09-18: "do both"):
//   * a package's Hobart label — the loose retail case, one package per scan
//   * a sealed box's CMC label — the freezer, the whole box in one scan, once
//     the person holding it confirms nothing has been pulled out
//
// Deliberately NOT part of /scanner. That page is the bench tool the cut crew
// runs all day and feature branches are held against it; a counting mode bolted
// on there would put a month-end job in the middle of production. This is its
// own door, and the two never share a table.
//
// Same phone-in-a-wet-glove constraints as the cleaning module: big targets,
// high contrast, nothing that only works on hover, and no destructive action
// that takes one tap.

const C = {
  ink:     '#12171A',
  panel:   '#1C2328',
  line:    '#2E383F',
  paper:   '#F2F5F6',
  muted:   '#8A97A0',
  accent:  '#4FA3C4',
  green:   '#4CAF50',
  amber:   '#F59E0B',
  red:     '#EF4444',
} as const
const TAP = 56
const COUNTER_KEY = 'inventoryCounter'

type Flash = { kind: 'ok' | 'warn' | 'bad'; text: string } | null

interface BoxSummary {
  serial: string
  customer_name: string
  pack_date: string
  packages: number
  lbs: number
  plus: number
}

/** One thing the crew did — a package, or a whole box — for the "just scanned" list. */
type ScanEvent =
  | { kind: 'package'; line: CountLine }
  | { kind: 'box'; box_id: string; serial: string; packages: number; lbs: number; voided: boolean; at: string }

// Who is counting, remembered on the device.
//
// localStorage is an external store, so it is read through useSyncExternalStore
// rather than copied into state inside an effect — the same reason the cleaning
// module does it this way. Two tabs on the same phone then agree about who is
// signed in, and there is no cascading render on mount. The snapshot is a
// string, so identity comparison is value comparison and nothing re-renders
// forever.
const counterListeners = new Set<() => void>()

function readCounter(): string {
  try { return localStorage.getItem(COUNTER_KEY) ?? '' } catch { return '' }
}
/** The server has no device to remember anything on. */
function readCounterOnServer(): string { return '' }

function subscribeCounter(cb: () => void) {
  counterListeners.add(cb)
  return () => { counterListeners.delete(cb) }
}

function writeCounter(value: string) {
  try { localStorage.setItem(COUNTER_KEY, value) } catch { /* private browsing */ }
  counterListeners.forEach(l => l())
}

// Plain fetchers: they return data and never set state, so an effect can hand
// the result straight to a setter and a handler can await one without the two
// paths drifting apart.
async function fetchCounts(): Promise<InventoryCount[]> {
  const res = await fetch('/api/inventory/counts')
  return res.ok ? res.json() : []
}
async function fetchLines(countId: string): Promise<CountLine[]> {
  const res = await fetch(`/api/inventory/counts/${countId}/lines`)
  return res.ok ? res.json() : []
}

function fmtMinutes(m: number | null): string {
  if (m == null) return '—'
  if (m < 1) return '<1 min'
  if (m < 60) return `${Math.round(m)} min`
  return `${Math.floor(m / 60)} h ${Math.round(m % 60)} min`
}

export default function InventoryCountPage() {
  const [counts,  setCounts]  = useState<InventoryCount[]>([])
  const [active,  setActive]  = useState<InventoryCount | null>(null)
  const [lines,   setLines]   = useState<CountLine[]>([])
  const [flash,   setFlash]   = useState<Flash>(null)
  const [busy,    setBusy]    = useState(false)
  const [loaded,  setLoaded]  = useState(false)
  const [pendingBox, setPendingBox] = useState<BoxSummary | null>(null)

  // New-count form
  const [newDate, setNewDate] = useState(isoDate())
  const [newLoc,  setNewLoc]  = useState<string>(COUNT_LOCATIONS[0])

  const bufRef   = useRef('')
  const inputRef = useRef<HTMLInputElement>(null)

  const counter = useSyncExternalStore(subscribeCounter, readCounter, readCounterOnServer)

  useEffect(() => {
    fetchCounts().then(rows => { setCounts(rows); setLoaded(true) })
  }, [])

  useEffect(() => {
    const id = active?.id
    if (!id) return
    // A count opened in another tab, or reopened, should not show a stale list
    // if this request loses a race with a newer one.
    let current = true
    fetchLines(id).then(rows => { if (current) setLines(rows) })
    return () => { current = false }
  }, [active?.id])

  const say = (kind: 'ok' | 'warn' | 'bad', text: string, ms = kind === 'ok' ? 1800 : 5000) => {
    setFlash({ kind, text })
    window.setTimeout(() => setFlash(f => (f && f.text === text ? null : f)), ms)
  }

  const mergeLines = (changed: CountLine[]) => {
    const byId = new Map(changed.map(l => [l.id, l]))
    setLines(prev => prev.map(l => byId.get(l.id) ?? l))
  }

  // ── Scanning ─────────────────────────────────────────────────────────
  const recordPackage = useCallback(async (barcode: string) => {
    if (!active) return
    try {
      const res = await fetch(`/api/inventory/counts/${active.id}/lines`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ barcode, counted_by: counter }),
      })
      const body = await res.json()
      if (!res.ok) { say('bad', body.error ?? 'Scan failed'); return }
      setLines(prev => [body, ...prev])
      const lb = body.weight_lbs != null ? `${Number(body.weight_lbs).toFixed(2)} lb` : 'by the piece'
      const name = body.item_name || `PLU ${body.plu_number}`
      if (body.possible_duplicate) {
        say('warn', `${name} · ${lb} — same weight as one inside box ${body.possible_duplicate.box_serial}, already counted. If it came out of that box, void it.`, 8000)
      } else if (!body.known_plu) {
        say('warn', `PLU ${body.plu_number} · ${lb} — counted, but this PLU is not in the app`)
      } else {
        say('ok', `${name} · ${lb}`)
      }
    } catch {
      say('bad', 'Could not reach the server — that package was NOT counted')
    }
  }, [active, counter])

  const recordBox = useCallback(async (serial: string, confirm: boolean) => {
    if (!active) return
    try {
      const res = await fetch(`/api/inventory/counts/${active.id}/lines`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ box_serial: serial, confirm_sealed: confirm, counted_by: counter }),
      })
      const body = await res.json()
      if (!res.ok) {
        // A producer's box and a box already counted are expected, not errors.
        say(body.code === 'not_ours' || body.code === 'already_counted' ? 'warn' : 'bad', body.error ?? 'Box scan failed', 7000)
        return
      }
      if (body.needs_confirm) { setPendingBox(body.box); return }
      setPendingBox(null)
      setLines(prev => [...(body.lines as CountLine[]), ...prev])
      say('ok', `Box ${body.box.serial} · ${body.box.packages} packages · ${Number(body.box.lbs).toFixed(1)} lb`)
    } catch {
      say('bad', 'Could not reach the server — that box was NOT counted')
    }
  }, [active, counter])

  // The gun types faster than React re-renders and does not always land its
  // Enter, so characters are drained out of the field rather than read off a
  // submit. Whatever is left over waits for the next keystroke.
  const onScanInput = (value: string) => {
    bufRef.current += value
    const { scans, rest } = drainScans(bufRef.current)
    bufRef.current = rest
    if (inputRef.current) inputRef.current.value = ''
    for (const s of scans) {
      if (s.kind === 'package') void recordPackage(s.code)
      else if (s.kind === 'box') void recordBox(s.serial, false)
      else say('warn', `${s.text} is a receiving label, not a count label. Scan the box label we printed, or its packages.`, 6000)
    }
  }

  const voidLine = async (line: CountLine) => {
    if (!active) return
    if (!window.confirm(`Void this scan?\n\n${line.item_name || `PLU ${line.plu_number}`}${line.weight_lbs != null ? ` · ${Number(line.weight_lbs).toFixed(2)} lb` : ''}\n\nIt stays in the record, marked voided.`)) return
    const res = await fetch(`/api/inventory/counts/${active.id}/lines`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ line_id: line.id, by: counter, reason: 'miscount' }),
    })
    const body = await res.json()
    if (!res.ok) { say('bad', body.error ?? 'Could not void'); return }
    mergeLines(body)
    say('warn', 'Scan voided')
  }

  const voidBox = async (ev: Extract<ScanEvent, { kind: 'box' }>) => {
    if (!active) return
    if (!window.confirm(`Void box ${ev.serial}?\n\nAll ${ev.packages} packages come out of the count. They stay in the record, marked voided — scan the packages one by one if the box was opened.`)) return
    const res = await fetch(`/api/inventory/counts/${active.id}/lines`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ box_id: ev.box_id, by: counter, reason: 'box voided' }),
    })
    const body = await res.json()
    if (!res.ok) { say('bad', body.error ?? 'Could not void'); return }
    mergeLines(body)
    say('warn', `Box ${ev.serial} voided`)
  }

  // ── Counts ───────────────────────────────────────────────────────────
  const startCount = async () => {
    setBusy(true)
    try {
      const res = await fetch('/api/inventory/counts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count_date: newDate, location: newLoc, opened_by: counter }),
      })
      const body = await res.json()
      if (!res.ok) { say('bad', body.error ?? 'Could not start'); return }
      setCounts(await fetchCounts())
      setActive(body)
      setLines([])
    } finally { setBusy(false) }
  }

  const closeCount = async () => {
    if (!active) return
    const t = totals(lines)
    if (!window.confirm(`Close the ${active.location} count for ${active.count_date}?\n\n${t.packages} packages · ${t.lbs.toFixed(1)} lb\n\nNothing more can be scanned into it unless it is reopened.`)) return
    const res = await fetch('/api/inventory/counts', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: active.id, action: 'close', by: counter }),
    })
    const body = await res.json()
    if (!res.ok) { say('bad', body.error ?? 'Could not close'); return }
    setActive(body)
    setPendingBox(null)
    setCounts(await fetchCounts())
    say('ok', 'Count closed')
  }

  const reopenCount = async (c: InventoryCount) => {
    const res = await fetch('/api/inventory/counts', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: c.id, action: 'reopen', by: counter }),
    })
    const body = await res.json()
    if (!res.ok) { say('bad', body.error ?? 'Could not reopen'); return }
    setActive(body)
    setCounts(await fetchCounts())
  }

  const t     = useMemo(() => totals(lines), [lines])
  const tally = useMemo(() => tallyByPlu(liveLines(lines)), [lines])
  const labor = useMemo(() => laborByPerson(lines, active ?? undefined), [lines, active])

  // A box of twenty packages is one thing the crew did, so it is one row here.
  const recent = useMemo<ScanEvent[]>(() => {
    const out: ScanEvent[] = []
    const boxIndex = new Map<string, number>()
    for (const l of lines) {
      if (!l.box_id) { out.push({ kind: 'package', line: l }); continue }
      const at = boxIndex.get(l.box_id)
      if (at == null) {
        boxIndex.set(l.box_id, out.length)
        out.push({
          kind: 'box', box_id: l.box_id, serial: l.box_serial ?? '', at: l.created_at,
          packages: l.voided_at ? 0 : l.quantity,
          lbs: l.voided_at || l.weight_lbs == null ? 0 : Number(l.weight_lbs) * l.quantity,
          voided: Boolean(l.voided_at),
        })
      } else {
        const ev = out[at] as Extract<ScanEvent, { kind: 'box' }>
        if (!l.voided_at) {
          ev.packages += l.quantity
          ev.lbs += l.weight_lbs == null ? 0 : Number(l.weight_lbs) * l.quantity
          ev.voided = false
        }
      }
    }
    // A voided box still shows what it held, so the struck-through row reads.
    for (const ev of out) {
      if (ev.kind === 'box' && ev.voided) {
        const held = lines.filter(l => l.box_id === ev.box_id)
        ev.packages = held.reduce((s, l) => s + l.quantity, 0)
        ev.lbs = held.reduce((s, l) => s + (l.weight_lbs == null ? 0 : Number(l.weight_lbs) * l.quantity), 0)
      }
    }
    return out.slice(0, 12)
  }, [lines])

  const openCounts = counts.filter(c => c.status === 'open')

  // ── Render ───────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', background: C.ink, color: C.paper, fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <div style={{ maxWidth: 780, margin: '0 auto', padding: '20px 16px 64px', display: 'flex', flexDirection: 'column', gap: 20 }}>

        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700, letterSpacing: '-0.02em' }}>Inventory Count</h1>
          <Link href="/" style={{ color: C.muted, fontSize: 14, textDecoration: 'none' }}>&larr; Home</Link>
        </div>

        {!active && (
          <>
            <Field label="Who is counting">
              <input
                id="counter-name"
                value={counter}
                onChange={e => writeCounter(e.target.value)}
                placeholder="Your name"
                style={inputStyle}
              />
            </Field>

            <Panel title="Start a count">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                <Field label="Count date" hint="The date this is booked at">
                  <input id="count-date" type="date" value={newDate} onChange={e => setNewDate(e.target.value)} style={inputStyle} />
                </Field>
                <Field label="Where">
                  <select id="count-location" value={newLoc} onChange={e => setNewLoc(e.target.value)} style={inputStyle}>
                    {COUNT_LOCATIONS.map(l => <option key={l} value={l}>{l}</option>)}
                  </select>
                </Field>
              </div>
              <button onClick={startCount} disabled={busy || !counter.trim()} style={btn(C.accent, busy || !counter.trim())}>
                {busy ? 'Starting…' : 'Start counting'}
              </button>
              {!counter.trim() && <p style={hintStyle}>Put your name in first — every scan, and every labor minute, is recorded against whoever counted it.</p>}
            </Panel>

            {openCounts.length > 0 && (
              <Panel title="Counts already open">
                {openCounts.map(c => (
                  <button key={c.id} onClick={() => setActive(c)} style={rowBtn}>
                    <span><b>{c.location}</b> &middot; {c.count_date}</span>
                    <span style={{ color: C.green, fontSize: 13 }}>open &rarr;</span>
                  </button>
                ))}
              </Panel>
            )}

            <Panel title="Finished counts">
              {!loaded && <p style={hintStyle}>Loading…</p>}
              {loaded && counts.filter(c => c.status === 'closed').length === 0 && (
                <p style={hintStyle}>No counts closed yet. The first one anchors the freezer — everything on /exec before that is a flow, not a balance.</p>
              )}
              {counts.filter(c => c.status === 'closed').slice(0, 12).map(c => (
                <div key={c.id} style={{ ...rowBtn, cursor: 'default' }}>
                  <span><b>{c.location}</b> &middot; {c.count_date}</span>
                  <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <button onClick={() => setActive(c)} style={miniBtn}>View</button>
                    <button onClick={() => reopenCount(c)} style={miniBtn}>Reopen</button>
                  </span>
                </div>
              ))}
            </Panel>
          </>
        )}

        {active && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: 20, fontWeight: 700 }}>{active.location}</div>
                <div style={{ color: C.muted, fontSize: 13 }}>
                  booked at {active.count_date} &middot; {active.status === 'open' ? `counting${counter ? ` as ${counter}` : ''}` : `closed by ${active.closed_by || 'someone'}`}
                </div>
              </div>
              <button onClick={() => { setActive(null); setFlash(null); setPendingBox(null) }} style={miniBtn}>All counts</button>
            </div>

            {active.status === 'open' && (
              <div>
                <input
                  ref={inputRef}
                  id="scan-field"
                  autoFocus
                  autoComplete="off"
                  autoCapitalize="characters"
                  placeholder="Scan a package or a box label…"
                  onChange={e => onScanInput(e.target.value)}
                  onBlur={e => { if (!pendingBox) setTimeout(() => e.target.focus(), 80) }}
                  style={{
                    ...inputStyle,
                    width: '100%', height: TAP + 8, fontSize: 20, textAlign: 'center',
                    borderColor: flash ? flashColor(flash.kind) : C.accent, borderWidth: 2,
                  }}
                />
                <div style={{
                  marginTop: 8, minHeight: 24, fontSize: 15, fontWeight: 600, lineHeight: 1.4,
                  color: flash ? flashColor(flash.kind) : C.muted,
                }}>
                  {flash ? flash.text : 'Loose packages: scan each label. Sealed boxes: scan the box label once.'}
                </div>
              </div>
            )}

            {pendingBox && active.status === 'open' && (
              <div style={{ background: C.panel, border: `2px solid ${C.amber}`, borderRadius: 8, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ fontSize: 13, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.amber, fontWeight: 700 }}>Box {pendingBox.serial}</div>
                <div style={{ fontSize: 22, fontWeight: 700 }}>
                  {pendingBox.packages} packages &middot; {pendingBox.lbs.toFixed(1)} lb
                </div>
                <div style={{ color: C.muted, fontSize: 14 }}>
                  {pendingBox.customer_name} &middot; packed {pendingBox.pack_date} &middot; {pendingBox.plus} PLU{pendingBox.plus === 1 ? '' : 's'}
                </div>
                <div style={{ fontSize: 17, fontWeight: 600 }}>Is it still full and sealed — nothing taken out?</div>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <button onClick={() => void recordBox(pendingBox.serial, true)} style={{ ...btn(C.green, false), flex: '1 1 200px' }}>
                    Yes — count the box
                  </button>
                  <button
                    onClick={() => { setPendingBox(null); say('warn', `Open box ${pendingBox.serial} — scan each package in it`, 6000); inputRef.current?.focus() }}
                    style={{ ...btn(C.line, false), color: C.paper, flex: '1 1 200px' }}
                  >
                    No — I&apos;ll scan its packages
                  </button>
                </div>
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 1, background: C.line, border: `1px solid ${C.line}`, borderRadius: 6, overflow: 'hidden' }}>
              <Stat n={t.packages.toLocaleString()} k="packages" />
              <Stat n={t.lbs.toLocaleString(undefined, { maximumFractionDigits: 1 })} k="pounds" />
              <Stat n={String(t.plus)} k="PLUs" />
              {t.boxes > 0 && <Stat n={String(t.boxes)} k="sealed boxes" />}
              {t.pieceOnly > 0 && <Stat n={String(t.pieceOnly)} k="by the piece" tone={C.amber} />}
              {t.voided > 0 && <Stat n={String(t.voided)} k="voided" tone={C.amber} />}
            </div>

            {recent.length > 0 && (
              <Panel title="Just scanned">
                {recent.map(ev => ev.kind === 'package' ? (
                  <div key={ev.line.id} style={{ ...rowBtn, cursor: 'default', opacity: ev.line.voided_at ? 0.45 : 1 }}>
                    <span style={{ textDecoration: ev.line.voided_at ? 'line-through' : 'none' }}>
                      <b>{ev.line.item_name || `PLU ${ev.line.plu_number}`}</b>
                      <span style={{ color: C.muted }}>
                        {' '}&middot; {ev.line.weight_lbs != null ? `${Number(ev.line.weight_lbs).toFixed(2)} lb` : 'each'}
                      </span>
                    </span>
                    {!ev.line.voided_at && active.status === 'open' && (
                      <button onClick={() => voidLine(ev.line)} style={{ ...miniBtn, color: C.red, borderColor: C.red }}>Void</button>
                    )}
                  </div>
                ) : (
                  <div key={`box-${ev.box_id}`} style={{ ...rowBtn, cursor: 'default', opacity: ev.voided ? 0.45 : 1, borderLeft: `3px solid ${C.accent}` }}>
                    <span style={{ textDecoration: ev.voided ? 'line-through' : 'none' }}>
                      <b>Box {ev.serial}</b>
                      <span style={{ color: C.muted }}> &middot; {ev.packages} packages &middot; {ev.lbs.toFixed(1)} lb</span>
                    </span>
                    {!ev.voided && active.status === 'open' && (
                      <button onClick={() => voidBox(ev)} style={{ ...miniBtn, color: C.red, borderColor: C.red }}>Void box</button>
                    )}
                  </div>
                ))}
              </Panel>
            )}

            {labor.people.length > 0 && (
              <Panel title="Labor">
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 1, background: C.line, border: `1px solid ${C.line}`, borderRadius: 6, overflow: 'hidden' }}>
                  <Stat n={fmtMinutes(labor.activeMinutes)} k="labor on the clock" />
                  <Stat n={labor.lbsPerHour != null ? labor.lbsPerHour.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '—'} k="lb per labor hour" />
                  <Stat n={fmtMinutes(labor.wallMinutes)} k={active.status === 'open' ? 'open so far' : 'open to close'} />
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                    <thead>
                      <tr><Th>Who</Th><Th right>Scans</Th><Th right>Minutes</Th><Th right>First</Th><Th right>Last</Th></tr>
                    </thead>
                    <tbody>
                      {labor.people.map(p => (
                        <tr key={p.name}>
                          <Td>{p.name}</Td>
                          <Td right mono>{p.scans}</Td>
                          <Td right mono>{fmtMinutes(p.activeMinutes)}</Td>
                          <Td right mono>{new Date(p.firstScan).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</Td>
                          <Td right mono>{new Date(p.lastScan).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p style={hintStyle}>
                  {`Minutes come off each person's scan times. A gap over ${IDLE_GAP_MINUTES} minutes counts as a break, and the time before someone's first scan and after their last isn't included, so this runs a little under the real time, by the same amount every count.`}
                </p>
              </Panel>
            )}

            {tally.length > 0 && (
              <Panel title={`Counted so far — ${tally.length} PLUs`}>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                    <thead>
                      <tr>
                        <Th>PLU</Th><Th>Item</Th><Th right>Packages</Th><Th right>Pounds</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {tally.map(r => (
                        <tr key={r.plu_number}>
                          <Td mono>{r.plu_number}</Td>
                          <Td>{r.item_name || <span style={{ color: C.amber }}>not in the app</span>}</Td>
                          <Td right mono>{r.packages}</Td>
                          <Td right mono>{r.byPiece ? '—' : r.lbs.toFixed(2)}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Panel>
            )}

            {active.status === 'open' && (
              <button onClick={closeCount} style={btn(C.green, false)}>Close this count</button>
            )}
            {active.status === 'closed' && (
              <button onClick={() => reopenCount(active)} style={btn(C.accent, false)}>Reopen to keep counting</button>
            )}

            <p style={hintStyle}>
              Scanning does not stop production — every package carries the moment it was scanned, so the count can be
              cut at an instant later. A miscount is voided, never erased. A producer&apos;s box is refused: it is their
              meat, not our inventory.
            </p>
          </>
        )}
      </div>
    </div>
  )
}

// ── small pieces ───────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  background: C.panel, color: C.paper, border: `1px solid ${C.line}`,
  borderRadius: 6, padding: '0 14px', height: TAP, fontSize: 16, minWidth: 150,
}
const hintStyle: React.CSSProperties = { color: C.muted, fontSize: 13, margin: 0, lineHeight: 1.5 }
const rowBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
  width: '100%', minHeight: TAP, padding: '10px 14px', textAlign: 'left',
  background: C.panel, color: C.paper, border: `1px solid ${C.line}`,
  borderRadius: 6, fontSize: 15, cursor: 'pointer',
}
const miniBtn: React.CSSProperties = {
  background: 'transparent', color: C.accent, border: `1px solid ${C.line}`,
  borderRadius: 5, padding: '8px 12px', fontSize: 13, cursor: 'pointer', minHeight: 40,
}
function btn(color: string, disabled: boolean): React.CSSProperties {
  return {
    background: disabled ? C.line : color, color: disabled ? C.muted : '#06131A',
    border: 'none', borderRadius: 6, minHeight: TAP, padding: '0 20px',
    fontSize: 17, fontWeight: 700, cursor: disabled ? 'not-allowed' : 'pointer', width: '100%',
  }
}
function flashColor(kind: 'ok' | 'warn' | 'bad') {
  return kind === 'ok' ? C.green : kind === 'warn' ? C.amber : C.red
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <h2 style={{ margin: 0, fontSize: 13, letterSpacing: '0.1em', textTransform: 'uppercase', color: C.muted, fontWeight: 600 }}>{title}</h2>
      {children}
    </section>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, color: C.muted }}>
      <span>{label}</span>
      {children}
      {hint && <span style={{ fontSize: 12 }}>{hint}</span>}
    </label>
  )
}

function Stat({ n, k, tone }: { n: string; k: string; tone?: string }) {
  return (
    <div style={{ background: C.panel, padding: '14px 16px' }}>
      <div style={{ fontSize: 24, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: tone ?? C.paper }}>{n}</div>
      <div style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.muted }}>{k}</div>
    </div>
  )
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return <th style={{ textAlign: right ? 'right' : 'left', padding: '8px 10px', borderBottom: `1px solid ${C.line}`, color: C.muted, fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{children}</th>
}
function Td({ children, right, mono }: { children: React.ReactNode; right?: boolean; mono?: boolean }) {
  return <td style={{ textAlign: right ? 'right' : 'left', padding: '8px 10px', borderBottom: `1px solid ${C.line}`, fontVariantNumeric: mono ? 'tabular-nums' : undefined, fontFamily: mono ? 'ui-monospace, monospace' : undefined }}>{children}</td>
}
