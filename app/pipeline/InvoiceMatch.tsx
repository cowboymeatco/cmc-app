'use client'
// Match an animal to its QuickBooks invoice(s) by hand. The page used to find
// invoices by spelling only, so a fair steer invoiced to its buyer or a
// customer spelled differently in QBO read "not invoiced" long after it was
// settled (Charlie, 2026-09-14). A person ticks the right invoice once; it's
// stored on the appointment and wins from then on. /api/pipeline/invoice-match.

import { useCallback, useEffect, useState } from 'react'

const C = {
  dark: '#1A0A04', darkBrown: '#351E0E', lightBrown: '#A6785A', tan: '#C9A882', cream: '#F2E8D9', green: '#4CAF50', yellow: '#D97706', red: '#EF4444',
}

interface Candidate {
  id: string; doc_number: string; customer_id: string; customer_name: string
  txn_date: string; total: number; balance: number; score: number
  linked_here: boolean; linked_to: string | null
}
interface Payload {
  appointment: {
    id: string; account: string; customers: string[]; species: string | null; head_count: number | null
    harvest_date: string | null; names: string[]; sessions: { customer_name: string; session_date: string; status: string }[]
    no_invoice_reason: string | null
  }
  candidates: Candidate[]
  error?: string
}

const money = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const REASONS = ['Our own animal', 'Resale — we bought it', 'Donated', 'Other']

