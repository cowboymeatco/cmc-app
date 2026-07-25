'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'

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
  openOrders: { id: string; title?: string }[]
  ordersError?: string
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

  const load = useCallback(async () => {
    setError(null)
    try {
      const [custRes, evRes, ringRes] = await Promise.all([
        fetch('/api/qbo/customers'),
        fetch('/api/billing/events'),
        fetch('/api/clover/ring-up'),
      ])
      const json = await custRes.json()
      if (!custRes.ok || json.error) throw new Error(json.error ?? 'Load failed')
      setData(json)
      const ev = await evRes.json()
      if (evRes.ok && !ev.error) setCharges(ev)
      const ru = await ringRes.json()
      if (ringRes.ok && !ru.error) setRingUp(ru)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  // Push one invoice to the register as a pre-labelled open order. The amount
  // is re-read from QuickBooks server-side, so what rings is the balance now.
  async function sendToRegister(inv: OpenInvoiceRow) {
    if (inv.onRegister && !confirm(
      `${inv.customerName} — INV ${inv.docNumber} is already waiting on the register.\n\n` +
      `Send it again? That creates a SECOND open order for the same invoice.`
    )) return
    setRingBusy(inv.id)
    setRingMsg(null)
    try {
      const res = await fetch('/api/clover/ring-up', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceId: inv.id }),
      })
      const json = await res.json()
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
            const q = ringSearch.trim().toLowerCase()
            const rows = q
              ? ringUp.invoices.filter(i =>
                  i.customerName.toLowerCase().includes(q) || i.docNumber.toLowerCase().includes(q))
              : ringUp.invoices
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
                        <td style={{ ...TD, textAlign: 'right' }}>
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
    </div>
  )
}
