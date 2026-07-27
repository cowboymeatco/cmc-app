'use client'
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { HACCP_CATEGORIES, formatBytes, type HaccpDocument } from '@/lib/haccpDocs'

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
    setBusy(true); setErr('')
    const fd = new FormData()
    fd.append('file', file)
    fd.append('title', title || file.name)
    fd.append('category', category)
    fd.append('version_date', version)
    fd.append('uploaded_by', who)
    fd.append('notes', notes)

    const res = await fetch('/api/haccp/documents', { method: 'POST', body: fd })
    setBusy(false)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setErr(body.error ?? 'Upload failed')
      return
    }
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
          <label style={LABEL}>File · PDF, Word or Excel, up to 25 MB</label>
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
          <label style={LABEL}>Category</label>
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
