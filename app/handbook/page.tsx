'use client'
// /handbook — the Team Member Handbook and each person's own Roles &
// Responsibilities, for the crew. Works on the entrance iPad and on a phone.
//
// Tap your name, enter your time clock PIN. You see the documents meant for
// everyone plus the ones assigned to you — nobody else's — and tap "I've read
// this" at the bottom of each. That's recorded with your name, the time and
// the version you read.
//
// The manager side (writing, publishing, assigning, who has signed) is
// /handbook/manage, behind the /exec passphrase.
//
// The sign-in is kept in memory only, and signs itself out after a few idle
// minutes: the iPad is shared, and the next person must not land in someone
// else's documents.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { HrDoc, HrDocSummary, buildPrintHTML, dayMT, docCss, openPrint, renderMarkdown, stampMT } from '@/lib/hrDocs'
import { C, api, bigBtn, btn, card, h2 } from '../timekeeping/shared'

const IDLE_SIGN_OUT_MS = 5 * 60_000
const KEEP_ALIVE_MS = 5 * 60_000   // the server session is 30 min; reading renews it

interface RosterEntry { id: string; name: string; needsSetup: boolean }
type Me = { id: string; name: string }

export default function HandbookPage() {
  const [token, setToken] = useState<string | null>(null)
  const [me, setMe] = useState<Me | null>(null)
  const [docs, setDocs] = useState<HrDocSummary[] | null>(null)
  const [open, setOpen] = useState<HrDoc | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const signOut = useCallback((why = '') => {
    setToken(t => {
      if (t) api('/api/handbook/session', { method: 'DELETE', headers: { 'x-handbook-token': t } }).catch(() => {})
      return null
    })
    setMe(null); setDocs(null); setOpen(null); setError(''); setNotice(why)
  }, [])

  /** A call as the signed-in person. A 401 means the session ran out: back to the names. */
  const call = useCallback(async <T,>(path: string, init: RequestInit = {}): Promise<T | null> => {
    if (!token) return null
    try {
      return await api<T>(path, { ...init, headers: { 'x-handbook-token': token } })
    } catch (e) {
      if ((e as { status?: number }).status === 401) { signOut('You were signed out. Enter your PIN again.'); return null }
      throw e
    }
  }, [token, signOut])

  const loadDocs = useCallback(async () => {
    try {
      const r = await call<{ employee: Me; docs: HrDocSummary[] }>('/api/handbook/docs')
      if (r) { setDocs(r.docs); setMe(r.employee) }
    } catch (e) { setError((e as Error).message) }
  }, [call])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loading after sign-in; state is only set once the request resolves
    if (token) loadDocs()
  }, [token, loadDocs])

  // Idle sign-out, and a keep-alive while someone is actually reading.
  const lastTouch = useRef(0)
  const lastPing = useRef(0)
  useEffect(() => {
    if (!token) return
    lastTouch.current = Date.now(); lastPing.current = Date.now()
    const touch = () => {
      const now = Date.now()
      lastTouch.current = now
      if (now - lastPing.current > KEEP_ALIVE_MS) {
        lastPing.current = now
        call('/api/handbook/docs').catch(() => {})
      }
    }
    const events = ['pointerdown', 'keydown', 'scroll', 'touchstart'] as const
    events.forEach(ev => window.addEventListener(ev, touch, { passive: true }))
    const t = setInterval(() => {
      if (Date.now() - lastTouch.current > IDLE_SIGN_OUT_MS) signOut('Signed out after a few idle minutes.')
    }, 15_000)
    return () => { events.forEach(ev => window.removeEventListener(ev, touch)); clearInterval(t) }
  }, [token, call, signOut])

  const openDoc = async (id: string) => {
    setError('')
    try {
      const r = await call<{ doc: HrDoc }>(`/api/handbook/docs/${id}`)
      if (r) { setOpen(r.doc); window.scrollTo(0, 0) }
    } catch (e) { setError((e as Error).message) }
  }

  const acknowledge = async () => {
    if (!open) return
    setError('')
    try {
      const r = await call<{ acknowledgedAt: string }>(`/api/handbook/docs/${open.id}/ack`, { method: 'POST', body: JSON.stringify({ version: open.version }) })
      if (r) { setOpen({ ...open, acknowledgedAt: r.acknowledgedAt }); loadDocs() }
    } catch (e) {
      setError((e as Error).message)
      // Most likely a newer version was published while they were reading.
      if ((e as { status?: number }).status === 409) openDoc(open.id)
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: C.darkBrown, padding: '1.25rem 1rem 3rem' }}>
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', fontFamily: 'Georgia, serif', fontSize: '1.35rem', fontWeight: 700, color: C.cream, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '1rem' }}>
          Cowboy Meat Co · Handbook
        </div>

        {!token && <SignIn notice={notice} onDone={(t, m) => { setNotice(''); setMe(m); setToken(t) }} />}

        {token && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.9rem', flexWrap: 'wrap' }}>
            {open && <button style={btn(C.medBrown)} onClick={() => { setOpen(null); setError('') }}>← All documents</button>}
            <span style={{ color: C.tan, fontSize: '0.9rem' }}>Signed in as <b style={{ color: C.cream }}>{me?.name}</b></span>
            <button style={{ ...btn('transparent'), border: `1px solid ${C.medBrown}`, color: C.tan, marginLeft: 'auto' }} onClick={() => signOut()}>Sign out</button>
          </div>
        )}

        {error && <div style={{ ...card, borderColor: C.red, color: C.red }}>{error}</div>}

        {token && !open && <DocList docs={docs} onOpen={openDoc} />}
        {token && open && <DocView doc={open} name={me?.name ?? ''} onAcknowledge={acknowledge} />}
      </div>
    </div>
  )
}

