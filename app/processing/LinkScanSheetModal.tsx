'use client'
import { useEffect, useMemo, useState } from 'react'
import { HarvestLog } from '@/lib/types'
import { splitsIntoHalves } from '@/lib/carcass'
import { CarcassLink } from '@/lib/cutSchedule'

// ══════════════════════════════════════════════════════════════════════════════
// LINK AN ANIMAL TO A SCAN SHEET
//
// Jill, 2026-08-25: "If they forget to scan an animal in, make it so we can
// link an animal on the cut schedule to a scan sheet."
//
// The carcass scan at INPUTS is what ties an animal to the boxes cut off it.
// Miss it and three things go wrong quietly: the box labels print with no
// producer, no hanging weight and no kill type; the session's yield has no
// denominator; and the carcass never comes off the cooler rail, so it sits on
// the cut schedule after the meat is long packed.
//
// This is the repair. It is NOT a second way to record a carcass — it writes
// exactly the row the scan would have written, and says on the row that no
// scanner produced it.
// ══════════════════════════════════════════════════════════════════════════════

const C = {
  dark:       '#1A0A04',
  darkBrown:  '#351E0E',
  medBrown:   '#75471B',
  lightBrown: '#A6785A',
  tan:        '#C9A882',
  cream:      '#F2E8D9',
  green:      '#4CAF50',
  red:        '#EF4444',
  amber:      '#F59E0B',
}

/** A packing session, as /api/processing/sessions returns it. */
interface SessionRow {
  customer_name: string
  session_date:  string
  status:        string | null
  box_count:     number
  total_weight:  number
  animals:       string[]
}

const fmtDay = (iso: string) =>
  new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

// Loose name match between a cut customer and a session. Session names carry
// the hanging weight the crew typed ("Pam Forrest 711"), and a cut customer is
// just "Pam Forrest", so neither startsWith nor equality catches the pair —
// compare on letters alone and let either side contain the other.
const nameKey = (s: string) => (s || '').toLowerCase().replace(/[^a-z]+/g, '')
function namesMatch(a: string, b: string): boolean {
  const x = nameKey(a), y = nameKey(b)
  if (!x || !y) return false
  return x === y || x.includes(y) || y.includes(x)
}

