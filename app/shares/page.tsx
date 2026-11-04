'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { SPECIES_EMOJI } from '@/lib/cutSchedule'
import { dateLabel, isoDate } from '@/lib/dates'
import type { Customer } from '@/lib/types'
import {
  SHARE_PORTIONS, SHARE_SPECIES, SOURCE_LABEL, STATUS_LABEL, estimateDollars, money, monthLabel, shareLbs,
  type ShareOrderView, type SharePortion, type ShareSource, type ShareSpecies, type ShareStatus,
} from '@/lib/shares'

// Whole / half / quarter orders on our own animals, front to back:
//
//   Requested   came in off /buy or the phone — call them, confirm, quote
//   Confirmed   price pinned, waiting for a kill date — place it on one of
//               our bookings (or book a new head) and it becomes a customer
//               slot there; everything downstream reads the slot
//   Scheduled   on a kill day. The hanging weight shows up off the kill
//               floor, the cut card off /cutting-instructions, and once the
//               carcass is weighed one click writes the invoice line
//   Ready       cut, wrapped, frozen — call them
//   Picked up   done
//
// The queue is sorted so the next thing to do is at the top of each group.

const C = {
  dark:       '#1A0A04',
  darkBrown:  '#351E0E',
  medBrown:   '#75471B',
  lightBrown: '#A6785A',
  tan:        '#C9A882',
  cream:      '#F2E8D9',
  green:      '#4CAF50',
  orange:     '#E8883A',
  red:        '#E53E3E',
  yellow:     '#D97706',
  blue:       '#3B82F6',
}
const INPUT: React.CSSProperties = {
  background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(166,120,90,0.3)',
  borderRadius: 3, padding: '0.5rem 0.75rem', color: C.cream, fontSize: '0.88rem',
  outline: 'none', boxSizing: 'border-box', width: '100%', fontFamily: 'inherit',
}
const LABEL: React.CSSProperties = {
  display: 'block', fontSize: '0.7rem', color: C.lightBrown,
  textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.3rem',
}
const CARD: React.CSSProperties = {
  background: C.darkBrown, border: '1px solid rgba(166,120,90,0.18)', borderRadius: 4, padding: '1rem 1.25rem',
}
const btn = (bg: string, color = C.dark, extra: React.CSSProperties = {}): React.CSSProperties => ({
  background: bg, color, border: 'none', borderRadius: 3, padding: '0.42rem 0.9rem', fontSize: '0.8rem',
  fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap', ...extra,
})
const ghost = (color = C.tan): React.CSSProperties => btn('transparent', color, { border: `1px solid ${color}66` })

function Field({ label, children, style }: { label: string; children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={style}><label style={LABEL}>{label}</label>{children}</div>
}

const WHO_KEY = 'cmc-shares-who'
const STATUS_CLR: Record<ShareStatus, string> = {
  requested: C.red, confirmed: C.yellow, scheduled: C.blue, ready: C.green, picked_up: C.lightBrown, cancelled: C.medBrown,
}

interface PriceRow {
  species: ShareSpecies; portion: SharePortion
  price_per_lb: number | null; qbo_item_id: string | null; qbo_item_name: string | null; est_hanging_lbs: number | null
  typical_whole_lbs: number | null; typical_basis: string | null; typical_share_lbs: number | null; estimate: number | null
}
interface Booking { id: string; harvest_date: string; head_count: number; claimed: number; open: number; buyers: string[]; status: string }

const fmtWhen = (iso: string) => {
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { timeZone: 'America/Denver', month: 'short', day: 'numeric' })
}
const monthInput = (iso: string | null) => (iso ? iso.slice(0, 7) : '')

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error ?? `${res.status}`)
  return body as T
}
const json = (method: string, body: unknown): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

