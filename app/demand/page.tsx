'use client'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { dateLabel, daysBetweenISO } from '@/lib/dates'
import type { DemandLine, DemandSummary, RoomCount, SpeciesSupply } from '@/lib/demand'

// /demand — what to buy, from what the open orders need.
//
// Charlie, 2026-11-01: "make me a demand page in the app so I know what I need
// to procure." Meat only, every open order, open to the crew.
//
// One row per item the open orders are still short. Across the row:
//
//   Short     ordered less packed, every open order (the case's restock
//             order included) — the same fill bars /orders shows
//   On hand   the last closed count of each room, added up
//   Coming    our own animals hanging or booked, as pounds of THIS item by the
//             yield our own past sessions actually made
//   To buy    short − on hand − coming
//
// The numbers it leans on are named at the bottom with their dates, because a
// count is a snapshot — nothing counts a package out of the case when it sells
// — and a yield is history, not a promise. The list suggests; a person buys.
//
// Every short item is listed, covered or not. Charlie, 2026-11-03: "I should
// have like 49 lbs of ribeye on here?" — eight orders due that Thursday wanted
// 49 lb of ribeye, and the page hid the row because 473 lb was "coming" off
// beef hanging and booked through December. Coming is an estimate about weeks
// away; the short is about this week. So the row stays, with Coming beside it
// and To buy reading "covered", and hiding the covered rows is the opt-in.

const C = {
  dark:       '#1A0A04',
  darkBrown:  '#351E0E',
  medBrown:   '#75471B',
  lightBrown: '#A6785A',
  tan:        '#C9A882',
  cream:      '#F2E8D9',
  green:      '#4CAF50',
  red:        '#E53E3E',
  yellow:     '#D97706',
  blue:       '#3B82F6',
}

interface BookedRow { id: string; harvest_date: string; species: string; head_count: number; status: string | null }
interface Payload {
  asOf:    string
  today:   string
  summary: DemandSummary
  lines:   DemandLine[]
  rooms:   RoomCount[]
  supply:  SpeciesSupply[]
  booked:  BookedRow[]
  basis:   { yieldDays: number; settleDays: number; hangingDays: number }
}

const fmt = (n: number, unit: string) => unit === 'LB' ? `${n.toFixed(1)} lb` : `${Math.ceil(n - 1e-9)} ea`
const fmtLbs = (n: number) => `${Math.round(n).toLocaleString()} lb`
/** A count older than this is a guess about today's freezer, and is coloured as one. */
const STALE_DAYS = 30

const CELL: React.CSSProperties = { padding: '0.55rem 0.75rem', fontSize: '0.88rem', color: C.cream, whiteSpace: 'nowrap' }
const NUM:  React.CSSProperties = { ...CELL, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }
const TH:   React.CSSProperties = {
  padding: '0.5rem 0.75rem', fontSize: '0.68rem', color: C.lightBrown, textTransform: 'uppercase',
  letterSpacing: '0.1em', textAlign: 'left', borderBottom: `1px solid rgba(166,120,90,0.3)`, whiteSpace: 'nowrap',
}
const THR: React.CSSProperties = { ...TH, textAlign: 'right' }