export default function LinkScanSheetModal({
  animal, cutCustomerNames, existing, onClose, onLinked,
}: {
  animal:           HarvestLog
  /** Everyone this carcass is assigned to — used only to sort the likely
   *  session to the top, never to pick one on the operator's behalf. */
  cutCustomerNames: string[]
  /** Sessions this animal already reached, so a half that's half-done shows it. */
  existing:         CarcassLink[]
  onClose:          () => void
  onLinked:         () => void
}) {
  const halves    = splitsIntoHalves(animal.species, animal.sex)
  const doneSides = new Set(existing.map(e => e.side).filter(Boolean) as ('L' | 'R')[])
  const wholeDone = existing.some(e => e.side === null)

  const [sessions, setSessions] = useState<SessionRow[] | null>(null)
  const [picked,   setPicked]   = useState<SessionRow | null>(null)
  // A splitting animal opens with whichever sides are still outstanding ticked
  // — the common repair is "nobody scanned this beef at all". Set once at mount
  // rather than synced: the modal is remounted per animal, so there is nothing
  // for a later render to correct.
  const [sides,    setSides]    = useState<Set<'L' | 'R'>>(
    () => new Set((['L', 'R'] as const).filter(s => !doneSides.has(s))))
  const [filter,   setFilter]   = useState('')
  const [saving,   setSaving]   = useState(false)
  const [error,    setError]    = useState<string | null>(null)

  useEffect(() => {
    let live = true
    fetch('/api/processing/sessions')
      .then(r => r.json())
      .then(d => { if (live) setSessions(Array.isArray(d) ? d as SessionRow[] : []) })
      .catch(() => { if (live) setSessions([]) })
    return () => { live = false }
  }, [])

  // Likely sessions first: a name that matches one of this carcass's cut
  // customers, then the most recent. Sessions that already hold an animal are
  // NOT hidden — a session can legitimately be cut from two carcasses — but
  // they sort below the empty ones, which are what a missed scan looks like.
  const ranked = useMemo(() => {
    if (!sessions) return []
    const q = filter.trim().toLowerCase()
    return sessions
      .filter(s => !q || s.customer_name.toLowerCase().includes(q) || s.session_date.includes(q))
      .map(s => ({
        s,
        match: cutCustomerNames.some(n => namesMatch(n, s.customer_name)),
        empty: (s.animals?.length ?? 0) === 0,
      }))
      .sort((a, b) =>
        (b.match ? 1 : 0) - (a.match ? 1 : 0) ||
        (b.empty ? 1 : 0) - (a.empty ? 1 : 0) ||
        b.s.session_date.localeCompare(a.s.session_date))
      .slice(0, 60)
  }, [sessions, filter, cutCustomerNames])

  const toggleSide = (s: 'L' | 'R') =>
    setSides(prev => {
      const n = new Set(prev)
      if (n.has(s)) n.delete(s)
      else n.add(s)
      return n
    })

  const chosen: (('L' | 'R') | null)[] = halves ? [...sides] : [null]
  const canSave = !!picked && chosen.length > 0 && !saving

  async function save() {
    if (!picked) return
    setSaving(true)
    setError(null)
    try {
      for (const side of chosen) {
        const res = await fetch('/api/processing/inputs', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            harvest_log_id: animal.id,
            side,
            customer_name:  picked.customer_name,
            pack_date:      picked.session_date,
            session_date:   picked.session_date,
          }),
        })
        if (!res.ok) {
          const j = await res.json().catch(() => ({}))
          throw new Error(j.error || `Link failed (${res.status})`)
        }
      }
      onLinked()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Link failed')
      setSaving(false)
    }
  }

  const hcw = animal.hot_carcass_weight_lbs != null ? Number(animal.hot_carcass_weight_lbs) : null

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.68)', zIndex: 200,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: C.dark, border: `1px solid ${C.medBrown}`, borderRadius: 6,
          width: 'min(620px, 100%)', maxHeight: '86vh', display: 'flex', flexDirection: 'column',
          color: C.cream,
        }}
      >
        {/* Header — the animal, stated plainly enough to catch a wrong row */}
        <div style={{ padding: '0.9rem 1.1rem', borderBottom: `1px solid ${C.darkBrown}` }}>
          <div style={{ fontSize: '0.95rem', fontWeight: 700 }}>Link this animal to a scan sheet</div>
          <div style={{ fontSize: '0.78rem', color: C.tan, marginTop: 3 }}>
            {animal.species} · Tag <b>{animal.carcass_tag || '—'}</b>
            {animal.producer ? <> · {animal.producer}</> : null}
            {hcw != null ? <> · {hcw} lb hanging</> : null}
          </div>
          <div style={{ fontSize: '0.7rem', color: C.medBrown, marginTop: 4, lineHeight: 1.35 }}>
            Writes the carcass input the scanner would have written, so the boxes pick up the
            producer, hanging weight and kill type — and the carcass comes off the cooler rail.
          </div>
        </div>

        {existing.length > 0 && (
          <div style={{
            margin: '0.7rem 1.1rem 0', padding: '0.4rem 0.6rem', borderRadius: 4,
            background: 'rgba(245,158,11,0.1)', border: `1px solid ${C.amber}55`,
            fontSize: '0.72rem', color: C.amber, lineHeight: 1.4,
          }}>
            Already linked: {existing.map(e =>
              `${e.side ? `${e.side} half` : 'whole'} → ${e.customer_name ?? '—'}`).join(', ')}
          </div>
        )}

        {/* Sides — only for the species that actually hang in halves */}
        {halves && (
          <div style={{ padding: '0.8rem 1.1rem 0' }}>
            <div style={{ fontSize: '0.65rem', color: C.medBrown, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 5 }}>
              Sides on this sheet
            </div>
            <div style={{ display: 'flex', gap: '0.4rem' }}>
              {(['L', 'R'] as const).map(s => {
                const on   = sides.has(s)
                const done = doneSides.has(s)
                return (
                  <button
                    key={s}
                    disabled={done}
                    onClick={() => toggleSide(s)}
                    title={done ? `The ${s} half is already linked` : `${s} half — ${hcw != null ? (hcw / 2).toFixed(1) : '?'} lb`}
                    style={{
                      background: done ? 'rgba(255,255,255,0.03)' : on ? 'rgba(201,168,130,0.28)' : 'rgba(255,255,255,0.03)',
                      border: `1px solid ${done ? 'rgba(166,120,90,0.2)' : on ? 'rgba(201,168,130,0.6)' : 'rgba(166,120,90,0.25)'}`,
                      borderRadius: 3, padding: '0.25rem 0.8rem',
                      color: done ? C.medBrown : on ? C.cream : C.lightBrown,
                      fontSize: '0.75rem', fontWeight: on ? 700 : 400,
                      cursor: done ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {done ? '✓ ' : on ? '✓ ' : ''}{s} half
                    {hcw != null ? ` · ${(hcw / 2).toFixed(1)} lb` : ''}
                  </button>
                )
              })}
            </div>
          </div>
        )}
        {!halves && wholeDone && (
          <div style={{ padding: '0.8rem 1.1rem 0', fontSize: '0.72rem', color: C.amber }}>
            This animal is already linked — linking it again will be refused.
          </div>
        )}

        {/* Session picker */}
        <div style={{ padding: '0.8rem 1.1rem 0' }}>
          <div style={{ fontSize: '0.65rem', color: C.medBrown, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 5 }}>
            Scan sheet
          </div>
          <input
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder="Find a session — customer or date…"
            style={{
              width: '100%', background: 'rgba(255,255,255,0.04)',
              border: `1px solid ${C.darkBrown}`, borderRadius: 4,
              padding: '0.35rem 0.6rem', color: C.cream, fontSize: '0.8rem', outline: 'none',
            }}
          />
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '0.5rem 1.1rem 0', minHeight: 120 }}>
          {sessions === null && <div style={{ color: C.medBrown, fontSize: '0.8rem', padding: '0.6rem 0' }}>Loading sessions…</div>}
          {sessions !== null && ranked.length === 0 && (
            <div style={{ color: C.medBrown, fontSize: '0.8rem', padding: '0.6rem 0' }}>No sessions match.</div>
          )}
          {ranked.map(({ s, match, empty }) => {
            const on = picked?.customer_name === s.customer_name && picked?.session_date === s.session_date
            return (
              <button
                key={`${s.customer_name}|${s.session_date}`}
                onClick={() => setPicked(s)}
                style={{
                  display: 'block', width: '100%', textAlign: 'left', marginBottom: 4,
                  background: on ? 'rgba(201,168,130,0.2)' : 'rgba(255,255,255,0.03)',
                  border: `1px solid ${on ? C.tan : 'rgba(166,120,90,0.2)'}`,
                  borderRadius: 4, padding: '0.4rem 0.6rem', cursor: 'pointer', color: C.cream,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '0.82rem', fontWeight: on ? 700 : 600 }}>{s.customer_name}</span>
                  <span style={{ fontSize: '0.7rem', color: C.lightBrown }}>{fmtDay(s.session_date)}</span>
                  {match && (
                    <span style={{
                      fontSize: '0.58rem', fontWeight: 700, color: C.green,
                      background: `${C.green}1A`, border: `1px solid ${C.green}55`,
                      borderRadius: 3, padding: '0 5px',
                    }}>likely</span>
                  )}
                  {!empty && (
                    <span
                      title={s.animals.join('\n')}
                      style={{
                        fontSize: '0.58rem', fontWeight: 700, color: C.amber,
                        background: `${C.amber}1A`, border: `1px solid ${C.amber}55`,
                        borderRadius: 3, padding: '0 5px',
                      }}
                    >
                      has {s.animals.length} animal{s.animals.length === 1 ? '' : 's'}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: '0.68rem', color: C.medBrown, marginTop: 2 }}>
                  {s.box_count} box{s.box_count === 1 ? '' : 'es'} · {s.total_weight.toFixed(1)} lbs
                  {s.status ? ` · ${s.status.replace('_', ' ')}` : ''}
                </div>
              </button>
            )
          })}
        </div>

        {error && (
          <div style={{ padding: '0.5rem 1.1rem 0', color: C.red, fontSize: '0.75rem' }}>{error}</div>
        )}

        <div style={{
          display: 'flex', justifyContent: 'flex-end', gap: '0.5rem',
          padding: '0.8rem 1.1rem', borderTop: `1px solid ${C.darkBrown}`, marginTop: '0.6rem',
        }}>
          <button
            onClick={onClose}
            style={{
              background: 'transparent', border: `1px solid ${C.darkBrown}`, borderRadius: 4,
              padding: '0.35rem 0.9rem', color: C.lightBrown, fontSize: '0.8rem', cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={!canSave}
            style={{
              background: canSave ? 'rgba(76,175,80,0.2)' : 'rgba(255,255,255,0.03)',
              border: `1px solid ${canSave ? C.green : C.darkBrown}`, borderRadius: 4,
              padding: '0.35rem 0.9rem', color: canSave ? C.cream : C.medBrown,
              fontSize: '0.8rem', fontWeight: 600, cursor: canSave ? 'pointer' : 'not-allowed',
            }}
          >
            {saving ? 'Linking…' : halves
              ? `Link ${chosen.length} side${chosen.length === 1 ? '' : 's'}`
              : 'Link animal'}
          </button>
        </div>
      </div>
    </div>
  )
}
