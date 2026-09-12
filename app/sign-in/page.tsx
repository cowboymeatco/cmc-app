'use client'
import { useEffect, useRef, useState } from 'react'

// The one door into the office app (see proxy.ts). Deliberately plain: it is
// typed on a scanner tablet with cold hands, so it is one field, one button,
// and a session long enough that nobody meets it twice in a season.
//
// `next` is read off window.location rather than useSearchParams so this page
// still prerenders without a Suspense boundary around it.

const C = {
  dark:       '#1A0A04',
  darkBrown:  '#351E0E',
  medBrown:   '#75471B',
  lightBrown: '#A6785A',
  cream:      '#F2E8D9',
}

export default function SignIn() {
  const [pass,  setPass]  = useState('')
  const [busy,  setBusy]  = useState(false)
  const [error, setError] = useState('')
  const next = useRef('/')

  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get('next')
    // Only ever bounce back into this app — an absolute URL here would make
    // the sign-in page an open redirect.
    if (raw && raw.startsWith('/') && !raw.startsWith('//')) next.current = raw
  }, [])

  async function submit() {
    if (!pass.trim() || busy) return
    setBusy(true); setError('')
    try {
      const res = await fetch('/api/staff/session', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ pass: pass.trim() }),
      })
      if (res.ok) {
        // Hard navigation, not a router push: the cookie has to be on the
        // request the server renders the next page from.
        window.location.href = next.current
        return
      }
      setError((await res.json().catch(() => ({}))).error ?? 'Could not sign in')
    } catch {
      setError('Request failed')
    }
    setBusy(false)
  }

  return (
    <div style={{
      minHeight: '100vh', background: C.darkBrown,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem',
    }}>
      <div style={{
        background: C.dark, border: '1px solid rgba(166,120,90,0.3)', borderRadius: 4,
        padding: '2rem', width: '100%', maxWidth: 380,
      }}>
        <h1 style={{
          fontFamily: 'Georgia, serif', fontSize: '1.1rem', fontWeight: 700, color: C.cream,
          textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 0.25rem',
        }}>
          Cowboy Meat Co
        </h1>
        <div style={{
          fontSize: '0.72rem', color: C.lightBrown, textTransform: 'uppercase',
          letterSpacing: '0.15em', marginBottom: '1.25rem',
        }}>
          Shop passphrase
        </div>

        <input
          type="password" value={pass} autoFocus
          onChange={e => setPass(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && submit()}
          placeholder="Passphrase"
          style={{
            width: '100%', boxSizing: 'border-box', background: C.darkBrown, color: C.cream,
            border: '1px solid rgba(166,120,90,0.4)', borderRadius: 4,
            padding: '0.7rem 0.9rem', fontSize: '1rem', marginBottom: '0.75rem',
          }}
        />
        <button onClick={submit} disabled={busy} style={{
          width: '100%', background: C.medBrown, border: 'none', borderRadius: 4,
          color: C.cream, fontSize: '0.9rem', fontWeight: 600, padding: '0.7rem',
          cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.7 : 1,
        }}>
          {busy ? 'Checking…' : 'Open the app'}
        </button>

        {error && <div style={{ color: '#E8883A', fontSize: '0.8rem', marginTop: '0.75rem' }}>{error}</div>}

        <p style={{ color: C.lightBrown, fontSize: '0.72rem', lineHeight: 1.5, marginTop: '1.25rem', marginBottom: 0 }}>
          One passphrase for the whole shop. This device stays signed in — you
          shouldn&apos;t see this screen again.
        </p>
      </div>
    </div>
  )
}