export default function InvoiceMatch({ appointmentId, onClose, onSaved }: { appointmentId: string; onClose: () => void; onSaved: () => void }) {
  const [q, setQ] = useState('')
  const [data, setData] = useState<Payload | null>(null)
  const [err, setErr] = useState('')
  const [picked, setPicked] = useState<Map<string, Candidate>>(new Map())
  const [pickedUp, setPickedUp] = useState(false)
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback((query: string) => {
    setErr('')
    fetch(`/api/pipeline/invoice-match?appointment=${encodeURIComponent(appointmentId)}${query ? `&q=${encodeURIComponent(query)}` : ''}`)
      .then(r => r.json())
      .then((d: Payload) => { if (d.error) setErr(d.error); else setData(d) })
      .catch(() => setErr('Could not load'))
  }, [appointmentId])

  useEffect(() => { load('') }, [load])
  useEffect(() => {
    if (!q.trim()) return
    const t = setTimeout(() => load(q.trim()), 350)
    return () => clearTimeout(t)
  }, [q, load])

  const toggle = (c: Candidate) => setPicked(prev => {
    const next = new Map(prev)
    if (next.has(c.id)) next.delete(c.id); else next.set(c.id, c)
    return next
  })

  const save = async (extra: Record<string, unknown> = {}) => {
    setSaving(true)
    try {
      const res = await fetch('/api/pipeline/invoice-match', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appointment_id: appointmentId,
          invoices: [...picked.values()].map(c => ({ id: c.id, doc_number: c.doc_number, customer_id: c.customer_id, customer_name: c.customer_name })),
          picked_up: pickedUp,
          ...extra,
        }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { setErr(d.error ?? 'Save failed'); return }
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  const unlink = async (c: Candidate) => {
    await fetch(`/api/pipeline/invoice-match?appointment=${encodeURIComponent(appointmentId)}&invoice=${encodeURIComponent(c.id)}`, { method: 'DELETE' })
    load(q.trim())
  }

  const a = data?.appointment
  const pickedTotal = [...picked.values()].reduce((s, c) => s + c.total, 0)

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: C.darkBrown, border: '1px solid rgba(166,120,90,0.4)', borderRadius: 6, width: '100%', maxWidth: 640, maxHeight: '92vh', overflowY: 'auto', padding: '1.1rem 1.25rem' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.6rem', marginBottom: '0.3rem' }}>
          <h2 style={{ margin: 0, fontFamily: 'Georgia, serif', color: C.cream, fontSize: '1.05rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Match invoice</h2>
          <button onClick={onClose} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: C.lightBrown, fontSize: '1.1rem', cursor: 'pointer' }}>✕</button>
        </div>
        {a && (
          <div style={{ color: C.lightBrown, fontSize: '0.78rem', marginBottom: '0.7rem', lineHeight: 1.45 }}>
            <strong style={{ color: C.cream }}>{a.account}</strong> · {a.species}{a.head_count && a.head_count > 1 ? ` ×${a.head_count}` : ''}{a.harvest_date ? ` · killed ${a.harvest_date}` : ''}
            <br />Looking for: {a.names.join(' · ')}
            {a.no_invoice_reason && <><br /><span style={{ color: C.yellow }}>Marked no invoice needed — {a.no_invoice_reason}</span>{' '}
              <button onClick={() => save({ no_invoice_reason: null })} style={{ background: 'none', border: 'none', color: C.tan, fontSize: '0.74rem', cursor: 'pointer', textDecoration: 'underline' }}>undo</button></>}
          </div>
        )}

        <input value={q} onChange={e => { setQ(e.target.value); if (!e.target.value.trim()) load('') }} placeholder="Search QuickBooks — buyer, customer, or invoice #"
          style={{ width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(166,120,90,0.4)', borderRadius: 3, padding: '0.5rem 0.65rem', color: C.cream, fontSize: '0.88rem', outline: 'none', marginBottom: '0.5rem' }} />

        {err && <div style={{ color: '#FCA5A5', fontSize: '0.8rem', marginBottom: '0.5rem' }}>{err}</div>}
        {!data && !err && <div style={{ color: C.lightBrown, fontSize: '0.82rem' }}>Reading QuickBooks…</div>}
        {data && !data.candidates.length && (
          <div style={{ color: C.lightBrown, fontSize: '0.8rem', padding: '0.5rem 0' }}>
            {q ? 'No invoices match that search.' : 'No invoice looks like this animal by name — search for the buyer or the invoice number.'}
          </div>
        )}

        {data && data.candidates.length > 0 && (
          <div style={{ border: '1px solid rgba(166,120,90,0.25)', borderRadius: 4, background: C.dark }}>
            {data.candidates.map(c => {
              const on = picked.has(c.id)
              return (
                <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.45rem 0.65rem', borderBottom: '1px solid rgba(166,120,90,0.12)', opacity: c.linked_to ? 0.5 : 1 }}>
                  {c.linked_here
                    ? <button onClick={() => unlink(c)} title="Unlink" style={{ background: 'none', border: `1px solid ${C.green}`, color: C.green, borderRadius: 3, fontSize: '0.68rem', padding: '0.1rem 0.35rem', cursor: 'pointer' }}>linked ✕</button>
                    : <input type="checkbox" checked={on} disabled={!!c.linked_to} onChange={() => toggle(c)} style={{ width: 17, height: 17, accentColor: C.tan, cursor: c.linked_to ? 'not-allowed' : 'pointer' }} />}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: C.cream, fontSize: '0.86rem' }}>#{c.doc_number} · {c.customer_name}</div>
                    <div style={{ color: C.lightBrown, fontSize: '0.7rem' }}>
                      {c.txn_date} · {money(c.total)} · {c.balance > 0.005 ? <span style={{ color: C.yellow }}>{money(c.balance)} due</span> : <span style={{ color: C.green }}>paid</span>}
                      {c.linked_to ? ' · already matched to another animal' : ''}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.75rem', color: C.cream, fontSize: '0.85rem', cursor: 'pointer' }}>
          <input type="checkbox" checked={pickedUp} onChange={e => setPickedUp(e.target.checked)} style={{ width: 17, height: 17, accentColor: C.tan }} />
          They&apos;ve picked up — close it out{a?.sessions.length ? ` (${a.sessions.filter(s => s.status !== 'picked_up').length} open session${a.sessions.filter(s => s.status !== 'picked_up').length !== 1 ? 's' : ''})` : ''}
        </label>

        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '0.8rem', flexWrap: 'wrap' }}>
          <button disabled={saving || (!picked.size && !pickedUp)} onClick={() => save()}
            style={{ background: picked.size || pickedUp ? C.tan : 'rgba(166,120,90,0.3)', color: C.dark, border: 'none', borderRadius: 4, padding: '0.55rem 1rem', fontSize: '0.86rem', fontWeight: 700, cursor: picked.size || pickedUp ? 'pointer' : 'not-allowed' }}>
            {saving ? 'Saving…' : picked.size ? `Link ${picked.size} invoice${picked.size !== 1 ? 's' : ''} (${money(pickedTotal)})${pickedUp ? ' + close out' : ''}` : pickedUp ? 'Close it out' : 'Tick the invoice(s)'}
          </button>
          <span style={{ marginLeft: 'auto', color: C.lightBrown, fontSize: '0.76rem' }}>No invoice for this one?</span>
          <select value={reason} onChange={e => setReason(e.target.value)}
            style={{ background: C.dark, border: '1px solid rgba(166,120,90,0.4)', borderRadius: 3, color: C.cream, fontSize: '0.78rem', padding: '0.3rem' }}>
            <option value="">Why…</option>
            {REASONS.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          <button disabled={!reason || saving} onClick={() => save({ no_invoice_reason: reason })}
            style={{ background: 'transparent', border: `1px solid ${reason ? C.yellow : 'rgba(166,120,90,0.3)'}`, color: reason ? C.yellow : C.lightBrown, borderRadius: 3, padding: '0.35rem 0.6rem', fontSize: '0.78rem', cursor: reason ? 'pointer' : 'not-allowed' }}>
            No invoice needed
          </button>
        </div>
      </div>
    </div>
  )
}
