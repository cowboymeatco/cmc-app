'use client'
import { useEffect, useState, useCallback } from 'react'
import { dateLabel } from '@/lib/dates'
import { C, useCrewMember, CleaningHeader, Banner, BigButton, inputStyle, cardStyle } from '../ui'

// Supplies: what's low, what's out, and what's already been ordered.
//
// Two halves on one screen because they're one thought — a crew member opens
// this to say "we're low on foam" and Jill opens it to see the list. Splitting
// them into separate screens would just mean a tap between them.

interface Supply { id: string; name: string; unit: string | null; vendor: string | null }

interface Request {
  id: string
  created_at: string
  name_text: string
  qty: string | null
  urgency: 'normal' | 'out'
  requested_by: string
  note: string | null
  status: 'open' | 'ordered' | 'received' | 'cancelled'
}

export default function SuppliesPage() {
  const { member } = useCrewMember()
  const [supplies, setSupplies] = useState<Supply[]>([])
  const [requests, setRequests] = useState<Request[]>([])
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState<string | null>(null)
  const [asking,   setAsking]   = useState(false)

  const load = useCallback(() => {
    Promise.allSettled([
      fetch('/api/cleaning/supplies').then(r => r.json()),
      fetch('/api/cleaning/supply-requests?status=open').then(r => r.json()),
    ]).then(([s, r]) => {
      if (s.status === 'fulfilled' && Array.isArray(s.value)) setSupplies(s.value)
      if (r.status === 'fulfilled' && Array.isArray(r.value)) setRequests(r.value)
      setLoading(false)
    })
  }, [])

  useEffect(() => { load() }, [load])

  async function handle(req: Request, action: string) {
    const res = await fetch('/api/cleaning/supply-requests', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ id: req.id, action, by: member?.name }),
    })
    if (!res.ok) {
      const body = await res.json()
      setError(body?.error ?? "That didn't work.")
      return
    }
    load()
  }

  return (
    <div style={{ paddingBottom: 60 }}>
      <CleaningHeader title="Supplies" back="/cleaning" member={member} />

      <div style={{ padding: 16, maxWidth: 720, margin: '0 auto' }}>
        {error && <Banner tone="error">{error}</Banner>}

        {!asking && (
          <div style={{ marginBottom: 20 }}>
            <BigButton label="+ Request a supply" onClick={() => setAsking(true)} />
          </div>
        )}

        {asking && (
          <RequestForm
            supplies={supplies}
            defaultName={member?.name}
            onDone={() => { setAsking(false); load() }}
            onCancel={() => setAsking(false)}
          />
        )}

        {loading && <p style={{ color: C.tan }}>Loading…</p>}

        {!loading && requests.length === 0 && !asking && (
          <div style={{ ...cardStyle, textAlign: 'center', color: C.tan }}>
            Nothing requested right now.
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {requests.map(req => (
            <div
              key={req.id}
              style={{
                ...cardStyle,
                borderColor: req.urgency === 'out' ? C.red : C.medBrown,
              }}
            >
              <div style={{
                display: 'flex', justifyContent: 'space-between',
                alignItems: 'flex-start', gap: 10,
              }}>
                <div style={{ flex: 1 }}>
                  <div style={{ color: C.cream, fontSize: 16, fontWeight: 600 }}>
                    {req.name_text}
                    {req.qty && <span style={{ color: C.tan, fontWeight: 400 }}> · {req.qty}</span>}
                  </div>
                  <div style={{ color: C.tan, fontSize: 12, marginTop: 3 }}>
                    {req.requested_by} · {dateLabel(req.created_at.slice(0, 10), { month: 'short', day: 'numeric' })}
                    {req.status === 'ordered' && (
                      <span style={{ color: C.blue }}> · ordered</span>
                    )}
                  </div>
                  {req.note && (
                    <div style={{ color: C.lightBrown, fontSize: 13, marginTop: 4 }}>{req.note}</div>
                  )}
                </div>
                {req.urgency === 'out' && (
                  <span style={{
                    fontSize: 11, fontWeight: 700, color: C.red,
                    border: `1px solid ${C.red}`, borderRadius: 4,
                    padding: '2px 6px', whiteSpace: 'nowrap',
                  }}>
                    OUT
                  </span>
                )}
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                {req.status === 'open' && (
                  <button
                    onClick={() => handle(req, 'ordered')}
                    style={{
                      flex: 1, minHeight: 44, background: C.dark,
                      border: `1px solid ${C.blue}`, borderRadius: 8,
                      color: C.blue, fontSize: 14, cursor: 'pointer',
                    }}
                  >
                    Ordered
                  </button>
                )}
                <button
                  onClick={() => handle(req, 'received')}
                  style={{
                    flex: 1, minHeight: 44, background: C.dark,
                    border: `1px solid ${C.green}`, borderRadius: 8,
                    color: C.green, fontSize: 14, cursor: 'pointer',
                  }}
                >
                  Got it
                </button>
                <button
                  onClick={() => handle(req, 'cancelled')}
                  style={{
                    minHeight: 44, background: C.dark, padding: '0 14px',
                    border: `1px solid ${C.medBrown}`, borderRadius: 8,
                    color: C.lightBrown, fontSize: 14, cursor: 'pointer',
                  }}
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function RequestForm({ supplies, defaultName, onDone, onCancel }: {
  supplies: Supply[]
  defaultName?: string
  onDone: () => void
  onCancel: () => void
}) {
  const [supplyId, setSupplyId] = useState('')
  const [freeText, setFreeText] = useState('')
  const [qty,      setQty]      = useState('')
  const [out,      setOut]      = useState(false)
  const [name,     setName]     = useState(defaultName ?? '')
  const [note,     setNote]     = useState('')
  const [error,    setError]    = useState<string | null>(null)
  const [busy,     setBusy]     = useState(false)

  const ready = Boolean((supplyId || freeText.trim()) && name.trim())

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/cleaning/supply-requests', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          supply_id:    supplyId || undefined,
          name_text:    freeText.trim() || undefined,
          qty:          qty.trim() || undefined,
          urgency:      out ? 'out' : 'normal',
          requested_by: name.trim(),
          note:         note.trim() || undefined,
        }),
      })
      const body = await res.json()
      if (!res.ok) { setError(body?.error ?? "That didn't send."); return }
      onDone()
    } catch {
      setError('No connection.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ ...cardStyle, marginBottom: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {error && <Banner tone="error">{error}</Banner>}

      {supplies.length > 0 && (
        <select
          value={supplyId}
          onChange={e => { setSupplyId(e.target.value); if (e.target.value) setFreeText('') }}
          style={inputStyle}
        >
          <option value="">— pick a supply —</option>
          {supplies.map(s => (
            <option key={s.id} value={s.id}>
              {s.name}{s.unit ? ` (${s.unit})` : ''}
            </option>
          ))}
        </select>
      )}

      <input
        value={freeText}
        onChange={e => { setFreeText(e.target.value); if (e.target.value) setSupplyId('') }}
        placeholder={supplies.length ? '…or type something else' : 'What do you need?'}
        style={inputStyle}
      />

      <input
        value={qty}
        onChange={e => setQty(e.target.value)}
        placeholder="How much? (e.g. 2 cases)"
        style={inputStyle}
      />

      {/* "Out" is the one that pages someone, so it's a deliberate toggle
          rather than a dropdown option that gets picked by accident. */}
      <button
        onClick={() => setOut(!out)}
        style={{
          minHeight: 52, borderRadius: 8, cursor: 'pointer',
          background: out ? C.red : C.dark,
          border: `1px solid ${out ? C.red : C.medBrown}`,
          color: C.cream, fontSize: 15, fontWeight: out ? 700 : 400,
        }}
      >
        {out ? '🚨 We are OUT — texts right away' : 'We are completely out'}
      </button>

      {!defaultName && (
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Your name"
          style={inputStyle}
        />
      )}

      <textarea
        value={note}
        onChange={e => setNote(e.target.value)}
        placeholder="Anything else? (optional)"
        rows={2}
        style={{ ...inputStyle, resize: 'vertical' }}
      />

      <BigButton label={busy ? 'Sending…' : 'Send request'} onClick={submit} disabled={!ready || busy} />
      <button
        onClick={onCancel}
        style={{
          background: 'none', border: 'none', color: C.lightBrown,
          fontSize: 14, cursor: 'pointer', minHeight: 40,
        }}
      >
        Cancel
      </button>
    </div>
  )
}
