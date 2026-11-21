'use client'
// /staging — every carcass still on the rail, oldest kill first, with what
// stands between it and the saw: a missing cut card (red) or more days to hang.
// Carcasses moved to the staging cooler (off the QR page) are listed on top.
//
// Built after a sold carcass hung uncut for weeks with nothing to show it was
// waiting (Charlie, 2026-11-21). Tap a row for the carcass page, where the
// crew moves it to staging or marks it cut.

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { C, btn, card, h2 } from '@/app/timekeeping/shared'
import { agingLabel } from '@/lib/carcassAging'
import { CARD_TEXT, cardState, FloorCarcass, killDateLabel, loadHangingCarcasses, oldestFirst, stampMT } from '@/lib/carcassFloor'

const REFRESH_MS = 60_000

export default function StagingPage() {
  const [rows, setRows] = useState<FloorCarcass[] | null>(null)
  const [err, setErr] = useState('')
  const [species, setSpecies] = useState<string>('All')

  const load = useCallback(async () => {
    try {
      setRows((await loadHangingCarcasses()).sort(oldestFirst))
      setErr('')
    } catch (e) {
      setErr((e as Error).message || 'Couldn’t load the cooler.')
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loading; state is only set once the requests resolve
    load()
    const t = setInterval(load, REFRESH_MS)
    return () => clearInterval(t)
  }, [load])

  const speciesList = useMemo(() => ['All', ...Array.from(new Set((rows ?? []).map(r => r.log.species))).sort()], [rows])
  const shown = (rows ?? []).filter(r => species === 'All' || r.log.species === species)
  const staged  = shown.filter(r => r.log.staged_at)
  const hanging = shown.filter(r => !r.log.staged_at)
  const noCard  = shown.filter(r => cardState(r) !== 'have').length
  const ready   = shown.filter(r => cardState(r) === 'have' && r.aging.ready).length

  return (
    <div style={{ minHeight: '100vh', background: C.darkBrown, padding: '1rem 1rem 3rem' }}>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.8rem' }}>
          <div style={{ fontFamily: 'Georgia, serif', fontSize: '1.2rem', fontWeight: 700, color: C.cream, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Cooler &amp; Staging</div>
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
            {speciesList.map(s => (
              <button key={s} onClick={() => setSpecies(s)}
                style={{ ...btn(species === s ? C.tan : 'transparent'), color: species === s ? C.dark : C.tan, border: `1px solid ${C.medBrown}` }}>{s}</button>
            ))}
            <button onClick={load} style={btn(C.medBrown)}>Refresh</button>
          </div>
        </div>

        {err && <div style={{ ...card, color: C.red }}>{err}</div>}
        {rows === null && !err && <div style={{ color: C.tan, textAlign: 'center', padding: '2rem' }}>Loading…</div>}

        {rows !== null && (
          <>
            <p style={{ color: C.tan, fontSize: '0.95rem', margin: '0 0 1rem' }}>
              {shown.length} hanging · <span style={{ color: C.green }}>{ready} ready to cut</span> ·{' '}
              <span style={{ color: noCard ? C.red : C.tan, fontWeight: noCard ? 700 : 400 }}>{noCard} missing a cut card</span>
            </p>
            <Section title={`In staging (${staged.length})`} rows={staged} empty="Nothing in the staging cooler." showStaged />
            <Section title={`Hanging (${hanging.length})`} rows={hanging} empty="Nothing else on the rail." />
          </>
        )}
      </div>
    </div>
  )
}

function Section({ title, rows, empty, showStaged }: { title: string; rows: FloorCarcass[]; empty: string; showStaged?: boolean }) {
  return (
    <div style={card}>
      <h2 style={h2}>{title}</h2>
      {rows.length === 0 && <div style={{ color: C.tan, fontSize: '0.9rem' }}>{empty}</div>}
      {rows.map(r => <Row key={r.log.id} r={r} showStaged={showStaged} />)}
    </div>
  )
}

function Row({ r, showStaged }: { r: FloorCarcass; showStaged?: boolean }) {
  const cs = cardState(r)
  const cardOk = cs === 'have'
  const names = r.entry?.cut_customers.length
    ? r.entry.cut_customers.map(c => `${c.name}${c.portion && c.portion !== 'Whole' ? ` (${c.portion})` : ''}`).join(', ')
    : (r.entry?.customer_name || r.log.producer || 'Unassigned')
  return (
    <Link href={`/carcass/${r.log.id}`} style={{
      display: 'grid', gridTemplateColumns: '4.2rem 1fr auto', gap: '0.7rem', alignItems: 'center', textDecoration: 'none',
      padding: '0.6rem 0.4rem', borderBottom: '1px solid rgba(166,120,90,0.15)',
      borderLeft: `4px solid ${cardOk ? (r.aging.ready ? C.green : C.amber) : C.red}`, paddingLeft: '0.6rem',
    }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ color: C.cream, fontSize: '1.6rem', fontWeight: 900, lineHeight: 1 }}>{r.log.carcass_tag || '—'}</div>
        <div style={{ color: C.lightBrown, fontSize: '0.68rem', textTransform: 'uppercase' }}>{r.log.species}</div>
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ color: C.cream, fontSize: '0.98rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{names}</div>
        <div style={{ color: C.tan, fontSize: '0.8rem' }}>
          Killed {killDateLabel(r.log.harvest_date)}
          {r.log.hot_carcass_weight_lbs != null && ` · ${r.log.hot_carcass_weight_lbs} lb`}
          {showStaged && r.log.staged_at && ` · staged ${stampMT(r.log.staged_at)}${r.log.staged_by ? ` by ${r.log.staged_by}` : ''}`}
        </div>
      </div>
      <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
        <div style={{ color: cardOk ? C.green : C.red, fontSize: '0.85rem', fontWeight: 700 }}>{cardOk ? 'Card ✓' : CARD_TEXT[cs]}</div>
        <div style={{ color: r.aging.ready ? C.green : C.amber, fontSize: '0.85rem' }}>
          {agingLabel(r.aging)} · {r.aging.daysHung}/{r.aging.target}d
        </div>
      </div>
    </Link>
  )
}
