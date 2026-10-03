'use client'
import { useCallback, useEffect, useState } from 'react'

// The Clover Capital advance on /billing: where it stands, and the form to
// re-enter the Clover dashboard's numbers (Finances → Clover Capital) when
// they move. Clover's API can't read the advance, so a person is the feed —
// see lib/cloverCapital. The 5:00 PM register close email carries it forward.

const C = { dark: '#1A0A04', lightBrown: '#A6785A', tan: '#C9A882', cream: '#F2E8D9', green: '#4CAF50', red: '#E53E3E', yellow: '#D97706' }
const CARD: React.CSSProperties = { background: C.dark, border: '1px solid rgba(166,120,90,0.25)', borderRadius: 4, padding: '1rem 1.25rem', marginBottom: '1rem' }
const INPUT: React.CSSProperties = {
  background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(166,120,90,0.35)', borderRadius: 3,
  padding: '0.4rem 0.6rem', color: C.cream, fontSize: '0.83rem', outline: 'none', width: '100%', boxSizing: 'border-box',
}
const LABEL: React.CSSProperties = { color: C.lightBrown, fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: '0.2rem' }

interface Advance {
  advance_number: string; advance_cents: number; payback_cents: number; funded_date: string | null
  holdback_rate: number; last_payment_date: string; paid_cents: number; balance_cents: number
  closed_date: string | null; updated_by: string | null; updated_at: string
}
interface Status {
  pending: { from: string; to: string; days: number; holdbackCents: number; missing: string[] }
  estBalanceCents: number
  pace: { perDayCents: number; days: number } | null
  payoffDate: string | null
}
interface Form { advanceNumber: string; advanceDollars: string; fundedDate: string; lastPaymentDate: string; paidDollars: string; balanceDollars: string; closedDate: string }

