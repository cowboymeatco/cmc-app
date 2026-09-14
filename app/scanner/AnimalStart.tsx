'use client'
// The top of New Session: the carcass tag AND the cut card, before anything
// gets packed.
//
// Charlie, 2026-09-13: "So we need both to start a session. I really like that
// idea." The tag says which animal is on the table; the card says whose it is
// and how it's cut. Scanning both — in either order — and checking they belong
// to the same booking is the first win of carcass symmetry (the Dan/Nikki
// crossed scan): a card that isn't on that animal's booking says so before a
// single box is filled. The customer's name comes off the card and stays
// editable as the box label.
//
// Only two ways around it, both said out loud: an animal whose booking has no
// cut card (our own animals) starts on the tag, and "not an animal — retail /
// repack" starts on a typed name. A lost tag can be picked off the cooler list;
// the card is still scanned.

import { useEffect, useMemo, useRef, useState } from 'react'
import type { AnimalCard, CoolerAnimal, ResolvedAnimal } from '@/lib/sessionLinks'

const C = {
  dark: '#1A0A04', medBrown: '#75471B', lightBrown: '#A6785A', tan: '#C9A882', cream: '#F2E8D9', yellow: '#D97706', green: '#4CAF50', red: '#EF4444',
}

export interface AnimalPick {
  customer_name: string
  appointment_id: string | null
  ci_id: string | null
  /** A carcass tag to add to the session as its input. Null when the animal was picked off the list as a split. */
  carcass_code: string | null
  label: string
}

/** The animal slot: scanned tag, or a pick off the cooler list when the tag is missing. */
interface AnimalSlot {
  appointment_id: string | null
  carcass_code: string | null
  label: string
  cards: AnimalCard[]
}
interface CardSlot { card: AnimalCard; appointment_id: string | null }

const shortCi = (id: string) => `CI-${id.replace(/-/g, '').slice(0, 8).toUpperCase()}`

