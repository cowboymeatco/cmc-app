'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'

// ── Producer Labels ──────────────────────────────────────────────────────────
// A producer who sells under their own label (Blegen Galloway) needs their own
// PLUs on the scale, because the Hobart prints one label format per PLU. Every
// producer's set on the scale all the time slowed the scales down, so each set
// lives here and goes on the scale only while that producer's animals are being
// packed (Charlie, 2026-09-23).
//
// This page is where a set is built (which house items the producer gets, on
// which label format), where it's exported for HCT when a card that names it
// is coming up, and where somebody records that it went on — and later came
// off — the scales. The scanner reads the same sets: it translates a producer
// PLU back to its house item and warns when the wrong label turns up.

interface SetItem {
  id: string; house_plu: string; plu_number: string; item_name: string
  house_name: string | null; house_active: boolean
}
interface SetCard {
  id: string; customer: string; species: string; kill_date: string | null; packing: boolean; packed: boolean
}
interface ProducerSet {
  id: string; name: string; label_format: string | null; plu_block_start: number
  loaded_at: string | null; notes: string | null
  items: SetItem[]; cards: SetCard[]
}
interface Unmatched { label: string; cards: number }
// From the kiosk's last read of the scales (/api/scale-reads, /scale-check):
// what the set's label format holds, and how much of the set each scale has.
interface ScaleInfo {
  format_texts: string[]
  byScale: { ip: string; found: number; format_on_scale: boolean | null }[]
}
interface HousePlu {
  plu_number: string; item_name: string; species: string | null; active: boolean
  ht_skeleton: Record<string, string> | null
}

const C = {
  dark:       '#1A0A04',
  darkBrown:  '#351E0E',
  medBrown:   '#75471B',
  lightBrown: '#A6785A',
  tan:        '#C9A882',
  cream:      '#F2E8D9',
  green:      '#4CAF50',
  amber:      '#F59E0B',
  red:        '#EF4444',
}