const $ = (c: number) => `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const day = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
const dollars = (c: number) => (c / 100).toFixed(2)

export default function CloverCapitalCard() {
  const [advance, setAdvance] = useState<Advance | null>(null)
  const [status, setStatus] = useState<Status | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<Form>({ advanceNumber: '', advanceDollars: '', fundedDate: '', lastPaymentDate: '', paidDollars: '', balanceDollars: '', closedDate: '' })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/clover/capital')
      const json = await res.json()
      if (!res.ok || json.error) throw new Error(json.error ?? 'Load failed')
      setAdvance(json.advance)
      setStatus(json.status)
      const a: Advance | null = json.advance
      if (a) setForm({
        advanceNumber: a.advance_number, advanceDollars: dollars(a.advance_cents), fundedDate: a.funded_date ?? '',
        lastPaymentDate: a.last_payment_date, paidDollars: dollars(a.paid_cents), balanceDollars: dollars(a.balance_cents), closedDate: a.closed_date ?? '',
      })
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : String(e), ok: false })
    } finally {
      setLoaded(true)
    }
  }, [])
  // eslint-disable-next-line react-hooks/set-state-in-effect -- one fetch after mount; state is set once it answers
  useEffect(() => { load() }, [load])

  async function save() {
    setBusy(true); setMsg(null)
    try {
      const res = await fetch('/api/clover/capital', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
      const json = await res.json()
      if (!res.ok || json.error) throw new Error(json.error ?? 'Save failed')
      setAdvance(json.advance); setStatus(json.status); setEditing(false)
      setMsg({ text: 'Saved — tonight\'s register close email will use these figures.', ok: true })
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : String(e), ok: false })
    } finally {
      setBusy(false)
    }
  }

  const field = (key: keyof Form, label: string, type: 'text' | 'date' = 'text') => (
    <label style={{ display: 'block' }}>
      <span style={LABEL}>{label}</span>
      <input type={type} value={form[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} style={INPUT} />
    </label>
  )

  return (
    <div style={CARD}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.5rem' }}>
        <div>
          <div style={{ color: C.tan, fontWeight: 700, fontSize: '0.95rem' }}>
            Clover Capital{advance && status && (
              <span style={{ color: status.estBalanceCents > 0 ? C.yellow : C.green, fontWeight: 400, marginLeft: '0.5rem' }}>
                {status.estBalanceCents > 0 ? `${$(status.estBalanceCents)} to go` : 'paid off?'}
              </span>
            )}
          </div>
          <div style={{ color: C.lightBrown, fontSize: '0.78rem' }}>
            The advance as the Clover dashboard shows it (Finances → Clover Capital). Clover&apos;s API can&apos;t read it, so
            type the figures here when they move; the nightly register close email carries them forward from each day&apos;s card batch.
          </div>
          {msg && <div style={{ color: msg.ok ? C.green : C.red, fontSize: '0.78rem', marginTop: '0.3rem' }}>{msg.text}</div>}
        </div>
        {!editing && (
          <button onClick={() => { setEditing(true); setMsg(null) }}
            style={{ background: C.tan, color: C.dark, border: 'none', borderRadius: 3, padding: '0.5rem 1.1rem', fontSize: '0.83rem', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
            {advance ? 'Update from dashboard' : 'Enter the advance'}
          </button>
        )}
      </div>

      {!loaded ? (
        <div style={{ color: C.lightBrown, fontSize: '0.83rem' }}>Loading…</div>
      ) : !editing && !advance ? (
        <div style={{ color: C.lightBrown, fontSize: '0.83rem' }}>No advance entered yet.</div>
      ) : !editing && advance ? (
        <div style={{ fontSize: '0.83rem', color: C.cream, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.5rem 1.5rem' }}>
          <div><span style={LABEL}>Balance due, per Clover</span>{$(advance.balance_cents)} <span style={{ color: C.lightBrown }}>through its {day(advance.last_payment_date)} payout</span></div>
          <div><span style={LABEL}>Paid so far</span>{$(advance.paid_cents)} of {$(advance.payback_cents)} <span style={{ color: C.lightBrown }}>({((advance.paid_cents / advance.payback_cents) * 100).toFixed(1)}%)</span></div>
          {status && status.pending.days > 0 && (
            <div><span style={LABEL}>Card batches on the way</span>{$(status.pending.holdbackCents)} held back <span style={{ color: C.lightBrown }}>{day(status.pending.from)} – {day(status.pending.to)}</span>
              {status.pending.missing.length > 0 && <div style={{ color: C.yellow }}>not read yet: {status.pending.missing.map(day).join(', ')}</div>}
            </div>
          )}
          <div><span style={LABEL}>Pays off about</span>{status?.payoffDate ? day(status.payoffDate) : <span style={{ color: C.lightBrown }}>after a week of card days is on record</span>}
            {status?.pace && <div style={{ color: C.lightBrown }}>{$(status.pace.perDayCents)}/day over {status.pace.days} days</div>}
          </div>
          <div style={{ gridColumn: '1 / -1', color: C.lightBrown, fontSize: '0.75rem' }}>
            Advance {advance.advance_number}: {$(advance.advance_cents)}{advance.funded_date ? ` funded ${day(advance.funded_date)}` : ''}, {Math.round(advance.holdback_rate * 100)}% of each card batch.
            {advance.updated_by ? ` Entered by ${advance.updated_by}.` : ''}
          </div>
        </div>
      ) : (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '0.6rem 1rem', maxWidth: 760 }}>
            {field('advanceNumber', 'Advance number')}
            {field('advanceDollars', 'Advance amount ($)')}
            {field('fundedDate', 'Date funded', 'date')}
            {field('lastPaymentDate', 'Last payment date', 'date')}
            {field('paidDollars', 'Total paid to date ($)')}
            {field('balanceDollars', 'Total balance due ($)')}
            {field('closedDate', 'Closed date (if paid off)', 'date')}
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.7rem', alignItems: 'center' }}>
            <button onClick={save} disabled={busy}
              style={{ background: C.green, color: C.dark, border: 'none', borderRadius: 3, padding: '0.5rem 1.1rem', fontSize: '0.83rem', fontWeight: 600, cursor: 'pointer' }}>
              {busy ? 'Saving…' : 'Save'}
            </button>
            <button onClick={() => { setEditing(false); setMsg(null); load() }} disabled={busy}
              style={{ background: 'transparent', color: C.lightBrown, border: '1px solid rgba(166,120,90,0.35)', borderRadius: 3, padding: '0.5rem 1.1rem', fontSize: '0.83rem', cursor: 'pointer' }}>
              Cancel
            </button>
            <span style={{ color: C.lightBrown, fontSize: '0.75rem' }}>Copy the figures as the dashboard shows them; whole dollars are fine.</span>
          </div>
        </div>
      )}
    </div>
  )
}