export default function SharesPage() {
  const [orders, setOrders]   = useState<ShareOrderView[]>([])
  const [prices, setPrices]   = useState<PriceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [showAll, setShowAll] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [showPrices, setShowPrices] = useState(false)
  const [error, setError]     = useState('')

  // One fetch for the queue and the price list; `tick` re-runs it after a
  // save that changes what the page is built on (the price list).
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick(t => t + 1), [])
  useEffect(() => {
    let alive = true
    Promise.all([
      api<ShareOrderView[]>(`/api/shares${showAll ? '?all=1' : ''}`),
      api<{ prices: PriceRow[] }>('/api/shares/prices'),
    ]).then(([o, p]) => { if (!alive) return; setOrders(o); setPrices(p.prices); setError(''); setLoading(false) })
      .catch(e => { if (!alive) return; setError(e instanceof Error ? e.message : String(e)); setLoading(false) })
    return () => { alive = false }
  }, [showAll, tick])

  const replace = (o: ShareOrderView) => setOrders(prev => prev.some(p => p.id === o.id) ? prev.map(p => p.id === o.id ? o : p) : [o, ...prev])

  const groups = useMemo(() => {
    const by: Record<ShareStatus, ShareOrderView[]> = { requested: [], confirmed: [], scheduled: [], ready: [], picked_up: [], cancelled: [] }
    for (const o of orders) by[o.status]?.push(o)
    // Oldest request first: whoever has waited longest gets the call.
    by.requested.sort((a, b) => a.created_at.localeCompare(b.created_at))
    // Soonest wanted first, "soonest available" ahead of a named month.
    by.confirmed.sort((a, b) => (a.wanted_month ?? '').localeCompare(b.wanted_month ?? '') || a.created_at.localeCompare(b.created_at))
    by.scheduled.sort((a, b) => (a.harvest_date ?? '').localeCompare(b.harvest_date ?? ''))
    by.ready.sort((a, b) => (a.ready_at ?? '').localeCompare(b.ready_at ?? ''))
    by.picked_up.sort((a, b) => (b.picked_up_at ?? '').localeCompare(a.picked_up_at ?? ''))
    by.cancelled.sort((a, b) => (b.cancelled_at ?? '').localeCompare(a.cancelled_at ?? ''))
    return by
  }, [orders])

  const priceFor = (s: ShareSpecies, p: SharePortion) => prices.find(r => r.species === s && r.portion === p) ?? null
  const unpriced = prices.some(p => p.price_per_lb == null)
  const noQbo = prices.some(p => p.price_per_lb != null && !p.qbo_item_id)

  return (
    <div style={{ minHeight: '100vh', background: C.dark, color: C.cream, fontFamily: 'inherit' }}>
      <header style={{ background: C.darkBrown, borderBottom: '1px solid rgba(166,120,90,0.3)', padding: '0 2rem', height: 72, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
          <Link href="/" style={{ color: C.lightBrown, textDecoration: 'none', fontSize: '0.85rem' }}>← Dashboard</Link>
          <div>
            <h1 style={{ fontFamily: 'Georgia, serif', fontSize: '1.2rem', fontWeight: 700, color: C.cream, letterSpacing: '0.08em', textTransform: 'uppercase', margin: 0 }}>Whole · Half · Quarter</h1>
            <p style={{ fontSize: '0.68rem', color: C.lightBrown, letterSpacing: '0.15em', textTransform: 'uppercase', margin: 0 }}>Shares of our own animals</p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <a href="/buy" target="_blank" rel="noopener noreferrer" style={{ ...ghost(C.lightBrown), textDecoration: 'none' }}>Customer form ↗</a>
          <button onClick={() => { setShowPrices(v => !v); setShowNew(false) }} style={ghost(C.tan)}>{showPrices ? 'Close prices' : 'Prices'}</button>
          <button onClick={() => { setShowNew(v => !v); setShowPrices(false) }} style={btn(C.orange)}>{showNew ? 'Close' : '+ New order'}</button>
        </div>
      </header>

      <main style={{ maxWidth: 1200, margin: '0 auto', padding: '1.5rem 2rem 5rem' }}>
        {error && <div style={{ ...CARD, borderColor: C.red, color: C.red, marginBottom: '1rem' }}>{error}</div>}
        {(unpriced || noQbo) && !showPrices && (
          <div style={{ ...CARD, borderColor: `${C.yellow}66`, marginBottom: '1rem', fontSize: '0.85rem', color: C.tan }}>
            {unpriced && <>Some sizes have no price yet, so the customer form doesn&apos;t offer them. </>}
            {noQbo && <>A priced size has no QuickBooks item, so its invoice can&apos;t be written. </>}
            <button onClick={() => setShowPrices(true)} style={{ ...ghost(C.yellow), marginLeft: '0.5rem' }}>Open prices</button>
          </div>
        )}

        {showNew && <NewOrder prices={prices} onSaved={rows => { rows.forEach(replace); setShowNew(false) }} />}
        {showPrices && <PricesPanel key={prices.map(p => [p.species, p.portion, p.price_per_lb, p.est_hanging_lbs, p.qbo_item_id].join(':')).join('|')} prices={prices} onSaved={reload} />}

        {/* Stat strip */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.75rem', margin: '0 0 1.5rem' }}>
          {(['requested', 'confirmed', 'scheduled', 'ready'] as ShareStatus[]).map(s => (
            <div key={s} style={{ ...CARD, padding: '0.75rem 1rem', borderColor: `${STATUS_CLR[s]}44` }}>
              <div style={{ fontSize: '1.6rem', fontWeight: 700, color: STATUS_CLR[s] }}>{loading ? '…' : groups[s].length}</div>
              <div style={{ fontSize: '0.72rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{STATUS_LABEL[s]}</div>
            </div>
          ))}
        </div>

        {loading ? <p style={{ color: C.lightBrown }}>Loading…</p> : (
          <>
            <Group title="Requested — call them" hint="New off the website or the phone. Confirm pins the price they were quoted." status="requested" rows={groups.requested} priceFor={priceFor} onChange={replace} />
            <Group title="Confirmed — needs a kill date" hint="Put each one on one of our bookings. The cut schedule and the cut card follow from the slot." status="confirmed" rows={groups.confirmed} priceFor={priceFor} onChange={replace} />
            <Group title="On the schedule" hint="Hanging weight shows up off the kill floor. Once it's there, Invoice writes the line to /billing." status="scheduled" rows={groups.scheduled} priceFor={priceFor} onChange={replace} />
            <Group title="Ready for pickup" hint="Called and waiting on them." status="ready" rows={groups.ready} priceFor={priceFor} onChange={replace} />
            <div style={{ marginTop: '1.5rem' }}>
              <button onClick={() => { setShowAll(v => !v); setLoading(true) }} style={ghost(C.lightBrown)}>
                {showAll ? 'Hide picked up & cancelled' : 'Show picked up & cancelled (last 6 months)'}
              </button>
            </div>
            {showAll && <>
              <Group title="Picked up" status="picked_up" rows={groups.picked_up} priceFor={priceFor} onChange={replace} />
              <Group title="Cancelled" status="cancelled" rows={groups.cancelled} priceFor={priceFor} onChange={replace} />
            </>}
          </>
        )}
      </main>
    </div>
  )
}

// ── A status group ───────────────────────────────────────────────────────────
function Group({ title, hint, status, rows, priceFor, onChange }: {
  title: string; hint?: string; status: ShareStatus; rows: ShareOrderView[]
  priceFor: (s: ShareSpecies, p: SharePortion) => PriceRow | null
  onChange: (o: ShareOrderView) => void
}) {
  return (
    <section style={{ marginBottom: '1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem', marginBottom: '0.5rem' }}>
        <h2 style={{ fontFamily: 'Georgia, serif', fontSize: '1rem', color: STATUS_CLR[status], margin: 0, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{title}</h2>
        <span style={{ color: C.lightBrown, fontSize: '0.8rem' }}>{rows.length}</span>
        {hint && <span style={{ color: C.lightBrown, fontSize: '0.75rem' }}>· {hint}</span>}
      </div>
      {rows.length === 0 ? (
        <div style={{ ...CARD, color: C.lightBrown, fontSize: '0.85rem', padding: '0.75rem 1.25rem' }}>Nothing here.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {rows.map(o => <OrderRow key={o.id} o={o} price={priceFor(o.species, o.portion)} onChange={onChange} />)}
        </div>
      )}
    </section>
  )
}

// ── One order ────────────────────────────────────────────────────────────────
function OrderRow({ o, price, onChange }: { o: ShareOrderView; price: PriceRow | null; onChange: (o: ShareOrderView) => void }) {
  const [open, setOpen] = useState(false)
  const [panel, setPanel] = useState<'' | 'schedule' | 'edit' | 'cancel'>('')
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')

  async function act(action: string, extra: Record<string, unknown> = {}) {
    setBusy(action); setErr('')
    try { onChange(await api<ShareOrderView>('/api/shares', json('PATCH', { id: o.id, action, ...extra }))); setPanel('') }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)) }
    setBusy('')
  }
  async function invoice() {
    setBusy('invoice'); setErr('')
    try {
      const r = await api<ShareOrderView & { charge: { amount: number }; missing_qbo_customer: boolean }>('/api/shares/invoice', json('POST', { id: o.id }))
      onChange(r)
      setNote(`${money(r.charge.amount, 2)} written to /billing as a pending charge.${r.missing_qbo_customer ? ' No QuickBooks customer is linked for this buyer yet — link them under Billing → Cut customers before it is sent.' : ''}`)
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)) }
    setBusy('')
  }
  async function unschedule() {
    if (!confirm(`Take ${o.customer_name} off the ${o.harvest_date ? dateLabel(o.harvest_date) : ''} booking? The slot is deleted; the order goes back to Confirmed.`)) return
    setBusy('remove'); setErr('')
    try { onChange(await api<ShareOrderView>('/api/shares/schedule', json('POST', { id: o.id, action: 'remove' }))) }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)) }
    setBusy('')
  }

  const quoteLbs = o.share_lbs ?? (price?.typical_whole_lbs ? shareLbs(price.typical_whole_lbs, o.portion) : null)
  const rate = o.price_per_lb ?? price?.price_per_lb ?? null
  const estimate = o.share_lbs != null && rate != null ? Math.round(o.share_lbs * rate) : estimateDollars(price?.typical_whole_lbs, o.portion, rate)
  const contact = [o.phone, o.email].filter(Boolean).join(' · ')
  const clr = STATUS_CLR[o.status]

  return (
    <div style={{ ...CARD, borderLeft: `3px solid ${clr}`, padding: '0.75rem 1.25rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 220px', minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: '0.98rem' }}>
            {SPECIES_EMOJI[o.species]} {o.portion} {o.species} <span style={{ color: C.tan, fontWeight: 400 }}>· {o.customer_name}</span>
          </div>
          <div style={{ color: C.lightBrown, fontSize: '0.78rem', marginTop: 2 }}>
            {contact || 'no contact'} · {SOURCE_LABEL[o.source as ShareSource] ?? o.source} {fmtWhen(o.created_at)}
            {o.fulfillment === 'delivery' && <span style={{ color: C.orange }}> · 🚚 delivery</span>}
          </div>
        </div>

        <div style={{ flex: '1 1 260px', fontSize: '0.8rem', color: C.tan, display: 'flex', gap: '1.25rem', flexWrap: 'wrap' }}>
          {o.status === 'requested' || o.status === 'confirmed' ? (
            <>
              <Stat label="Wants" value={monthLabel(o.wanted_month)} />
              <Stat label="Quote" value={rate != null ? `${money(rate, 2)}/lb${estimate != null ? ` ≈ ${money(estimate)}` : ''}` : 'no price set'} warn={rate == null} />
            </>
          ) : (
            <>
              <Stat label="Kill day" value={o.harvest_date ? dateLabel(o.harvest_date, { weekday: 'short', month: 'short', day: 'numeric' }) : '—'} />
              <Stat label="Hanging" value={o.hanging_lbs != null ? `${o.hanging_lbs} lb → ${o.share_lbs} lb share` : (o.harvest_date && o.harvest_date <= isoDate() ? 'not weighed yet' : 'not killed yet')} warn={o.hanging_lbs == null && !!o.harvest_date && o.harvest_date <= isoDate()} />
              <Stat label="Cut card" value={o.cut_card_in ? '✓ in' : 'missing'} warn={!o.cut_card_in} />
              <Stat label="Invoice" value={o.invoice_status ? `${o.invoice_status}${o.invoice_amount != null ? ` · ${money(o.invoice_amount, 2)}` : ''}` : (o.share_lbs != null && rate != null ? `≈ ${money(o.share_lbs * rate)} · not written` : '—')} warn={!o.invoice_status && o.share_lbs != null} />
            </>
          )}
        </div>

        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {o.status === 'requested' && <button disabled={!!busy} onClick={() => act('confirm')} style={btn(C.yellow)}>{busy === 'confirm' ? '…' : 'Confirm'}</button>}
          {(o.status === 'requested' || o.status === 'confirmed') && <button disabled={!!busy} onClick={() => setPanel(panel === 'schedule' ? '' : 'schedule')} style={btn(C.blue, C.cream)}>Place on kill date</button>}
          {o.status === 'scheduled' && o.share_lbs != null && (!o.invoice_status || o.invoice_status === 'pending' || o.invoice_status === 'skipped') && (
            <button disabled={!!busy} onClick={invoice} style={btn(C.green)}>{busy === 'invoice' ? '…' : o.invoice_status ? 'Re-figure invoice' : 'Invoice'}</button>
          )}
          {o.status === 'scheduled' && <button disabled={!!busy} onClick={() => act('ready')} style={btn(C.green)}>Ready</button>}
          {(o.status === 'scheduled' || o.status === 'ready') && <button disabled={!!busy} onClick={() => act('picked_up')} style={btn(C.tan)}>Picked up</button>}
          {(o.status === 'picked_up' || o.status === 'cancelled' || o.status === 'ready') && <button disabled={!!busy} onClick={() => act('reopen')} style={ghost(C.lightBrown)}>Reopen</button>}
          <button onClick={() => { setOpen(v => !v); setPanel('') }} style={ghost(C.lightBrown)}>{open ? 'Less' : 'More'}</button>
        </div>
      </div>

      {(err || note) && <div style={{ marginTop: '0.5rem', fontSize: '0.82rem', color: err ? C.red : C.green }}>{err || note}</div>}
      {o.notes && !open && <div style={{ marginTop: '0.4rem', fontSize: '0.8rem', color: C.tan, fontStyle: 'italic' }}>“{o.notes}”</div>}

      {panel === 'schedule' && <SchedulePanel o={o} onDone={r => { onChange(r); setPanel('') }} onClose={() => setPanel('')} />}

      {open && (
        <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid rgba(166,120,90,0.15)' }}>
          {/* Keyed on the last save so a confirm or a re-figure refreshes the fields instead of fighting what was typed. */}
          <EditPanel key={o.updated_at} o={o} quoteLbs={quoteLbs} onChange={onChange} />
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
            {o.appointment_id && (
              <>
                <Link href="/schedule" style={{ ...ghost(C.blue), textDecoration: 'none' }}>Open booking on /schedule</Link>
                <Link href="/cutting-instructions" style={{ ...ghost(C.blue), textDecoration: 'none' }}>Cut cards</Link>
                {o.invoice_status && <Link href="/billing" style={{ ...ghost(C.blue), textDecoration: 'none' }}>Billing</Link>}
                {!['picked_up'].includes(o.status) && <button disabled={!!busy} onClick={unschedule} style={ghost(C.orange)}>{busy === 'remove' ? '…' : 'Take off schedule'}</button>}
              </>
            )}
            {o.customer_id && <Link href={`/customers?id=${o.customer_id}`} style={{ ...ghost(C.lightBrown), textDecoration: 'none' }}>Customer record</Link>}
            {o.status !== 'picked_up' && o.status !== 'cancelled' && !o.appointment_id && (
              panel === 'cancel' ? (
                <CancelInline onCancel={reason => act('cancel', { cancel_reason: reason })} onClose={() => setPanel('')} />
              ) : <button onClick={() => setPanel('cancel')} style={ghost(C.red)}>Cancel order</button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: '0.62rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</div>
      <div style={{ color: warn ? C.yellow : C.cream, fontSize: '0.82rem' }}>{value}</div>
    </div>
  )
}

function CancelInline({ onCancel, onClose }: { onCancel: (reason: string) => void; onClose: () => void }) {
  const [reason, setReason] = useState('')
  return (
    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flex: 1 }}>
      <input style={{ ...INPUT, maxWidth: 320 }} placeholder="Why? (optional)" value={reason} onChange={e => setReason(e.target.value)} />
      <button onClick={() => onCancel(reason)} style={btn(C.red, C.cream)}>Cancel it</button>
      <button onClick={onClose} style={ghost(C.lightBrown)}>Keep</button>
    </div>
  )
}

// ── Put it on a kill date ────────────────────────────────────────────────────
function SchedulePanel({ o, onDone, onClose }: { o: ShareOrderView; onDone: (o: ShareOrderView) => void; onClose: () => void }) {
  const [bookings, setBookings] = useState<Booking[] | null>(null)
  const [date, setDate] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const need = o.portion === 'Whole' ? 1 : o.portion === 'Half' ? 0.5 : 0.25

  useEffect(() => {
    api<{ bookings: Booking[] }>(`/api/shares/schedule?species=${o.species}`).then(d => setBookings(d.bookings)).catch(e => { setErr(String(e.message ?? e)); setBookings([]) })
  }, [o.species])

  async function place(body: Record<string, unknown>) {
    setBusy(true); setErr('')
    try { onDone(await api<ShareOrderView>('/api/shares/schedule', json('POST', { id: o.id, ...body }))) }
    catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (/head open/.test(msg) && confirm(`${msg}. Put it on anyway? The booking will read over its head count on /schedule until the head count is raised.`)) {
        try { onDone(await api<ShareOrderView>('/api/shares/schedule', json('POST', { id: o.id, ...body, force: true }))) } catch (e2) { setErr(e2 instanceof Error ? e2.message : String(e2)) }
      } else setErr(msg)
    }
    setBusy(false)
  }

  return (
    <div style={{ marginTop: '0.75rem', padding: '0.75rem 1rem', background: 'rgba(59,130,246,0.08)', border: `1px solid ${C.blue}44`, borderRadius: 4 }}>
      <div style={{ fontSize: '0.8rem', color: C.tan, marginBottom: '0.5rem' }}>
        Our upcoming <strong>{o.species.toLowerCase()}</strong> bookings with room for {need === 1 ? 'a whole' : need === 0.5 ? 'a half' : 'a quarter'}.
        Placing it adds <strong>{o.customer_name}</strong> as a customer slot on the booking{o.price_per_lb == null ? ' and pins today’s price' : ''}.
      </div>
      {bookings === null ? <div style={{ color: C.lightBrown, fontSize: '0.8rem' }}>Loading bookings…</div> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', marginBottom: '0.75rem' }}>
          {bookings.length === 0 && <div style={{ color: C.lightBrown, fontSize: '0.8rem' }}>No upcoming {o.species.toLowerCase()} bookings of our own on the schedule.</div>}
          {bookings.map(b => {
            const fits = b.open + 1e-9 >= need
            return (
              <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: '1rem', fontSize: '0.82rem', padding: '0.4rem 0.6rem', background: 'rgba(255,255,255,0.03)', borderRadius: 3, opacity: fits ? 1 : 0.55 }}>
                <div style={{ minWidth: 130, color: C.cream, fontWeight: 600 }}>{dateLabel(b.harvest_date, { weekday: 'short', month: 'short', day: 'numeric' })}</div>
                <div style={{ color: C.tan }}>{b.head_count} head · {b.open} open{b.buyers.length ? ` · ${b.buyers.join(', ')}` : ''}</div>
                <div style={{ marginLeft: 'auto' }}>
                  <button disabled={busy} onClick={() => place({ appointment_id: b.id })} style={fits ? btn(C.blue, C.cream) : ghost(C.lightBrown)}>{fits ? 'Place here' : 'Full — force'}</button>
                </div>
              </div>
            )
          })}
        </div>
      )}
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '0.8rem', color: C.tan }}>Or book a new head of ours on</span>
        <input type="date" min={isoDate()} value={date} onChange={e => setDate(e.target.value)} style={{ ...INPUT, width: 170 }} />
        <button disabled={busy || !date} onClick={() => place({ harvest_date: date })} style={btn(C.blue, C.cream)}>Book &amp; place</button>
        <button onClick={onClose} style={{ ...ghost(C.lightBrown), marginLeft: 'auto' }}>Close</button>
      </div>
      {err && <div style={{ color: C.red, fontSize: '0.82rem', marginTop: '0.5rem' }}>{err}</div>}
    </div>
  )
}

