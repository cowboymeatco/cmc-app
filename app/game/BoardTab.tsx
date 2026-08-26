'use client'

import { useMemo, useState } from 'react'
import type { GameIntake } from '@/lib/types'
import { C, INPUT, BTN, STATUS_META, STATUS_FLOW, money, daysHeld } from './ui'

// The board — every animal in the building, grouped by where it is.
//
// The column an animal sits in answers "what is happening to it"; the colour of
// the day count answers "should I be worried". Those are the only two questions
// asked at this screen, and in November they get asked about two hundred
// animals, so the row is deliberately dense: tag, name, species, days, money.

const AGE_WARN = 14
const AGE_BAD  = 21

export default function BoardTab({
  intakes, loading, onOpen, onRefresh,
}: {
  intakes: GameIntake[]
  loading: boolean
  onOpen: (id: string) => void
  onRefresh: () => void
}) {
  const [q, setQ]         = useState('')
  const [species, setSpecies] = useState('')

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return intakes.filter(i => {
      if (species && i.species !== species) return false
      if (!needle) return true
      return (
        i.hunter_name.toLowerCase().includes(needle) ||
        i.tag_number.toLowerCase().includes(needle) ||
        i.license_tag_no.toLowerCase().includes(needle) ||
        i.hunter_phone.includes(needle)
      )
    })
  }, [intakes, q, species])

  // Columns follow the flow through the building, with picked-up and abandoned
  // left off: this board is what is still here.
  const columns = STATUS_FLOW.filter(s => s !== 'picked_up')
  const byStatus = useMemo(() => {
    const m = new Map<string, GameIntake[]>()
    for (const s of columns) m.set(s, [])
    for (const i of filtered) m.get(i.status)?.push(i)
    return m
  }, [filtered, columns])

  const speciesList = useMemo(
    () => Array.from(new Set(intakes.map(i => i.species))).sort(),
    [intakes],
  )

  // The ones that need a phone call: ready and nobody has been told, or sitting
  // long enough that it is turning into somebody else's problem.
  const needsCall = filtered.filter(i => i.status === 'freezer' && !i.notified_at)
  const stale     = filtered.filter(i => i.status !== 'picked_up' && daysHeld(i.received_at) >= AGE_BAD)

  return (
    <div>
      {/* ── Filters ── */}
      <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <input
          value={q} onChange={e => setQ(e.target.value)} style={{ ...INPUT, maxWidth: 300 }}
          placeholder="Hunter, tag number, licence, phone…"
        />
        <select value={species} style={{ ...INPUT, width: 'auto' }} onChange={e => setSpecies(e.target.value)}>
          <option value="">All species</option>
          {speciesList.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <button style={{ ...BTN('rgba(255,255,255,0.06)', C.cream), padding: '0.45rem 0.8rem', fontSize: '0.8rem' }}
          onClick={onRefresh}>↻</button>
        <span style={{ marginLeft: 'auto', fontSize: '0.8rem', color: C.lightBrown }}>
          {filtered.length} in the building
        </span>
      </div>

      {/* ── Things that need a person ── */}
      {(needsCall.length > 0 || stale.length > 0) && (
        <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
          {needsCall.length > 0 && (
            <Alert color={C.green} title={`${needsCall.length} in the freezer, not called`}
              body={needsCall.slice(0, 6).map(i => i.hunter_name).join(', ') + (needsCall.length > 6 ? '…' : '')} />
          )}
          {stale.length > 0 && (
            <Alert color={C.red} title={`${stale.length} here ${AGE_BAD}+ days`}
              body={stale.slice(0, 6).map(i => `${i.tag_number} ${i.hunter_name}`).join(', ') + (stale.length > 6 ? '…' : '')} />
          )}
        </div>
      )}

      {loading && <div style={{ color: C.lightBrown }}>Loading…</div>}
      {!loading && !filtered.length && (
        <div style={{ color: C.lightBrown, padding: '2rem', textAlign: 'center' }}>
          Nothing in the building. Take one in from the Intake tab.
        </div>
      )}

      {/* ── Columns ── */}
      <div style={{
        display: 'grid', gridTemplateColumns: `repeat(${columns.length}, minmax(160px, 1fr))`,
        gap: '0.75rem', alignItems: 'start',
      }}>
        {columns.map(status => {
          const meta = STATUS_META[status]
          const list = byStatus.get(status) ?? []
          return (
            <div key={status}>
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                borderBottom: `2px solid ${meta.color}`, paddingBottom: '0.35rem', marginBottom: '0.6rem',
              }}>
                <span style={{
                  fontSize: '0.7rem', color: meta.color, textTransform: 'uppercase',
                  letterSpacing: '0.12em', fontWeight: 700,
                }}>{meta.label}</span>
                <span style={{ fontSize: '0.8rem', color: C.tan, fontWeight: 600 }}>{list.length}</span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                {list.map(i => <Card key={i.id} intake={i} onOpen={() => onOpen(i.id)} />)}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Alert({ color, title, body }: { color: string; title: string; body: string }) {
  return (
    <div style={{
      flex: '1 1 280px', padding: '0.7rem 0.9rem', borderRadius: 4,
      background: `${color}14`, border: `1px solid ${color}`,
    }}>
      <div style={{ fontSize: '0.82rem', color, fontWeight: 700 }}>{title}</div>
      <div style={{ fontSize: '0.75rem', color: C.tan, marginTop: '0.2rem' }}>{body}</div>
    </div>
  )
}

function Card({ intake, onOpen }: { intake: GameIntake; onOpen: () => void }) {
  const held = daysHeld(intake.received_at)
  const ageColor = held >= AGE_BAD ? C.red : held >= AGE_WARN ? C.yellow : C.lightBrown
  const wants = [intake.cape_requested && 'CAPE', intake.antlers_returned && 'ANTLERS', intake.hide_returned && 'HIDE']
    .filter(Boolean).join(' · ')

  return (
    <button
      onClick={onOpen}
      // The card's content is a stack of divs, which leaves the button with no
      // accessible name at all — it announces as an unlabelled control.
      aria-label={`${intake.tag_number} — ${intake.hunter_name}, ${intake.species}, ${STATUS_META[intake.status]?.label ?? intake.status}`}
      style={{
        textAlign: 'left', width: '100%', cursor: 'pointer',
        background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(166,120,90,0.25)',
        borderRadius: 4, padding: '0.6rem', color: C.cream,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontFamily: 'monospace', fontSize: '0.78rem', color: C.tan, fontWeight: 700 }}>
          {intake.tag_number}
        </span>
        <span style={{ fontSize: '0.7rem', color: ageColor, fontWeight: held >= AGE_WARN ? 700 : 400 }}>
          {held}d
        </span>
      </div>
      <div style={{ fontSize: '0.86rem', fontWeight: 600, marginTop: '0.2rem', lineHeight: 1.25 }}>
        {intake.hunter_name}
      </div>
      <div style={{ fontSize: '0.72rem', color: C.lightBrown, marginTop: '0.1rem' }}>
        {intake.species}{intake.sex ? ` · ${intake.sex}` : ''}
        {intake.weight_in_lbs ? ` · ${intake.weight_in_lbs} lb` : ''}
      </div>

      {wants && (
        <div style={{
          fontSize: '0.62rem', color: C.yellow, marginTop: '0.35rem',
          letterSpacing: '0.06em', fontWeight: 700,
        }}>
          SAVE {wants}
        </div>
      )}

      {(intake.charge_total ?? 0) > 0 && (
        <div style={{ fontSize: '0.72rem', color: C.green, marginTop: '0.3rem' }}>
          {money(intake.charge_total!)}
          {intake.output_lbs ? <span style={{ color: C.lightBrown }}> · {intake.output_lbs} lb out</span> : null}
        </div>
      )}

      {intake.status === 'freezer' && !intake.notified_at && (
        <div style={{ fontSize: '0.65rem', color: C.green, marginTop: '0.3rem', fontWeight: 700 }}>
          📞 NOT CALLED
        </div>
      )}
      {intake.storage_location && (
        <div style={{ fontSize: '0.65rem', color: C.lightBrown, marginTop: '0.25rem' }}>
          📍 {intake.storage_location}
        </div>
      )}
    </button>
  )
}
