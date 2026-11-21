'use client'
// /carcass/[id] — what a phone opens when it scans the QR on a carcass tag.
//
// The question it answers is the one that let a sold carcass hang uncut for
// weeks (Tammy Eustice, Oct 15 tag 15): is this carcass ready to cut? That is
// two things — its cut card is in, and it has hung long enough — and then two
// moves the crew logs from here: into the staging cooler, then cut.
//
// Anyone can read the page; moving a carcass takes the time clock PIN, so the
// staging list can say who moved it.

import { use, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { HarvestLog, CarcassAssignment } from '@/lib/types'
import { C, btn, card, h2 } from '@/app/timekeeping/shared'
import { agingLabel, agingState, defaultAgingDays } from '@/lib/carcassAging'
import { CARD_TEXT, cardState, FloorCarcass, killDateLabel, loadHangingCarcasses, stampMT } from '@/lib/carcassFloor'
import { clearFloorSession, floorAction, FloorSession, getFloorSession } from '@/lib/floorSession'
import FloorSignIn from '@/components/FloorSignIn'

type Action = { action: 'stage' | 'unstage' | 'cut' } | { action: 'aging'; days: number | null }

type View =
  | { kind: 'loading' }
  | { kind: 'missing' }
  | { kind: 'error'; message: string }
  | { kind: 'hanging'; c: FloorCarcass }
  | { kind: 'off'; log: HarvestLog; names: string[] }

const cardHref = (id: string) => `/cutting-instructions?id=${encodeURIComponent(id)}`

export default function CarcassPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [view, setView] = useState<View>({ kind: 'loading' })
  const [session, setSession] = useState<FloorSession | null>(null)
  const [pending, setPending] = useState<Action | null>(null)   // waiting on a sign-in
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [agingDraft, setAgingDraft] = useState<string | null>(null)

  // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage is only readable after mount
  useEffect(() => { setSession(getFloorSession()) }, [])

  const load = useCallback(async () => {
    try {
      const logs = await fetch(`/api/harvest?ids=${encodeURIComponent(id)}`, { cache: 'no-store' }).then(r => r.json())
      const log = Array.isArray(logs) ? (logs[0] as HarvestLog | undefined) : undefined
      if (!log) { setView({ kind: 'missing' }); return }
      if (log.status === 'chilling') {
        const all = await loadHangingCarcasses()
        const c = all.find(x => x.log.id === id)
          ?? { log, entry: null, aging: agingState(log.harvest_date, log.species, log.aging_target_days) }
        setView({ kind: 'hanging', c })
      } else {
        const asg = await fetch(`/api/carcass-assignments?harvest_log_ids=${encodeURIComponent(id)}`).then(r => r.json()).catch(() => [])
        const names = Array.isArray(asg) ? (asg as CarcassAssignment[]).map(a => `${a.customer_name} (${a.portion})`) : []
        setView({ kind: 'off', log, names })
      }
    } catch (e) {
      setView({ kind: 'error', message: (e as Error).message || 'Couldn’t load this carcass.' })
    }
  }, [id])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- loading; state is only set once the requests resolve
  useEffect(() => { load() }, [load])

  const run = useCallback(async (a: Action, s: FloorSession) => {
    setBusy(true); setErr('')
    try {
      await floorAction(`/api/carcass-floor/${id}`, s.token, a)
      setAgingDraft(null)
      await load()
    } catch (e) {
      const status = (e as { status?: number }).status
      if (status === 401) { setSession(null); setPending(a); setErr('Signed out. Enter your PIN again.') }
      else setErr((e as Error).message)
    } finally { setBusy(false) }
  }, [id, load])

  const act = (a: Action) => {
    const s = getFloorSession()
    if (!s) { setSession(null); setPending(a); return }
    setSession(s)
    run(a, s)
  }

  const markCut = (c: FloorCarcass) => {
    const warn: string[] = []
    const cs = cardState(c)
    if (cs !== 'have') warn.push(`• ${CARD_TEXT[cs]}.`)
    if (!c.aging.ready) warn.push(`• It has hung ${c.aging.daysHung} of ${c.aging.target} days (${agingLabel(c.aging)}).`)
    const split = c.entry && c.entry.cut_customers.length > 1
    if (split) warn.push(`• It is split between ${c.entry!.cut_customers.map(x => `${x.name} (${x.portion})`).join(', ')}. Only mark it cut once every portion is cut.`)
    const msg = `Mark tag ${c.log.carcass_tag || '—'} as cut? It comes off the rail and off the cut schedule.` +
      (warn.length ? `\n\n${warn.join('\n')}` : '')
    if (!window.confirm(msg)) return
    act({ action: 'cut' })
  }

  const header = (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.9rem', gap: '0.5rem', flexWrap: 'wrap' }}>
      <div style={{ fontFamily: 'Georgia, serif', fontSize: '1.1rem', fontWeight: 700, color: C.cream, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Carcass</div>
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
        {session && (
          <button style={{ ...btn('transparent'), border: `1px solid ${C.medBrown}`, color: C.tan }}
            onClick={() => { clearFloorSession(); setSession(null) }}>Sign out {session.name.split(' ')[0]}</button>
        )}
        <Link href="/staging" style={{ ...btn(C.medBrown), textDecoration: 'none' }}>Staging list</Link>
      </div>
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', background: C.darkBrown, padding: '1rem 1rem 3rem' }}>
      <div style={{ maxWidth: 560, margin: '0 auto' }}>
        {header}
        {pending && !session && (
          <FloorSignIn
            why={err || 'Sign in to move this carcass.'}
            onCancel={() => { setPending(null); setErr('') }}
            onDone={s => { setSession(s); const a = pending; setPending(null); setErr(''); run(a, s) }}
          />
        )}
        {view.kind === 'loading' && <div style={{ color: C.tan, textAlign: 'center', padding: '2rem' }}>Loading…</div>}
        {view.kind === 'missing' && <div style={{ ...card, color: C.tan }}>No carcass matches this QR code. It may have been deleted from the harvest log.</div>}
        {view.kind === 'error' && <div style={{ ...card, color: C.red }}>{view.message} <button style={btn(C.medBrown)} onClick={load}>Retry</button></div>}
        {view.kind === 'off' && <OffRail log={view.log} names={view.names} />}
        {view.kind === 'hanging' && (() => {
          const c = view.c
          const l = c.log
          const cs = cardState(c)
          const cardOk = cs === 'have'
          const staged = !!l.staged_at
          return (
            <>
              <Basics log={l} />

              <div style={card}>
                <h2 style={h2}>Ready to cut?</h2>
                <Line ok={cardOk} label="Cut card" value={CARD_TEXT[cs]} />
                <Line ok={c.aging.ready} label="Aging"
                  value={`${agingLabel(c.aging)} · hung ${c.aging.daysHung} of ${c.aging.target} days${c.aging.custom ? ' (set for this carcass)' : ''}`} />
                <Line ok={staged ? true : null} label="Where"
                  value={staged ? `Staging cooler since ${stampMT(l.staged_at)}${l.staged_by ? ` · ${l.staged_by}` : ''}` : 'Hanging in the cooler'} />
              </div>

              <div style={card}>
                <h2 style={h2}>Customers</h2>
                {(c.entry?.cut_customers.length ?? 0) === 0 && (
                  <div style={{ color: C.red, fontSize: '0.95rem' }}>
                    Nobody is assigned to this carcass yet{c.entry?.customer_name ? ` (booked as ${c.entry.customer_name})` : ''}. Assign it on the cut schedule.
                  </div>
                )}
                {c.entry?.cut_customers.map(cc => (
                  <div key={cc.appointment_customer_id} style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', padding: '0.45rem 0', borderBottom: '1px solid rgba(166,120,90,0.15)', alignItems: 'baseline' }}>
                    <span style={{ color: C.cream, fontSize: '1rem' }}>{cc.name} <span style={{ color: C.tan, fontSize: '0.85rem' }}>· {cc.portion}</span></span>
                    {cc.has_instructions && cc.cutting_instruction_id
                      ? <Link href={cardHref(cc.cutting_instruction_id)} style={{ color: C.green, fontSize: '0.9rem', whiteSpace: 'nowrap' }}>Cut card ✓</Link>
                      : <span style={{ color: C.red, fontSize: '0.9rem', fontWeight: 700, whiteSpace: 'nowrap' }}>No cut card</span>}
                  </div>
                ))}
              </div>

              {err && !pending && <div style={{ ...card, color: C.red }}>{err}</div>}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem', marginBottom: '1rem' }}>
                {staged
                  ? <button disabled={busy} style={{ ...bigAction(C.medBrown), opacity: busy ? 0.6 : 1 }} onClick={() => act({ action: 'unstage' })}>Back to hanging</button>
                  : <button disabled={busy} style={{ ...bigAction(C.amber), opacity: busy ? 0.6 : 1 }} onClick={() => act({ action: 'stage' })}>Move to staging</button>}
                <button disabled={busy} style={{ ...bigAction(C.green), opacity: busy ? 0.6 : 1 }} onClick={() => markCut(c)}>Mark cut</button>
              </div>

              <div style={card}>
                <h2 style={h2}>Aging target</h2>
                <p style={{ color: C.tan, fontSize: '0.85rem', margin: '0 0 0.6rem' }}>
                  {l.species} default is {defaultAgingDays(l.species)} days. Change it only when the customer asks for longer or shorter.
                </p>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                  <input type="number" inputMode="numeric" min={1} max={90} placeholder={String(defaultAgingDays(l.species))}
                    value={agingDraft ?? (l.aging_target_days != null ? String(l.aging_target_days) : '')}
                    onChange={e => setAgingDraft(e.target.value.replace(/\D/g, '').slice(0, 2))}
                    style={{ width: 90, background: C.darkBrown, color: C.cream, border: `1px solid ${C.medBrown}`, borderRadius: 6, padding: '0.6rem', fontSize: '1.1rem' }} />
                  <span style={{ color: C.tan }}>days</span>
                  <button disabled={busy || agingDraft === null} style={{ ...btn(C.medBrown), opacity: agingDraft === null ? 0.5 : 1 }}
                    onClick={() => act({ action: 'aging', days: agingDraft ? Number(agingDraft) : null })}>Save</button>
                </div>
              </div>
            </>
          )
        })()}
      </div>
    </div>
  )
}

const bigAction = (color: string): React.CSSProperties => ({
  ...btn(color), padding: '1.1rem 0.8rem', fontSize: '1.1rem', borderRadius: 8, minHeight: 64, color: '#1A0A04',
})

function Basics({ log: l }: { log: HarvestLog }) {
  const h1 = l.half_1_weight_lbs, h2w = l.half_2_weight_lbs
  return (
    <div style={{ ...card, textAlign: 'center' }}>
      <div style={{ color: C.tan, fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
        {l.species}{l.kill_type ? ` · ${l.kill_type}` : ''}{l.producer ? ` · ${l.producer}` : ''}
      </div>
      <div style={{ color: C.cream, fontSize: '3.2rem', fontWeight: 900, lineHeight: 1.05 }}>Tag {l.carcass_tag || '—'}</div>
      <div style={{ color: C.cream, fontSize: '1rem' }}>Killed {killDateLabel(l.harvest_date)}</div>
      <div style={{ color: C.tan, fontSize: '0.95rem', marginTop: '0.3rem' }}>
        HCW {l.hot_carcass_weight_lbs != null ? `${l.hot_carcass_weight_lbs} lb` : '—'}
        {(h1 != null || h2w != null) && ` · L ${h1 ?? '—'} / R ${h2w ?? '—'}`}
      </div>
    </div>
  )
}

function Line({ ok, label, value }: { ok: boolean | null; label: string; value: string }) {
  const color = ok === null ? C.tan : ok ? C.green : C.red
  return (
    <div style={{ display: 'flex', gap: '0.6rem', padding: '0.45rem 0', borderBottom: '1px solid rgba(166,120,90,0.15)', alignItems: 'baseline' }}>
      <span style={{ color, fontSize: '1.1rem', width: '1.2rem' }}>{ok === null ? '•' : ok ? '✓' : '✗'}</span>
      <span style={{ color: C.lightBrown, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.08em', width: '5.5rem', flexShrink: 0 }}>{label}</span>
      <span style={{ color, fontSize: '1rem', fontWeight: 600 }}>{value}</span>
    </div>
  )
}

function OffRail({ log, names }: { log: HarvestLog; names: string[] }) {
  const what = log.status === 'delivered' ? 'Delivered whole' : log.status === 'cut' ? 'Cut' : log.status === 'complete' ? 'Complete' : log.status
  return (
    <>
      <Basics log={log} />
      <div style={card}>
        <h2 style={h2}>Off the rail</h2>
        <div style={{ color: C.green, fontSize: '1.05rem', fontWeight: 700 }}>
          {what}{log.cut_at ? ` ${stampMT(log.cut_at)}` : ''}{log.cut_by ? ` · ${log.cut_by}` : ''}
        </div>
        {names.length > 0 && <div style={{ color: C.tan, marginTop: '0.4rem' }}>{names.join(', ')}</div>}
      </div>
    </>
  )
}