function Stat({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div style={{ background: C.dark, border: '1px solid rgba(166,120,90,0.18)', borderLeft: `4px solid ${color ?? C.medBrown}`, borderRadius: 4, padding: '0.8rem 1rem', minWidth: 150 }}>
      <div style={{ fontSize: '0.66rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.1em' }}>{label}</div>
      <div style={{ fontFamily: 'Georgia, serif', fontSize: '1.45rem', fontWeight: 700, color: C.cream, lineHeight: 1.2, marginTop: 2 }}>{value}</div>
      {sub && <div style={{ fontSize: '0.72rem', color: C.tan, marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

export default function DemandPage() {
  const [data, setData]       = useState<Payload | null>(null)
  const [error, setError]     = useState<string | null>(null)
  const [species, setSpecies] = useState<string>('all')
  const [hideCovered, setHideCovered] = useState(false)
  const [open, setOpen]       = useState<Set<string>>(new Set())

  useEffect(() => {
    fetch('/api/demand')
      .then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? r.statusText); return j as Payload })
      .then(setData)
      .catch(e => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  const speciesList = useMemo(() => {
    const s = new Set<string>()
    for (const l of data?.lines ?? []) s.add(l.species ?? 'Unknown')
    return [...s].sort()
  }, [data])

  const rows = useMemo(() => (data?.lines ?? []).filter(l =>
    (species === 'all' || (l.species ?? 'Unknown') === species) && (!hideCovered || l.toBuy > 0)
  ), [data, species, hideCovered])

  const toggle = (key: string) => setOpen(prev => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n })

  const noCounts = data != null && data.rooms.length === 0
  const oldestRoom = data?.rooms.length ? data.rooms[data.rooms.length - 1] : null
  const anyStale = !!(data && oldestRoom && daysBetweenISO(oldestRoom.count_date, data.today) > STALE_DAYS)

  return (
    <div style={{ minHeight: '100vh', background: 'var(--dark-brown)', display: 'flex', flexDirection: 'column' }}>
      <header style={{ background: 'var(--dark)', borderBottom: '1px solid rgba(166,120,90,0.3)', padding: '0 2rem', height: '64px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <Link href="/" style={{ color: C.lightBrown, textDecoration: 'none', fontSize: '0.82rem' }}>← Dashboard</Link>
          <span style={{ color: 'rgba(166,120,90,0.4)' }}>|</span>
          <h1 style={{ fontFamily: 'Georgia, serif', fontSize: '1.1rem', fontWeight: 700, color: C.cream, letterSpacing: '0.08em', textTransform: 'uppercase', margin: 0 }}>Demand</h1>
          <span style={{ fontSize: '0.78rem', color: C.lightBrown }}>what the open orders need that we don&apos;t have</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <Link href="/orders" style={{ color: C.tan, textDecoration: 'none', fontSize: '0.8rem' }}>Retail Orders →</Link>
          <Link href="/inventory" style={{ color: C.tan, textDecoration: 'none', fontSize: '0.8rem' }}>Count the freezer →</Link>
        </div>
      </header>

      <main style={{ flex: 1, padding: '1.5rem 2rem', maxWidth: '1400px', width: '100%', margin: '0 auto', boxSizing: 'border-box' }}>
        {error && (
          <div style={{ background: 'rgba(229,62,62,0.12)', border: `1px solid ${C.red}`, borderRadius: 4, padding: '0.75rem 1rem', color: C.cream, marginBottom: '1rem' }}>
            Couldn&apos;t load demand: {error}
          </div>
        )}
        {!data && !error && <div style={{ color: C.lightBrown, padding: '2rem 0' }}>Adding up the open orders…</div>}

        {data && (
          <>
            {/* The answer, up top */}
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
              <Stat label="Items to buy" value={String(data.summary.linesToBuy)} sub={`${data.summary.linesShort} items short on ${data.summary.openOrders} open orders`} color={data.summary.linesToBuy ? C.red : C.green} />
              <Stat label="Pounds to buy" value={fmtLbs(data.summary.lbsToBuy)} sub="by-the-pound items" color={C.yellow} />
              <Stat label="Packages to buy" value={`${data.summary.pkgsToBuy} ea`} sub="by-the-piece items" color={C.yellow} />
              {data.supply.map(s => (
                <Stat key={s.species} label={`${s.species} coming`}
                  value={`${s.hangingHead + s.bookedHead} hd`}
                  sub={`${s.hangingHead} hanging · ${fmtLbs(s.hangingLbs)}${s.bookedHead ? ` · ${s.bookedHead} booked ≈ ${fmtLbs(s.bookedLbs)}` : ''}`}
                  color={C.blue} />
              ))}
            </div>

            {(noCounts || anyStale) && (
              <div style={{ background: 'rgba(217,119,6,0.12)', border: `1px solid ${C.yellow}`, borderRadius: 4, padding: '0.6rem 1rem', color: C.cream, fontSize: '0.84rem', marginBottom: '1rem' }}>
                {noCounts
                  ? <>No closed inventory count on file, so <b>On hand</b> is blank and everything short reads as to-buy. <Link href="/inventory" style={{ color: C.tan }}>Count a room</Link> and this page nets it off.</>
                  : <>The oldest count in use is <b>{oldestRoom!.location}</b> from {dateLabel(oldestRoom!.count_date, { month: 'short', day: 'numeric' })} — {daysBetweenISO(oldestRoom!.count_date, data.today)} days ago. Sales since then are not deducted.</>}
              </div>
            )}

            {/* Filters */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
              {['all', ...speciesList].map(s => (
                <button key={s} onClick={() => setSpecies(s)} style={{
                  padding: '0.35rem 0.9rem', borderRadius: 3, border: `1px solid ${species === s ? C.tan : 'rgba(166,120,90,0.35)'}`,
                  background: species === s ? C.medBrown : 'transparent', color: species === s ? C.cream : C.lightBrown,
                  fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer',
                }}>{s === 'all' ? 'All species' : s}</button>
              ))}
              <label style={{ marginLeft: 'auto', fontSize: '0.8rem', color: C.lightBrown, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                <input type="checkbox" checked={hideCovered} onChange={e => setHideCovered(e.target.checked)} />
                Hide items covered by the freezer or what&apos;s coming
              </label>
            </div>

            {/* The list */}
            <div style={{ background: C.dark, border: '1px solid rgba(166,120,90,0.18)', borderRadius: 4, overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={TH}>Item</th>
                    <th style={TH}>Species</th>
                    <th style={THR}>Short</th>
                    <th style={THR}>On hand</th>
                    <th style={THR}>Coming</th>
                    <th style={THR}>To buy</th>
                    <th style={THR}>Orders</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && (
                    <tr><td colSpan={7} style={{ ...CELL, color: C.lightBrown, textAlign: 'center', padding: '2rem' }}>
                      {data.lines.length === 0 ? 'Every open order line is filled. Nothing to buy.' : 'Everything short is covered by the freezer or what’s coming.'}
                    </td></tr>
                  )}
                  {rows.map(l => {
                    const isOpen = open.has(l.key)
                    const nextDue = l.orders[0]?.due_date
                    const overdue = nextDue && nextDue < data.today
                    return (
                      <RowGroup key={l.key} isOpen={isOpen} onToggle={() => toggle(l.key)} line={l} today={data.today} overdue={!!overdue} />
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* What the numbers rest on */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1rem', marginTop: '1.25rem' }}>
              <Basis title="On hand — last closed count per room">
                {data.rooms.length === 0
                  ? <li>No closed count on file.</li>
                  : data.rooms.map(r => {
                    const age = daysBetweenISO(r.count_date, data.today)
                    return <li key={r.location}><b>{r.location}</b> — {dateLabel(r.count_date, { month: 'short', day: 'numeric' })} <span style={{ color: age > STALE_DAYS ? C.yellow : C.lightBrown }}>({age}d ago)</span></li>
                  })}
                <li style={{ color: C.lightBrown }}>Rooms never counted contribute nothing. A count is a snapshot: what sold out of the case since is not deducted.</li>
              </Basis>
              <Basis title="Coming — our own animals, by species">
                {data.supply.length === 0 && <li>No own animals hanging or booked.</li>}
                {data.supply.map(s => (
                  <li key={s.species}>
                    <b>{s.species}</b> — {s.hangingHead} hanging ({fmtLbs(s.hangingLbs)}), {s.bookedHead} booked (≈{fmtLbs(s.bookedLbs)}).{' '}
                    {s.yieldSessions
                      ? <span style={{ color: C.lightBrown }}>Yield from {s.yieldSessions} own session{s.yieldSessions === 1 ? '' : 's'}, {fmtLbs(s.yieldHangLbs)} hanging.</span>
                      : <span style={{ color: C.yellow }}>No settled own session to take a yield from — counts as nothing coming.</span>}
                  </li>
                ))}
                {data.booked.length > 0 && (
                  <li style={{ color: C.lightBrown }}>
                    Booked: {data.booked.map(b => `${b.head_count} ${b.species} ${dateLabel(b.harvest_date, { month: 'short', day: 'numeric' })}`).join(' · ')}
                  </li>
                )}
                <li style={{ color: C.lightBrown }}>
                  Yield is pounds of each item per hanging pound, measured on our own single-species sessions in the last {data.basis.yieldDays} days
                  and at least {data.basis.settleDays} days old. Hanging = our carcasses no cut session has scanned, last {data.basis.hangingDays} days.
                </li>
              </Basis>
            </div>
            <div style={{ fontSize: '0.7rem', color: C.lightBrown, marginTop: '0.75rem' }}>
              As of {new Date(data.asOf).toLocaleString('en-US', { timeZone: 'America/Denver', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} MT.
              Nothing here places an order.
            </div>
          </>
        )}
      </main>

      <footer style={{ background: 'var(--dark)', borderTop: '1px solid rgba(166,120,90,0.2)', padding: '0.5rem 2rem', textAlign: 'center', fontSize: '0.72rem', color: C.lightBrown, flexShrink: 0 }}>
        Cowboy Meat Company · 1109 Front St, Forsyth MT · (406) 346-7660
      </footer>
    </div>
  )
}

function Basis({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: C.dark, border: '1px solid rgba(166,120,90,0.18)', borderRadius: 4, padding: '0.8rem 1rem' }}>
      <div style={{ fontSize: '0.66rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.4rem' }}>{title}</div>
      <ul style={{ margin: 0, paddingLeft: '1.1rem', fontSize: '0.8rem', color: C.cream, lineHeight: 1.5 }}>{children}</ul>
    </div>
  )
}

function RowGroup({ line: l, isOpen, onToggle, today, overdue }: {
  line: DemandLine; isOpen: boolean; onToggle: () => void; today: string; overdue: boolean
}) {
  const buyColor = l.toBuy > 0 ? C.red : C.green
  return (
    <>
      <tr onClick={onToggle} style={{ cursor: 'pointer', borderTop: '1px solid rgba(166,120,90,0.12)', background: isOpen ? 'rgba(255,255,255,0.03)' : 'transparent' }}>
        <td style={CELL}>
          <span style={{ color: C.lightBrown, marginRight: 8, display: 'inline-block', width: 10 }}>{isOpen ? '▾' : '▸'}</span>
          {l.item_name}
          {l.plu_number
            ? <span style={{ color: C.lightBrown, fontSize: '0.72rem', marginLeft: 8 }}>PLU {l.plu_number}</span>
            : <span title="Typed in without a PLU, so the freezer and the yield can't be matched to it" style={{ color: C.yellow, fontSize: '0.72rem', marginLeft: 8 }}>no PLU</span>}
        </td>
        <td style={{ ...CELL, color: C.tan }}>{l.species ?? '—'}</td>
        <td style={NUM}>{fmt(l.short, l.unit)}</td>
        <td style={{ ...NUM, color: l.onHand == null ? C.lightBrown : C.cream }}>{l.onHand == null ? (l.plu_number ? 'no count' : '—') : fmt(l.onHand, l.unit)}</td>
        <td style={{ ...NUM, color: l.coming == null ? C.lightBrown : C.cream }} title={l.coming == null ? 'No own-session yield for this item' : `${fmt(l.comingHanging, l.unit)} hanging + ${fmt(l.comingBooked, l.unit)} booked`}>
          {l.coming == null ? (l.plu_number ? 'no yield' : '—') : fmt(l.coming, l.unit)}
        </td>
        <td style={{ ...NUM, fontWeight: 700, color: buyColor }}>{l.toBuy > 0 ? fmt(l.toBuy, l.unit) : 'covered'}</td>
        <td style={{ ...NUM, color: overdue ? C.red : C.tan }}>
          {l.orders.length}{l.orders.some(o => o.restock) ? ' · case' : ''}
          {overdue && <span title="An order for this item is past due" style={{ marginLeft: 6 }}>!</span>}
        </td>
      </tr>
      {isOpen && (
        <tr style={{ background: 'rgba(0,0,0,0.25)' }}>
          <td colSpan={7} style={{ padding: '0.4rem 0.75rem 0.8rem 2.4rem' }}>
            <table style={{ borderCollapse: 'collapse' }}>
              <tbody>
                {l.orders.map(o => (
                  <tr key={o.order_id}>
                    <td style={{ ...CELL, padding: '0.2rem 1.25rem 0.2rem 0', fontSize: '0.82rem' }}>
                      <Link href="/orders" style={{ color: o.restock ? C.yellow : C.cream, textDecoration: 'none' }}>
                        {o.restock ? 'Retail Case (standing restock)' : o.customer_name}
                      </Link>
                    </td>
                    <td style={{ ...CELL, padding: '0.2rem 1.25rem 0.2rem 0', fontSize: '0.82rem', color: o.due_date < today ? C.red : C.tan }}>
                      due {dateLabel(o.due_date, { weekday: 'short', month: 'short', day: 'numeric' })}
                    </td>
                    <td style={{ ...CELL, padding: '0.2rem 1.25rem 0.2rem 0', fontSize: '0.82rem', color: C.lightBrown }}>{o.status.replace('_', ' ')}</td>
                    <td style={{ ...NUM, padding: '0.2rem 0', fontSize: '0.82rem' }}>needs {fmt(o.short, l.unit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {l.coming != null && (
              <div style={{ fontSize: '0.74rem', color: C.lightBrown, marginTop: 6 }}>
                Coming: {fmt(l.comingHanging, l.unit)} off what&apos;s hanging, {fmt(l.comingBooked, l.unit)} off booked kills (estimate).
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  )
}