// ── Edit the order's details ─────────────────────────────────────────────────
function EditPanel({ o, quoteLbs, onChange }: { o: ShareOrderView; quoteLbs: number | null; onChange: (o: ShareOrderView) => void }) {
  const [f, setF] = useState({
    customer_name: o.customer_name, phone: o.phone ?? '', email: o.email ?? '', preferred_contact: o.preferred_contact,
    portion: o.portion, wanted_month: monthInput(o.wanted_month), fulfillment: o.fulfillment, delivery_address: o.delivery_address ?? '',
    notes: o.notes, office_notes: o.office_notes, price_per_lb: o.price_per_lb != null ? String(o.price_per_lb) : '',
  })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF(prev => ({ ...prev, [k]: e.target.value }))

  async function save() {
    setBusy(true); setMsg('')
    try {
      onChange(await api<ShareOrderView>('/api/shares', json('PATCH', { id: o.id, ...f, wanted_month: f.wanted_month || null, price_per_lb: f.price_per_lb === '' ? null : Number(f.price_per_lb) })))
      setMsg('Saved.')
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)) }
    setBusy(false)
  }
  const locked = !!o.appointment_id

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.75rem' }}>
        <Field label="Name"><input style={INPUT} value={f.customer_name} onChange={set('customer_name')} /></Field>
        <Field label="Phone"><input style={INPUT} value={f.phone} onChange={set('phone')} /></Field>
        <Field label="Email"><input style={INPUT} value={f.email} onChange={set('email')} /></Field>
        <Field label="Reach them by">
          <select style={INPUT} value={f.preferred_contact} onChange={set('preferred_contact')}>
            {['Phone Call', 'Text Message', 'Email'].map(c => <option key={c}>{c}</option>)}
          </select>
        </Field>
        <Field label={locked ? 'Size (change on the booking)' : 'Size'}>
          <select style={{ ...INPUT, opacity: locked ? 0.6 : 1 }} disabled={locked} value={f.portion} onChange={set('portion')}>
            {SHARE_PORTIONS[o.species].map(p => <option key={p}>{p}</option>)}
          </select>
        </Field>
        <Field label="Wants it"><input type="month" style={INPUT} value={f.wanted_month} onChange={set('wanted_month')} /></Field>
        <Field label="Pickup / delivery">
          <select style={INPUT} value={f.fulfillment} onChange={set('fulfillment')}><option value="pickup">Pickup</option><option value="delivery">Delivery</option></select>
        </Field>
        <Field label={`$/lb hanging${quoteLbs != null && f.price_per_lb ? ` · ≈ ${money(Math.round(quoteLbs * Number(f.price_per_lb)))}` : ''}`}>
          <input type="number" step="0.01" min="0" style={INPUT} value={f.price_per_lb} onChange={set('price_per_lb')} placeholder={o.status === 'requested' ? 'pins on confirm' : ''} />
        </Field>
        {f.fulfillment === 'delivery' && <Field label="Delivery address" style={{ gridColumn: 'span 2' }}><input style={INPUT} value={f.delivery_address} onChange={set('delivery_address')} /></Field>}
        <Field label="Customer's notes" style={{ gridColumn: 'span 2' }}><textarea rows={2} style={{ ...INPUT, resize: 'vertical' }} value={f.notes} onChange={set('notes')} /></Field>
        <Field label="Office notes" style={{ gridColumn: 'span 2' }}><textarea rows={2} style={{ ...INPUT, resize: 'vertical' }} value={f.office_notes} onChange={set('office_notes')} placeholder="what they said on the phone, what they were quoted, …" /></Field>
      </div>
      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginTop: '0.6rem' }}>
        <button disabled={busy} onClick={save} style={btn(C.tan)}>{busy ? 'Saving…' : 'Save'}</button>
        {msg && <span style={{ fontSize: '0.8rem', color: msg === 'Saved.' ? C.green : C.red }}>{msg}</span>}
        <span style={{ fontSize: '0.72rem', color: C.lightBrown, marginLeft: 'auto' }}>
          {o.taken_by ? `Taken by ${o.taken_by} · ` : ''}{o.qbo_item_name ? `QuickBooks item: ${o.qbo_item_name}` : ''}
        </span>
      </div>
    </div>
  )
}