export default function AnimalStart({ date, onPick, onRetail, retail, initialCode }: {
  date: string
  /** Called with the pick once it's complete (both scans, or an allowed exception); null otherwise. */
  onPick: (p: AnimalPick | null) => void
  onRetail: (on: boolean) => void
  retail: boolean
  /** A tag or card scanned on the sessions screen that opened this form. */
  initialCode?: string | null
}) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [animal, setAnimal] = useState<AnimalSlot | null>(null)
  const [card, setCard] = useState<CardSlot | null>(null)
  const [noCardOk, setNoCardOk] = useState(false)
  const [mismatchOk, setMismatchOk] = useState(false)
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
    setBusy(true); setMsg('')
    try {
      const hit: ResolvedAnimal = await fetch(`/api/scanner/animal?code=${encodeURIComponent(raw)}`).then(r => r.json())
      setCode('')
      if (!hit.found) { setMsg(hit.label); return }
      if (hit.kind === 'card') {
        setCard({ card: hit.cards[0], appointment_id: hit.appointment_id })
        setMismatchOk(false)
      } else {
        setAnimal({ appointment_id: hit.appointment_id, carcass_code: hit.carcass_code, label: hit.label, cards: hit.cards })
        setShowCooler(false)
        setNoCardOk(false); setMismatchOk(false)
      }
    } catch {
      setMsg('Lookup failed — scan again')
    } finally {
      setBusy(false)
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }

  // A tag or card scanned on the sessions screen opens this form already looked up.
  const firstCode = useRef(initialCode)
  useEffect(() => {
    const first = firstCode.current
    firstCode.current = null
    if (first) resolve(first)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Does the card belong to the animal on the table?
  const match: 'none' | 'ok' | 'mismatch' = !animal || !card ? 'none'
    : animal.cards.some(c => c.id === card.card.id) || (!!animal.appointment_id && card.appointment_id === animal.appointment_id) ? 'ok'
    : 'mismatch'
  const animalHasNoCard = !!animal && animal.cards.length === 0

  const complete = !!animal && (
    (!!card && (match === 'ok' || mismatchOk)) ||
    (!card && animalHasNoCard && noCardOk)
  )

  // Tell the page whenever the pick becomes complete or stops being.
  const pick: AnimalPick | null = useMemo(() => complete && animal ? {
    customer_name: card?.card.customer_name ?? '',
    appointment_id: animal.appointment_id,
    ci_id: card?.card.id ?? null,
    carcass_code: animal.carcass_code,
    label: animal.label,
  } : null, [complete, animal, card])
  const pickKey = pick ? `${pick.appointment_id}|${pick.ci_id}|${pick.carcass_code}|${pick.customer_name}` : ''
  useEffect(() => { onPick(pick) }, [pickKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return (cooler ?? []).filter(a => !q || `${a.tag} ${a.species} ${a.producer} ${a.picks.map(p => p.customer_name).join(' ')}`.toLowerCase().includes(q))
  }, [cooler, filter])

  if (retail) {
    return (
      <div style={{ marginBottom: '1rem', background: 'rgba(166,120,90,0.12)', border: '1px solid rgba(166,120,90,0.4)', borderRadius: 4, padding: '0.55rem 0.7rem', display: 'flex', alignItems: 'center' }}>
        <div style={{ flex: 1, color: C.cream, fontSize: '0.82rem' }}>Not an animal — retail / repack. Type the name below.</div>
        <button type="button" onClick={() => onRetail(false)} style={{ background: 'none', border: 'none', color: C.tan, fontSize: '0.78rem', cursor: 'pointer' }}>scan an animal instead</button>
      </div>
    )
  }

  const tone = (t: 'ok' | 'warn' | 'bad') => t === 'bad' ? C.red : t === 'warn' ? C.yellow : C.green
  const slot = (done: boolean, title: string, body: React.ReactNode, onClear: () => void, t: 'ok' | 'warn' | 'bad' = 'ok') => (
    <div style={{
      flex: 1, minWidth: 0, borderRadius: 4, padding: '0.45rem 0.55rem',
      background: done ? `${tone(t)}1F` : 'rgba(255,255,255,0.04)',
      border: `1px ${done ? 'solid' : 'dashed'} ${done ? tone(t) : 'rgba(166,120,90,0.4)'}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
        <span style={{ color: done ? tone(t) : C.lightBrown, fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', flex: 1 }}>{done ? (t === 'bad' ? '✕ ' : '✓ ') : ''}{title}</span>
        {done && <button type="button" onClick={onClear} title="Clear" style={{ background: 'none', border: 'none', color: C.lightBrown, cursor: 'pointer', fontSize: '0.8rem', padding: 0 }}>✕</button>}
      </div>
      <div style={{ color: done ? C.cream : C.lightBrown, fontSize: '0.78rem', lineHeight: 1.3 }}>{body}</div>
    </div>
  )

  return (
    <div style={{ marginBottom: '1rem' }}>
      <label style={{ display: 'block', fontSize: '0.7rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.35rem' }}>
        Scan the carcass tag and the cut card
      </label>

      <input ref={inputRef} autoFocus value={code} onChange={e => setCode(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); resolve() } }}
        placeholder={busy ? 'Looking up…' : !animal && !card ? 'Scan either one first' : !animal ? 'Now the carcass tag' : !card ? 'Now the cut card' : 'Both scanned'}
        style={{ width: '100%', background: 'rgba(255,255,255,0.07)', border: `1px solid ${C.tan}`, borderRadius: 4, padding: '0.7rem', color: C.cream, fontSize: '1.05rem', outline: 'none', boxSizing: 'border-box' }} />
      {msg && <div style={{ color: C.yellow, fontSize: '0.76rem', marginTop: '0.3rem' }}>{msg}</div>}

      <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.45rem' }}>
        {slot(!!animal, 'Carcass tag', animal ? animal.label : 'the animal on the table', () => { setAnimal(null); setNoCardOk(false); setMismatchOk(false) })}
        {slot(!!card, 'Cut card', card
          ? <>{card.card.customer_name}<span style={{ display: 'block', color: C.lightBrown, fontSize: '0.68rem' }}>{shortCi(card.card.id)}{card.card.species ? ` · ${card.card.species}` : ''}</span></>
          : animal && animal.cards.length
            ? <>expecting {animal.cards.length === 1 ? `${animal.cards[0].customer_name} (${shortCi(animal.cards[0].id)})` : `one of ${animal.cards.map(c => shortCi(c.id)).join(', ')}`}</>
            : 'whose it is',
          () => { setCard(null); setMismatchOk(false) },
          match === 'mismatch' ? (mismatchOk ? 'warn' : 'bad') : 'ok')}
      </div>

      {match === 'mismatch' && card && animal && (
        <div style={{ marginTop: '0.4rem', color: '#FCA5A5', fontSize: '0.78rem', lineHeight: 1.35 }}>
          ⚠ This cut card isn&apos;t on that animal&apos;s booking.{' '}
          {animal.cards.length ? <>Its booking has {animal.cards.map(c => `${c.customer_name} (${shortCi(c.id)})`).join(', ')}.</> : 'That booking has no cut card at all.'}
          {' '}Check the tag and the card before packing.
          {!mismatchOk && (
            <button type="button" onClick={() => setMismatchOk(true)}
              style={{ display: 'block', marginTop: '0.3rem', background: 'transparent', border: `1px solid ${C.yellow}`, color: C.yellow, borderRadius: 3, padding: '0.25rem 0.6rem', fontSize: '0.74rem', cursor: 'pointer' }}>
              They&apos;re right — the card just isn&apos;t linked. Use it anyway
            </button>
          )}
        </div>
      )}

      {animalHasNoCard && !card && (
        <div style={{ marginTop: '0.4rem', color: C.yellow, fontSize: '0.78rem' }}>
          This animal&apos;s booking has no cut card (our own animals don&apos;t).{' '}
          <label style={{ cursor: 'pointer', color: C.cream }}>
            <input type="checkbox" checked={noCardOk} onChange={e => setNoCardOk(e.target.checked)} style={{ verticalAlign: 'middle', marginRight: 4 }} />
            start without a card
          </label>
        </div>
      )}

      <div style={{ display: 'flex', gap: '0.9rem', marginTop: '0.4rem' }}>
        {!animal && (
          <button type="button" onClick={() => setShowCooler(s => !s)}
            style={{ background: 'none', border: 'none', color: C.tan, fontSize: '0.76rem', cursor: 'pointer', padding: 0 }}>
            {showCooler ? '▾' : '▸'} tag missing? pick from the cooler
          </button>
        )}
        <button type="button" onClick={() => onRetail(true)}
          style={{ marginLeft: 'auto', background: 'none', border: 'none', color: C.lightBrown, fontSize: '0.76rem', cursor: 'pointer', padding: 0 }}>
          not an animal (retail / repack)
        </button>
      </div>

      {showCooler && !animal && (
        <div style={{ marginTop: '0.35rem', border: '1px solid rgba(166,120,90,0.3)', borderRadius: 4, background: C.dark }}>
          <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter tag, name, producer"
            style={{ width: '100%', background: 'transparent', border: 'none', borderBottom: '1px solid rgba(166,120,90,0.25)', padding: '0.45rem 0.6rem', color: C.cream, fontSize: '0.85rem', outline: 'none', boxSizing: 'border-box' }} />
          <div style={{ maxHeight: 220, overflowY: 'auto' }}>
            {!cooler && <div style={{ color: C.lightBrown, fontSize: '0.78rem', padding: '0.5rem 0.6rem' }}>Loading…</div>}
            {cooler && !shown.length && <div style={{ color: C.lightBrown, fontSize: '0.78rem', padding: '0.5rem 0.6rem' }}>Nothing hanging matches.</div>}
            {shown.map(a => (
              <button key={a.harvest_log_id} type="button"
                onClick={() => {
                  setAnimal({
                    appointment_id: a.appointment_id,
                    // A split animal: the whole-carcass code would pull both halves off the rail — scan the half's tag in the session instead.
                    carcass_code: a.picks.length === 1 ? a.code : null,
                    label: `${a.species ?? 'Carcass'} · Tag ${a.tag}${a.weight_lbs ? ` · ${Math.round(a.weight_lbs)} lb` : ''}${a.producer ? ` · ${a.producer}` : ''} (picked, not scanned)`,
                    cards: a.picks.filter(p => p.cutting_instruction_id).map(p => ({ id: p.cutting_instruction_id!, customer_name: p.customer_name, species: a.species, created_at: null })),
                  })
                  setShowCooler(false); setNoCardOk(false); setMismatchOk(false)
                  setTimeout(() => inputRef.current?.focus(), 0)
                }}
                style={{ display: 'block', width: '100%', textAlign: 'left', background: 'transparent', border: 'none', borderBottom: '1px solid rgba(166,120,90,0.12)', padding: '0.45rem 0.6rem', cursor: 'pointer' }}>
                <div style={{ color: C.cream, fontSize: '0.86rem' }}>
                  {a.scheduled_today && <span style={{ color: C.green, fontWeight: 700 }}>TODAY · </span>}
                  Tag {a.tag} · {a.picks.map(p => p.customer_name || '(no customer)').join(' / ')}
                </div>
                <div style={{ color: C.lightBrown, fontSize: '0.7rem' }}>
                  {a.species}{a.weight_lbs ? ` · ${Math.round(a.weight_lbs)} lb` : ''} · killed {a.harvest_date.slice(5)}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