// ── Sign-in ─────────────────────────────────────────────────────────────────

function SignIn({ notice, onDone }: { notice: string; onDone: (token: string, me: Me) => void }) {
  const [roster, setRoster] = useState<RosterEntry[] | null>(null)
  const [picked, setPicked] = useState<RosterEntry | null>(null)
  const [pin, setPin] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api<{ roster: RosterEntry[] }>('/api/timeclock/roster').then(r => setRoster(r.roster)).catch(e => setErr((e as Error).message))
  }, [])

  const submit = async (value: string) => {
    if (!picked || busy) return
    setBusy(true); setErr('')
    try {
      const r = await api<{ token: string; employee: Me }>('/api/handbook/session', { method: 'POST', body: JSON.stringify({ employeeId: picked.id, pin: value }) })
      onDone(r.token, r.employee)
    } catch (e) {
      setErr((e as Error).message); setPin('')
    } finally { setBusy(false) }
  }

  if (!picked) {
    return (
      <div style={card}>
        <h2 style={h2}>Tap your name</h2>
        {notice && <p style={{ color: C.amber, fontSize: '0.9rem', margin: '0 0 0.8rem' }}>{notice}</p>}
        {err && <p style={{ color: C.red, fontSize: '0.9rem', margin: '0 0 0.8rem' }}>{err}</p>}
        {roster === null && !err && <div style={{ color: C.tan }}>Loading…</div>}
        {roster?.length === 0 && <div style={{ color: C.tan }}>No one is set up yet. Ask a manager.</div>}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '0.6rem' }}>
          {roster?.map(r => (
            <button key={r.id} style={bigBtn(C.medBrown)} onClick={() => { setPicked(r); setPin(''); setErr('') }}>{r.name}</button>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div style={{ ...card, maxWidth: 380, margin: '0 auto', textAlign: 'center' }}>
      <h2 style={h2}>{picked.name}</h2>
      {picked.needsSetup ? (
        <p style={{ color: C.tan, fontSize: '0.95rem', lineHeight: 1.5 }}>
          You don&apos;t have a PIN yet. Pick one at the time clock iPad at work first, then come back here.
        </p>
      ) : (
        <>
          <p style={{ color: C.tan, fontSize: '0.9rem', margin: '0 0 0.8rem' }}>Enter your time clock PIN.</p>
          <input
            type="password" inputMode="numeric" pattern="[0-9]*" autoComplete="off" autoFocus maxLength={4} value={pin} disabled={busy}
            aria-label="PIN"
            onChange={e => {
              const v = e.target.value.replace(/\D/g, '').slice(0, 4)
              setPin(v)
              if (v.length === 4) submit(v)
            }}
            style={{ width: 160, textAlign: 'center', letterSpacing: '0.5em', background: C.darkBrown, color: C.cream, border: `1px solid ${C.medBrown}`, borderRadius: 8, padding: '0.8rem 0.5rem', fontSize: '1.6rem' }}
          />
          {busy && <div style={{ color: C.tan, fontSize: '0.85rem', marginTop: '0.6rem' }}>Checking…</div>}
          {err && <div style={{ color: C.red, fontSize: '0.9rem', marginTop: '0.6rem' }}>{err}</div>}
        </>
      )}
      <div style={{ marginTop: '1rem' }}>
        <button style={{ ...btn('transparent'), border: `1px solid ${C.medBrown}`, color: C.tan }} onClick={() => { setPicked(null); setPin(''); setErr('') }}>← Not you? Back to names</button>
      </div>
    </div>
  )
}

// ── The shelf ───────────────────────────────────────────────────────────────

function DocList({ docs, onOpen }: { docs: HrDocSummary[] | null; onOpen: (id: string) => void }) {
  if (docs === null) return <div style={{ color: C.tan, textAlign: 'center', padding: '2rem' }}>Loading…</div>
  if (docs.length === 0) return <div style={{ ...card, color: C.tan }}>Nothing has been published for you yet. Check back, or ask Charlie.</div>
  const waiting = docs.filter(d => !d.acknowledgedAt).length
  return (
    <>
      <p style={{ color: waiting ? C.amber : C.green, fontSize: '0.9rem', margin: '0 0 0.8rem' }}>
        {waiting ? `${waiting} document${waiting === 1 ? '' : 's'} waiting for you to read and acknowledge.` : 'You\'re up to date on everything.'}
      </p>
      {docs.map(d => (
        <button key={d.id} onClick={() => onOpen(d.id)} style={{ ...card, display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer' }}>
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'baseline', flexWrap: 'wrap' }}>
            <span style={{ fontFamily: 'Georgia, serif', fontSize: '1.1rem', fontWeight: 700, color: C.cream }}>{d.title}</span>
            <span style={{ fontSize: '0.72rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              {d.audience === 'everyone' ? 'Everyone' : 'Your role'}
            </span>
          </div>
          <div style={{ fontSize: '0.82rem', marginTop: '0.3rem', color: d.acknowledgedAt ? C.green : C.amber }}>
            {d.acknowledgedAt ? `✓ You acknowledged this ${dayMT(d.acknowledgedAt)}` : '● Needs your acknowledgment'}
            <span style={{ color: C.lightBrown }}> · Version {d.version}, {dayMT(d.publishedAt)}</span>
          </div>
        </button>
      ))}
    </>
  )
}

// ── One document ────────────────────────────────────────────────────────────

function DocView({ doc, name, onAcknowledge }: { doc: HrDoc; name: string; onAcknowledge: () => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const [printErr, setPrintErr] = useState('')
  // Safe to inject: renderMarkdown escapes the document and adds only its own tags.
  const html = useMemo(() => renderMarkdown(doc.body), [doc.body])
  const versionLine = `Version ${doc.version} · published ${dayMT(doc.publishedAt)}`

  const print = () => {
    const ok = openPrint(buildPrintHTML({
      title: doc.title, body: doc.body, versionLine,
      acks: doc.acknowledgedAt ? [{ name, acknowledgedAt: doc.acknowledgedAt }] : undefined,
    }))
    setPrintErr(ok ? '' : 'Your browser blocked the printout. Allow pop-ups for this site and try again.')
  }

  return (
    <div style={card}>
      <style>{docCss('.hr-doc', C.cream, C.tan, 'rgba(166,120,90,0.4)')}</style>
      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 260px' }}>
          <div style={{ fontFamily: 'Georgia, serif', fontSize: '1.4rem', fontWeight: 700, color: C.cream }}>{doc.title}</div>
          <div style={{ fontSize: '0.78rem', color: C.lightBrown }}>{versionLine}</div>
        </div>
        <button style={{ ...btn('transparent'), border: `1px solid ${C.medBrown}`, color: C.tan }} onClick={print}>Print / PDF</button>
      </div>
      {printErr && <div style={{ color: C.red, fontSize: '0.85rem', marginTop: '0.5rem' }}>{printErr}</div>}
      <hr style={{ border: 'none', borderTop: '1px solid rgba(166,120,90,0.3)', margin: '0.9rem 0' }} />
      <div className="hr-doc" dangerouslySetInnerHTML={{ __html: html }} />
      <hr style={{ border: 'none', borderTop: '1px solid rgba(166,120,90,0.3)', margin: '1.2rem 0 1rem' }} />
      {doc.acknowledgedAt ? (
        <div style={{ color: C.green, fontSize: '0.95rem' }}>
          ✓ {name} acknowledged version {doc.version} on {stampMT(doc.acknowledgedAt)}.
        </div>
      ) : (
        <div>
          <p style={{ color: C.tan, fontSize: '0.9rem', margin: '0 0 0.7rem', lineHeight: 1.5 }}>
            By tapping the button, I ({name}) confirm I have read this document and understand it. Questions go to Charlie before I tap.
          </p>
          <button style={bigBtn(C.green)} disabled={busy} onClick={async () => { setBusy(true); try { await onAcknowledge() } finally { setBusy(false) } }}>
            {busy ? 'Saving…' : 'I\'ve read this'}
          </button>
        </div>
      )}
    </div>
  )
}
