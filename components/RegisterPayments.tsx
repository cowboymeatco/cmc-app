'use client'

import { useCallback, useEffect, useState } from 'react'
import { addDaysISO, dateLabel, isoDate } from '@/lib/dates'
import type { RingUpPaymentDecision } from '@/lib/ringUpPayments'

// Invoice tickets paid at the register → QuickBooks Receive Payment.
// Shows, for one shop day, what the app records (or in test mode WOULD record)
// against each invoice, what it skips and what it leaves for a person.
// Test mode writes nothing: this card is how a test day is checked against the
// register. See lib/ringUpPayments.

const C = {
  dark: '#1A0A04', lightBrown: '#A6785A', tan: '#C9A882',
  cream: '#F2E8D9', green: '#4CAF50', red: '#E53E3E', yellow: '#D97706',
}
const CARD: React.CSSProperties = {
  background: C.dark, border: '1px solid rgba(166,120,90,0.25)',
  borderRadius: 4, padding: '1rem 1.25rem', marginBottom: '1rem',
}
const TH: React.CSSProperties = {
  textAlign: 'left', fontSize: '0.7rem', color: C.lightBrown, textTransform: 'uppercase',
  letterSpacing: '0.1em', padding: '0.4rem 0.6rem', borderBottom: '1px solid rgba(166,120,90,0.25)',
}
const TD: React.CSSProperties = { padding: '0.4rem 0.6rem', fontSize: '0.8rem', color: C.cream, verticalAlign: 'top' }
const BTN: React.CSSProperties = {
  background: C.tan, color: C.dark, border: 'none', borderRadius: 3,
  padding: '0.35rem 0.8rem', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer',
}

interface Plan {
  date: string
  live: boolean
  postingFrom: string | null
  decisions: RingUpPaymentDecision[]
  error?: string
}

const ACTION_LABEL = { record: 'Record', skip: 'Skip', flag: 'Needs a person' } as const
const ACTION_COLOR = { record: C.green, skip: C.lightBrown, flag: C.yellow } as const

export default function RegisterPayments() {
  const [date, setDate] = useState(isoDate())
  const [plan, setPlan] = useState<Plan | null>(null)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [reads, setReads] = useState(0) // bump to re-read the same day

  // Reading a day is one Clover call per order, so it only happens on open,
  // on a day change and on Refresh. State is set only when the read returns.
  useEffect(() => {
    let alive = true
    fetch(`/api/clover/ringup-payments?date=${date}`)
      .then(res => res.json())
      .catch(e => ({ date, live: false, postingFrom: null, decisions: [], error: e instanceof Error ? e.message : String(e) }))
      .then((p: Plan) => { if (alive) { setPlan(p); setLoading(false) } })
    return () => { alive = false }
  }, [date, reads])

  const reread = useCallback((d: string) => {
    setLoading(true); setNote(null)
    if (d === date) setReads(n => n + 1)
    else setDate(d)
  }, [date])
  const load = reread

  const recordNow = async () => {
    setRunning(true); setNote(null)
    try {
      const res = await fetch('/api/clover/ringup-payments', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date }),
      })
      const r = await res.json()
      if (!res.ok) setNote(r.message ?? r.error ?? 'Failed')
      else setNote(r.live ? `Recorded ${r.recorded.length}${r.errors.length ? `, ${r.errors.length} failed` : ''}.` : 'Test mode: nothing recorded.')
      setLoading(true)
      setReads(n => n + 1)
    } finally {
      setRunning(false)
    }
  }

  const money = (c: number) => `$${(c / 100).toFixed(2)}`
  const rows = plan?.decisions ?? []
  const toRecord = rows.filter(r => r.action === 'record')

  return (
    <div style={CARD}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div>
          <div style={{ color: C.tan, fontWeight: 700, fontSize: '0.95rem' }}>Register payments → QuickBooks</div>
          <div style={{ color: C.lightBrown, fontSize: '0.75rem', marginTop: 2 }}>
            Invoice tickets paid at the register, recorded as Receive Payment into Undeposited Funds.
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
          <button style={BTN} onClick={() => load(addDaysISO(date, -1))}>‹</button>
          <span style={{ color: C.cream, fontSize: '0.8rem', minWidth: 110, textAlign: 'center' }}>{dateLabel(date)}</span>
          <button style={BTN} onClick={() => load(addDaysISO(date, 1))} disabled={date >= isoDate()}>›</button>
          <button style={BTN} onClick={() => load(date)} disabled={loading}>{loading ? 'Reading…' : 'Refresh'}</button>
          {plan?.live && toRecord.length > 0 && (
            <button style={{ ...BTN, background: C.green }} onClick={recordNow} disabled={running}>{running ? 'Recording…' : 'Record now'}</button>
          )}
        </div>
      </div>

      {plan && !plan.live && (
        <div style={{ marginTop: '0.6rem', padding: '0.4rem 0.6rem', border: `1px solid ${C.yellow}`, color: C.yellow, fontSize: '0.78rem', borderRadius: 3 }}>
          Test mode{plan.postingFrom ? ` (live from ${plan.postingFrom})` : ''}: this shows what the app would record. Nothing is written to QuickBooks.
        </div>
      )}
      {note && <div style={{ marginTop: '0.5rem', color: C.cream, fontSize: '0.8rem' }}>{note}</div>}
      {plan?.error && <div style={{ marginTop: '0.5rem', color: C.red, fontSize: '0.8rem' }}>{plan.error}</div>}

      {plan && !plan.error && (rows.length === 0 ? (
        <div style={{ marginTop: '0.75rem', color: C.lightBrown, fontSize: '0.8rem' }}>No invoice tickets paid at the register this day.</div>
      ) : (
        <div style={{ overflowX: 'auto', marginTop: '0.75rem' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={TH}>Invoice</th><th style={TH}>Customer</th><th style={TH}>Tender</th>
                <th style={{ ...TH, textAlign: 'right' }}>Register took</th><th style={{ ...TH, textAlign: 'right' }}>Records</th>
                <th style={TH}>{plan.live ? 'Action' : 'Would'}</th><th style={TH}>Why</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={`${r.key}:${r.action}`}>
                  <td style={TD}>{r.docNumber || '—'}</td>
                  <td style={TD}>{r.customerName ?? '—'}</td>
                  <td style={TD}>{r.tenderLabel}</td>
                  <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace' }}>{money(r.paidCents)}</td>
                  <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace' }}>{r.action === 'record' ? money(r.amountCents) : '—'}</td>
                  <td style={{ ...TD, color: ACTION_COLOR[r.action], fontWeight: 600 }}>{ACTION_LABEL[r.action]}</td>
                  <td style={{ ...TD, color: C.lightBrown }}>{r.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  )
}