// ── Take an order at the desk ────────────────────────────────────────────────
function NewOrder({ prices, onSaved }: { prices: PriceRow[]; onSaved: (rows: ShareOrderView[]) => void }) {
  const [who, setWho] = useState('')
  const [source, setSource] = useState<ShareSource>('phone')
  const [species, setSpecies] = useState<ShareSpecies>('Beef')
  const [portionPick, setPortion] = useState<SharePortion>('Half')
  const [qty, setQty] = useState(1)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [contact, setContact] = useState('Phone Call')
  const [month, setMonth] = useState('')
  const [fulfillment, setFulfillment] = useState<'pickup' | 'delivery'>('pickup')
  const [address, setAddress] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [matches, setMatches] = useState<Customer[]>([])
  const searchT = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- restoring the remembered name after mount; reading it during render would mismatch the server HTML
    try { setWho(localStorage.getItem(WHO_KEY) ?? '') } catch { /* private browsing */ }
  }, [])
  // A hog or lamb has no quarter: the pick falls back to the first size sold.
  const portion: SharePortion = SHARE_PORTIONS[species].includes(portionPick) ? portionPick : SHARE_PORTIONS[species][0]

  // Offer a customer record as the name is typed, the same lookup /calls uses.
  function onName(v: string) {
    setName(v)
    if (searchT.current) clearTimeout(searchT.current)
    if (v.trim().length < 2) { setMatches([]); return }
    searchT.current = setTimeout(async () => {
      try { setMatches((await api<Customer[]>(`/api/customers?search=${encodeURIComponent(v.trim())}`)).slice(0, 6)) } catch { setMatches([]) }
    }, 250)
  }
  function pick(c: Customer) {
    setName(c.name); setPhone(c.phone ?? ''); setEmail(c.email ?? '')
    if (c.preferred_contact) setContact(c.preferred_contact)
    setMatches([])
  }

  const price = prices.find(p => p.species === species && p.portion === portion) ?? null

  async function save() {
    setErr('')
    if (!who.trim()) { setErr('Your name, so we know who took the order.'); return }
    if (!name.trim()) { setErr('Customer name.'); return }
    if (!phone.trim() && !email.trim()) { setErr('A phone number or email.'); return }
    setBusy(true)
    try { localStorage.setItem(WHO_KEY, who.trim()) } catch { /* private browsing */ }
    try {
      onSaved(await api<ShareOrderView[]>('/api/shares', json('POST', {
        source, taken_by: who, species, portion, qty, customer_name: name, phone, email, preferred_contact: contact,
        wanted_month: month || null, fulfillment, delivery_address: fulfillment === 'delivery' ? address : null, notes,
      })))
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)) }
    setBusy(false)
  }

  return (
    <div style={{ ...CARD, marginBottom: '1.25rem', borderColor: `${C.orange}55` }}>
      <h2 style={{ fontFamily: 'Georgia, serif', fontSize: '1rem', color: C.orange, margin: '0 0 0.75rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>New order</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '0.75rem' }}>
        <Field label="Taken by"><input style={INPUT} value={who} onChange={e => setWho(e.target.value)} /></Field>
        <Field label="How it came in">
          <select style={INPUT} value={source} onChange={e => setSource(e.target.value as ShareSource)}>
            {(['phone', 'walk_in', 'text', 'email'] as ShareSource[]).map(s => <option key={s} value={s}>{SOURCE_LABEL[s]}</option>)}
          </select>
        </Field>
        <Field label="Species">
          <select style={INPUT} value={species} onChange={e => setSpecies(e.target.value as ShareSpecies)}>
            {SHARE_SPECIES.map(s => <option key={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Size">
          <select style={INPUT} value={portion} onChange={e => setPortion(e.target.value as SharePortion)}>
            {SHARE_PORTIONS[species].map(p => <option key={p}>{p}</option>)}
          </select>
        </Field>
        <Field label="How many">
          <select style={INPUT} value={qty} onChange={e => setQty(Number(e.target.value))}>{[1, 2, 3, 4, 5, 6].map(n => <option key={n} value={n}>{n}</option>)}</select>
        </Field>
        <Field label="Quote">
          <div style={{ ...INPUT, background: 'transparent', border: '1px solid transparent', padding: '0.5rem 0' }}>
            {price?.price_per_lb != null
              ? <span>{money(price.price_per_lb, 2)}/lb{price.estimate != null ? <span style={{ color: C.tan }}> ≈ {money(price.estimate)}</span> : ''}</span>
              : <span style={{ color: C.yellow }}>no price set</span>}
          </div>
        </Field>

        <Field label="Customer" style={{ gridColumn: 'span 2', position: 'relative' }}>
          <input style={INPUT} value={name} onChange={e => onName(e.target.value)} autoComplete="off" />
          {matches.length > 0 && (
            <div style={{ position: 'absolute', zIndex: 5, left: 0, right: 0, background: C.dark, border: '1px solid rgba(166,120,90,0.4)', borderRadius: 3, marginTop: 2 }}>
              {matches.map(c => (
                <div key={c.id} onMouseDown={() => pick(c)} style={{ padding: '0.4rem 0.75rem', cursor: 'pointer', fontSize: '0.85rem', borderBottom: '1px solid rgba(166,120,90,0.15)' }}>
                  {c.name}{c.ranch_name ? <span style={{ color: C.lightBrown }}> · {c.ranch_name}</span> : ''}<span style={{ color: C.lightBrown, float: 'right' }}>{c.phone}</span>
                </div>
              ))}
            </div>
          )}
        </Field>
        <Field label="Phone"><input style={INPUT} value={phone} onChange={e => setPhone(e.target.value)} /></Field>
        <Field label="Email"><input style={INPUT} value={email} onChange={e => setEmail(e.target.value)} /></Field>
        <Field label="Reach them by">
          <select style={INPUT} value={contact} onChange={e => setContact(e.target.value)}>{['Phone Call', 'Text Message', 'Email'].map(c => <option key={c}>{c}</option>)}</select>
        </Field>
        <Field label="Wants it"><input type="month" style={INPUT} value={month} onChange={e => setMonth(e.target.value)} /></Field>

        <Field label="Pickup / delivery">
          <select style={INPUT} value={fulfillment} onChange={e => setFulfillment(e.target.value as 'pickup' | 'delivery')}><option value="pickup">Pickup</option><option value="delivery">Delivery</option></select>
        </Field>
        {fulfillment === 'delivery' && <Field label="Delivery address" style={{ gridColumn: 'span 2' }}><input style={INPUT} value={address} onChange={e => setAddress(e.target.value)} /></Field>}
        <Field label="Notes" style={{ gridColumn: fulfillment === 'delivery' ? 'span 3' : 'span 5' }}>
          <input style={INPUT} value={notes} onChange={e => setNotes(e.target.value)} placeholder="splitting with a neighbor, mostly burger, …" />
        </Field>
      </div>
      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginTop: '0.75rem' }}>
        <button disabled={busy} onClick={save} style={btn(C.orange)}>{busy ? 'Saving…' : `Save ${qty > 1 ? `${qty} orders` : 'order'}`}</button>
        {err && <span style={{ color: C.red, fontSize: '0.82rem' }}>{err}</span>}
        <span style={{ fontSize: '0.75rem', color: C.lightBrown, marginLeft: 'auto' }}>Lands in Requested. Confirm pins the price; Place puts it on a kill date.</span>
      </div>
    </div>
  )
}

// ── The price list ───────────────────────────────────────────────────────────
function PricesPanel({ prices, onSaved }: { prices: PriceRow[]; onSaved: () => void }) {
  const [rows, setRows] = useState(prices.map(p => ({ ...p, price: p.price_per_lb != null ? String(p.price_per_lb) : '', est: p.est_hanging_lbs != null ? String(p.est_hanging_lbs) : '' })))
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [qboQ, setQboQ] = useState('')
  const [qboHits, setQboHits] = useState<{ qbo_id: string; name: string; full_name: string; sales_price: number | null }[]>([])
  const [qboFor, setQboFor] = useState<number | null>(null)
  const t = useRef<ReturnType<typeof setTimeout> | null>(null)

  function searchQbo(q: string) {
    setQboQ(q)
    if (t.current) clearTimeout(t.current)
    if (q.trim().length < 2) { setQboHits([]); return }
    t.current = setTimeout(async () => {
      try { setQboHits((await api<{ items: typeof qboHits }>(`/api/shares/prices?qbo=${encodeURIComponent(q.trim())}`)).items) } catch { setQboHits([]) }
    }, 250)
  }
  const upd = (i: number, patch: Partial<typeof rows[number]>) => setRows(prev => prev.map((r, j) => j === i ? { ...r, ...patch } : r))

  async function save() {
    setBusy(true); setMsg('')
    try {
      await api('/api/shares/prices', json('PUT', { rows: rows.map(r => ({ species: r.species, portion: r.portion, price_per_lb: r.price === '' ? null : Number(r.price), est_hanging_lbs: r.est === '' ? null : Number(r.est), qbo_item_id: r.qbo_item_id, qbo_item_name: r.qbo_item_name })) }))
      setMsg('Saved.'); onSaved()
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)) }
    setBusy(false)
  }

  return (
    <div style={{ ...CARD, marginBottom: '1.25rem', borderColor: `${C.tan}55` }}>
      <h2 style={{ fontFamily: 'Georgia, serif', fontSize: '1rem', color: C.tan, margin: '0 0 0.25rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Prices</h2>
      <p style={{ fontSize: '0.8rem', color: C.lightBrown, margin: '0 0 0.75rem', lineHeight: 1.5 }}>
        $/lb hanging weight, all-in (kill, cut &amp; wrap included). A size with no price isn&apos;t offered on the customer form.
        The estimate uses the kill floor&apos;s six-month average for that species when we have one, else the typical weight typed here.
        The QuickBooks item is what the sale line posts to — one per size, or the same item for all of them.
      </p>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
        <thead>
          <tr>{['Share', '$/lb hanging', 'Typical whole lbs', 'Typical share', 'Estimate', 'QuickBooks item'].map(h => (
            <th key={h} style={{ textAlign: 'left', fontSize: '0.68rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.08em', padding: '0.3rem 0.5rem', borderBottom: '1px solid rgba(166,120,90,0.25)' }}>{h}</th>
          ))}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const whole = r.typical_whole_lbs ?? (r.est ? Number(r.est) : null)
            const share = shareLbs(whole, r.portion)
            const est = estimateDollars(whole, r.portion, r.price ? Number(r.price) : null)
            return (
              <tr key={`${r.species}|${r.portion}`}>
                <td style={{ padding: '0.35rem 0.5rem', color: C.cream, fontWeight: 600 }}>{SPECIES_EMOJI[r.species]} {r.portion} {r.species}</td>
                <td style={{ padding: '0.35rem 0.5rem' }}><input type="number" step="0.01" min="0" style={{ ...INPUT, width: 110 }} value={r.price} onChange={e => upd(i, { price: e.target.value })} /></td>
                <td style={{ padding: '0.35rem 0.5rem' }}>
                  <input type="number" step="1" min="0" style={{ ...INPUT, width: 110 }} value={r.est} onChange={e => upd(i, { est: e.target.value })} />
                  {r.typical_basis && r.typical_whole_lbs != null && <div style={{ fontSize: '0.68rem', color: C.lightBrown }}>kill floor: {r.typical_whole_lbs} lb ({r.typical_basis})</div>}
                </td>
                <td style={{ padding: '0.35rem 0.5rem', color: C.tan }}>{share != null ? `${Math.round(share)} lb` : '—'}</td>
                <td style={{ padding: '0.35rem 0.5rem', color: C.cream }}>{est != null ? `≈ ${money(est)}` : '—'}</td>
                <td style={{ padding: '0.35rem 0.5rem', position: 'relative' }}>
                  {qboFor === i ? (
                    <div>
                      <input autoFocus style={INPUT} value={qboQ} onChange={e => searchQbo(e.target.value)} placeholder="search QuickBooks items…" onBlur={() => setTimeout(() => setQboFor(null), 150)} />
                      {qboHits.length > 0 && (
                        <div style={{ position: 'absolute', zIndex: 5, left: 0, right: 0, background: C.dark, border: '1px solid rgba(166,120,90,0.4)', borderRadius: 3, maxHeight: 220, overflowY: 'auto' }}>
                          {qboHits.map(h => (
                            <div key={h.qbo_id} onMouseDown={() => { upd(i, { qbo_item_id: h.qbo_id, qbo_item_name: h.name }); setQboFor(null); setQboQ(''); setQboHits([]) }}
                              style={{ padding: '0.35rem 0.6rem', cursor: 'pointer', fontSize: '0.8rem', borderBottom: '1px solid rgba(166,120,90,0.15)' }}>
                              {h.full_name}{h.sales_price != null ? <span style={{ color: C.lightBrown }}> · {money(h.sales_price, 2)}</span> : ''}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                      <span style={{ color: r.qbo_item_name ? C.cream : C.yellow, fontSize: '0.82rem' }}>{r.qbo_item_name ?? 'not set'}</span>
                      <button onClick={() => { setQboFor(i); setQboQ('') }} style={ghost(C.lightBrown)}>{r.qbo_item_id ? 'Change' : 'Pick'}</button>
                      {r.qbo_item_id && <button onClick={() => upd(i, { qbo_item_id: null, qbo_item_name: null })} style={ghost(C.lightBrown)}>×</button>}
                    </div>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginTop: '0.75rem' }}>
        <button disabled={busy} onClick={save} style={btn(C.tan)}>{busy ? 'Saving…' : 'Save prices'}</button>
        {msg && <span style={{ fontSize: '0.8rem', color: msg === 'Saved.' ? C.green : C.red }}>{msg}</span>}
        <span style={{ fontSize: '0.75rem', color: C.lightBrown, marginLeft: 'auto' }}>Changing a price never reprices an order already confirmed — that quote is pinned on the order.</span>
      </div>
    </div>
  )
}
