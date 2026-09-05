'use client'
import { useEffect, useState, useCallback, useSyncExternalStore } from 'react'
import Link from 'next/link'

// Shared furniture for the cleaning module.
//
// Every design decision in here answers the same question: this is a phone,
// held in a wet glove, in a loud room, at ten at night, by someone who wants to
// finish and go home. So: big targets, high contrast, no hover-only affordances,
// and no destructive action that takes fewer than two taps.

export const C = {
  dark:       '#1A0A04',
  darkBrown:  '#351E0E',
  medBrown:   '#75471B',
  lightBrown: '#A6785A',
  tan:        '#C9A882',
  cream:      '#F2E8D9',
  green:      '#4CAF50',
  red:        '#EF4444',
  amber:      '#F59E0B',
  blue:       '#60A5FA',
} as const

/** Minimum comfortable target for a gloved thumb. */
export const TAP = 56

// ── Who's using the phone ───────────────────────────────────────────────

export interface CrewMember { id: string; name: string; role: 'crew' | 'lead' }

const CREW_KEY = 'cleaningCrewMember'

// localStorage is an external store, so it's read through useSyncExternalStore
// rather than copied into state inside an effect. That keeps two tabs on the
// same phone in agreement about who is signed in, and avoids the cascading
// render that reading it in an effect would cause.
//
// The snapshot is cached against its raw string because useSyncExternalStore
// compares snapshots by identity: parsing fresh every call would return a new
// object each time and re-render forever.
const listeners = new Set<() => void>()
let rawCache:    string | null = null
let valueCache:  CrewMember | null = null

function readCrew(): CrewMember | null {
  let raw: string | null = null
  try { raw = localStorage.getItem(CREW_KEY) } catch { /* private browsing */ }
  if (raw !== rawCache) {
    rawCache = raw
    try { valueCache = raw ? (JSON.parse(raw) as CrewMember) : null }
    catch { valueCache = null }
  }
  return valueCache
}

/** Server render has no device to remember anything. */
function readCrewOnServer(): CrewMember | null { return null }

function subscribeCrew(cb: () => void) {
  listeners.add(cb)
  // 'storage' only fires in OTHER tabs, which is why writes also notify locally.
  window.addEventListener('storage', cb)
  return () => { listeners.delete(cb); window.removeEventListener('storage', cb) }
}

/**
 * The signed-in crew member, remembered on the device.
 *
 * Deliberately not a server session: there is no password to protect, and a
 * cookie that expires mid-shift would put a sign-in wall between someone and
 * the checkbox they're trying to tap. The name is stamped onto every row at
 * write time, so the record doesn't depend on this surviving.
 */
export function useCrewMember() {
  const member = useSyncExternalStore(subscribeCrew, readCrew, readCrewOnServer)

  const setMember = useCallback((m: CrewMember | null) => {
    try {
      if (m) localStorage.setItem(CREW_KEY, JSON.stringify(m))
      else   localStorage.removeItem(CREW_KEY)
    } catch { /* private browsing — the pick just won't outlive the tab */ }
    rawCache = null            // force the next read to re-parse
    listeners.forEach(l => l())
  }, [])

  return { member, setMember }
}

