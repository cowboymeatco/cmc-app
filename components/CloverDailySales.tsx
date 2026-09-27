'use client'

import { useCallback, useEffect, useState } from 'react'
import { dateLabel } from '@/lib/dates'
import type { DaySummary } from '@/lib/cloverSales'
import type { Proposal, ItemMapping, InvoiceCandidate, QboItemRef, DayRow } from '@/lib/qboDailySales'
import type { DepositProposal } from '@/lib/qboDeposits'

// Register sales → QuickBooks, on /billing next to the register sync.
// One row per shop day. Opening a day reads it live from Clover and shows the
// QuickBooks entry the app would write; nothing is written until a person
// approves, and the server refuses anything that doesn't balance, was already
// entered, or changed since the page loaded.

const C = {
  dark: '#1A0A04', medBrown: '#75471B', lightBrown: '#A6785A', tan: '#C9A882',
  cream: '#F2E8D9', green: '#4CAF50', red: '#E53E3E', yellow: '#D97706',
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
const NUM: React.CSSProperties = { ...TD, fontFamily: 'monospace', textAlign: 'right', whiteSpace: 'nowrap' }
const SUB: React.CSSProperties = { color: C.tan, fontWeight: 700, fontSize: '0.85rem', margin: '1rem 0 0.35rem' }

const $ = (c: number | null | undefined) => (c == null ? '—' : `${c < 0 ? '−' : ''}$${(Math.abs(c) / 100).toFixed(2)}`)

interface DayListRow {
  date: string
  status: 'not_posted' | 'posting' | 'posted' | 'error'
  changedAfterPost: boolean
  invoiceDoc: string | null
  approvedBy: string | null
  postedAt: string | null
  error: string | null
  retailNetCents: number | null
  netCents: number | null
}

interface DayDetail {
  summary: DaySummary
  proposal: Proposal
  mappings: ItemMapping[]
  candidates: InvoiceCandidate[]
  retailItems: QboItemRef[]
  record: DayRow | null
  postingFrom: string | null
}

function statusOf(row: DayListRow, detail?: DayDetail): { text: string; color: string } {
  if (row.status === 'posted' && (row.changedAfterPost || detail?.record?.changed_after_post)) return { text: '⚠ changed after posting', color: C.red }
  if (row.status === 'posted') return { text: `posted${row.invoiceDoc ? ` · INV ${row.invoiceDoc}` : ''}`, color: C.green }
  if (row.status === 'error') return { text: 'failed part-way', color: C.red }
  if (row.status === 'posting') return { text: 'posting…', color: C.yellow }
  if (!detail) return { text: 'not posted', color: C.lightBrown }
  const p = detail.proposal
  if (p.alreadyPosted) return { text: `in QuickBooks · INV ${p.alreadyPosted.docNumber}`, color: C.green }
  if (p.handEntered) return { text: `entered by hand · INV ${p.handEntered.docNumber}`, color: C.lightBrown }
  if (detail.summary.orderCount === 0) return { text: 'no sales', color: C.lightBrown }
  if (p.blockers.length) return { text: 'needs review', color: C.yellow }
  return { text: 'ready to post', color: C.green }
}

export default function CloverDailySales() {
  const [days, setDays] = useState<DayListRow[] | null>(null)
  const [postingFrom, setPostingFrom] = useState<string | null>(null)
  const [recordError, setRecordError] = useState<string | null>(null)
  const [details, setDetails] = useState<Record<string, DayDetail>>({})
  const [loadingDay, setLoadingDay] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)

  const loadList = useCallback(() =>
    fetch('/api/clover/daily-sales')
      .then(async res => {
        const json = await res.json()
        if (!res.ok || json.error) throw new Error(json.error ?? 'Load failed')
        setDays(json.days)
        setPostingFrom(json.postingFrom)
        setRecordError(json.recordError)
      })
      .catch(e => setError(e instanceof Error ? e.message : String(e))),
  [])

  useEffect(() => { void loadList() }, [loadList])

  async function loadDay(date: string): Promise<DayDetail | null> {
    setLoadingDay(date)
    setError(null)
    try {
      const res = await fetch(`/api/clover/daily-sales?date=${date}`)
      const json = await res.json()
      if (!res.ok || json.error) throw new Error(json.error ?? 'Load failed')
      setDetails(d => ({ ...d, [date]: json }))
      return json
    } catch (e) {
      setError(`${dateLabel(date)}: ${e instanceof Error ? e.message : String(e)}`)
      return null
    } finally {
      setLoadingDay(null)
    }
  }

  // One day at a time: each is ~one Clover call per order, and Clover
  // throttles bursts.
  async function checkRecent() {
    if (!days) return
    setChecking(true)
    for (const d of days.slice(0, 7)) await loadDay(d.date)
    await loadList()
    setChecking(false)
  }

  async function toggle(date: string) {
    if (open === date) { setOpen(null); return }
    setOpen(date)
    setMsg(null)
    if (!details[date]) await loadDay(date)
  }

  async function mapItem(date: string, m: ItemMapping, qboId: string, retailItems: QboItemRef[]) {
    const q = retailItems.find(r => r.id === qboId) ?? m.suggestions.find(r => r.id === qboId)
    if (!q) return
    setError(null)
    try {
      const res = await fetch('/api/clover/daily-sales', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'map', cloverItemId: m.cloverItemId, cloverName: m.cloverName, qboItemId: q.id, qboItemName: q.name }),
      })
      const json = await res.json()
      if (!res.ok || json.error) throw new Error(json.error ?? 'Save failed')
      await loadDay(date)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function approve(date: string, detail: DayDetail, approvedBy: string) {
    const p = detail.proposal
    if (!confirm(
      `Post ${dateLabel(date)} to QuickBooks?\n\n` +
      `Invoice to CMC ${$(p.invoice?.totalCents)}, ${p.payments.length} payment(s)` +
      (p.journal ? `, gift card / tips journal entry` : '') +
      `.\n\nThis writes to the books. It can only be undone in QuickBooks.`,
    )) return
    setError(null)
    setMsg(null)
    try {
      const res = await fetch('/api/clover/daily-sales', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'post', date, fingerprint: detail.summary.fingerprint, approvedBy }),
      })
      const json = await res.json()
      if (res.status === 401) throw new Error('Sign in with the executive passphrase on /exec first, then approve again.')
      if (!res.ok || json.error) throw new Error(json.error ?? 'Post failed')
      setMsg(`✓ ${dateLabel(date)} posted — invoice ${json.record?.qbo_invoice_doc ?? json.record?.qbo_invoice_id}.`)
      await loadList()
      await loadDay(date)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div style={CARD}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.5rem' }}>
        <div>
          <div style={{ color: C.tan, fontWeight: 700, fontSize: '0.95rem' }}>Register Sales → QuickBooks</div>
          <div style={{ color: C.lightBrown, fontSize: '0.78rem', maxWidth: 720 }}>
            Each shop day&apos;s Clover sales (Mountain Time), laid out the way the books take them: one invoice to CMC
            for the retail sold, a payment for each tender, and gift cards sold to Clover Gift Cards Payable. Invoice
            ring-ups and amounts keyed under a customer&apos;s name are listed, not posted — they pay invoices that are
            already income.
          </div>
        </div>
        <button onClick={checkRecent} disabled={checking || !days} style={BTN(C.tan)}>
          {checking ? 'Checking…' : '⟳ Check last 7 days'}
        </button>
      </div>

      <div style={{ fontSize: '0.78rem', marginBottom: '0.6rem', color: postingFrom ? C.green : C.yellow }}>
        {postingFrom
          ? `Posting is on for days from ${dateLabel(postingFrom)}. Earlier days were entered by hand.`
          : 'Posting is off — register sales are still entered by hand. This is a preview: every day can be opened and checked, nothing can be posted.'}
      </div>
      {recordError && (
        <div style={{ fontSize: '0.75rem', color: C.lightBrown, marginBottom: '0.5rem' }}>
          Posting records unavailable ({recordError}) — days show as not posted.
        </div>
      )}
      {error && <div style={{ color: C.red, fontSize: '0.8rem', marginBottom: '0.5rem' }}>{error}</div>}
      {msg && <div style={{ color: C.green, fontSize: '0.8rem', marginBottom: '0.5rem' }}>{msg}</div>}

      {!days ? (
        <div style={{ color: C.lightBrown, fontSize: '0.83rem' }}>Loading…</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>
            <th style={TH}>Day</th><th style={TH}>Status</th>
            <th style={{ ...TH, textAlign: 'right' }}>Retail sales</th><th style={{ ...TH, textAlign: 'right' }}>Clover net</th><th style={TH}></th>
          </tr></thead>
          <tbody>
            {days.map(row => {
              const detail = details[row.date]
              const st = statusOf(row, detail)
              return (
                <DayRowView key={row.date} row={row} detail={detail} status={st} open={open === row.date}
                  loading={loadingDay === row.date} onToggle={() => toggle(row.date)}
                  onMap={(m, id) => detail && mapItem(row.date, m, id, detail.retailItems)}
                  onApprove={name => detail && approve(row.date, detail, name)}
                  onReload={() => loadDay(row.date)} />
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}

function DayRowView(props: {
  row: DayListRow; detail?: DayDetail; status: { text: string; color: string }; open: boolean; loading: boolean
  onToggle: () => void; onMap: (m: ItemMapping, qboId: string) => void; onApprove: (name: string) => void; onReload: () => void
}) {
  const { row, detail, status, open, loading } = props
  const t = detail?.summary.totals
  return (
    <>
      <tr>
        <td style={TD}>{dateLabel(row.date, { weekday: 'short', month: 'short', day: 'numeric' })}</td>
        <td style={{ ...TD, color: status.color, fontSize: '0.78rem' }}>{status.text}</td>
        <td style={NUM}>{$(t?.retailNetCents ?? row.retailNetCents)}</td>
        <td style={NUM}>{$(t?.netCents ?? row.netCents)}</td>
        <td style={{ ...TD, textAlign: 'right' }}>
          <button onClick={props.onToggle} style={{ ...BTN('transparent', C.lightBrown), border: '1px solid rgba(166,120,90,0.35)', padding: '0.25rem 0.7rem', fontSize: '0.76rem' }}>
            {loading ? 'Reading Clover…' : open ? 'Close' : 'Review'}
          </button>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={5} style={{ ...TD, background: 'rgba(255,255,255,0.03)', padding: '0.75rem 1rem' }}>
            {!detail ? (
              <div style={{ color: C.lightBrown }}>{loading ? 'Reading the day from Clover…' : 'Could not load this day.'}</div>
            ) : (
              <DayDetailView row={row} d={detail} onMap={props.onMap} onApprove={props.onApprove} onReload={props.onReload} loading={loading} />
            )}
          </td>
        </tr>
      )}
    </>
  )
}

function DayDetailView({ row, d, onMap, onApprove, onReload, loading }: {
  row: DayListRow; d: DayDetail; onMap: (m: ItemMapping, qboId: string) => void; onApprove: (name: string) => void; onReload: () => void; loading: boolean
}) {
  const [approver, setApprover] = useState('')
  const s = d.summary
  const t = s.totals
  const p = d.proposal
  const mapByClover = new Map(d.mappings.map(m => [m.cloverItemId, m]))
  const posted = row.status === 'posted' || d.record?.status === 'posted'
  const canPost = !!d.postingFrom && s.date >= d.postingFrom && p.blockers.length === 0 && !posted && row.status !== 'posting'

  const totals: [string, number | null, string?][] = [
    ['Taken in (all payments)', t.collectedCents],
    ['Refunded', -t.refundsCents],
    ['Tips', t.tipsCents],
    ['Net to the bank', t.netCents, 'before Clover fees and loan holdback'],
    ['Retail at shelf price', t.retailGrossCents],
    ['Discounts', -t.discountsCents],
    ['Retail sales', t.retailNetCents],
    ['Invoice ring-ups', t.invoicePaymentsCents],
    ['Hand-keyed amounts', t.handKeyedCents],
    ['Gift cards sold', t.giftCardsSoldCents],
    ['Sales tax', t.taxCents],
    ['Processing fees', null, 'not in Clover\'s API — booked from the deposit'],
  ]

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem', fontSize: '0.75rem', color: C.lightBrown }}>
        <span>{s.orderCount} paid orders · {s.paymentCount} payments · {new Date(s.window.startUtc).toISOString().slice(11, 16)}–{new Date(s.window.endUtc).toISOString().slice(11, 16)} UTC</span>
        <button onClick={onReload} disabled={loading} style={{ ...BTN('transparent', C.lightBrown), padding: 0, fontSize: '0.75rem', textDecoration: 'underline' }}>re-read from Clover</button>
      </div>

      {d.record?.changed_after_post && (
        <div style={{ color: C.red, fontSize: '0.8rem', margin: '0.5rem 0' }}>
          ⚠ Clover&apos;s numbers for this day changed after it was posted (posted net {$(d.record.summary.totals.netCents)}, now {$(t.netCents)}).
          Usually a late refund or an edited ticket. Adjust in QuickBooks — the app will not re-post a day.
        </div>
      )}
      {d.record?.status === 'error' && (
        <div style={{ color: C.red, fontSize: '0.8rem', margin: '0.5rem 0' }}>Posting stopped part-way: {d.record.error}</div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '0.3rem 1rem', margin: '0.5rem 0' }}>
        {totals.map(([label, v, hint]) => (
          <div key={label} style={{ fontSize: '0.8rem', display: 'flex', justifyContent: 'space-between', gap: '0.5rem' }} title={hint}>
            <span style={{ color: C.lightBrown }}>{label}</span>
            <span style={{ fontFamily: 'monospace', color: v == null ? C.lightBrown : C.cream }}>{v == null ? 'n/a' : $(v)}</span>
          </div>
        ))}
      </div>

      <div style={SUB}>By tender</div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr>
          <th style={TH}>Tender</th><th style={{ ...TH, textAlign: 'right' }}>Taken in</th><th style={{ ...TH, textAlign: 'right' }}>Refunded</th>
          <th style={{ ...TH, textAlign: 'right' }}>Of which retail</th>
        </tr></thead>
        <tbody>
          {s.byTender.map(x => (
            <tr key={x.kind}>
              <td style={TD}>{x.label}</td><td style={NUM}>{$(x.collectedCents)}</td>
              <td style={NUM}>{x.refundsCents ? $(-x.refundsCents) : '—'}</td><td style={NUM}>{$(x.retailCents)}</td>
            </tr>
          ))}
          {s.categories.length > 0 && (
            <tr><td colSpan={4} style={{ ...TD, fontSize: '0.75rem', color: C.lightBrown }}>
              Retail by Clover category: {s.categories.map(c => `${c.name} ${$(c.amountCents)}`).join(' · ')}
            </td></tr>
          )}
        </tbody>
      </table>

      <div style={SUB}>Proposed QuickBooks entry {p.balanced ? <span style={{ color: C.green, fontWeight: 400 }}>· balances</span> : <span style={{ color: C.red }}>· does not balance</span>}</div>
      {p.invoice && (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>
            <th style={TH}>Invoice to {p.invoice.customerName} · {dateLabel(p.invoice.txnDate, { month: 'short', day: 'numeric' })}</th>
            <th style={TH}>Rung up as</th><th style={{ ...TH, textAlign: 'right' }}>Qty</th><th style={{ ...TH, textAlign: 'right' }}>Amount</th>
          </tr></thead>
          <tbody>
            {p.invoice.lines.map(l => {
              const m = l.cloverItemIds.length === 1 ? mapByClover.get(l.cloverItemIds[0]) : undefined
              return (
                <tr key={l.qboItemId ?? l.cloverItemIds.join()}>
                  <td style={TD}>
                    {l.qboItemName ? (
                      <>{l.qboItemName}{m?.source && m.source !== 'map' && <span style={{ color: C.lightBrown, fontSize: '0.7rem', marginLeft: '0.4rem' }}>{m.source === 'plu' ? 'PLU link' : 'same name'}</span>}</>
                    ) : m ? (
                      <select defaultValue="" onChange={e => e.target.value && onMap(m, e.target.value)}
                        style={{ background: C.dark, color: C.yellow, border: `1px solid ${C.yellow}`, borderRadius: 3, fontSize: '0.78rem', padding: '0.2rem', maxWidth: 300 }}>
                        <option value="">Pick the QuickBooks item…</option>
                        {m.suggestions.length > 0 && (
                          <optgroup label="Closest names">
                            {m.suggestions.map(sug => <option key={sug.id} value={sug.id}>{sug.fullName}</option>)}
                          </optgroup>
                        )}
                        <optgroup label="All retail items">
                          {d.retailItems.map(r => <option key={r.id} value={r.id}>{r.fullName}</option>)}
                        </optgroup>
                      </select>
                    ) : <span style={{ color: C.red }}>unmapped</span>}
                  </td>
                  <td style={{ ...TD, color: C.lightBrown, fontSize: '0.78rem' }}>{l.description}</td>
                  <td style={NUM}>{l.qty.toFixed(2)}</td>
                  <td style={NUM}>{$(l.amountCents)}</td>
                </tr>
              )
            })}
            {p.invoice.discountCents !== 0 && (
              <tr><td style={TD} colSpan={3}>Discounts</td><td style={NUM}>{$(-p.invoice.discountCents)}</td></tr>
            )}
            <tr><td style={{ ...TD, fontWeight: 700 }} colSpan={3}>Invoice total</td><td style={{ ...NUM, fontWeight: 700 }}>{$(p.invoice.totalCents)}</td></tr>
            {p.payments.map(x => (
              <tr key={x.tender}>
                <td style={{ ...TD, color: C.lightBrown }} colSpan={3}>Payment · {x.label} → Undeposited Funds <span style={{ fontSize: '0.7rem' }}>({x.refNum})</span></td>
                <td style={NUM}>{$(x.amountCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {p.journal && (
        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '0.4rem' }}>
          <thead><tr><th style={TH}>Journal entry</th><th style={{ ...TH, textAlign: 'right' }}>Debit</th><th style={{ ...TH, textAlign: 'right' }}>Credit</th></tr></thead>
          <tbody>
            {p.journal.lines.map((l, i) => (
              <tr key={i}>
                <td style={TD}>{l.accountName}</td>
                <td style={NUM}>{l.posting === 'Debit' ? $(l.amountCents) : ''}</td>
                <td style={NUM}>{l.posting === 'Credit' ? $(l.amountCents) : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div style={{ fontSize: '0.75rem', color: C.lightBrown, marginTop: '0.5rem' }}>
        Where the day&apos;s {$(t.netCents)} went: {p.reconciliation.filter(r => r.amountCents).map(r => `${r.label} ${$(r.amountCents)}`).join(' · ')}
      </div>

      {d.candidates.length > 0 && (
        <>
          <div style={SUB}>Payments on existing invoices — not posted</div>
          <div style={{ fontSize: '0.75rem', color: C.lightBrown, marginBottom: '0.3rem' }}>
            These are already income in QuickBooks. Receive them against the invoice the usual way; posting them as sales would count them twice.
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={TH}>On the register</th><th style={TH}>Tender</th><th style={{ ...TH, textAlign: 'right' }}>Amount</th><th style={TH}>QuickBooks</th></tr></thead>
            <tbody>
              {d.candidates.map(c => (
                <tr key={c.lineId}>
                  <td style={TD}>{c.label}{c.kind === 'hand-keyed' && <span style={{ color: C.yellow, fontSize: '0.7rem', marginLeft: '0.4rem' }}>keyed by name</span>}</td>
                  <td style={{ ...TD, color: C.lightBrown }}>{c.tender}</td>
                  <td style={NUM}>{$(c.amountCents)}</td>
                  <td style={{ ...TD, fontSize: '0.76rem', color: C.lightBrown }}>
                    {c.note}
                    {c.matches.slice(0, 3).map(m => (
                      <div key={m.id}>INV {m.docNumber} · {m.customer} · ${m.totalAmt.toFixed(2)} · {m.balance ? `open $${m.balance.toFixed(2)}` : 'paid'}</div>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {s.refundedLines.length > 0 && (
        <div style={{ fontSize: '0.78rem', color: C.lightBrown, marginTop: '0.6rem' }}>
          Refunded, left out: {s.refundedLines.map(l => `${l.name} ${$(l.amountCents)} (${l.tender})`).join(' · ')}
        </div>
      )}
      {s.warnings.length > 0 && (
        <div style={{ fontSize: '0.78rem', color: C.yellow, marginTop: '0.6rem' }}>
          {s.warnings.map(w => <div key={w}>⚠ {w}</div>)}
        </div>
      )}

      <div style={{ borderTop: '1px solid rgba(166,120,90,0.2)', marginTop: '0.8rem', paddingTop: '0.6rem' }}>
        {posted ? (
          <div style={{ color: C.green, fontSize: '0.83rem' }}>
            Posted {d.record?.posted_at ? new Date(d.record.posted_at).toLocaleString('en-US', { timeZone: 'America/Denver' }) : ''}
            {d.record?.approved_by ? ` by ${d.record.approved_by}` : ''} — invoice {d.record?.qbo_invoice_doc ?? d.record?.qbo_invoice_id}.
          </div>
        ) : (
          <>
            {p.blockers.map(b => <div key={b} style={{ color: C.yellow, fontSize: '0.8rem' }}>● {b}</div>)}
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '0.5rem', flexWrap: 'wrap' }}>
              <input value={approver} onChange={e => setApprover(e.target.value)} placeholder="Your name"
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(166,120,90,0.35)', borderRadius: 3, padding: '0.4rem 0.6rem', color: C.cream, fontSize: '0.83rem' }} />
              <button disabled={!canPost || !approver.trim()} onClick={() => onApprove(approver.trim())}
                style={{ ...BTN(canPost && approver.trim() ? C.green : 'rgba(166,120,90,0.25)'), cursor: canPost && approver.trim() ? 'pointer' : 'not-allowed' }}>
                {row.status === 'error' ? 'Approve — finish posting' : 'Approve & post to QuickBooks'}
              </button>
              {!d.postingFrom && <span style={{ fontSize: '0.75rem', color: C.lightBrown }}>Posting is off.</span>}
              {d.postingFrom && s.date < d.postingFrom && <span style={{ fontSize: '0.75rem', color: C.lightBrown }}>Before {dateLabel(d.postingFrom, { month: 'short', day: 'numeric' })} — entered by hand.</span>}
            </div>
          </>
        )}
      </div>

      <DepositPanel date={s.date} />
    </div>
  )
}

// ── Card deposit ────────────────────────────────────────────────────────────
// The day's card money arrives as one bank deposit, less Clover's 25% loan
// holdback and its fees. The app knows the gross and the holdback; the bank
// amount is typed in (no API can read it) and the fee is what's left.

const INPUT: React.CSSProperties = {
  background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(166,120,90,0.35)', borderRadius: 3,
  padding: '0.35rem 0.5rem', color: C.cream, fontSize: '0.83rem', width: 120,
}

function toCents(v: string): number | null {
  const t = v.replace(/[$,\s]/g, '')
  if (!t || !/^-?\d+(\.\d{1,2})?$/.test(t)) return null
  return Math.round(Number(t) * 100)
}

interface DepositRecord {
  status: string
  qbo_deposit_id: string | null
  bank_date: string
  deposit_cents: number
  approved_by: string | null
}

function DepositPanel({ date }: { date: string }) {
  const [p, setP] = useState<DepositProposal | null>(null)
  const [fingerprint, setFingerprint] = useState<string | null>(null)
  const [postingFrom, setPostingFrom] = useState<string | null>(null)
  const [record, setRecord] = useState<DepositRecord | null>(null)
  const [amount, setAmount] = useState('')
  const [holdback, setHoldback] = useState('')
  const [bankDate, setBankDate] = useState('')
  const [approver, setApprover] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const check = useCallback((dep: string, hold: string, bank: string) => {
    const q = new URLSearchParams({ date })
    const dc = toCents(dep), hc = toCents(hold)
    if (dc != null) q.set('deposit', String(dc))
    if (hc != null) q.set('holdback', String(hc))
    if (bank) q.set('bankDate', bank)
    return fetch(`/api/clover/deposits?${q}`)
      .then(async res => {
        const json = await res.json()
        if (!res.ok || json.error) throw new Error(json.error ?? 'Load failed')
        setP(json.proposal)
        setFingerprint(json.fingerprint)
        setPostingFrom(json.postingFrom)
        setRecord(json.record)
        setErr(null)
      })
      .catch(e => setErr(e instanceof Error ? e.message : String(e)))
  }, [date])

  useEffect(() => { void check('', '', '') }, [check])

  async function recheck() {
    setBusy(true)
    await check(amount, holdback, bankDate)
    setBusy(false)
  }

  async function approve() {
    if (!p || p.depositCents == null || p.feeCents == null || !fingerprint) return
    if (!confirm(
      `Record the ${dateLabel(date, { month: 'short', day: 'numeric' })} Clover deposit in QuickBooks?\n\n` +
      `${$(p.grossCents)} card − ${$(p.holdbackCents)} loan − ${$(p.feeCents)} fees = ${$(p.depositCents)} ` +
      `into First State Bank on ${p.bankDate}.`,
    )) return
    setBusy(true)
    setErr(null)
    setMsg(null)
    try {
      const res = await fetch('/api/clover/deposits', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date, depositCents: p.depositCents, holdbackCents: p.holdbackCents, bankDate: p.bankDate,
          fingerprint, approvedBy: approver.trim(),
        }),
      })
      const json = await res.json()
      if (res.status === 401) throw new Error('Sign in with the executive passphrase on /exec first, then approve again.')
      if (!res.ok || json.error) throw new Error(json.error ?? 'Post failed')
      setMsg(`✓ Deposit recorded in QuickBooks (#${json.record?.qbo_deposit_id}).`)
      await check(amount, holdback, bankDate)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
    setBusy(false)
  }

  const open = !!p && !p.alreadyDeposited && record?.status !== 'posted'
  const canPost = !!p && !!postingFrom && date >= postingFrom && p.blockers.length === 0 && !!approver.trim() && !busy
  // The "enter the amount / date" blockers are the inputs themselves.
  const shown = (b: string) => !/^Enter /.test(b)

  return (
    <div style={{ borderTop: '1px solid rgba(166,120,90,0.2)', marginTop: '0.8rem' }}>
      <div style={SUB}>Card deposit — loan holdback and fees</div>
      {!p ? (
        <div style={{ color: err ? C.red : C.lightBrown, fontSize: '0.8rem' }}>{err ?? 'Looking for the day’s card payments in QuickBooks…'}</div>
      ) : p.grossCents <= 0 ? (
        <div style={{ color: C.lightBrown, fontSize: '0.8rem' }}>No card sales — nothing for Clover to deposit.</div>
      ) : (
        <>
          {record?.status === 'posted' && (
            <div style={{ color: C.green, fontSize: '0.8rem', marginBottom: '0.3rem' }}>
              Recorded by the app: {$(record.deposit_cents)} on {record.bank_date} (QuickBooks #{record.qbo_deposit_id}
              {record.approved_by ? `, ${record.approved_by}` : ''}).
            </div>
          )}
          {p.alreadyDeposited && (
            <div style={{ color: C.lightBrown, fontSize: '0.8rem', marginBottom: '0.3rem' }}>
              In QuickBooks already: deposit #{p.alreadyDeposited.id} on {p.alreadyDeposited.date} — {$(p.alreadyDeposited.totalCents)} after
              loan {$(p.alreadyDeposited.loanCents)} and fees {$(p.alreadyDeposited.feeCents)}.
              {p.alreadyDeposited.loanCents !== p.holdbackDefaultCents && (
                <span style={{ color: C.yellow }}> The usual 25% holdback would be {$(p.holdbackDefaultCents)}.</span>
              )}
            </div>
          )}
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              {p.items.map(i => (
                <tr key={i.txnId}>
                  <td style={{ ...TD, color: C.lightBrown }}>
                    {i.txnType === 'Payment' ? 'Payment · ' : ''}{i.label} <span style={{ fontSize: '0.7rem' }}>({i.txnDate})</span>
                  </td>
                  <td style={NUM}>{$(i.amountCents)}</td>
                </tr>
              ))}
              <tr><td style={{ ...TD, fontWeight: 700 }}>Card sales for the day (Clover)</td><td style={{ ...NUM, fontWeight: 700 }}>{$(p.grossCents)}</td></tr>
              <tr>
                <td style={TD}>Clover Loan Payable — holdback{p.holdbackCents === p.holdbackDefaultCents ? ' (25%)' : ''}</td>
                <td style={NUM}>{$(-p.holdbackCents)}</td>
              </tr>
              <tr>
                <td style={TD}>Clover POS Processing Fee — what&apos;s left</td>
                <td style={NUM}>
                  {p.feeCents != null ? $(-p.feeCents)
                    : p.alreadyDeposited ? $(-(p.grossCents - p.holdbackCents - p.alreadyDeposited.totalCents))
                    : 'enter the bank amount'}
                </td>
              </tr>
              <tr>
                <td style={{ ...TD, fontWeight: 700 }}>Deposit to First State Bank Checking</td>
                <td style={{ ...NUM, fontWeight: 700 }}>{$(p.depositCents ?? p.alreadyDeposited?.totalCents)}</td>
              </tr>
            </tbody>
          </table>

          {open && (
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap', marginTop: '0.5rem', fontSize: '0.78rem', color: C.lightBrown }}>
              <label>Bank shows $<input value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" style={INPUT} /></label>
              <label>on <input type="date" value={bankDate} onChange={e => setBankDate(e.target.value)} style={{ ...INPUT, width: 150 }} /></label>
              <label>Loan holdback $<input value={holdback} onChange={e => setHoldback(e.target.value)} placeholder={(p.holdbackDefaultCents / 100).toFixed(2)} style={{ ...INPUT, width: 100 }} /></label>
              <button onClick={recheck} disabled={busy} style={{ ...BTN(C.tan), padding: '0.35rem 0.8rem' }}>
                {busy ? 'Checking…' : 'Work it out'}
              </button>
            </div>
          )}

          {p.warnings.map(w => <div key={w} style={{ color: C.yellow, fontSize: '0.78rem', marginTop: '0.3rem' }}>⚠ {w}</div>)}
          {p.blockers.filter(shown).map(b => <div key={b} style={{ color: C.yellow, fontSize: '0.78rem', marginTop: '0.3rem' }}>● {b}</div>)}
          {err && <div style={{ color: C.red, fontSize: '0.78rem', marginTop: '0.3rem' }}>{err}</div>}
          {msg && <div style={{ color: C.green, fontSize: '0.78rem', marginTop: '0.3rem' }}>{msg}</div>}

          {open && p.depositCents != null && (
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '0.5rem', flexWrap: 'wrap' }}>
              <input value={approver} onChange={e => setApprover(e.target.value)} placeholder="Your name" style={{ ...INPUT, width: 160 }} />
              <button disabled={!canPost} onClick={approve}
                style={{ ...BTN(canPost ? C.green : 'rgba(166,120,90,0.25)'), cursor: canPost ? 'pointer' : 'not-allowed' }}>
                Approve &amp; record deposit
              </button>
              {!postingFrom && <span style={{ fontSize: '0.75rem', color: C.lightBrown }}>Posting is off.</span>}
            </div>
          )}
        </>
      )}
    </div>
  )
}
