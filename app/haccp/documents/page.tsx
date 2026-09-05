'use client'
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { HACCP_BUCKET, HACCP_CATEGORIES, HACCP_MAX_BYTES, formatBytes, type HaccpDocument } from '@/lib/haccpDocs'
import { supabase } from '@/lib/supabase'

const C = {
  dark:       '#1A0A04',
  darkBrown:  '#351E0E',
  medBrown:   '#75471B',
  lightBrown: '#A6785A',
  tan:        '#C9A882',
  cream:      '#F2E8D9',
  green:      '#4CAF50',
  amber:      '#F59E0B',
  red:        '#E53E3E',
}

const INPUT: React.CSSProperties = {
  background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(166,120,90,0.35)',
  borderRadius: 3, padding: '0.5rem 0.75rem', color: C.cream, fontSize: '0.88rem',
  outline: 'none', boxSizing: 'border-box', width: '100%',
}
const LABEL: React.CSSProperties = {
  display: 'block', fontSize: '0.68rem', color: C.lightBrown,
  textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.3rem',
}

export default function HaccpDocumentsPage() {
  const [docs,    setDocs]    = useState<HaccpDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [msg,     setMsg]     = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/haccp/documents')
    setDocs(res.ok ? await res.json() : [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  // The file itself is never public — ask the server for a 5-minute signed link
  // at click time and hand that to the browser.
  async function open(doc: HaccpDocument) {
    setMsg('')
    const res = await fetch(`/api/haccp/documents/${doc.id}`)
    if (!res.ok) { setMsg('Could not open that file'); return }
    const { url } = await res.json()
    window.open(url, '_blank', 'noopener')
  }

  async function retire(doc: HaccpDocument) {
    if (!confirm(`Retire “${doc.title}”? It comes off this list but the file is kept.`)) return
    const res = await fetch(`/api/haccp/documents/${doc.id}`, { method: 'DELETE' })
    setMsg(res.ok ? `Retired ${doc.title}` : 'Could not retire that document')
    if (res.ok) load()
  }

  const byCategory = HACCP_CATEGORIES
    .map(cat => ({ cat, items: docs.filter(d => d.category === cat) }))
    .filter(g => g.items.length > 0)
  const uncategorised = docs.filter(d => !HACCP_CATEGORIES.includes(d.category as never))
  if (uncategorised.length) byCategory.push({ cat: 'Other' as never, items: uncategorised })

  return (
    <div style={{ minHeight: '100vh', background: 'var(--dark-brown)', display: 'flex', flexDirection: 'column' }}>
      <header style={{ background: 'var(--dark)', borderBottom: '1px solid rgba(166,120,90,0.3)', padding: '0 2rem', height: '64px', display: 'flex', alignItems: 'center', gap: '1rem', flexShrink: 0 }}>
        <Link href="/haccp" style={{ color: C.lightBrown, textDecoration: 'none', fontSize: '0.82rem' }}>← HACCP</Link>
        <span style={{ color: 'rgba(166,120,90,0.4)' }}>|</span>
        <h1 style={{ fontFamily: 'Georgia, serif', fontSize: '1.1rem', fontWeight: 700, color: C.cream, letterSpacing: '0.08em', textTransform: 'uppercase', margin: 0 }}>
          Plan &amp; Programs
        </h1>
        <span style={{ color: C.lightBrown, fontSize: '0.78rem' }}>
          {loading ? 'Loading…' : `${docs.length} document${docs.length !== 1 ? 's' : ''} on file`}
        </span>
      </header>

      <main style={{ flex: 1, padding: '1.5rem 2rem 3rem', maxWidth: '1100px', width: '100%', margin: '0 auto', boxSizing: 'border-box' }}>
        <p style={{ fontSize: '0.8rem', color: C.lightBrown, lineHeight: 1.5, margin: '0 0 1.25rem' }}>
          The written HACCP plan, hazard analysis, prerequisite programs, SSOPs and blank forms — kept here so the
          current revision is always the one in hand. Files are stored privately; each download is a signed link that
          expires after five minutes. This is the library an inspector portal will read from.
        </p>

        {msg && (
          <div style={{ background: 'rgba(76,175,80,0.12)', border: `1px solid ${C.green}55`, color: C.cream, borderRadius: 4, padding: '0.6rem 0.9rem', fontSize: '0.85rem', marginBottom: '1rem' }}>
            {msg}
          </div>
        )}

        <UploadCard onUploaded={m => { setMsg(m); load() }} />

        <InspectorPortalCard />

        {!loading && docs.length === 0 && (
          <div style={{ background: C.dark, border: '1px dashed rgba(166,120,90,0.3)', borderRadius: 4, padding: '2rem', textAlign: 'center', color: C.lightBrown, fontSize: '0.85rem' }}>
            Nothing uploaded yet. Start with the HACCP plan and the hazard analysis.
          </div>
        )}

        {byCategory.map(group => (
          <section key={group.cat} style={{ marginBottom: '1.75rem' }}>
            <h2 style={{ fontFamily: 'Georgia, serif', fontSize: '0.85rem', color: C.tan, textTransform: 'uppercase', letterSpacing: '0.12em', margin: '0 0 0.6rem' }}>
              {group.cat} <span style={{ color: C.lightBrown, fontWeight: 'normal' }}>· {group.items.length}</span>
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {group.items.map(d => (
                <div key={d.id} style={{
                  background: C.dark, border: '1px solid rgba(166,120,90,0.2)',
                  borderLeft: `3px solid ${C.amber}`, borderRadius: 4,
                  padding: '0.7rem 1rem', display: 'flex', alignItems: 'center', gap: '1rem',
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: C.cream, fontWeight: 600, fontSize: '0.88rem' }}>{d.title}</div>
                    <div style={{ color: C.lightBrown, fontSize: '0.74rem', marginTop: '0.15rem' }}>
                      {d.filename} · {formatBytes(d.size_bytes)}
                      {d.version_date ? ` · rev ${d.version_date}` : ''}
                      {d.uploaded_by ? ` · ${d.uploaded_by}` : ''}
                    </div>
                    {d.notes && <div style={{ color: C.tan, fontSize: '0.74rem', marginTop: '0.2rem' }}>{d.notes}</div>}
                  </div>
                  <button onClick={() => open(d)} style={{
                    background: C.tan, color: C.dark, border: 'none', borderRadius: 3,
                    padding: '0.4rem 0.9rem', fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer',
                  }}>Open ↗</button>
                  <button onClick={() => retire(d)} style={{
                    background: 'transparent', color: C.lightBrown, border: '1px solid rgba(166,120,90,0.3)',
                    borderRadius: 3, padding: '0.4rem 0.8rem', fontSize: '0.8rem', cursor: 'pointer',
                  }}>Retire</button>
                </div>
              ))}
            </div>
          </section>
        ))}
      </main>

      <footer style={{ background: 'var(--dark)', borderTop: '1px solid rgba(166,120,90,0.2)', padding: '0.5rem 2rem', textAlign: 'center', fontSize: '0.72rem', color: C.lightBrown }}>
        Cowboy Meat Company · 1109 Front St, Forsyth MT · (406) 346-7660
      </footer>
    </div>
  )
}

// ── Inspector portal admin ────────────────────────────────────────────────────

interface Network { id: string; network: string; label: string | null; added_at: string }
interface NetworkState { yourIp: string; yourIpAllowed: boolean; networks: Network[] }
interface VisitActivity { action: string; detail: string | null; at: string }
interface VisitRow {
  id: string; inspector: string; agency: string | null; ip: string | null
  started_at: string; activity: VisitActivity[]
}

// Charlie manages the plant allowlist from here rather than from a hosting
// dashboard: stand in the office, press the button, that network is authorized.
function InspectorPortalCard() {
  const [net,     setNet]     = useState<NetworkState | null>(null)
  const [visits,  setVisits]  = useState<VisitRow[]>([])
  const [manual,  setManual]  = useState('')
  const [busy,    setBusy]    = useState(false)
  const [err,     setErr]     = useState('')
  const [showLog, setShowLog] = useState(false)

  const load = useCallback(async () => {
    const [n, v] = await Promise.all([
      fetch('/api/inspector/network').then(r => r.ok ? r.json() : null),
      fetch('/api/inspector/visits').then(r => r.ok ? r.json() : []),
    ])
    setNet(n); setVisits(v)
  }, [])

  useEffect(() => { load() }, [load])

  async function add(network?: string, label?: string) {
    setBusy(true); setErr('')
    const res = await fetch('/api/inspector/network', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ network, label }),
    })
    setBusy(false)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setErr(body.error ?? 'Could not add that network')
      return
    }
    setManual('')
    load()
  }

  async function remove(id: string) {
    if (!confirm('Remove this network? Inspectors on it lose access immediately.')) return
    await fetch(`/api/inspector/network?id=${id}`, { method: 'DELETE' })
    load()
  }

  return (
    <div style={{
      background: C.dark, border: '1px solid rgba(166,120,90,0.25)',
      borderLeft: `4px solid #60A5FA`, borderRadius: 4,
      padding: '1.1rem 1.25rem', marginBottom: '1.75rem',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.6rem' }}>
        <div style={{ color: C.cream, fontFamily: 'Georgia, serif', fontSize: '0.9rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Inspector Portal
        </div>
        <Link href="/inspector" style={{ color: '#60A5FA', fontSize: '0.78rem', textDecoration: 'none' }}>Open /inspector ↗</Link>
      </div>

      <p style={{ fontSize: '0.78rem', color: C.lightBrown, lineHeight: 1.5, margin: '0 0 0.9rem' }}>
        Inspectors see the documents above plus live cold storage and kill day records — read only, and only from a
        network on this list. Every visitor types their name first and everything they open is logged.
      </p>

      {net && (
        <div style={{
          background: net.yourIpAllowed ? 'rgba(76,175,80,0.1)' : 'rgba(245,158,11,0.1)',
          border: `1px solid ${net.yourIpAllowed ? C.green : C.amber}44`,
          borderRadius: 3, padding: '0.6rem 0.85rem', marginBottom: '0.85rem',
          display: 'flex', alignItems: 'center', gap: '0.85rem', flexWrap: 'wrap',
        }}>
          <span style={{ fontSize: '0.82rem', color: C.cream }}>
            This device is at <strong>{net.yourIp}</strong> —{' '}
            {net.yourIpAllowed ? 'already authorized' : 'not on the list'}
          </span>
          {!net.yourIpAllowed && (
            <button onClick={() => add(undefined, 'Plant network')} disabled={busy} style={{
              background: C.green, color: C.dark, border: 'none', borderRadius: 3,
              padding: '0.35rem 0.9rem', fontSize: '0.78rem', fontWeight: 700, cursor: 'pointer',
            }}>Authorize this network</button>
          )}
        </div>
      )}

      {net && net.networks.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', marginBottom: '0.85rem' }}>
          {net.networks.map(n => (
            <div key={n.id} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.82rem', color: C.cream }}>
              <span style={{ fontFamily: 'monospace' }}>{n.network}</span>
              <span style={{ color: C.lightBrown, fontSize: '0.76rem' }}>{n.label ?? ''}</span>
              <button onClick={() => remove(n.id)} style={{
                marginLeft: 'auto', background: 'none', border: 'none',
                color: C.lightBrown, cursor: 'pointer', fontSize: '0.78rem',
              }}>Remove</button>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.6rem' }}>
        <input
          value={manual}
          onChange={e => setManual(e.target.value)}
          placeholder="Add another address or range, e.g. 24.116.40.0/24"
          style={{ ...INPUT, flex: 1, fontSize: '0.82rem', padding: '0.4rem 0.6rem' }}
        />
        <button onClick={() => manual.trim() && add(manual.trim())} disabled={busy || !manual.trim()} style={{
          background: 'transparent', border: '1px solid rgba(166,120,90,0.35)', color: C.tan,
          borderRadius: 3, padding: '0.4rem 0.9rem', fontSize: '0.8rem', cursor: 'pointer',
        }}>Add</button>
      </div>

      {err && <div style={{ color: C.red, fontSize: '0.8rem', marginBottom: '0.6rem' }}>{err}</div>}

      {net && net.networks.length === 0 && (
        <div style={{ fontSize: '0.78rem', color: C.amber, marginBottom: '0.6rem' }}>
          No networks authorized yet — the portal is closed to everyone. Open this page from the plant and press
          Authorize.
        </div>
      )}

      <button onClick={() => setShowLog(s => !s)} style={{
        background: 'none', border: 'none', color: C.lightBrown, cursor: 'pointer',
        fontSize: '0.8rem', padding: 0,
      }}>
        {showLog ? '▾' : '▸'} Visitor log ({visits.length})
      </button>

      {showLog && (
        <div style={{ marginTop: '0.7rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {visits.length === 0 && <span style={{ fontSize: '0.8rem', color: C.lightBrown }}>No inspector has signed in yet.</span>}
          {visits.map(v => (
            <div key={v.id} style={{ borderTop: '1px solid rgba(166,120,90,0.15)', paddingTop: '0.45rem' }}>
              <div style={{ fontSize: '0.83rem', color: C.cream }}>
                <strong>{v.inspector}</strong>
                {v.agency ? ` · ${v.agency}` : ''}
                <span style={{ color: C.lightBrown, fontSize: '0.76rem' }}>
                  {' '}· {new Date(v.started_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                  {v.ip ? ` · ${v.ip}` : ''}
                </span>
              </div>
              {v.activity.length > 0 && (
                <div style={{ fontSize: '0.75rem', color: C.lightBrown, marginTop: '0.2rem' }}>
                  {v.activity.map((a, i) => (
                    <span key={i}>{i > 0 ? ' · ' : ''}{a.action.replace(/_/g, ' ')}{a.detail ? `: ${a.detail}` : ''}</span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function UploadCard({ onUploaded }: { onUploaded: (msg: string) => void }) {
  const [file,     setFile]     = useState<File | null>(null)
  const [title,    setTitle]    = useState('')
  const [category, setCategory] = useState<string>(HACCP_CATEGORIES[0])
  const [version,  setVersion]  = useState('')
  const [who,      setWho]      = useState('')
  const [notes,    setNotes]    = useState('')
  const [busy,     setBusy]     = useState(false)
  const [err,      setErr]      = useState('')

  async function submit() {
    if (!file) { setErr('Choose a file first'); return }
    if (file.size > HACCP_MAX_BYTES) { setErr(`That file is ${formatBytes(file.size)} — the limit is ${HACCP_MAX_BYTES / 1024 / 1024} MB`); return }
    setBusy(true); setErr('')
    try {
      // 1. Ask the server for a one-shot signed slot in the bucket.
      const signRes = await fetch('/api/haccp/documents', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intent: 'sign', filename: file.name, size: file.size, category }),
      })
      const sign = await signRes.json().catch(() => ({}))
      if (!signRes.ok) throw new Error(sign.error ?? 'Could not start the upload')

      // 2. Send the bytes straight to storage — never through our own API,
      //    which can't take bodies over a few MB on Vercel.
      const { error: upErr } = await supabase.storage
        .from(HACCP_BUCKET)
        .uploadToSignedUrl(sign.path, sign.token, file, { contentType: file.type || 'application/octet-stream' })
      if (upErr) throw new Error(upErr.message)

      // 3. Write the library row now that the file is in place.
      const regRes = await fetch('/api/haccp/documents', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          intent: 'register', path: sign.path, filename: file.name, size: file.size, mime: file.type,
          title: title || file.name, category, version_date: version, uploaded_by: who, notes,
        }),
      })
      const reg = await regRes.json().catch(() => ({}))
      if (!regRes.ok) throw new Error(reg.error ?? 'Upload failed')
    } catch (e) {
      setBusy(false)
      setErr(e instanceof Error ? e.message : 'Upload failed')
      return
    }
    setBusy(false)
    setFile(null); setTitle(''); setVersion(''); setNotes('')
    onUploaded(`Uploaded ${title || file.name}`)
  }

  return (
    <div style={{
      background: C.dark, border: '1px solid rgba(166,120,90,0.25)',
      borderLeft: `4px solid ${C.green}`, borderRadius: 4,
      padding: '1.1rem 1.25rem', marginBottom: '1.75rem',
    }}>
      <div style={{ color: C.cream, fontFamily: 'Georgia, serif', fontSize: '0.9rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.9rem' }}>
        Upload a document
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1.2fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
        <div>
          <label style={LABEL}>File · PDF, Word or Excel, up to 50 MB</label>
          <input
            type="file"
            onChange={e => {
              const f = e.target.files?.[0] ?? null
              setFile(f)
              if (f && !title) setTitle(f.name.replace(/\.[^.]+$/, ''))
            }}
            style={{ ...INPUT, padding: '0.35rem 0.5rem' }}
          />
        </div>
        <div>
          <label style={LABEL}>Category <span style={{ opacity: 0.6 }}>· Blank Form stays off the inspector portal</span></label>
          <select value={category} onChange={e => setCategory(e.target.value)} style={{ ...INPUT, background: C.darkBrown }}>
            {HACCP_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label style={LABEL}>Revision date</label>
          <input type="date" value={version} onChange={e => setVersion(e.target.value)} style={INPUT} />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
        <div>
          <label style={LABEL}>Title</label>
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Beef Slaughter HACCP Plan" style={INPUT} />
        </div>
        <div>
          <label style={LABEL}>Uploaded by</label>
          <input value={who} onChange={e => setWho(e.target.value)} placeholder="Initials or name" style={INPUT} />
        </div>
      </div>

      <div style={{ marginBottom: '0.9rem' }}>
        <label style={LABEL}>Notes</label>
        <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="What changed in this revision, where it applies…" style={INPUT} />
      </div>

      {err && <div style={{ color: C.red, fontSize: '0.8rem', marginBottom: '0.6rem' }}>{err}</div>}

      <button onClick={submit} disabled={busy || !file} style={{
        background: busy || !file ? 'rgba(166,120,90,0.2)' : C.green,
        color: busy || !file ? 'rgba(166,120,90,0.5)' : C.dark,
        border: 'none', borderRadius: 3, padding: '0.55rem 1.4rem',
        fontSize: '0.85rem', fontWeight: 700, letterSpacing: '0.04em',
        cursor: busy || !file ? 'default' : 'pointer',
      }}>
        {busy ? 'Uploading…' : 'Upload'}
      </button>
    </div>
  )
}