/** Full-screen roster picker. Shown until somebody says who they are. */
export function CrewPicker({ onPick, onCancel }: {
  onPick: (m: CrewMember) => void
  onCancel?: () => void
}) {
  const [crew,    setCrew]    = useState<CrewMember[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/cleaning/crew')
      .then(r => r.json())
      .then(d => setCrew(Array.isArray(d) ? d : []))
      .catch(() => setCrew([]))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div style={{ padding: 20, maxWidth: 520, margin: '0 auto' }}>
      <h2 style={{ color: C.cream, fontSize: 22, marginBottom: 6 }}>Who&apos;s this?</h2>
      <p style={{ color: C.tan, fontSize: 14, marginBottom: 20 }}>
        Tap your name so the work gets recorded under it.
      </p>

      {loading && <p style={{ color: C.lightBrown }}>Loading…</p>}

      {!loading && crew.length === 0 && (
        <div style={{
          background: C.darkBrown, border: `1px solid ${C.medBrown}`,
          borderRadius: 10, padding: 16, color: C.tan, fontSize: 14,
        }}>
          Nobody&apos;s on the roster yet.{' '}
          <Link href="/cleaning/admin" style={{ color: C.amber }}>Add the crew</Link>{' '}
          before the first shift.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {crew.map(m => (
          <button
            key={m.id}
            onClick={() => onPick(m)}
            style={{
              minHeight:    TAP,
              background:   C.darkBrown,
              border:       `2px solid ${C.medBrown}`,
              borderRadius: 10,
              color:        C.cream,
              fontSize:     18,
              fontWeight:   600,
              textAlign:    'left',
              padding:      '0 18px',
              cursor:       'pointer',
            }}
          >
            {m.name}
            {m.role === 'lead' && (
              <span style={{ color: C.amber, fontSize: 12, marginLeft: 10 }}>LEAD</span>
            )}
          </button>
        ))}
      </div>

      {onCancel && (
        <button
          onClick={onCancel}
          style={{
            marginTop: 20, background: 'none', border: 'none',
            color: C.lightBrown, fontSize: 14, cursor: 'pointer',
          }}
        >
          Cancel
        </button>
      )}
    </div>
  )
}

// ── Chrome ──────────────────────────────────────────────────────────────

export function CleaningHeader({ title, back, member, onSwitch }: {
  title: string
  back?: string
  member?: CrewMember | null
  onSwitch?: () => void
}) {
  return (
    <header style={{
      background:   C.dark,
      borderBottom: `1px solid ${C.medBrown}`,
      padding:      '12px 16px',
      display:      'flex',
      alignItems:   'center',
      gap:          12,
      position:     'sticky',
      top:          0,
      zIndex:       50,
    }}>
      {back && (
        <Link href={back} style={{
          color: C.tan, fontSize: 26, textDecoration: 'none',
          lineHeight: 1, padding: '4px 8px 8px 0',
        }}>
          ‹
        </Link>
      )}
      <h1 style={{ color: C.cream, fontSize: 18, fontWeight: 700, flex: 1, margin: 0 }}>
        {title}
      </h1>
      {member && (
        <button
          onClick={onSwitch}
          style={{
            background:   'none',
            border:       `1px solid ${C.medBrown}`,
            borderRadius: 20,
            color:        C.tan,
            fontSize:     13,
            padding:      '6px 12px',
            cursor:       onSwitch ? 'pointer' : 'default',
            whiteSpace:   'nowrap',
          }}
        >
          {member.name}
        </button>
      )}
    </header>
  )
}

export function ProgressBar({ pct, tone = C.green }: { pct: number; tone?: string }) {
  return (
    <div style={{
      height: 8, background: C.dark, borderRadius: 4, overflow: 'hidden', width: '100%',
    }}>
      <div style={{
        height: '100%', width: `${Math.min(100, Math.max(0, pct))}%`,
        background: tone, transition: 'width 0.3s',
      }} />
    </div>
  )
}

export function Banner({ tone, children }: {
  tone: 'error' | 'warn' | 'ok' | 'info'
  children: React.ReactNode
}) {
  const color = { error: C.red, warn: C.amber, ok: C.green, info: C.blue }[tone]
  return (
    <div style={{
      background:   `${color}22`,
      border:       `1px solid ${color}`,
      borderRadius: 8,
      padding:      '10px 14px',
      color:        C.cream,
      fontSize:     14,
      margin:       '0 0 14px',
    }}>
      {children}
    </div>
  )
}

/** Primary action. Full width, thumb-sized, never ambiguous about its state. */
export function BigButton({ label, onClick, tone = C.medBrown, disabled, type = 'button' }: {
  label:     React.ReactNode
  onClick?:  () => void
  tone?:     string
  disabled?: boolean
  type?:     'button' | 'submit'
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      style={{
        width:        '100%',
        minHeight:    TAP,
        background:   disabled ? C.darkBrown : tone,
        border:       `1px solid ${disabled ? C.medBrown : tone}`,
        borderRadius: 10,
        color:        C.cream,
        fontSize:     17,
        fontWeight:   700,
        cursor:       disabled ? 'default' : 'pointer',
        opacity:      disabled ? 0.5 : 1,
      }}
    >
      {label}
    </button>
  )
}

export const inputStyle: React.CSSProperties = {
  width:        '100%',
  minHeight:    48,
  background:   C.dark,
  border:       `1px solid ${C.medBrown}`,
  borderRadius: 8,
  color:        C.cream,
  padding:      '10px 12px',
  fontSize:     16,   // 16px or iOS zooms the whole page on focus
  fontFamily:   'inherit',
  outline:      'none',
}

export const cardStyle: React.CSSProperties = {
  background:   C.darkBrown,
  border:       `1px solid ${C.medBrown}`,
  borderRadius: 12,
  padding:      14,
}

/** Camera/library picker that hands back the uploaded URL. */
export function PhotoButton({ label, onUploaded, extra, disabled }: {
  label:      string
  onUploaded: (url: string, raw: Record<string, unknown>) => void
  /** Extra form fields — shift_id, shift_item_id, kind, taken_by. */
  extra?:     Record<string, string | undefined>
  disabled?:  boolean
}) {
  const [busy, setBusy]   = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function upload(file: File) {
    setBusy(true)
    setError(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      for (const [k, v] of Object.entries(extra ?? {})) if (v) fd.append(k, v)

      const res  = await fetch('/api/cleaning/photo', { method: 'POST', body: fd })
      const body = await res.json()
      if (!res.ok) { setError(body?.error ?? 'Upload failed'); return }
      onUploaded(body.url, body)
    } catch {
      setError('Upload failed — check your signal.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <label style={{
        display:      'flex',
        alignItems:   'center',
        justifyContent: 'center',
        gap:          8,
        minHeight:    48,
        background:   C.dark,
        border:       `1px dashed ${C.medBrown}`,
        borderRadius: 8,
        color:        busy ? C.lightBrown : C.tan,
        fontSize:     15,
        cursor:       disabled || busy ? 'default' : 'pointer',
        opacity:      disabled ? 0.5 : 1,
      }}>
        📷 {busy ? 'Uploading…' : label}
        <input
          type="file"
          accept="image/*"
          // Opens the camera directly on a phone instead of the file browser.
          capture="environment"
          disabled={disabled || busy}
          style={{ display: 'none' }}
          onChange={e => {
            const f = e.target.files?.[0]
            if (f) upload(f)
            e.target.value = ''   // same file twice in a row still fires
          }}
        />
      </label>
      {error && <div style={{ color: C.red, fontSize: 13, marginTop: 6 }}>{error}</div>}
    </div>
  )
}

/**
 * Clip picker for a procedure step.
 *
 * The file never passes through the app: we ask the server for a signed URL and
 * PUT the bytes straight at storage. That is not an optimisation — the API
 * routes run on the edge, where the body cap is a few megabytes, and any clip
 * worth filming is bigger than that.
 *
 * `capture` is deliberately absent. A photo is nearly always taken on the spot,
 * so PhotoButton opens the camera; a clip of the auger going back in is usually
 * one somebody already shot, and forcing the camera would hide it.
 */
export function VideoButton({ label, onUploaded, disabled, kind }: {
  label:      string
  onUploaded: (url: string, path: string) => void
  disabled?:  boolean
  /** Where the clip belongs — a procedure step (default) or a reported issue. */
  kind?:      'reference' | 'issue'
}) {
  const [busy, setBusy]     = useState(false)
  const [error, setError]   = useState<string | null>(null)

  async function upload(file: File) {
    setBusy(true)
    setError(null)
    try {
      const signRes = await fetch('/api/cleaning/video', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, size: file.size, type: file.type, kind }),
      })
      const sign = await signRes.json()
      if (!signRes.ok) { setError(sign?.error ?? 'Upload failed'); return }

      const put = await fetch(sign.upload_url, {
        method:  'PUT',
        headers: { 'Content-Type': file.type || 'video/mp4' },
        body:    file,
      })
      // The signed URL talks to storage directly, so a rejection here is the
      // bucket's, not ours — say which of the two failed rather than a flat
      // "upload failed" that sends someone looking in the wrong place.
      if (!put.ok) { setError('Storage turned the clip away — try a shorter one.'); return }

      onUploaded(sign.url, sign.path)
    } catch {
      setError('Upload failed — check your signal.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <label style={{
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'center',
        gap:            8,
        minHeight:      48,
        background:     C.dark,
        border:         `1px dashed ${C.medBrown}`,
        borderRadius:   8,
        color:          busy ? C.lightBrown : C.tan,
        fontSize:       15,
        cursor:         disabled || busy ? 'default' : 'pointer',
        opacity:        disabled ? 0.5 : 1,
      }}>
        🎥 {busy ? 'Uploading… hold on' : label}
        <input
          type="file"
          accept="video/*"
          disabled={disabled || busy}
          style={{ display: 'none' }}
          onChange={e => {
            const f = e.target.files?.[0]
            if (f) upload(f)
            e.target.value = ''   // same file twice in a row still fires
          }}
        />
      </label>
      {error && <div style={{ color: C.red, fontSize: 13, marginTop: 6 }}>{error}</div>}
    </div>
  )
}

/**
 * A step's clip, played in place.
 *
 * `preload="metadata"` matters more here than it looks: a procedure can carry a
 * dozen steps, and preloading them all would pull a few hundred megabytes over
 * shop wifi to show a screen somebody scrolls past. `playsInline` keeps iOS from
 * throwing it fullscreen the moment it starts.
 */
export function StepVideo({ src, style }: { src: string; style?: React.CSSProperties }) {
  return (
    <video
      src={src}
      controls
      playsInline
      preload="metadata"
      style={{
        width: '100%', marginTop: 10, borderRadius: 8, display: 'block',
        border: `1px solid ${C.medBrown}`, background: '#000',
        ...style,
      }}
    />
  )
}
