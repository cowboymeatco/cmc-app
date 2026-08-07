'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import InvoiceSlips, { SlipInvoice } from '@/components/InvoiceSlips'

// Billing: producer -> QuickBooks customer recognition (phase 1), then
// billable events review + accumulating invoices (next phases).
// Producers come from harvest_log.producer; links live in producer_qbo_links.

const C = {
  dark:       '#1A0A04',
  medBrown:   '#75471B',
  lightBrown: '#A6785A',
  tan:        '#C9A882',
  cream:      '#F2E8D9',
  green:      '#4CAF50',
  red:        '#E53E3E',
  yellow:     '#D97706',
}
const BTN = (bg: string, color = C.dark): React.CSSProperties => ({
  background: bg, color, border: 'none', borderRadius: 3,
  padding: '0.5rem 1.1rem', fontSize: '0.83rem', fontWeight: 600,
  cursor: 'pointer', letterSpacing: '0.04em',
})
const CARD: React.CSSProperties = {
  background: C.dark, border: '1px solid rgba(166,120,90,0.25)',
  borderRadius: 4, padding: '1rem 1.25rem', marginBottom: '1rem',
}
const TH: React.CSSProperties = {
  textAlign: 'left', fontSize: '0.7rem', color: C.lightBrown, textTransform: 'uppercase',
  letterSpacing: '0.1em', padding: '0.4rem 0.6rem', borderBottom: '1px solid rgba(166,120,90,0.25)',
}
const TD: React.CSSProperties = {
  padding: '0.45rem 0.6rem', fontSize: '0.83rem', color: C.cream,
  borderBottom: '1px solid rgba(166,120,90,0.12)',
}

interface Producer { name: string; harvestCount: number }
interface BillableEvent {
  id: string
  service_date: string
  rule_key: string
  customer_name: string
  qbo_customer_id: string
  description: string
  qty: number
  unit: string
  rate: number
  amount: number
}
interface EventsData {
  events: BillableEvent[]
  totals: {
    amount: number
    byDay: { day: string; amount: number }[]
    byCustomer: { name: string; amount: number }[]
  }
}
interface OpenInvoiceRow {
  id: string
  docNumber: string
  customerName: string
  balance: number
  balanceCents: number
  txnDate: string
  dueDate: string | null
  onRegister: boolean
}
interface RingUpData {
  invoices: OpenInvoiceRow[]
  ordersError?: string
}
interface SweepDecision {
  orderId: string
  docNumber: string
  title: string
  amountCents: number | null
  action: 'remove' | 'keep'
  reason: string
}
interface SweepLogRow {
  created_at: string
  doc_number: string
  title: string
  amount_cents: number | null
  action: string
  reason: string
  status: string
  error: string
  triggered_by: string
}
interface SyncDecision {
  docNumber: string
  customerName: string
  title: string
  amountCents: number
  action: 'create' | 'update' | 'skip'
  reason: string
  orderId?: string
}
interface SweepData {
  wouldRemove: SweepDecision[]
  wouldKeep: SweepDecision[]
  wouldCreate: SyncDecision[]
  wouldUpdate: SyncDecision[]
  needsPerson: SyncDecision[]
  history: SweepLogRow[]
}
interface QboCust { qbo_id: string; display_name: string; company_name?: string | null; phone?: string | null; balance: number | null }
interface LinksData {
  linked: { producer: Producer; qbo: QboCust }[]
  suggestions: { producer: Producer; qbo: QboCust; confidence: string }[]
  unmatched: Producer[]
  syncedAt: string | null
}

