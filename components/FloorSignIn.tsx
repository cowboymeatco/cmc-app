'use client'
// Tap your name, enter your time clock PIN — the handbook's sign-in, for the
// carcass QR page and the staging list. Same roster, same check, same
// lockout (five wrong PINs in 15 minutes locks that person out everywhere).

import { useEffect, useState } from 'react'
import { C, api, bigBtn, btn, card, h2 } from '@/app/timekeeping/shared'
import { FloorSession, saveFloorSession } from '@/lib/floorSession'

interface RosterEntry { id: string; name: string; needsSetup: boolean }

export default function FloorSignIn({ why, onDone, onCancel }: { why?: string; onDone: (s: FloorSession) => void; onCancel?: () => void }) {
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
      const r = await api<{ token: string; employee: { id: string; name: string } }>('/api/handbook/session', {
        method: 'POST', body: JSON.stringify({ employeeId: picked.id, pin: value }),
      })
      onDone(saveFloorSession({ token: r.token, id: r.employee.id, name: r.employee.name }))
    } catch (e) {
      setErr((e as Error).message); setPin('')
    } finally { setBusy(false) }
  }

  const cancel = onCancel && (
    <div style={{ marginTop: '1rem' }}>
      <button style={{ ...btn('transparent'), border: `1px solid ${C.medBrown}`, color: C.tan }} onClick={onCancel}>Cancel</button>
    </div>
  )

  if (!picked) {
    return (
      <div style={card}>
        <h2 style={h2}>Tap your name</h2>
        {why && <p style={{ color: C.tan, fontSize: '0.9rem', margin: '0 0 0.8rem' }}>{why}</p>}
        {err && <p style={{ color: C.red, fontSize: '0.9rem', margin: '0 0 0.8rem' }}>{err}</p>}
        {roster === null && !err && <div style={{ color: C.tan }}>Loading…</div>}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '0.6rem' }}>
          {roster?.map(r => (
            <button key={r.id} style={bigBtn(C.medBrown)} onClick={() => { setPicked(r); setPin(''); setErr('') }}>{r.name}</button>
          ))}
        </div>
        {cancel}
      </div>
    )
  }

  return (
    <div style={{ ...card, maxWidth: 380, margin: '0 auto 1rem', textAlign: 'center' }}>
      <h2 style={h2}>{picked.name}</h2>
      {picked.needsSetup ? (
        <p style={{ color: C.tan, fontSize: '0.95rem', lineHeight: 1.5 }}>
          You don&apos;t have a PIN yet. Pick one at the time clock iPad first, then come back.
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
      <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem', justifyContent: 'center' }}>
        <button style={{ ...btn('transparent'), border: `1px solid ${C.medBrown}`, color: C.tan }} onClick={() => { setPicked(null); setPin(''); setErr('') }}>← Back to names</button>
        {onCancel && <button style={{ ...btn('transparent'), border: `1px solid ${C.medBrown}`, color: C.tan }} onClick={onCancel}>Cancel</button>}
      </div>
    </div>
  )
}
