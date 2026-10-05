'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import {
  CARD_SPECIES, CUT_SHEET_BUCKET, CUT_SHEET_MAX_BYTES, confidentMatch, formatBytes,
  matchCustomers, parseCutSheetFilename, type BriefCustomer, type CardSpecies, type CustomerMatch,
} from '@/lib/cutSheetFiles'

// ── Migrate old cut sheets ────────────────────────────────────────────────────
//
// Before the online form a cutting card was a scanned PDF, an Office Lens
// photo, a Word doc or an Excel sheet on SharePoint — "Abel, Dave BEEF.pdf" by
// the hundred under USB Drive/Cutting Instructions, and a folder per producer
// in Charlie's OneDrive. This page walks those folders (or takes the files off
// the office PC), guesses the producer and species from each file name, lets
// the office confirm or fix the guess, and files each one on the producer's
// record as an "On file" card with the original attached. See
// lib/cutSheetFiles.ts for the shape and the one-time Entra setup.

const C = {
  dark: '#1A0A04', darkBrown: '#351E0E', medBrown: '#75471B', lightBrown: '#A6785A',
  tan: '#C9A882', cream: '#F2E8D9', green: '#4CAF50', orange: '#E8883A', red: '#E53E3E',
}
const INPUT: React.CSSProperties = {
  background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(166,120,90,0.3)',
  borderRadius: 3, padding: '0.4rem 0.6rem', color: C.cream, fontSize: '0.84rem',
  outline: 'none', boxSizing: 'border-box', width: '100%', fontFamily: 'inherit',
}
function btn(bg: string, color = C.dark): React.CSSProperties {
  return { background: bg, color, border: 'none', borderRadius: 3, padding: '0.45rem 0.9rem', fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }
}
const SMALL: React.CSSProperties = { fontSize: '0.72rem', color: C.lightBrown }

type Drive = { id: string; name: string; kind: 'onedrive' | 'site'; owner: string }
type Item = {
  id: string; drive_id: string; name: string; size: number | null; folder: boolean
  child_count: number | null; mime: string | null; modified: string | null; web_url: string | null; path: string
}
type Crumb = { id: string; name: string }

// What the office decides per file; everything else is derived from the name.
interface Decision {
  customerId?: string | null
  customerName?: string
  species?: CardSpecies | ''
  killDate?: string
  notes?: string
}
type RowState = 'ready' | 'importing' | 'imported' | 'error'
interface Row {
  key: string
  name: string
  size: number | null
  modified: string | null
  folder: string
  item?: Item
  file?: File
  customerId: string | null
  customerName: string
  species: CardSpecies | ''
  killDate: string
  notes: string
  suggestions: CustomerMatch[]
  auto: boolean
}

const ACCEPT = '.pdf,.jpg,.jpeg,.png,.heic,.heif,.webp,.tif,.tiff,.doc,.docx,.xls,.xlsx,.xltx,.txt'

