'use client'
// Dollars booked per harvest week, against what a week needs — so the owner
// sees a thin week coming while there's still time to go find animals
// (Charlie, 2026-09-13). Data and assumptions: /api/schedule/dollars.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { BookedDollarsResponse } from '@/app/api/schedule/dollars/route'

const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`
const short = (n: number) => (n >= 1000 ? `$${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : money(n))
const wk = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

// How far ahead a short week is worth shouting about.
const WARN_WEEKS = 6

export default function BookedDollars() {
  const [d, setD] = useState<BookedDollarsResponse | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  const load = () => fetch('/api/schedule/dollars').then(r => r.json()).then(x => { if (x.weeks) setD(x) }).catch(() => {})
  useEffect(() => { load() }, [])

  if (!d) return null
  const target = d.target
  const max = Math.max(target ?? 0, ...d.weeks.map(w => w.dollars), 1)
  // This week is mostly already in; the first short week AFTER it is the call to act.
  const short1 = target ? d.weeks.slice(1, WARN_WEEKS + 1).find(w => w.dollars < target) : undefined
  const saveTarget = async (value: number | null) => {
    await fetch('/api/schedule/dollars', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target: value }) })
    setEditing(false)
    load()
  }

  return (
    <div style={{ background: 'var(--dark)', border: `1px solid ${short1 ? 'rgba(239,68,68,0.45)' : 'rgba(166,120,90,0.2)'}`, borderRadius: 4, padding: '0.8rem 1rem', marginBottom: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.9rem', flexWrap: 'wrap', marginBottom: '0.6rem' }}>
        <span style={{ color: 'var(--cream)', fontWeight: 700, fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>💵 Dollars booked</span>
        {target != null && (short1
          ? <span style={{ color: '#FCA5A5', fontSize: '0.82rem', fontWeight: 700 }}>⚠ Week of {wk(short1.week_start)} is {money(target - short1.dollars)} short — get animals coming in</span>
          : <span style={{ color: '#86EFAC', fontSize: '0.82rem', fontWeight: 700 }}>✓ The next {WARN_WEEKS} weeks each cover the target</span>)}
        <span style={{ marginLeft: 'auto', color: 'var(--tan)', fontSize: '0.75rem' }}>
          {editing ? (
            <>
              target $<input autoFocus value={draft} onChange={e => setDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') saveTarget(draft.trim() ? Number(draft) : null); if (e.key === 'Escape') setEditing(false) }}
                style={{ width: 70, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(166,120,90,0.4)', borderRadius: 3, color: 'var(--cream)', fontSize: '0.75rem', padding: '0 4px' }} />
              /wk <button onClick={() => saveTarget(draft.trim() ? Number(draft) : null)} style={linkBtn}>save</button>
              {d.target_source === 'set' && <button onClick={() => saveTarget(null)} style={linkBtn}>use payroll</button>}
            </>
          ) : (
            <button onClick={() => { setDraft(String(target ?? '')); setEditing(true) }} style={linkBtn}
              title={d.target_source === 'payroll' ? 'Average weekly payroll, last 13 weeks — does what we booked cover the crew?' : 'Set by hand'}>
              target {target != null ? money(target) : '—'}/wk {d.target_source === 'payroll' ? '(avg payroll)' : ''} ✎
            </button>
          )}
          {' · '}<Link href="/pipeline" style={{ color: 'var(--tan)' }}>in the building →</Link>
        </span>
      </div>

      {/* One bar per harvest week */}
      <div style={{ position: 'relative', display: 'grid', gridTemplateColumns: `repeat(${d.weeks.length}, 1fr)`, gap: '0.35rem', alignItems: 'end', height: 96 }}>
        {target != null && (
          <div title={`Target ${money(target)}/wk`} style={{ position: 'absolute', left: 0, right: 0, bottom: `${(target / max) * 70 + 18}px`, borderTop: '1px dashed rgba(242,232,217,0.5)', pointerEvents: 'none' }} />
        )}
        {d.weeks.map((w, i) => {
          const under = target != null && w.dollars < target
          const color = i === 0 ? 'rgba(166,120,90,0.6)' : under ? '#EF4444' : '#4CAF50'
          const head = Object.entries(w.head).map(([s, n]) => `${n} ${s.toLowerCase()}`).join(', ')
          const tip = `Week of ${wk(w.week_start)}: ${money(w.dollars)} booked` +
            (head ? `\n${head} · ${w.appointments} appointment${w.appointments !== 1 ? 's' : ''}` : '\nnothing booked') +
            (w.own_head ? `\n+ ${w.own_head} of our own (not counted)` : '') +
            (w.accounts.length ? `\n${w.accounts.slice(0, 8).join(', ')}${w.accounts.length > 8 ? '…' : ''}` : '') +
            (target != null ? `\n${under ? `${money(target - w.dollars)} under` : `${money(w.dollars - target)} over`} target` : '')
          return (
            <div key={w.week_start} title={tip} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%', cursor: 'help' }}>
              <span style={{ color: 'var(--cream)', fontSize: '0.66rem', fontWeight: 700, marginBottom: 2 }}>{short(w.dollars)}</span>
              <div style={{ width: '100%', maxWidth: 46, height: Math.max(2, (w.dollars / max) * 70), background: color, borderRadius: '2px 2px 0 0' }} />
              <span style={{ color: i === 0 ? 'var(--tan)' : 'rgba(201,168,130,0.75)', fontSize: '0.62rem', marginTop: 3, whiteSpace: 'nowrap' }}>{i === 0 ? 'this wk' : wk(w.week_start)}</span>
            </div>
          )
        })}
      </div>

      <div style={{ color: 'rgba(201,168,130,0.7)', fontSize: '0.66rem', marginTop: '0.45rem' }}>
        Kill + cut &amp; wrap by harvest week at recent average hanging weights
        {d.per_head.Beef?.hanging_lbs ? ` (beef ${d.per_head.Beef.hanging_lbs} lb ≈ ${money(d.per_head.Beef.dollars)}` : ''}
        {d.per_head.Hog?.hanging_lbs ? `, hog ${d.per_head.Hog.hanging_lbs} lb ≈ ${money(d.per_head.Hog.dollars)})` : d.per_head.Beef?.hanging_lbs ? ')' : ''}
        , plus smokehouse on linked cut cards. Our own animals aren&apos;t counted.
      </div>
    </div>
  )
}

const linkBtn: React.CSSProperties = { background: 'none', border: 'none', color: 'var(--tan)', fontSize: '0.75rem', cursor: 'pointer', padding: 0, marginLeft: 4 }