const INPUT: React.CSSProperties = {
  background: 'rgba(0,0,0,0.3)', color: C.cream, border: '1px solid rgba(166,120,90,0.35)',
  borderRadius: 3, padding: '0.35rem 0.55rem', fontSize: '0.85rem',
}
const btn = (bg: string, fg: string = C.dark): React.CSSProperties => ({
  background: bg, color: fg, border: bg === 'transparent' ? '1px solid rgba(166,120,90,0.35)' : 'none',
  borderRadius: 3, padding: '0.4rem 0.8rem', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
})
const fmtDate = (d: string | null) =>
  d ? new Date(d.length === 10 ? d + 'T12:00:00' : d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : '—'

async function post(body: Record<string, unknown>): Promise<string | null> {
  const res = await fetch('/api/producer-labels', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  if (res.ok) return null
  const j = await res.json().catch(() => ({}))
  return j?.error ?? 'Something went wrong'
}

export default function ProducerLabelsPage() {
  const [sets, setSets]           = useState<ProducerSet[] | null>(null)
  const [unmatched, setUnmatched] = useState<Unmatched[]>([])
  const [house, setHouse]         = useState<HousePlu[]>([])
  const [error, setError]         = useState<string | null>(null)
  const [newName, setNewName]     = useState('')
  const [newFmt, setNewFmt]       = useState('')
  const [busy, setBusy]           = useState(false)
  const [scaleInfo, setScaleInfo] = useState<Record<string, ScaleInfo>>({})

  const load = useCallback(() =>
    fetch('/api/producer-labels')
      .then(r => r.json())
      .then(j => {
        if (j?.error) { setError(String(j.error)); return }
        setSets(j.sets)
        setUnmatched(j.unmatched ?? [])
      })
      .catch(() => setError('Could not load the producer labels.')), [])

  useEffect(() => {
    load()
    fetch('/api/processing?active=true').then(r => r.json())
      .then(d => setHouse(Array.isArray(d) ? d : [])).catch(() => {})
    fetch('/api/scale-reads').then(r => r.json())
      .then(d => setScaleInfo(Object.fromEntries(
        (Array.isArray(d?.producerSets) ? d.producerSets : []).map((p: ScaleInfo & { name: string }) => [p.name, p]))))
      .catch(() => {})
  }, [load])

  async function run(body: Record<string, unknown>) {
    setBusy(true)
    setError(null)
    const err = await post(body)
    if (err) setError(err)
    await load()
    setBusy(false)
    return !err
  }

  async function createSet(name: string, fmt: string) {
    if (await run({ action: 'create_set', name, label_format: fmt })) { setNewName(''); setNewFmt('') }
  }

  return (
    <div style={{ minHeight: '100vh', background: C.darkBrown, color: C.cream, fontFamily: 'system-ui, sans-serif' }}>
      <header style={{ background: C.dark, borderBottom: '1px solid rgba(166,120,90,0.3)', padding: '0 2rem', minHeight: 64, display: 'flex', alignItems: 'center', gap: '1.25rem', flexWrap: 'wrap' }}>
        <Link href="/processing" style={{ color: C.lightBrown, textDecoration: 'none', fontSize: '0.82rem' }}>← Processing</Link>
        <h1 style={{ fontFamily: 'Georgia, serif', fontSize: '1.1rem', fontWeight: 700, color: C.cream, letterSpacing: '0.08em', textTransform: 'uppercase', margin: 0 }}>Producer Labels</h1>
      </header>

      <main style={{ maxWidth: 1100, margin: '0 auto', padding: '1.25rem 2rem 4rem' }}>
        <p style={{ fontSize: '0.85rem', color: C.tan, lineHeight: 1.55, margin: '0 0 1rem', maxWidth: 780 }}>
          A producer who sells under their own label gets their own PLUs — copies of the house items, printed on
          their label format. A set lives here and goes on the scales only while that producer&apos;s animals are
          being packed. Put the producer&apos;s name on the cutting card&apos;s <strong style={{ color: C.cream }}>Scale label</strong>{' '}
          and the card shows up under its set below.
        </p>

        {error && (
          <div style={{ background: 'rgba(239,68,68,0.12)', border: `1px solid ${C.red}`, borderRadius: 4, padding: '0.6rem 0.9rem', color: '#f3a5a5', fontSize: '0.85rem', marginBottom: '1rem' }}>
            {error}
          </div>
        )}

        {/* Cards that name a label nobody has built a set for — the scanner can't
            check those, and there's nothing to load. */}
        {unmatched.map(u => (
          <div key={u.label} style={{ background: 'rgba(245,158,11,0.10)', border: `1px solid ${C.amber}`, borderRadius: 4, padding: '0.6rem 0.9rem', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
            <span style={{ color: C.amber, fontWeight: 700, fontSize: '0.85rem' }}>
              ⚠ {u.cards} card{u.cards === 1 ? '' : 's'} say &ldquo;{u.label}&rdquo; — no PLU set by that name
            </span>
            <span style={{ color: C.lightBrown, fontSize: '0.78rem' }}>Build one, or fix the card&apos;s Scale label to match an existing set.</span>
            <button disabled={busy} onClick={() => { setNewName(u.label); setNewFmt('') }} style={{ ...btn('transparent', C.tan), marginLeft: 'auto' }}>
              Start a set called this
            </button>
          </div>
        ))}

        {/* New set */}
        <div style={{ background: C.dark, border: '1px solid rgba(166,120,90,0.25)', borderRadius: 4, padding: '0.9rem 1.1rem', marginBottom: '1.25rem', display: 'flex', alignItems: 'flex-end', gap: '0.75rem', flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.7rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Producer
            <input style={{ ...INPUT, width: 240 }} value={newName} onChange={e => setNewName(e.target.value)} placeholder="Blegen Galloway" />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.7rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Label format #
            <input style={{ ...INPUT, width: 110 }} value={newFmt} onChange={e => setNewFmt(e.target.value.replace(/\D/g, ''))} placeholder="e.g. 510" inputMode="numeric" />
          </label>
          <button disabled={busy || !newName.trim()} onClick={() => createSet(newName, newFmt)} style={btn(C.tan)}>+ New producer label</button>
          <span style={{ fontSize: '0.75rem', color: C.lightBrown }}>
            Gets its own block of 1,000 PLU numbers from 20000 up. The format can be filled in later.
          </span>
        </div>

        {sets === null && !error && <div style={{ color: C.lightBrown }}>Loading…</div>}
        {sets?.length === 0 && <div style={{ color: C.lightBrown, fontSize: '0.9rem' }}>No producer labels yet.</div>}

        {sets?.map(s => <SetPanel key={s.id} set={s} house={house} busy={busy} run={run} scale={scaleInfo[s.name]} />)}
      </main>
    </div>
  )
}

function SetPanel({ set: s, house, busy, run, scale }: {
  set: ProducerSet; house: HousePlu[]; busy: boolean
  run: (body: Record<string, unknown>) => Promise<boolean>
  scale?: ScaleInfo
}) {
  const [editing, setEditing]   = useState(false)
  const [name, setName]         = useState(s.name)
  const [fmt, setFmt]           = useState(s.label_format ?? '')
  const [adding, setAdding]     = useState(false)

  const waiting   = s.cards.filter(c => !c.packed)
  const allPacked = s.cards.length > 0 && waiting.length === 0
  const loaded    = !!s.loaded_at
  const canExport = !!s.label_format && s.items.length > 0

  // The one line that says what to do with this set right now.
  const call =
    !s.label_format ? { color: C.amber, text: 'Needs its label format number before it can go on the scale.' }
    : !s.items.length ? { color: C.amber, text: 'No PLUs yet — add the house items this producer gets.' }
    : waiting.length && !loaded ? { color: C.amber, text: `${waiting.length} animal${waiting.length === 1 ? '' : 's'} to pack on this label — download the set, load it through HCT, then mark it loaded.` }
    : waiting.length && loaded ? { color: C.green, text: `On the scales and ready — ${waiting.length} animal${waiting.length === 1 ? '' : 's'} to pack.` }
    : allPacked && loaded ? { color: C.tan, text: 'Everything on this label is packed — take the set off the scales, then mark it removed.' }
    : loaded ? { color: C.tan, text: 'On the scales, but no open card names it. Take it off when you’re sure it isn’t needed.' }
    : { color: C.lightBrown, text: 'Off the scales. Nothing to do until a card names it.' }

  return (
    <section style={{ background: C.dark, border: `1px solid ${loaded ? 'rgba(76,175,80,0.45)' : 'rgba(166,120,90,0.25)'}`, borderRadius: 4, marginBottom: '1.25rem' }}>
      <div style={{ padding: '0.9rem 1.1rem', borderBottom: '1px solid rgba(166,120,90,0.15)', display: 'flex', alignItems: 'center', gap: '0.9rem', flexWrap: 'wrap' }}>
        {editing ? (
          <>
            <input style={{ ...INPUT, width: 220 }} value={name} onChange={e => setName(e.target.value)} />
            <span style={{ fontSize: '0.75rem', color: C.lightBrown }}>Format #</span>
            <input style={{ ...INPUT, width: 90 }} value={fmt} onChange={e => setFmt(e.target.value.replace(/\D/g, ''))} inputMode="numeric" />
            <button disabled={busy} style={btn(C.tan)} onClick={async () => {
              if (await run({ action: 'update_set', id: s.id, name, label_format: fmt })) setEditing(false)
            }}>Save</button>
            <button disabled={busy} style={btn('transparent', C.tan)} onClick={() => { setEditing(false); setName(s.name); setFmt(s.label_format ?? '') }}>Cancel</button>
          </>
        ) : (
          <>
            <h2 style={{ margin: 0, fontFamily: 'Georgia, serif', fontSize: '1.05rem', color: C.cream }}>🏷 {s.name}</h2>
            <span style={{ fontSize: '0.8rem', color: s.label_format ? C.tan : C.amber }}>
              Label format <strong style={{ fontFamily: 'monospace' }}>{s.label_format ?? 'not set'}</strong>
              {/* What the scale's own copy of that format holds — the logo is
                  the check that the number really is this producer's label. */}
              {scale?.format_texts.length ? <span style={{ color: C.lightBrown }}> · {scale.format_texts.slice(0, 2).join(' · ')}</span> : null}
            </span>
            <span style={{ fontSize: '0.8rem', color: C.lightBrown, fontFamily: 'monospace' }}>
              PLUs {s.plu_block_start}–{s.plu_block_start + 999}
            </span>
            <button disabled={busy} style={btn('transparent', C.tan)} onClick={() => setEditing(true)}>✏️ Edit</button>
          </>
        )}
        <span style={{ marginLeft: 'auto', fontSize: '0.8rem', fontWeight: 700, color: loaded ? C.green : C.lightBrown }}>
          {loaded ? `● On the scales since ${fmtDate(s.loaded_at)}` : '○ Off the scales'}
        </span>
      </div>

      {/* The last read of the scales, when there's been one: is the set
          actually there, whatever the Mark loaded button says. */}
      {scale && scale.byScale.length > 0 && s.items.length > 0 && (
        <div style={{ padding: '0.45rem 1.1rem', borderBottom: '1px solid rgba(166,120,90,0.15)', display: 'flex', gap: '0.9rem', flexWrap: 'wrap', fontSize: '0.78rem' }}>
          <span style={{ color: C.lightBrown }}>Last scale read:</span>
          {scale.byScale.map(b => (
            <span key={b.ip} style={{ fontFamily: 'monospace', color: b.found === s.items.length ? C.green : b.found ? C.amber : C.lightBrown }}>
              .{b.ip.split('.').pop()} {b.found}/{s.items.length}{b.format_on_scale === false ? ' · format missing!' : ''}
            </span>
          ))}
          <Link href="/scale-check" style={{ color: C.tan, marginLeft: 'auto' }}>Scale Check →</Link>
        </div>
      )}

      <div style={{ padding: '0.75rem 1.1rem', display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap', borderBottom: '1px solid rgba(166,120,90,0.15)' }}>
        <span style={{ fontSize: '0.85rem', color: call.color, fontWeight: 600, flex: '1 1 320px' }}>{call.text}</span>
        <a
          href={canExport ? `/api/producer-labels/export?id=${s.id}` : undefined}
          aria-disabled={!canExport}
          style={{ ...btn(canExport ? C.tan : C.medBrown), textDecoration: 'none', opacity: canExport ? 1 : 0.5, pointerEvents: canExport ? 'auto' : 'none' }}>
          ⬇ Download .ht for HCT
        </a>
        {loaded ? (
          <button disabled={busy} style={btn('transparent', C.tan)} onClick={() => {
            if (confirm(`Mark ${s.name}'s PLUs as removed from the scales? Only do this once they're actually off.`)) run({ action: 'update_set', id: s.id, loaded: false })
          }}>Mark removed</button>
        ) : (
          <button disabled={busy || !canExport} style={btn(C.green)} onClick={() => run({ action: 'update_set', id: s.id, loaded: true })}>✓ Mark loaded</button>
        )}
      </div>

      {/* Cards that name this label */}
      <div style={{ padding: '0.6rem 1.1rem', borderBottom: '1px solid rgba(166,120,90,0.15)' }}>
        <div style={{ fontSize: '0.68rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.35rem' }}>
          Cutting cards on this label
        </div>
        {s.cards.length === 0 ? (
          <div style={{ fontSize: '0.8rem', color: C.lightBrown }}>
            None. Set a card&apos;s <strong>Scale label</strong> to &ldquo;{s.name}&rdquo; on the Cutting Instructions page.
          </div>
        ) : s.cards.map(c => (
          <div key={c.id} style={{ display: 'flex', gap: '0.9rem', fontSize: '0.83rem', padding: '0.2rem 0', flexWrap: 'wrap' }}>
            <span style={{ color: C.cream, fontWeight: 600, minWidth: 200 }}>{c.customer}</span>
            <span style={{ color: C.tan }}>{c.species}</span>
            <span style={{ color: C.lightBrown }}>killed {fmtDate(c.kill_date)}</span>
            <span style={{ color: c.packed ? C.green : c.packing ? C.amber : C.lightBrown, fontWeight: 600 }}>
              {c.packed ? '✓ packed' : c.packing ? '⏳ packing now' : 'not packed yet'}
            </span>
          </div>
        ))}
      </div>

      {/* The set's PLUs */}
      <div style={{ padding: '0.6rem 1.1rem 0.9rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.4rem' }}>
          <span style={{ fontSize: '0.68rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
            {s.items.length} PLU{s.items.length === 1 ? '' : 's'}
          </span>
          <button disabled={busy} style={btn('transparent', C.tan)} onClick={() => setAdding(a => !a)}>
            {adding ? 'Close' : '+ Add house items'}
          </button>
        </div>
        {adding && <AddItems set={s} house={house} busy={busy} run={run} onDone={() => setAdding(false)} />}
        {s.items.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
            <thead>
              <tr style={{ color: C.lightBrown, fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: 'left' }}>
                <th style={{ padding: '0.3rem 0.4rem' }}>{s.name} PLU</th>
                <th style={{ padding: '0.3rem 0.4rem' }}>Prints as</th>
                <th style={{ padding: '0.3rem 0.4rem' }}>Copy of house PLU</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {s.items.map(it => <ItemRow key={it.id} item={it} busy={busy} loaded={loaded} run={run} />)}
            </tbody>
          </table>
        )}
        {!loaded && (
          <div style={{ marginTop: '0.75rem' }}>
            <button disabled={busy} style={{ ...btn('transparent', '#e69a9a'), fontSize: '0.72rem' }} onClick={() => {
              if (confirm(`Delete the ${s.name} set and its ${s.items.length} PLUs? Cards that name it keep their Scale label.`)) run({ action: 'delete_set', id: s.id })
            }}>Delete set</button>
          </div>
        )}
      </div>
    </section>
  )
}

function ItemRow({ item: it, busy, loaded, run }: {
  item: SetItem; busy: boolean; loaded: boolean
  run: (body: Record<string, unknown>) => Promise<boolean>
}) {
  const [name, setName] = useState(it.item_name)
  const dirty = name.trim() !== it.item_name
  return (
    <tr style={{ borderTop: '1px solid rgba(166,120,90,0.12)' }}>
      <td style={{ padding: '0.3rem 0.4rem', fontFamily: 'monospace', color: C.cream }}>{it.plu_number}</td>
      <td style={{ padding: '0.3rem 0.4rem' }}>
        <input style={{ ...INPUT, width: '100%', maxWidth: 340, padding: '0.2rem 0.4rem', fontSize: '0.8rem' }}
          value={name} onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && dirty) run({ action: 'rename_item', item_id: it.id, item_name: name }) }} />
        {dirty && (
          <button disabled={busy} style={{ ...btn(C.tan), marginLeft: '0.4rem', padding: '0.2rem 0.5rem' }}
            onClick={() => run({ action: 'rename_item', item_id: it.id, item_name: name })}>Save</button>
        )}
      </td>
      <td style={{ padding: '0.3rem 0.4rem', color: it.house_name && it.house_active ? C.tan : C.red }}>
        <span style={{ fontFamily: 'monospace', color: C.lightBrown }}>{it.house_plu}</span>{' '}
        {it.house_name ?? 'house PLU deleted'}{it.house_name && !it.house_active ? ' (retired)' : ''}
      </td>
      <td style={{ padding: '0.3rem 0.4rem', textAlign: 'right' }}>
        {!loaded && (
          <button disabled={busy} title="Drop from this set" onClick={() => run({ action: 'remove_item', item_id: it.id })}
            style={{ background: 'none', border: 'none', color: C.lightBrown, cursor: 'pointer', fontSize: '0.9rem' }}>✕</button>
        )}
      </td>
    </tr>
  )
}

function AddItems({ set: s, house, busy, run, onDone }: {
  set: ProducerSet; house: HousePlu[]; busy: boolean
  run: (body: Record<string, unknown>) => Promise<boolean>; onDone: () => void
}) {
  const [q, setQ]             = useState('')
  const [species, setSpecies] = useState('Beef')
  const [picked, setPicked]   = useState<Set<string>>(new Set())
  const have = useMemo(() => new Set(s.items.map(i => i.house_plu)), [s.items])
  const speciesList = useMemo(() => [...new Set(house.map(h => h.species).filter((x): x is string => !!x))].sort(), [house])
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return house
      .filter(h => !have.has(String(h.plu_number)))
      .filter(h => !species || h.species === species)
      .filter(h => !needle || h.item_name.toLowerCase().includes(needle) || String(h.plu_number).includes(needle))
      .sort((a, b) => Number(a.plu_number) - Number(b.plu_number))
  }, [house, have, species, q])
  const toggle = (p: string) => setPicked(prev => {
    const next = new Set(prev)
    if (next.has(p)) next.delete(p); else next.add(p)
    return next
  })

  return (
    <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(166,120,90,0.2)', borderRadius: 4, padding: '0.7rem', marginBottom: '0.75rem' }}>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.5rem' }}>
        <select value={species} onChange={e => setSpecies(e.target.value)} style={INPUT}>
          <option value="">All species</option>
          {speciesList.map(sp => <option key={sp} value={sp}>{sp}</option>)}
        </select>
        <input style={{ ...INPUT, width: 220 }} value={q} onChange={e => setQ(e.target.value)} placeholder="Search name or PLU" />
        <button disabled={busy || !shown.length} style={btn('transparent', C.tan)}
          onClick={() => setPicked(prev => new Set([...prev, ...shown.map(h => String(h.plu_number))]))}>
          Select all {shown.length} shown
        </button>
        <button disabled={busy || !picked.size} style={btn(C.tan)} onClick={async () => {
          if (await run({ action: 'add_items', id: s.id, house_plus: [...picked] })) { setPicked(new Set()); onDone() }
        }}>Add {picked.size || ''} to {s.name}</button>
      </div>
      <div style={{ maxHeight: 280, overflowY: 'auto', columns: '2 280px', fontSize: '0.8rem' }}>
        {shown.map(h => {
          const p = String(h.plu_number)
          return (
            <label key={p} style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', padding: '0.12rem 0', breakInside: 'avoid', cursor: 'pointer', color: picked.has(p) ? C.cream : C.tan }}>
              <input type="checkbox" checked={picked.has(p)} onChange={() => toggle(p)} />
              <span style={{ fontFamily: 'monospace', color: C.lightBrown, minWidth: 44 }}>{p}</span>
              {h.item_name}
              {h.ht_skeleton?.l1 && <span style={{ color: C.lightBrown, fontSize: '0.7rem' }}>· fmt {h.ht_skeleton.l1}</span>}
            </label>
          )
        })}
        {!shown.length && <div style={{ color: C.lightBrown }}>Nothing left to add here.</div>}
      </div>
    </div>
  )
}