export default function MigrateCutSheetsPage() {
  const [customers, setCustomers] = useState<BriefCustomer[]>([])
  const [who, setWho] = useState('')
  const [tab, setTab] = useState<'sharepoint' | 'upload'>('sharepoint')

  // SharePoint side
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [drives, setDrives] = useState<Drive[]>([])
  const [drivesErr, setDrivesErr] = useState('')
  const [driveId, setDriveId] = useState('')
  const [crumbs, setCrumbs] = useState<Crumb[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [imported, setImported] = useState<Record<string, string>>({})
  const [listing, setListing] = useState(false)
  const [listErr, setListErr] = useState('')
  const [search, setSearch] = useState('')
  const [searched, setSearched] = useState('')

  // Upload side
  const [localFiles, setLocalFiles] = useState<File[]>([])
  const [dragOver, setDragOver] = useState(false)

  // Decisions, selection, progress
  const [decisions, setDecisions] = useState<Record<string, Decision>>({})
  const [states, setStates] = useState<Record<string, { state: RowState; cardId?: string; error?: string }>>({})
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [hideImported, setHideImported] = useState(true)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const cancelRef = useRef(false)
  const [pinned, setPinned] = useState<BriefCustomer | null>(null)
  const [recent, setRecent] = useState<{ cardId: string; name: string; customer: string }[]>([])

  // ── loading ────────────────────────────────────────────────────────────────
  const loadCustomers = useCallback(async () => {
    const data = await fetch('/api/customers?brief=1').then(r => r.json()).catch(() => [])
    const list: BriefCustomer[] = Array.isArray(data) ? data : []
    setCustomers(list)
    return list
  }, [])

  useEffect(() => {
    try { setWho(localStorage.getItem('cmc-migrate-who') ?? '') } catch { /* private mode */ }
    loadCustomers().then(list => {
      // ?producer=<id> from a producer's record on /customers: file everything
      // under them unless the office says otherwise.
      const want = new URLSearchParams(window.location.search).get('producer')
      const hit = want ? list.find(c => c.id === want) : null
      if (hit) { setPinned(hit); setTab('upload') }
    })
    fetch('/api/cut-sheet-files?drives=1')
      .then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? 'could not reach Microsoft'); return j })
      .then((j: { configured: boolean; drives: Drive[] }) => {
        setConfigured(j.configured)
        setDrives(j.drives ?? [])
        if (!j.configured) setTab('upload')
        // Start in the library the old cards live in, if we can see it.
        const first = (j.drives ?? []).find(d => /cut card/i.test(d.name)) ?? (j.drives ?? []).find(d => d.kind === 'site') ?? j.drives?.[0]
        if (first) setDriveId(first.id)
      })
      .catch(e => { setConfigured(false); setDrivesErr(e instanceof Error ? e.message : 'could not reach Microsoft') })
  }, [loadCustomers])

  useEffect(() => { try { localStorage.setItem('cmc-migrate-who', who) } catch { /* ignore */ } }, [who])

  const listFolder = useCallback(async (drive: string, item: string, nextCrumbs: Crumb[]) => {
    setListing(true); setListErr(''); setSearched('')
    try {
      const r = await fetch(`/api/cut-sheet-files?drive=${encodeURIComponent(drive)}&item=${encodeURIComponent(item)}`)
      const j = await r.json()
      if (!r.ok) throw new Error(j.error ?? 'could not list that folder')
      setItems(j.items ?? [])
      setImported(j.imported ?? {})
      setCrumbs(nextCrumbs)
      setSelected(new Set())
    } catch (e) {
      setListErr(e instanceof Error ? e.message : 'could not list that folder')
    } finally { setListing(false) }
  }, [])

  useEffect(() => {
    if (!driveId) return
    const d = drives.find(x => x.id === driveId)
    listFolder(driveId, 'root', [{ id: 'root', name: d ? `${d.owner} · ${d.name}` : 'Root' }])
  }, [driveId, drives, listFolder])

  async function runSearch() {
    const q = search.trim()
    if (!q || !driveId) return
    setListing(true); setListErr('')
    try {
      const r = await fetch(`/api/cut-sheet-files?drive=${encodeURIComponent(driveId)}&search=${encodeURIComponent(q)}`)
      const j = await r.json()
      if (!r.ok) throw new Error(j.error ?? 'search failed')
      setItems(j.items ?? []); setImported(j.imported ?? {}); setSearched(q); setSelected(new Set())
    } catch (e) {
      setListErr(e instanceof Error ? e.message : 'search failed')
    } finally { setListing(false) }
  }

  // ── rows: the name's guess, then whatever the office changed ──────────────
  const folderName = crumbs.length ? crumbs[crumbs.length - 1].name : ''
  const rows: Row[] = useMemo(() => {
    const build = (key: string, name: string, size: number | null, modified: string | null, folder: string, item?: Item, file?: File): Row => {
      const parsed = parseCutSheetFilename(name, folder)
      const suggestions = matchCustomers(parsed.customerName, customers)
      const auto = confidentMatch(suggestions)
      const d = decisions[key] ?? {}
      const customerId = d.customerId !== undefined ? d.customerId : (pinned?.id ?? auto?.id ?? null)
      return {
        key, name, size, modified, folder, item, file,
        customerId,
        customerName: d.customerName ?? (parsed.customerName || pinned?.name || auto?.name || ''),
        species: d.species ?? (parsed.species ?? ''),
        killDate: d.killDate ?? (parsed.killDate ?? ''),
        notes: d.notes ?? parsed.qualifier,
        suggestions,
        auto: d.customerId === undefined && !pinned && !!auto,
      }
    }
    if (tab === 'upload') {
      return localFiles.map(f => build(`local:${f.name}:${f.size}:${f.lastModified}`, f.name, f.size, new Date(f.lastModified).toISOString(), '', undefined, f))
    }
    // In a search, each hit's own folder names it; in a listing, the folder we're in.
    return items.filter(i => !i.folder).map(i => build(i.id, i.name, i.size, i.modified, searched ? (i.path.split('/').pop() ?? '') : (crumbs.length > 1 ? folderName : ''), i))
  }, [tab, localFiles, items, customers, decisions, pinned, searched, folderName, crumbs.length])

  const rowState = (r: Row): { state: RowState; cardId?: string; error?: string } =>
    states[r.key] ?? (r.item && imported[r.item.id] ? { state: 'imported', cardId: imported[r.item.id] } : { state: 'ready' })

  const visible = rows.filter(r => !(hideImported && rowState(r).state === 'imported'))
  const readyRows = rows.filter(r => rowState(r).state === 'ready' || rowState(r).state === 'error')
  const selectedRows = readyRows.filter(r => selected.has(r.key))
  const missingProducer = selectedRows.filter(r => !r.customerId).length
  const folders = tab === 'sharepoint' && !searched ? items.filter(i => i.folder) : []

  const decide = (key: string, patch: Decision) => setDecisions(prev => ({ ...prev, [key]: { ...prev[key], ...patch } }))

  // A producer not on the books yet: make the record right here, role producer.
  async function createProducer(name: string): Promise<BriefCustomer | null> {
    const r = await fetch('/api/customers', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, role: 'producer' }),
    })
    const j = await r.json().catch(() => null)
    if (!r.ok || !j?.id) { alert(j?.error ?? 'Could not create that producer'); return null }
    const made: BriefCustomer = { id: j.id, name: j.name, ranch_name: j.ranch_name ?? '', role: j.role ?? 'producer' }
    setCustomers(prev => [...prev, made].sort((a, b) => a.name.localeCompare(b.name)))
    return made
  }

  // ── importing ──────────────────────────────────────────────────────────────
  async function importOne(r: Row): Promise<{ card_id: string }> {
    const common = {
      customer_id: r.customerId, customer_name: r.customerName, species: r.species || null,
      kill_date: r.killDate || null, notes: r.notes || null, imported_by: who || null,
    }
    if (r.item) {
      const res = await fetch('/api/cut-sheet-files', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intent: 'import', drive_id: r.item.drive_id, item_id: r.item.id, ...common }),
      })
      const j = await res.json().catch(() => ({}))
      if (res.status === 409 && j.card_id) return { card_id: j.card_id }
      if (!res.ok) throw new Error(j.error ?? 'import failed')
      return j
    }
    const file = r.file!
    if (file.size > CUT_SHEET_MAX_BYTES) throw new Error(`${formatBytes(file.size)} is over the ${CUT_SHEET_MAX_BYTES / 1024 / 1024} MB limit`)
    const signRes = await fetch('/api/cut-sheet-files', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ intent: 'sign', filename: file.name, size: file.size, customer_id: r.customerId }),
    })
    const sign = await signRes.json().catch(() => ({}))
    if (!signRes.ok) throw new Error(sign.error ?? 'could not start the upload')
    const { error: upErr } = await supabase.storage
      .from(CUT_SHEET_BUCKET)
      .uploadToSignedUrl(sign.path, sign.token, file, { contentType: file.type || 'application/octet-stream' })
    if (upErr) throw new Error(upErr.message)
    const regRes = await fetch('/api/cut-sheet-files', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ intent: 'register', path: sign.path, filename: file.name, size: file.size, mime: file.type, source_path: 'Uploaded from the office PC', ...common }),
    })
    const reg = await regRes.json().catch(() => ({}))
    if (!regRes.ok) throw new Error(reg.error ?? 'could not file the card')
    return reg
  }

  async function runImport(targets: Row[]) {
    const todo = targets.filter(r => r.customerId)
    if (!todo.length) return
    setRunning(true); cancelRef.current = false
    setProgress({ done: 0, total: todo.length })
    for (let i = 0; i < todo.length; i++) {
      if (cancelRef.current) break
      const r = todo[i]
      setStates(prev => ({ ...prev, [r.key]: { state: 'importing' } }))
      try {
        const made = await importOne(r)
        setStates(prev => ({ ...prev, [r.key]: { state: 'imported', cardId: made.card_id } }))
        if (r.item) setImported(prev => ({ ...prev, [r.item!.id]: made.card_id }))
        const cust = customers.find(c => c.id === r.customerId)
        setRecent(prev => [{ cardId: made.card_id, name: r.name, customer: cust?.name ?? r.customerName }, ...prev].slice(0, 30))
        setSelected(prev => { const n = new Set(prev); n.delete(r.key); return n })
      } catch (e) {
        setStates(prev => ({ ...prev, [r.key]: { state: 'error', error: e instanceof Error ? e.message : 'import failed' } }))
      }
      setProgress({ done: i + 1, total: todo.length })
    }
    setRunning(false)
  }

  async function undo(cardId: string, key?: string) {
    const r = await fetch(`/api/cut-sheet-files?card=${encodeURIComponent(cardId)}`, { method: 'DELETE' })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) { alert(j.error ?? 'Could not undo that'); return }
    setRecent(prev => prev.filter(x => x.cardId !== cardId))
    setImported(prev => {
      const n = { ...prev }
      for (const k of Object.keys(n)) if (n[k] === cardId) delete n[k]
      return n
    })
    setStates(prev => {
      const n = { ...prev }
      for (const k of Object.keys(n)) if (n[k].cardId === cardId) delete n[k]
      if (key) delete n[key]
      return n
    })
  }

  // ── drop zone ──────────────────────────────────────────────────────────────
  function addFiles(list: FileList | File[] | null) {
    if (!list) return
    const incoming = Array.from(list).filter(f => f.size > 0)
    setLocalFiles(prev => {
      const seen = new Set(prev.map(f => `${f.name}:${f.size}:${f.lastModified}`))
      return [...prev, ...incoming.filter(f => !seen.has(`${f.name}:${f.size}:${f.lastModified}`))]
    })
    setTab('upload')
  }

  const driveGroups = useMemo(() => {
    const g = new Map<string, Drive[]>()
    for (const d of drives) g.set(d.owner, [...(g.get(d.owner) ?? []), d])
    return [...g.entries()]
  }, [drives])

  // ── render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', background: 'var(--dark-brown)', paddingBottom: '4rem' }}
      onDragOver={e => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={e => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files) }}>

      <header style={{ background: 'var(--dark)', borderBottom: '1px solid rgba(166,120,90,0.3)', padding: '0 1.5rem', height: '64px', display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <Link href="/cutting-instructions" style={{ color: 'var(--tan)', textDecoration: 'none', fontSize: '0.85rem' }}>← Cutting Instructions</Link>
        <span style={{ color: 'rgba(166,120,90,0.4)' }}>|</span>
        <h1 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, color: 'var(--cream)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>📂 Migrate Old Cut Sheets</h1>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <label style={{ ...SMALL, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            Your name
            <input style={{ ...INPUT, width: 140 }} value={who} onChange={e => setWho(e.target.value)} placeholder="Jill" />
          </label>
          <Link href="/customers" style={{ ...btn('rgba(166,120,90,0.2)', C.tan), textDecoration: 'none' }}>👥 Producers</Link>
        </div>
      </header>

      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '1.25rem 1.5rem' }}>

        <p style={{ color: C.tan, fontSize: '0.86rem', margin: '0 0 1rem', lineHeight: 1.5 }}>
          Each file becomes an <strong style={{ color: C.cream }}>On file</strong> card on the producer&apos;s record with the original attached.
          The producer and species are read off the file name (<code style={{ color: C.cream }}>Abel, Dave BEEF.pdf</code>) — a green name was matched with confidence,
          an amber one needs a look. Nothing is imported until you say so, and anything you import can be undone from the list.
        </p>

        {pinned && (
          <div style={{ background: 'rgba(76,175,80,0.1)', border: '1px solid rgba(76,175,80,0.35)', borderRadius: 4, padding: '0.6rem 0.9rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.85rem', color: C.cream }}>
            Filing everything under <strong>{pinned.name}</strong>{pinned.ranch_name ? ` (${pinned.ranch_name})` : ''}.
            <button style={{ ...btn('transparent', C.tan), padding: '0.2rem 0.5rem' }} onClick={() => setPinned(null)}>Match by file name instead</button>
          </div>
        )}

        {/* Source tabs */}
        <div style={{ display: 'flex', gap: 0, marginBottom: '1rem', border: '1px solid rgba(166,120,90,0.3)', borderRadius: 4, overflow: 'hidden', width: 'fit-content' }}>
          {([['sharepoint', '☁️ SharePoint / OneDrive'], ['upload', '💻 Files from this computer']] as const).map(([t, label], i) => (
            <button key={t} onClick={() => setTab(t)} style={{
              background: tab === t ? C.medBrown : 'transparent', color: tab === t ? C.cream : C.tan,
              border: 'none', borderLeft: i ? '1px solid rgba(166,120,90,0.3)' : 'none',
              padding: '0.55rem 1.2rem', fontSize: '0.85rem', fontWeight: tab === t ? 700 : 400, cursor: 'pointer',
            }}>{label}{t === 'upload' && localFiles.length ? ` (${localFiles.length})` : ''}</button>
          ))}
        </div>

        {/* ── SharePoint browser ── */}
        {tab === 'sharepoint' && (
          <div style={{ background: C.dark, border: '1px solid rgba(166,120,90,0.2)', borderRadius: 6, padding: '1rem', marginBottom: '1rem' }}>
            {configured === null && <div style={{ color: C.lightBrown, fontSize: '0.85rem' }}>Reaching Microsoft…</div>}
            {configured === false && (
              <div style={{ color: C.tan, fontSize: '0.85rem', lineHeight: 1.6 }}>
                <div style={{ color: C.cream, fontWeight: 700, marginBottom: '0.3rem' }}>SharePoint isn&apos;t connected to the app yet.</div>
                {drivesErr && <div style={{ color: '#e08585', marginBottom: '0.4rem' }}>{drivesErr}</div>}
                One-time setup in the Entra admin center: App registrations → <em>CMC App Mailer</em> → API permissions → add the Microsoft Graph
                <strong> application</strong> permissions <code>Files.Read.All</code> and <code>Sites.Read.All</code>, then <em>Grant admin consent</em>.
                The app already signs in with that registration to send the register report, so no new keys are needed.
                <div style={{ marginTop: '0.5rem' }}>Meanwhile the <button style={{ ...btn('transparent', C.orange), padding: 0, textDecoration: 'underline' }} onClick={() => setTab('upload')}>files-from-this-computer</button> path works now — OneDrive keeps a copy of every folder on the office PC.</div>
              </div>
            )}
            {configured && (
              <>
                <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
                  <select style={{ ...INPUT, width: 'auto', minWidth: 260 }} value={driveId} onChange={e => setDriveId(e.target.value)}>
                    {!drives.length && <option value="">No libraries visible</option>}
                    {driveGroups.map(([owner, ds]) => (
                      <optgroup key={owner} label={owner}>
                        {ds.map(d => <option key={d.id} value={d.id}>{d.kind === 'onedrive' ? `${owner}'s OneDrive` : d.name}</option>)}
                      </optgroup>
                    ))}
                  </select>
                  <form onSubmit={e => { e.preventDefault(); runSearch() }} style={{ display: 'flex', gap: '0.4rem', flex: 1, minWidth: 260 }}>
                    <input style={INPUT} value={search} onChange={e => setSearch(e.target.value)} placeholder="Search this library for a name or folder…" />
                    <button type="submit" style={btn('rgba(166,120,90,0.2)', C.tan)} disabled={listing || !search.trim()}>Search</button>
                    {searched && <button type="button" style={btn('transparent', C.tan)} onClick={() => { setSearch(''); listFolder(driveId, crumbs[crumbs.length - 1]?.id ?? 'root', crumbs) }}>✕ Back to folder</button>}
                  </form>
                </div>

                {/* Breadcrumbs */}
                {!searched && (
                  <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center', flexWrap: 'wrap', fontSize: '0.84rem', marginBottom: '0.75rem' }}>
                    {crumbs.map((c, i) => (
                      <span key={c.id} style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
                        {i > 0 && <span style={{ color: 'rgba(166,120,90,0.5)' }}>›</span>}
                        {i < crumbs.length - 1
                          ? <button onClick={() => listFolder(driveId, c.id, crumbs.slice(0, i + 1))} style={{ background: 'none', border: 'none', color: C.orange, cursor: 'pointer', font: 'inherit', padding: 0 }}>{c.name}</button>
                          : <span style={{ color: C.cream, fontWeight: 600 }}>{c.name}</span>}
                      </span>
                    ))}
                    {listing && <span style={{ ...SMALL, marginLeft: '0.5rem' }}>loading…</span>}
                  </div>
                )}
                {searched && <div style={{ ...SMALL, marginBottom: '0.75rem' }}>{listing ? 'Searching…' : `${rows.length} file${rows.length === 1 ? '' : 's'} matching “${searched}”`}</div>}
                {listErr && <div style={{ color: '#e08585', fontSize: '0.85rem', marginBottom: '0.75rem' }}>{listErr}</div>}

                {/* Subfolders */}
                {folders.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '0.5rem' }}>
                    {folders.map(f => (
                      <button key={f.id} onClick={() => listFolder(driveId, f.id, [...crumbs, { id: f.id, name: f.name }])}
                        style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(166,120,90,0.25)', borderRadius: 3, padding: '0.35rem 0.7rem', color: C.cream, fontSize: '0.82rem', cursor: 'pointer' }}>
                        📁 {f.name}{f.child_count != null ? <span style={{ color: C.lightBrown }}> · {f.child_count}</span> : null}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ── Upload drop zone ── */}
        {tab === 'upload' && (
          <label style={{
            display: 'block', background: dragOver ? 'rgba(232,136,58,0.12)' : C.dark,
            border: `2px dashed ${dragOver ? C.orange : 'rgba(166,120,90,0.35)'}`, borderRadius: 6,
            padding: '1.25rem', marginBottom: '1rem', textAlign: 'center', cursor: 'pointer', color: C.tan, fontSize: '0.88rem',
          }}>
            <input type="file" multiple accept={ACCEPT} style={{ display: 'none' }} onChange={e => { addFiles(e.target.files); e.target.value = '' }} />
            <div style={{ fontSize: '1.6rem' }}>📥</div>
            <div><strong style={{ color: C.cream }}>Drop the old cut sheets here</strong>, or click to pick them.</div>
            <div style={SMALL}>PDF, photos, Word or Excel · up to {CUT_SHEET_MAX_BYTES / 1024 / 1024} MB each · the OneDrive folder on this PC works as a source</div>
          </label>
        )}

        {/* ── File rows ── */}
        {(tab === 'upload' ? localFiles.length > 0 : configured && (rows.length > 0 || listing)) && (
          <div style={{ background: C.dark, border: '1px solid rgba(166,120,90,0.2)', borderRadius: 6, overflow: 'hidden' }}>
            <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap', padding: '0.6rem 1rem', background: 'rgba(0,0,0,0.3)', borderBottom: '1px solid rgba(166,120,90,0.15)' }}>
              <span style={{ fontSize: '0.84rem', color: C.cream }}>
                {rows.length} file{rows.length === 1 ? '' : 's'}
                {rows.length - readyRows.length > 0 && <span style={SMALL}> · {rows.length - readyRows.length} already in</span>}
              </span>
              <button style={btn('rgba(166,120,90,0.2)', C.tan)} onClick={() => setSelected(new Set(readyRows.map(r => r.key)))} disabled={running}>Select all ready</button>
              <button style={btn('rgba(166,120,90,0.2)', C.tan)} onClick={() => setSelected(new Set(readyRows.filter(r => r.auto || (pinned && r.customerId)).map(r => r.key)))} disabled={running} title="Only the files whose producer was matched with confidence">Select matched</button>
              <button style={btn('transparent', C.tan)} onClick={() => setSelected(new Set())} disabled={running}>Clear</button>
              <label style={{ ...SMALL, display: 'flex', alignItems: 'center', gap: '0.3rem', marginLeft: '0.5rem' }}>
                <input type="checkbox" checked={hideImported} onChange={e => setHideImported(e.target.checked)} /> hide already imported
              </label>
              {tab === 'upload' && <button style={btn('transparent', C.tan)} onClick={() => { setLocalFiles([]); setSelected(new Set()) }} disabled={running}>Remove all</button>}
              <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
                {running
                  ? <>
                      <span style={{ fontSize: '0.84rem', color: C.cream }}>Importing {progress.done} / {progress.total}…</span>
                      <button style={btn('rgba(150,40,40,0.3)', '#e69a9a')} onClick={() => { cancelRef.current = true }}>Stop</button>
                    </>
                  : <>
                      {missingProducer > 0 && <span style={{ fontSize: '0.78rem', color: '#f0b429' }}>{missingProducer} selected with no producer</span>}
                      <button style={btn(C.orange)} disabled={!selectedRows.length || missingProducer > 0} onClick={() => runImport(selectedRows)}>
                        Import {selectedRows.length || ''} selected →
                      </button>
                    </>}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '28px minmax(220px, 1.4fr) 92px minmax(220px, 1.3fr) 128px minmax(120px, 0.8fr) 150px', gap: '0.5rem', padding: '0.45rem 1rem', fontSize: '0.66rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.1em', borderBottom: '1px solid rgba(166,120,90,0.12)' }}>
              <span /><span>File</span><span>Species</span><span>Producer</span><span>Date on file</span><span>Note</span><span style={{ textAlign: 'right' }}>Status</span>
            </div>

            {visible.length === 0 && !listing && (
              <div style={{ padding: '1.5rem', textAlign: 'center', color: C.lightBrown, fontSize: '0.85rem' }}>
                {rows.length ? 'Everything here is already in.' : 'No files in this folder — open a subfolder above.'}
              </div>
            )}
            {visible.map(r => {
              const st = rowState(r)
              const done = st.state === 'imported'
              const busy = st.state === 'importing'
              return (
                <div key={r.key} style={{
                  display: 'grid', gridTemplateColumns: '28px minmax(220px, 1.4fr) 92px minmax(220px, 1.3fr) 128px minmax(120px, 0.8fr) 150px',
                  gap: '0.5rem', alignItems: 'center', padding: '0.5rem 1rem', borderBottom: '1px solid rgba(166,120,90,0.08)',
                  background: selected.has(r.key) ? 'rgba(232,136,58,0.06)' : 'transparent', opacity: done ? 0.6 : 1,
                }}>
                  <input type="checkbox" disabled={done || busy || running} checked={selected.has(r.key)}
                    onChange={() => setSelected(prev => { const n = new Set(prev); if (n.has(r.key)) n.delete(r.key); else n.add(r.key); return n })}
                    style={{ width: 15, height: 15, accentColor: C.tan, cursor: 'pointer' }} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ color: C.cream, fontSize: '0.86rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.name}>
                      {/\.(jpe?g|png|heic|heif|webp|tiff?)$/i.test(r.name) ? '🖼' : '📄'} {r.name}
                      {r.item?.web_url && <a href={r.item.web_url} target="_blank" rel="noreferrer" title="Open on SharePoint" style={{ color: C.lightBrown, marginLeft: '0.4rem', textDecoration: 'none' }}>↗</a>}
                    </div>
                    <div style={SMALL}>
                      {formatBytes(r.size)}{r.modified ? ` · ${new Date(r.modified).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` : ''}
                      {searched && r.item?.path ? ` · ${r.item.path}` : ''}
                    </div>
                  </div>
                  <select style={{ ...INPUT, padding: '0.3rem 0.4rem' }} value={r.species} disabled={done || busy} onChange={e => decide(r.key, { species: e.target.value as CardSpecies | '' })}>
                    <option value="">—</option>
                    {CARD_SPECIES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <ProducerPicker
                    customers={customers} value={r.customerId} suggestions={r.suggestions} auto={r.auto}
                    disabled={done || busy} typedName={r.customerName}
                    onChange={id => decide(r.key, { customerId: id })}
                    onCreate={async name => { const made = await createProducer(name); if (made) decide(r.key, { customerId: made.id }); }}
                  />
                  <input type="date" style={{ ...INPUT, padding: '0.3rem 0.4rem' }} value={r.killDate} disabled={done || busy} onChange={e => decide(r.key, { killDate: e.target.value })} />
                  <input style={{ ...INPUT, padding: '0.3rem 0.5rem' }} value={r.notes} disabled={done || busy} placeholder="GRINDER, COW…" onChange={e => decide(r.key, { notes: e.target.value })} />
                  <div style={{ textAlign: 'right', fontSize: '0.78rem' }}>
                    {st.state === 'ready' && <span style={{ color: C.lightBrown }}>{r.customerId ? 'Ready' : 'Pick a producer'}</span>}
                    {busy && <span style={{ color: C.tan }}>Importing…</span>}
                    {st.state === 'error' && <span style={{ color: '#e08585' }} title={st.error}>✕ {st.error && st.error.length > 40 ? st.error.slice(0, 40) + '…' : st.error}</span>}
                    {done && st.cardId && (
                      <span style={{ display: 'inline-flex', gap: '0.5rem', alignItems: 'center' }}>
                        <Link href={`/cutting-instructions?id=${st.cardId}`} style={{ color: C.green, fontWeight: 600, textDecoration: 'none' }}>✓ On file</Link>
                        <button style={{ ...btn('transparent', C.lightBrown), padding: 0, fontSize: '0.74rem' }} onClick={() => undo(st.cardId!, r.key)} disabled={running}>undo</button>
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Recently imported this visit */}
        {recent.length > 0 && (
          <div style={{ marginTop: '1.25rem', background: C.dark, border: '1px solid rgba(166,120,90,0.2)', borderRadius: 6, padding: '0.9rem 1rem' }}>
            <div style={{ fontSize: '0.72rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.5rem' }}>Imported this visit ({recent.length})</div>
            {recent.map(x => (
              <div key={x.cardId} style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', fontSize: '0.83rem', padding: '0.3rem 0', borderBottom: '1px solid rgba(166,120,90,0.08)' }}>
                <span style={{ color: C.cream, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{x.name}</span>
                <span style={{ color: C.tan }}>→ {x.customer}</span>
                <Link href={`/cutting-instructions?id=${x.cardId}`} style={{ color: C.orange, textDecoration: 'none' }}>open</Link>
                <button style={{ ...btn('transparent', C.lightBrown), padding: 0, fontSize: '0.76rem' }} onClick={() => undo(x.cardId)} disabled={running}>undo</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Producer picker ───────────────────────────────────────────────────────────
// A text box that shows the chosen producer, and on focus a short list: the
// name's best matches first, then anything typed. Enter takes the top one;
// "+ Add" makes a record for a producer not on the books.
function ProducerPicker({ customers, value, suggestions, auto, disabled, typedName, onChange, onCreate }: {
  customers: BriefCustomer[]
  value: string | null
  suggestions: CustomerMatch[]
  auto: boolean
  disabled?: boolean
  typedName: string
  onChange: (id: string | null) => void
  onCreate: (name: string) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [creating, setCreating] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)
  const chosen = value ? customers.find(c => c.id === value) ?? null : null

  useEffect(() => {
    if (!open) return
    const off = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', off)
    return () => document.removeEventListener('mousedown', off)
  }, [open])

  const typed = q.trim()
  const options: { c: BriefCustomer; score?: number }[] = typed
    ? matchCustomers(typed, customers, 8).map(m => ({ c: m.customer, score: m.score }))
    : suggestions.map(m => ({ c: m.customer, score: m.score }))
  const createName = typed || typedName
  const exact = createName && customers.some(c => c.name.trim().toLowerCase() === createName.toLowerCase())

  const pick = (id: string) => { onChange(id); setQ(''); setOpen(false) }
  const tone = !chosen ? '#f0b429' : auto ? C.green : C.cream

  return (
    <div ref={boxRef} style={{ position: 'relative' }}>
      <div onClick={() => !disabled && setOpen(o => !o)} style={{ ...INPUT, padding: '0.3rem 0.5rem', display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: disabled ? 'default' : 'pointer', borderColor: !chosen ? 'rgba(240,180,41,0.6)' : auto ? 'rgba(76,175,80,0.5)' : 'rgba(166,120,90,0.3)' }}>
        <span style={{ flex: 1, color: tone, fontSize: '0.84rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {chosen ? <>{chosen.name}{chosen.ranch_name ? <span style={{ color: C.lightBrown }}> · {chosen.ranch_name}</span> : null}</> : (typedName ? `“${typedName}” — who?` : 'Pick a producer')}
        </span>
        {chosen && !disabled && <button onClick={e => { e.stopPropagation(); onChange(null) }} title="Clear" style={{ background: 'none', border: 'none', color: C.lightBrown, cursor: 'pointer', padding: 0, fontSize: '0.8rem' }}>✕</button>}
        {!disabled && <span style={{ color: C.lightBrown, fontSize: '0.7rem' }}>▾</span>}
      </div>
      {open && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20, background: C.darkBrown, border: '1px solid rgba(166,120,90,0.4)', borderRadius: 4, boxShadow: '0 8px 24px rgba(0,0,0,0.5)', padding: '0.4rem' }}>
          <input autoFocus style={{ ...INPUT, marginBottom: '0.35rem' }} value={q} placeholder="Type a name or ranch…" onChange={e => setQ(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && options[0]) { e.preventDefault(); pick(options[0].c.id) } if (e.key === 'Escape') setOpen(false) }} />
          <div style={{ maxHeight: 220, overflowY: 'auto' }}>
            {options.length === 0 && <div style={{ ...SMALL, padding: '0.3rem 0.4rem' }}>{typed ? 'No producer by that name.' : 'No match from the file name — type to search.'}</div>}
            {options.map(({ c, score }) => (
              <button key={c.id} onClick={() => pick(c.id)} style={{ display: 'flex', width: '100%', gap: '0.5rem', alignItems: 'center', background: c.id === value ? 'rgba(232,136,58,0.12)' : 'transparent', border: 'none', borderRadius: 3, padding: '0.35rem 0.4rem', color: C.cream, fontSize: '0.84rem', cursor: 'pointer', textAlign: 'left' }}>
                <span style={{ flex: 1 }}>{c.name}{c.ranch_name ? <span style={{ color: C.lightBrown }}> · {c.ranch_name}</span> : null}</span>
                <span style={{ ...SMALL, fontSize: '0.68rem' }}>{c.role === 'producer' ? '🐄' : c.role === 'both' ? '↕' : '🛒'}{score != null ? ` ${score}` : ''}</span>
              </button>
            ))}
          </div>
          {createName && !exact && (
            <button disabled={creating} onClick={async () => { setCreating(true); await onCreate(createName); setCreating(false); setQ(''); setOpen(false) }}
              style={{ ...btn('rgba(76,175,80,0.15)', C.green), width: '100%', marginTop: '0.35rem', textAlign: 'left' }}>
              {creating ? 'Adding…' : `+ Add “${createName}” as a new producer`}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