export default function BillingPage() {
  const [data, setData] = useState<LinksData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState<string | null>(null)

  // manual picker
  const [pickerFor, setPickerFor] = useState<Producer | null>(null)
  const [pickerSearch, setPickerSearch] = useState('')
  const [pickerResults, setPickerResults] = useState<QboCust[]>([])

  // charges
  const [charges, setCharges] = useState<EventsData | null>(null)
  const [detecting, setDetecting] = useState(false)
  const [detectMsg, setDetectMsg] = useState<string | null>(null)
  const [eventBusy, setEventBusy] = useState<string | null>(null)

  // ring up at register
  const [ringUp, setRingUp] = useState<RingUpData | null>(null)
  const [ringSearch, setRingSearch] = useState('')
  const [ringBusy, setRingBusy] = useState<string | null>(null)
  const [ringMsg, setRingMsg] = useState<string | null>(null)

  // barcode slips — set = render + print, cleared when the print dialog closes
  const [slips, setSlips] = useState<SlipInvoice[] | null>(null)
  const slipsDone = useCallback(() => setSlips(null), [])
  const ringFilter = useCallback((invoices: OpenInvoiceRow[]) => {
    const q = ringSearch.trim().toLowerCase()
    return q
      ? invoices.filter(i => i.customerName.toLowerCase().includes(q) || i.docNumber.toLowerCase().includes(q))
      : invoices
  }, [ringSearch])

  // register cleanup
  const [sweep, setSweep] = useState<SweepData | null>(null)
  const [sweeping, setSweeping] = useState(false)
  const [sweepMsg, setSweepMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const [custRes, evRes, ringRes, sweepRes] = await Promise.all([
        fetch('/api/qbo/customers'),
        fetch('/api/billing/events'),
        fetch('/api/clover/ring-up'),
        fetch('/api/clover/reconcile'),
      ])
      const json = await custRes.json()
      if (!custRes.ok || json.error) throw new Error(json.error ?? 'Load failed')
      setData(json)
      const ev = await evRes.json()
      if (evRes.ok && !ev.error) setCharges(ev)
      const ru = await ringRes.json()
      if (ringRes.ok && !ru.error) setRingUp(ru)
      const sw = await sweepRes.json()
      if (sweepRes.ok && !sw.error) setSweep(sw)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  async function syncNow() {
    setSweeping(true)
    setSweepMsg(null)
    try {
      // Two requests, not one: doing both phases server-side blew the function
      // timeout on a populated register, so each phase gets its own budget.
      const post = async (phase: string) => {
        const res = await fetch('/api/clover/reconcile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phase }),
        })
        const json = await res.json()
        if (!res.ok || json.error) throw new Error(json.error ?? `${phase} failed`)
        return json
      }
      const sync = await post('sync')
      const sweep = await post('sweep')
      const json = { ...sync, removed: sweep.removed, errors: [...(sync.errors ?? []), ...(sweep.errors ?? [])] }

      const parts: string[] = []
      if (json.created?.length) parts.push(`${json.created.length} added`)
      if (json.updated?.length) parts.push(`${json.updated.length} amount(s) corrected`)
      if (json.removed?.length) parts.push(`${json.removed.length} removed`)
      if (json.deferred) parts.push(`${json.deferred} left — press again to continue`)
      if (json.errors?.length) parts.push(`${json.errors.length} failed`)
      setSweepMsg(parts.length ? `Register synced — ${parts.join(', ')}.` : 'Register already up to date.')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
    setSweeping(false)
  }

  // Push one invoice to the register as a pre-labelled open order. The amount
  // is re-read from QuickBooks server-side, so what rings is the balance now.
  //
  // The duplicate check is the server's, not this page's: it asks Clover at the
  // moment of the press and answers 409 if an order is already waiting. The
  // confirm below is the only way past it, so a stale flag or a slow Clover read
  // can no longer turn repeated presses into repeated orders.
  async function sendToRegister(inv: OpenInvoiceRow) {
    setRingBusy(inv.id)
    setRingMsg(null)
    try {
      const post = (force: boolean) => fetch('/api/clover/ring-up', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceId: inv.id, force }),
      })
      let res = await post(false)
      let json = await res.json()
      if (res.status === 409) {
        const already = (json.alreadyOnRegister ?? []).length
        if (!confirm(
          `${json.error}\n\n` +
          `Send it again? That leaves ${already + 1} open orders for the same invoice ` +
          `and the counter can ring the customer up twice.`
        )) { setRingBusy(null); return }
        res = await post(true)
        json = await res.json()
      }
      if (!res.ok || json.error) throw new Error(json.error ?? 'Send failed')
      setRingMsg(`✓ ${json.title} — $${Number(json.amount).toFixed(2)} is on the register. Pull it up under Open Orders.`)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
    setRingBusy(null)
  }

  async function detect() {
    setDetecting(true)
    setDetectMsg(null)
    try {
      const res = await fetch('/api/billing/detect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      const json = await res.json()
      if (!res.ok || json.error) throw new Error(json.error ?? 'Detect failed')
      setDetectMsg(`Scanned ${json.scanned} harvests since ${json.since}: ${json.created} new charge(s), ${json.alreadyDetected} already detected.`
        + (json.unbillable.length ? ` ⚠ ${json.unbillable.length} unbillable: ${json.unbillable.slice(0, 3).join('; ')}${json.unbillable.length > 3 ? '…' : ''}` : ''))
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
    setDetecting(false)
  }

  async function skipEvent(ev: BillableEvent, restore = false) {
    setEventBusy(ev.id)
    await fetch('/api/billing/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: restore ? 'restore' : 'skip', id: ev.id }),
    })
    await load()
    setEventBusy(null)
  }

  useEffect(() => { load() }, [load])

  // debounce the picker search against the 8.8k-customer cache
  useEffect(() => {
    if (!pickerFor) return
    const t = setTimeout(async () => {
      const res = await fetch(`/api/qbo/customers?search=${encodeURIComponent(pickerSearch)}`)
      const json = await res.json()
      setPickerResults(json.results ?? [])
    }, 250)
    return () => clearTimeout(t)
  }, [pickerSearch, pickerFor])

  async function act(action: string, body: Record<string, unknown>, busyKey: string) {
    setBusy(busyKey)
    try {
      const res = await fetch('/api/qbo/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...body }),
      })
      const json = await res.json()
      if (!res.ok || json.error) throw new Error(json.error ?? `${action} failed`)
      setPickerFor(null)
      setPickerSearch('')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
    setBusy(null)
  }

  async function sync() {
    setSyncing(true)
    setSyncMsg(null)
    try {
      const res = await fetch('/api/qbo/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sync' }),
      })
      const json = await res.json()
      if (!res.ok || json.error) throw new Error(json.error ?? 'Sync failed')
      setSyncMsg(`Refreshed ${json.count} QuickBooks customers (${json.active} active).`)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
    setSyncing(false)
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--dark-brown)', display: 'flex', flexDirection: 'column' }}>
      <header style={{ background: 'var(--dark)', borderBottom: '1px solid rgba(166,120,90,0.3)', padding: '0 2rem', height: 64, display: 'flex', alignItems: 'center', gap: '1rem', flexShrink: 0 }}>
        <Link href="/" style={{ color: C.lightBrown, textDecoration: 'none', fontSize: '0.82rem' }}>← Dashboard</Link>
        <span style={{ color: 'rgba(166,120,90,0.4)' }}>|</span>
        <h1 style={{ fontFamily: 'Georgia, serif', fontSize: '1.1rem', fontWeight: 700, color: C.cream, letterSpacing: '0.08em', textTransform: 'uppercase', margin: 0 }}>Billing</h1>
      </header>

      <main style={{ flex: 1, padding: '1.5rem 2rem', maxWidth: 1100, width: '100%', margin: '0 auto', boxSizing: 'border-box' }}>
        {error && (
          <div style={{ ...CARD, borderColor: C.red, color: C.red, fontSize: '0.85rem' }}>
            {error} <button onClick={() => { setError(null); load() }} style={{ ...BTN('transparent', C.red), border: `1px solid ${C.red}`, marginLeft: '1rem', padding: '0.2rem 0.6rem' }}>Retry</button>
          </div>
        )}

        {/* ── Ring up at register ────────────────────────────────────── */}
        <div style={CARD}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem', flexWrap: 'wrap', gap: '0.5rem' }}>
            <div>
              <div style={{ color: C.tan, fontWeight: 700, fontSize: '0.95rem' }}>
                Ring Up at Register{ringUp && ringUp.invoices.length > 0 && (
                  <span style={{ color: C.yellow, fontWeight: 400, marginLeft: '0.5rem' }}>
                    {ringUp.invoices.length} unpaid · ${ringUp.invoices.reduce((s, i) => s + i.balance, 0).toFixed(2)}
                  </span>
                )}
              </div>
              <div style={{ color: C.lightBrown, fontSize: '0.78rem' }}>
                Sends an open QuickBooks invoice to Clover as a labelled order — name, invoice # and amount already
                rung up, so the counter is one tap.
              </div>
              {ringMsg && <div style={{ color: C.green, fontSize: '0.78rem', marginTop: '0.3rem' }}>{ringMsg}</div>}
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <input
                value={ringSearch}
                onChange={e => setRingSearch(e.target.value)}
                placeholder="Search name or invoice #…"
                style={{
                  background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(166,120,90,0.35)',
                  borderRadius: 3, padding: '0.45rem 0.7rem', color: C.cream, fontSize: '0.85rem',
                  outline: 'none', minWidth: 220,
                }}
              />
              {ringUp && ringFilter(ringUp.invoices).length > 0 && (
                <button
                  onClick={() => setSlips(ringFilter(ringUp.invoices))}
                  title="Print a barcode slip for each invoice listed below — scan it into the Clover order search"
                  style={{ ...BTN(C.tan), whiteSpace: 'nowrap' }}>
                  🖨 Slips ({ringFilter(ringUp.invoices).length})
                </button>
              )}
            </div>
          </div>

          {ringUp?.ordersError && (
            <div style={{ color: C.red, fontSize: '0.78rem', marginBottom: '0.5rem' }}>
              Clover orders unreachable — {ringUp.ordersError}
            </div>
          )}

          {!ringUp ? (
            <div style={{ color: C.lightBrown, fontSize: '0.83rem' }}>Loading open invoices…</div>
          ) : ringUp.invoices.length === 0 ? (
            <div style={{ color: C.lightBrown, fontSize: '0.83rem' }}>No unpaid invoices in QuickBooks.</div>
          ) : (() => {
            const rows = ringFilter(ringUp.invoices)
            if (rows.length === 0) {
              return <div style={{ color: C.lightBrown, fontSize: '0.83rem' }}>No open invoice matches “{ringSearch}”.</div>
            }
            return (
              <div style={{ maxHeight: 340, overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr>
                    <th style={TH}>Customer</th><th style={TH}>Invoice</th><th style={TH}>Dated</th>
                    <th style={TH}>Balance</th><th style={TH}></th>
                  </tr></thead>
                  <tbody>
                    {rows.map(inv => (
                      <tr key={inv.id}>
                        <td style={TD}>
                          {inv.customerName}
                          {inv.onRegister && (
                            <span title="Already waiting on the register" style={{ color: C.green, marginLeft: '0.4rem', fontSize: '0.72rem' }}>
                              ● on register
                            </span>
                          )}
                        </td>
                        <td style={{ ...TD, fontFamily: 'monospace', color: C.lightBrown }}>{inv.docNumber}</td>
                        <td style={{ ...TD, fontFamily: 'monospace', color: C.lightBrown }}>{inv.txnDate}</td>
                        <td style={{ ...TD, color: C.yellow, fontFamily: 'monospace' }}>${inv.balance.toFixed(2)}</td>
                        <td style={{ ...TD, textAlign: 'right', whiteSpace: 'nowrap' }}>
                          <button onClick={() => setSlips([inv])}
                            title="Print a barcode slip — scan it into the Clover order search"
                            style={{ ...BTN('transparent', C.lightBrown), border: '1px solid rgba(166,120,90,0.35)',
                              padding: '0.3rem 0.6rem', fontSize: '0.76rem', marginRight: '0.4rem' }}>
                            🖨
                          </button>
                          <button onClick={() => sendToRegister(inv)} disabled={ringBusy === inv.id}
                            style={{ ...BTN(inv.onRegister ? 'transparent' : C.green, inv.onRegister ? C.lightBrown : C.dark),
                              border: inv.onRegister ? '1px solid rgba(166,120,90,0.35)' : 'none',
                              padding: '0.3rem 0.8rem', fontSize: '0.76rem', whiteSpace: 'nowrap' }}>
                            {ringBusy === inv.id ? 'Sending…' : inv.onRegister ? 'Send again' : '→ Send to Register'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          })()}
        </div>

        {/* ── Register cleanup ───────────────────────────────────────── */}
        <div style={CARD}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem', flexWrap: 'wrap', gap: '0.5rem' }}>
            <div>
              <div style={{ color: C.tan, fontWeight: 700, fontSize: '0.95rem' }}>
                Register Sync
                {sweep && (sweep.wouldCreate.length + sweep.wouldUpdate.length + sweep.wouldRemove.length) > 0 && (
                  <span style={{ color: C.yellow, fontWeight: 400, marginLeft: '0.5rem' }}>
                    {[
                      sweep.wouldCreate.length && `${sweep.wouldCreate.length} to add`,
                      sweep.wouldUpdate.length && `${sweep.wouldUpdate.length} to correct`,
                      sweep.wouldRemove.length && `${sweep.wouldRemove.length} to remove`,
                    ].filter(Boolean).join(' · ')}
                  </span>
                )}
              </div>
              <div style={{ color: C.lightBrown, fontSize: '0.78rem' }}>
                Runs itself at 5am. Every open invoice gets an order waiting on the register, amounts are
                corrected when a balance moves, and orders are pulled once the invoice is marked paid in
                QuickBooks. Paid orders and anything a cashier added are never touched.
              </div>
              {sweepMsg && <div style={{ color: C.green, fontSize: '0.78rem', marginTop: '0.3rem' }}>{sweepMsg}</div>}
            </div>
            <button onClick={syncNow} disabled={sweeping} style={BTN(C.tan)}>
              {sweeping ? 'Syncing…' : '⟳ Sync register now'}
            </button>
          </div>

          {!sweep ? (
            <div style={{ color: C.lightBrown, fontSize: '0.83rem' }}>Checking the register…</div>
          ) : (
            <>
              {sweep.wouldCreate.length === 0 && sweep.wouldUpdate.length === 0 &&
               sweep.wouldRemove.length === 0 && sweep.needsPerson.length === 0 && (
                <div style={{ color: C.green, fontSize: '0.83rem' }}>
                  Register is in sync with QuickBooks — nothing to add, correct or remove.
                </div>
              )}

              {(sweep.wouldCreate.length > 0 || sweep.wouldUpdate.length > 0) && (
                <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '0.6rem' }}>
                  <thead><tr>
                    <th style={TH}>Pending</th><th style={TH}>Invoice</th><th style={TH}>Amount</th><th style={TH}>Why</th>
                  </tr></thead>
                  <tbody>
                    {[...sweep.wouldCreate, ...sweep.wouldUpdate].map(d => (
                      <tr key={`${d.action}-${d.docNumber}`}>
                        <td style={{ ...TD, color: d.action === 'create' ? C.green : C.yellow }}>
                          {d.action === 'create' ? 'add' : 'correct'}
                        </td>
                        <td style={TD}>{d.title}</td>
                        <td style={{ ...TD, fontFamily: 'monospace' }}>${(d.amountCents / 100).toFixed(2)}</td>
                        <td style={{ ...TD, fontSize: '0.78rem', color: C.lightBrown }}>{d.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {sweep.needsPerson.length > 0 && (
                <div style={{ fontSize: '0.78rem', color: C.yellow, marginBottom: '0.5rem' }}>
                  <div style={{ marginBottom: '0.25rem' }}>⚠ Needs a person ({sweep.needsPerson.length}) — left untouched:</div>
                  {sweep.needsPerson.map(d => (
                    <div key={d.docNumber} style={{ paddingLeft: '0.6rem', color: C.lightBrown }}>
                      <span style={{ color: C.cream }}>{d.title}</span> — {d.reason}
                    </div>
                  ))}
                  {/* Charlie asked what to do about one of these: Tana Cates bought a
                      summer sausage when she picked up her hog, so the register ticket
                      no longer matches the invoice. Nothing is broken — say so here,
                      where the situation actually shows up. */}
                  <div style={{ paddingLeft: '0.6rem', marginTop: '0.35rem', color: C.lightBrown, fontStyle: 'italic' }}>
                    Something was rung onto the order at the counter, so it no longer matches the
                    invoice on its own. That ticket is the sale of record — take it as it stands,
                    and the invoice is settled in QuickBooks the usual way. Nothing here needs
                    fixing in the app; the sync just won&apos;t touch an order someone is working on.
                  </div>
                </div>
              )}

              {sweep.wouldRemove.length > 0 && (
                <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '0.6rem' }}>
                  <thead><tr>
                    <th style={TH}>Ready to remove</th><th style={TH}>Amount</th><th style={TH}>Why</th>
                  </tr></thead>
                  <tbody>
                    {sweep.wouldRemove.map(d => (
                      <tr key={d.orderId}>
                        <td style={TD}>{d.title}</td>
                        <td style={{ ...TD, fontFamily: 'monospace', color: C.yellow }}>
                          {d.amountCents != null ? `$${(d.amountCents / 100).toFixed(2)}` : '—'}
                        </td>
                        <td style={{ ...TD, fontSize: '0.78rem', color: C.lightBrown }}>{d.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {sweep.wouldKeep.length > 0 && (
                <div style={{ fontSize: '0.78rem', color: C.lightBrown }}>
                  <div style={{ marginBottom: '0.25rem' }}>Left alone ({sweep.wouldKeep.length}):</div>
                  {sweep.wouldKeep.map(d => (
                    <div key={d.orderId} style={{ paddingLeft: '0.6rem' }}>
                      <span style={{ color: C.cream }}>{d.title || d.docNumber}</span> — {d.reason}
                    </div>
                  ))}
                </div>
              )}

              {sweep.history.length > 0 && (
                <details style={{ marginTop: '0.7rem' }}>
                  <summary style={{ color: C.lightBrown, fontSize: '0.78rem', cursor: 'pointer' }}>
                    Sync history ({sweep.history.length})
                  </summary>
                  <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '0.4rem' }}>
                    <thead><tr>
                      <th style={TH}>When</th><th style={TH}>Order</th><th style={TH}>Action</th><th style={TH}>Why</th>
                    </tr></thead>
                    <tbody>
                      {sweep.history.map((h, i) => (
                        <tr key={i}>
                          <td style={{ ...TD, fontFamily: 'monospace', color: C.lightBrown, fontSize: '0.75rem' }}>
                            {new Date(h.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                          </td>
                          <td style={{ ...TD, fontSize: '0.78rem' }}>{h.title || h.doc_number}</td>
                          <td style={{ ...TD, fontSize: '0.78rem', color: h.status === 'error' ? C.red : h.action === 'removed' ? C.green : C.lightBrown }}>
                            {h.status === 'error' ? 'error' : h.action}{h.triggered_by === 'manual' ? ' (manual)' : ''}
                          </td>
                          <td style={{ ...TD, fontSize: '0.75rem', color: C.lightBrown }}>{h.error || h.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
              )}
            </>
          )}
        </div>

        {/* ── Status ─────────────────────────────────────────────────── */}
        <div style={{ ...CARD, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div>
            <div style={{ color: C.tan, fontWeight: 700, fontSize: '0.95rem' }}>Producer → QuickBooks Customers</div>
            <div style={{ color: C.lightBrown, fontSize: '0.78rem' }}>
              Link every producer to their QuickBooks customer so services can invoice automatically.
              {data?.syncedAt ? ` Customer list refreshed ${new Date(data.syncedAt).toLocaleDateString()}.` : ''}
            </div>
            {syncMsg && <div style={{ color: C.green, fontSize: '0.78rem', marginTop: '0.3rem' }}>{syncMsg}</div>}
          </div>
          <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
            {data && (
              <span style={{ color: C.lightBrown, fontSize: '0.78rem' }}>
                {data.linked.length} linked · {data.suggestions.length} suggested · {data.unmatched.length} unmatched
              </span>
            )}
            <button onClick={sync} disabled={syncing} style={BTN(C.tan)}>
              {syncing ? 'Refreshing…' : '⟳ Refresh from QuickBooks'}
            </button>
          </div>
        </div>

        {!data && !error && <div style={{ color: C.lightBrown, padding: '2rem' }}>Loading producers…</div>}

        {/* ── Pending charges ────────────────────────────────────────── */}
        <div style={CARD}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem', flexWrap: 'wrap', gap: '0.5rem' }}>
            <div>
              <div style={{ color: C.tan, fontWeight: 700, fontSize: '0.95rem' }}>
                Pending Charges{charges && charges.events.length > 0 && (
                  <span style={{ color: C.green, fontWeight: 400, marginLeft: '0.5rem' }}>
                    ${charges.totals.amount.toFixed(2)} across {charges.events.length} service(s)
                  </span>
                )}
              </div>
              <div style={{ color: C.lightBrown, fontSize: '0.78rem' }}>
                Services detected from harvests and cutting since 7/11 — kill fees split across paying portions, cut &amp; wrap at carcass weight.
              </div>
              {detectMsg && <div style={{ color: C.green, fontSize: '0.78rem', marginTop: '0.3rem' }}>{detectMsg}</div>}
            </div>
            <button onClick={detect} disabled={detecting} style={BTN(C.green)}>
              {detecting ? 'Scanning…' : '⚡ Detect New Charges'}
            </button>
          </div>

          {charges && charges.totals.byDay.length > 0 && (
            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', margin: '0.5rem 0 0.75rem' }}>
              {charges.totals.byDay.map(d => (
                <span key={d.day} style={{ background: 'rgba(76,175,80,0.12)', border: '1px solid rgba(76,175,80,0.35)', borderRadius: 3, color: C.green, padding: '0.2rem 0.6rem', fontSize: '0.75rem' }}>
                  {new Date(d.day + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}: ${d.amount.toFixed(2)}
                </span>
              ))}
            </div>
          )}

          {(!charges || charges.events.length === 0) ? (
            <div style={{ color: C.lightBrown, fontSize: '0.83rem' }}>
              No pending charges. Hit ⚡ Detect after harvests are logged or carcasses marked cut.
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={TH}>Service Day</th><th style={TH}>Bill To</th><th style={TH}>Service</th>
                <th style={TH}>Qty</th><th style={TH}>Rate</th><th style={TH}>Amount</th><th style={TH}></th>
              </tr></thead>
              <tbody>
                {charges.events.map(ev => (
                  <tr key={ev.id}>
                    <td style={{ ...TD, fontFamily: 'monospace', color: C.lightBrown }}>{ev.service_date}</td>
                    <td style={TD}>
                      {ev.customer_name}
                      {!ev.qbo_customer_id && <span title="Not linked to a QuickBooks customer yet" style={{ color: C.yellow, marginLeft: '0.35rem' }}>⚠</span>}
                    </td>
                    <td style={{ ...TD, fontSize: '0.78rem' }}>{ev.description}</td>
                    <td style={TD}>{Number(ev.qty)}{ev.unit === 'lb' ? ' lb' : ''}</td>
                    <td style={{ ...TD, color: C.lightBrown }}>${Number(ev.rate).toFixed(2)}{ev.unit === 'lb' ? '/lb' : ''}</td>
                    <td style={{ ...TD, color: C.green }}>${Number(ev.amount).toFixed(2)}</td>
                    <td style={{ ...TD, textAlign: 'right' }}>
                      <button onClick={() => skipEvent(ev)} disabled={eventBusy === ev.id}
                        style={{ ...BTN('transparent', C.lightBrown), border: '1px solid rgba(166,120,90,0.35)', padding: '0.2rem 0.6rem', fontSize: '0.72rem' }}>
                        skip
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* ── Suggestions ────────────────────────────────────────────── */}
        {data && data.suggestions.length > 0 && (
          <div style={CARD}>
            <div style={{ color: C.tan, fontWeight: 700, fontSize: '0.95rem', marginBottom: '0.5rem' }}>
              Suggested Links <span style={{ color: C.lightBrown, fontWeight: 400 }}>({data.suggestions.length} exact name matches)</span>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={TH}>Producer</th><th style={TH}>Harvests</th><th style={TH}>QuickBooks Customer</th><th style={TH}></th>
              </tr></thead>
              <tbody>
                {data.suggestions.map(({ producer, qbo }) => (
                  <tr key={producer.name}>
                    <td style={TD}>{producer.name}</td>
                    <td style={{ ...TD, color: C.lightBrown }}>{producer.harvestCount}</td>
                    <td style={TD}>{qbo.display_name}</td>
                    <td style={{ ...TD, textAlign: 'right' }}>
                      <button onClick={() => act('link', { producerName: producer.name, qboId: qbo.qbo_id }, producer.name)}
                        disabled={busy === producer.name}
                        style={{ ...BTN(C.green), padding: '0.3rem 0.8rem', fontSize: '0.76rem' }}>
                        {busy === producer.name ? '…' : 'Link'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Linked ─────────────────────────────────────────────────── */}
        {data && (
          <div style={CARD}>
            <div style={{ color: C.tan, fontWeight: 700, fontSize: '0.95rem', marginBottom: '0.5rem' }}>
              Linked <span style={{ color: C.lightBrown, fontWeight: 400 }}>({data.linked.length})</span>
            </div>
            {data.linked.length === 0 ? (
              <div style={{ color: C.lightBrown, fontSize: '0.83rem' }}>No producers linked yet — confirm the suggestions above.</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>
                  <th style={TH}>Producer</th><th style={TH}>Harvests</th><th style={TH}>QuickBooks Customer</th><th style={TH}></th>
                </tr></thead>
                <tbody>
                  {data.linked.map(({ producer, qbo }) => (
                    <tr key={producer.name}>
                      <td style={TD}>{producer.name}</td>
                      <td style={{ ...TD, color: C.lightBrown }}>{producer.harvestCount}</td>
                      <td style={TD}>{qbo.display_name}</td>
                      <td style={{ ...TD, textAlign: 'right' }}>
                        <button onClick={() => { if (confirm(`Unlink ${producer.name}?`)) act('unlink', { producerName: producer.name }, producer.name) }}
                          disabled={busy === producer.name}
                          style={{ ...BTN('transparent', C.red), border: `1px solid ${C.red}`, padding: '0.25rem 0.7rem', fontSize: '0.74rem', opacity: 0.75 }}>
                          Unlink
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* ── Unmatched (manual picker) ──────────────────────────────── */}
        {data && data.unmatched.length > 0 && (
          <div style={CARD}>
            <div style={{ color: C.tan, fontWeight: 700, fontSize: '0.95rem', marginBottom: '0.5rem' }}>
              No Match Yet <span style={{ color: C.lightBrown, fontWeight: 400 }}>({data.unmatched.length} producers — search their QuickBooks name)</span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
              {data.unmatched.map(p => (
                <button key={p.name} onClick={() => { setPickerFor(p); setPickerSearch(p.name.split(' ').pop() ?? '') }}
                  style={{
                    background: pickerFor?.name === p.name ? C.medBrown : 'rgba(255,255,255,0.05)',
                    border: '1px solid rgba(166,120,90,0.3)', borderRadius: 3, color: C.cream,
                    padding: '0.25rem 0.6rem', fontSize: '0.75rem', cursor: 'pointer',
                  }}>
                  {p.name} <span style={{ color: C.lightBrown }}>({p.harvestCount})</span>
                </button>
              ))}
            </div>

            {pickerFor && (
              <div style={{ marginTop: '0.85rem', borderTop: '1px solid rgba(166,120,90,0.2)', paddingTop: '0.75rem' }}>
                <div style={{ color: C.cream, fontSize: '0.85rem', marginBottom: '0.4rem' }}>
                  Link <strong>{pickerFor.name}</strong> to:
                  <button onClick={() => setPickerFor(null)} style={{ background: 'none', border: 'none', color: C.lightBrown, cursor: 'pointer', marginLeft: '0.6rem' }}>cancel</button>
                </div>
                <input
                  autoFocus
                  value={pickerSearch}
                  onChange={e => setPickerSearch(e.target.value)}
                  placeholder="Search 8,800+ QuickBooks customers…"
                  style={{
                    width: '100%', maxWidth: 420, background: 'rgba(255,255,255,0.06)',
                    border: '1px solid rgba(166,120,90,0.35)', borderRadius: 3,
                    padding: '0.45rem 0.7rem', color: C.cream, fontSize: '0.85rem', outline: 'none',
                  }}
                />
                <div style={{ marginTop: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.25rem', maxWidth: 560 }}>
                  {pickerResults.map(q => (
                    <button key={q.qbo_id} onClick={() => act('link', { producerName: pickerFor.name, qboId: q.qbo_id }, pickerFor.name)}
                      disabled={busy === pickerFor.name}
                      style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(166,120,90,0.25)',
                        borderRadius: 3, color: C.cream, padding: '0.4rem 0.7rem', fontSize: '0.8rem', cursor: 'pointer',
                      }}>
                      <span>{q.display_name}{q.company_name ? <span style={{ color: C.lightBrown }}> · {q.company_name}</span> : null}</span>
                      {q.balance != null && q.balance > 0 && <span style={{ color: C.yellow, fontFamily: 'monospace' }}>owes ${q.balance.toFixed(2)}</span>}
                    </button>
                  ))}
                  {pickerResults.length === 0 && <div style={{ color: C.lightBrown, fontSize: '0.78rem' }}>No QuickBooks customers match — they may need to be created in QuickBooks first.</div>}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Coming next ────────────────────────────────────────────── */}
        <div style={{ ...CARD, color: C.lightBrown, fontSize: '0.8rem' }}>
          <strong style={{ color: C.tan }}>Next up:</strong> once producers are linked, services detected in the app
          (kill, cut &amp; wrap, value-add) will accumulate as dated line items on each producer&apos;s open QuickBooks
          invoice — and you&apos;ll see daily value creation here.
        </div>
      </main>

      <footer style={{ background: 'var(--dark)', borderTop: '1px solid rgba(166,120,90,0.2)', padding: '0.5rem 2rem', textAlign: 'center', fontSize: '0.72rem', color: C.lightBrown, flexShrink: 0 }}>
        Cowboy Meat Company · 1109 Front St, Forsyth MT · (406) 346-7660
      </footer>

      {slips && <InvoiceSlips invoices={slips} onDone={slipsDone} />}
    </div>
  )
}
