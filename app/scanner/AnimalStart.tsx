'use client'
// The top of New Session: start from the animal, not a typed name.
//
// Scan the carcass tag or the cut card — or tap the animal off the cooler
// list — and the session gets that animal's appointment and cut card, with the
// customer's name filled in underneath (still editable: the floor adds the
// hanging weight). Typing a name without an animal still works for retail
// and repacks. Charlie, 2026-09-13 — lib/sessionLinks.ts has the why.

import { useEffect, useMemo, useRef, useState } from 'react'
import type { CoolerAnimal, ResolvedAnimal } from '@/lib/sessionLinks'

const C = {
  dark: '#1A0A04', medBrown: '#75471B', lightBrown: '#A6785A', tan: '#C9A882', cream: '#F2E8D9', yellow: '#D97706', green: '#4CAF50',
}

export interface AnimalPick {
  customer_name: string
  appointment_id: string | null
  ci_id: string | null
  /** A carcass tag to add to the session as its input. Null when only the card or a split animal was picked. */
  carcass_code: string | null
  label: string
}

export default function AnimalStart({ date, pick, onPick, initialCode }: {
  date: string
  pick: AnimalPick | null
  onPick: (p: AnimalPick | null) => void
  /** A tag scanned on the sessions screen that opened this form. */
  initialCode?: string | null
}) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [choices, setChoices] = useState<{ hit: ResolvedAnimal } | null>(null)
  const [showCooler, setShowCooler] = useState(false)
  const [cooler, setCooler] = useState<CoolerAnimal[] | null>(null)
  const [filter, setFilter] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!showCooler || cooler) return
    fetch(`/api/scanner/animal?cooler=1&date=${date}`).then(r => r.json()).then(d => setCooler(d.animals ?? [])).catch(() => setCooler([]))
  }, [showCooler, cooler, date])

  const resolve = async (given?: string) => {
    const raw = (given ?? code).trim()
    if (!raw) return
    setBusy(true); setMsg(''); setChoices(null)
    try {
      const hit: ResolvedAnimal = await fetch(`/api/scanner/animal?code=${encodeURIComponent(raw)}`).then(r => r.json())
      setCode('')
      if (!hit.found) { setMsg(hit.label); return }
      if (hit.cards.length > 1) { setChoices({ hit }); return }
      const card = hit.cards[0] ?? null
      onPick({
        customer_name: card?.customer_name ?? '',
        appointment_id: hit.appointment_id,
        ci_id: card?.id ?? null,
        carcass_code: hit.carcass_code,
        label: hit.label,
      })
      if (!card) setMsg('No cut card on this animal yet — type the customer below')
    } catch {
      setMsg('Lookup failed — type the customer below')
    } finally {
      setBusy(false)
    }
  }

  // A carcass tag scanned on the sessions screen opens this form already looked up.
  const firstCode = useRef(initialCode)
  useEffect(() => {
    const first = firstCode.current
    firstCode.current = null
    if (first) resolve(first)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return (cooler ?? []).filter(a => !q || `${a.tag} ${a.species} ${a.producer} ${a.picks.map(p => p.customer_name).join(' ')}`.toLowerCase().includes(q))
  }, [cooler, filter])

  return (
    <div style={{ marginBottom: '1rem' }}>
      <label style={{ display: 'block', fontSize: '0.7rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.35rem' }}>
        Start from the animal
      </label>

      {pick ? (
        <div style={{ background: 'rgba(76,175,80,0.12)', border: `1px solid ${C.green}`, borderRadius: 4, padding: '0.55rem 0.7rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: C.green, fontSize: '0.72rem', fontWeight: 700 }}>🔗 Linked to the animal</div>
            <div style={{ color: C.cream, fontSize: '0.85rem' }}>{pick.label}</div>
            <div style={{ color: C.lightBrown, fontSize: '0.7rem' }}>
              {pick.ci_id ? 'cut card ✓' : 'no cut card'}{pick.carcass_code ? ` · adds ${pick.carcass_code} to the session` : ''}
            </div>
          </div>
          <button type="button" onClick={() => { onPick(null); setMsg(''); setTimeout(() => inputRef.current?.focus(), 0) }}
            style={{ background: 'none', border: 'none', color: C.lightBrown, fontSize: '1rem', cursor: 'pointer' }} title="Unlink">✕</button>
        </div>
      ) : (
        <>
          <input ref={inputRef} autoFocus value={code} onChange={e => setCode(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); resolve() } }}
            placeholder={busy ? 'Looking up…' : 'Scan the carcass tag or cut card'}
            style={{ width: '100%', background: 'rgba(255,255,255,0.07)', border: `1px solid ${C.tan}`, borderRadius: 4, padding: '0.75rem', color: C.cream, fontSize: '1.05rem', outline: 'none', boxSizing: 'border-box' }} />
          {msg && <div style={{ color: C.yellow, fontSize: '0.76rem', marginTop: '0.35rem' }}>{msg}</div>}

          {choices && (
            <div style={{ marginTop: '0.45rem' }}>
              <div style={{ color: C.cream, fontSize: '0.78rem', marginBottom: '0.3rem' }}>{choices.hit.label} — whose is this?</div>
              {choices.hit.cards.map(c => (
                <button key={c.id} type="button"
                  onClick={() => { onPick({ customer_name: c.customer_name, appointment_id: choices.hit.appointment_id, ci_id: c.id, carcass_code: choices.hit.carcass_code, label: choices.hit.label }); setChoices(null) }}
                  style={{ display: 'block', width: '100%', textAlign: 'left', marginBottom: '0.3rem', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(166,120,90,0.4)', borderRadius: 4, padding: '0.5rem 0.6rem', color: C.cream, fontSize: '0.88rem', cursor: 'pointer' }}>
                  {c.customer_name}
                  {/* Same customer on two cards reads identically — the card code and date tell them apart. */}
                  <span style={{ display: 'block', color: C.lightBrown, fontSize: '0.7rem' }}>
                    CI-{c.id.replace(/-/g, '').slice(0, 8).toUpperCase()}{c.species ? ` · ${c.species}` : ''}{c.created_at ? ` · card made ${c.created_at.slice(5, 10)}` : ''}
                  </span>
                </button>
              ))}
            </div>
          )}

          <button type="button" onClick={() => setShowCooler(s => !s)}
            style={{ marginTop: '0.4rem', background: 'none', border: 'none', color: C.tan, fontSize: '0.78rem', cursor: 'pointer', padding: 0 }}>
            {showCooler ? '▾' : '▸'} or pick from the cooler
          </button>
          {showCooler && (
            <div style={{ marginTop: '0.35rem', border: '1px solid rgba(166,120,90,0.3)', borderRadius: 4, background: C.dark }}>
              <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter tag, name, producer"
                style={{ width: '100%', background: 'transparent', border: 'none', borderBottom: '1px solid rgba(166,120,90,0.25)', padding: '0.45rem 0.6rem', color: C.cream, fontSize: '0.85rem', outline: 'none', boxSizing: 'border-box' }} />
              <div style={{ maxHeight: 220, overflowY: 'auto' }}>
                {!cooler && <div style={{ color: C.lightBrown, fontSize: '0.78rem', padding: '0.5rem 0.6rem' }}>Loading…</div>}
                {cooler && !shown.length && <div style={{ color: C.lightBrown, fontSize: '0.78rem', padding: '0.5rem 0.6rem' }}>Nothing hanging matches.</div>}
                {shown.map(a => a.picks.map((p, i) => (
                  <button key={`${a.harvest_log_id}-${i}`} type="button"
                    onClick={() => onPick({
                      customer_name: p.customer_name,
                      appointment_id: a.appointment_id,
                      ci_id: p.cutting_instruction_id,
                      // A split animal: the whole-carcass code would pull both halves off the rail — scan the half's tag instead.
                      carcass_code: a.picks.length === 1 ? a.code : null,
                      label: `${a.species ?? 'Carcass'} · Tag ${a.tag}${a.weight_lbs ? ` · ${Math.round(a.weight_lbs)} lb` : ''}${a.producer ? ` · ${a.producer}` : ''}`,
                    })}
                    style={{ display: 'block', width: '100%', textAlign: 'left', background: 'transparent', border: 'none', borderBottom: '1px solid rgba(166,120,90,0.12)', padding: '0.45rem 0.6rem', cursor: 'pointer' }}>
                    <div style={{ color: C.cream, fontSize: '0.86rem' }}>
                      {a.scheduled_today && <span style={{ color: C.green, fontWeight: 700 }}>TODAY · </span>}
                      {p.customer_name || '(no customer on the booking)'}{a.picks.length > 1 ? ` · ${i + 1} of ${a.picks.length}` : ''}
                    </div>
                    <div style={{ color: C.lightBrown, fontSize: '0.7rem' }}>
                      {a.species} · Tag {a.tag}{a.weight_lbs ? ` · ${Math.round(a.weight_lbs)} lb` : ''} · killed {a.harvest_date.slice(5)}{p.cutting_instruction_id ? ' · cut card ✓' : ''}
                    </div>
                  </button>
                )))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
