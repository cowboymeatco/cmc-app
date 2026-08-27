'use client'

import { useCallback, useEffect, useState } from 'react'
import type { GameIntake } from '@/lib/types'
import type { GameSheet } from '@/lib/gameCuts'
import { generateGameTag, generateGameWorkOrder } from '@/lib/labelGameTag'
import { toRateMap, type GameRate, type RateMap } from '@/lib/gameBilling'
import { isoDate } from '@/lib/dates'
import CutSheetEditor from './CutSheetEditor'
import { C, INPUT, LABEL, BTN, CARD, SPECIES, SEX_BY_SPECIES, CONDITIONS, printHTML } from './ui'

// The drop-off window.
//
// This form gets filled in with a truck idling outside and somebody's hands
// cold, so it is split in two: the six things we must have before the animal
// can be taken in, and the cut sheet, which can wait. An animal with a name, a
// species and a tag number can be hung. An animal without one cannot be found
// again, which is the only unrecoverable mistake at this window.

interface Draft {
  hunter_name: string; hunter_phone: string; hunter_email: string
  species: string; sex: string; license_tag_no: string; hunting_district: string
  harvest_date: string; condition: string; received_by: string
  base_material: string; weight_in_lbs: string; finished_product: string
  roast_lbs: string; trim_lbs: string
  storage_location: string; notes: string; cleaning_hours: string
  cape_requested: boolean; antlers_returned: boolean; hide_returned: boolean
}

// Boned Out is the default because it is what nearly every hunter arrives with:
// a cooler of trim already broken down in the field, ready for the smokehouse.
const blank = (): Draft => ({
  hunter_name: '', hunter_phone: '', hunter_email: '',
  species: 'Deer', sex: '', license_tag_no: '', hunting_district: '',
  harvest_date: '', condition: 'Boned Out', received_by: '',
  base_material: '', weight_in_lbs: '', finished_product: '',
  roast_lbs: '', trim_lbs: '',
  storage_location: '', notes: '', cleaning_hours: '',
  cape_requested: false, antlers_returned: false, hide_returned: false,
})

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div>
      <label style={LABEL}>{label}</label>
      {children}
      {hint && <div style={{ fontSize: '0.7rem', color: C.lightBrown, marginTop: '0.25rem' }}>{hint}</div>}
    </div>
  )
}

function Check({ on, onToggle, children, accent }: {
  on: boolean; onToggle: () => void; children: React.ReactNode; accent?: string
}) {
  return (
    <label style={{
      display: 'flex', alignItems: 'center', gap: '0.55rem', cursor: 'pointer',
      fontSize: '0.85rem', color: on ? C.cream : C.tan, padding: '0.3rem 0',
    }}>
      <input type="checkbox" checked={on} onChange={onToggle}
        style={{ width: 16, height: 16, accentColor: accent ?? C.green, cursor: 'pointer' }} />
      {children}
    </label>
  )
}

export default function IntakeTab({ onSaved }: { onSaved: (intake: GameIntake) => void }) {
  const [d, setD]         = useState<Draft>(blank())
  const [sheet, setSheet] = useState<GameSheet>({})
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState('')
  const [done, setDone]     = useState<GameIntake | null>(null)
  const [showSheet, setShowSheet] = useState(true)
  // Needed only for printing: the work order names each category from the live
  // price list. Without it a line prints as its raw key ("jerky") instead of
  // "Jerky", which is the kind of thing nobody notices until it is on paper.
  const [rates, setRates] = useState<RateMap>(() => toRateMap(null))

  const loadRates = useCallback(() =>
    fetch('/api/game/rates')
      .then(r => r.json())
      .then(d => { if (Array.isArray(d)) setRates(toRateMap(d as GameRate[])) })
      .catch(() => { /* the seed fallback already gives sensible labels */ }),
  [])

  useEffect(() => { loadRates() }, [loadRates])

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD(prev => ({ ...prev, [k]: v }))

  // The total adds itself up from the two real weights, until somebody types
  // over it — a drop-off that only ever gets one number on the scale is common,
  // and the form should not fight that.
  const [totalTyped, setTotalTyped] = useState(false)
  const derivedTotal = (() => {
    const r = Number(d.roast_lbs) || 0
    const t = Number(d.trim_lbs) || 0
    return r + t > 0 ? Math.round((r + t) * 10) / 10 : ''
  })()

  const sexOptions = SEX_BY_SPECIES[d.species] ?? SEX_BY_SPECIES.Other
  // Trophy items only mean something when an animal arrived as an animal.
  const whole = d.condition.startsWith('Whole') || d.condition === 'Quartered'

  async function save() {
    if (!d.hunter_name.trim()) { setError('The hunter’s name is the one thing this cannot be saved without.'); return }
    setSaving(true); setError('')
    try {
      const res = await fetch('/api/game', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...d,
          weight_in_lbs:  totalTyped
            ? (d.weight_in_lbs === '' ? null : Number(d.weight_in_lbs))
            : (derivedTotal === '' ? null : derivedTotal),
          roast_lbs:      d.roast_lbs === '' ? null : Number(d.roast_lbs),
          trim_lbs:       d.trim_lbs  === '' ? null : Number(d.trim_lbs),
          cleaning_hours: d.cleaning_hours === '' ? null : Number(d.cleaning_hours),
          harvest_date:   d.harvest_date || null,
          cut_sheet:     sheet,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Save failed')
      setDone(json as GameIntake)
      onSaved(json as GameIntake)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  function startAnother() {
    setD(blank()); setSheet({}); setDone(null); setError('')
  }

  // ── Just saved: the tag is the next physical act, so it is the whole screen ──
  if (done) {
    return (
      <div style={{ ...CARD, maxWidth: 620, margin: '2rem auto', textAlign: 'center', padding: '2rem' }}>
        <div style={{ fontSize: '0.75rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.16em' }}>
          Tagged in
        </div>
        <div style={{
          fontFamily: 'monospace', fontSize: '2.6rem', fontWeight: 700,
          color: C.green, letterSpacing: '0.05em', margin: '0.5rem 0',
        }}>
          {done.tag_number}
        </div>
        <div style={{ color: C.cream, fontSize: '1.05rem', fontWeight: 600 }}>{done.hunter_name}</div>
        <div style={{ color: C.tan, fontSize: '0.85rem', marginTop: '0.2rem' }}>
          {done.species}{done.sex ? ` · ${done.sex}` : ''} · {done.condition}
          {done.weight_in_lbs ? ` · ${done.weight_in_lbs} lb` : ''}
        </div>
        {done.base_material && (
          <div style={{ color: C.lightBrown, fontSize: '0.8rem', marginTop: '0.15rem' }}>{done.base_material}</div>
        )}

        <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'center', marginTop: '1.5rem', flexWrap: 'wrap' }}>
          <button style={BTN(C.green)} onClick={() => printHTML(generateGameTag(done))}>
            🏷 Print claim tag
          </button>
          <button style={BTN(C.tan)} onClick={() => printHTML(generateGameWorkOrder(done, sheet, rates))}>
            📋 Print work order
          </button>
          <button style={BTN('rgba(255,255,255,0.08)', C.cream)} onClick={startAnother}>
            Next animal
          </button>
        </div>
        <p style={{ fontSize: '0.75rem', color: C.lightBrown, marginTop: '1.25rem', lineHeight: 1.6 }}>
          Tear the tag in half — top half on the animal, bottom half to the hunter.
          The work order goes with the carcass to the cut floor.
        </p>
      </div>
    )
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.15fr)', gap: '1.5rem', alignItems: 'start' }}>

      {/* ── Left: who and what ── */}
      <div style={CARD}>
        <div style={{
          fontSize: '0.78rem', color: C.tan, textTransform: 'uppercase', letterSpacing: '0.14em',
          fontWeight: 700, borderBottom: `1px solid ${C.medBrown}`, paddingBottom: '0.35rem', marginBottom: '1rem',
        }}>
          The animal & the hunter
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
          <Field label="Hunter name *">
            <input value={d.hunter_name} onChange={e => set('hunter_name', e.target.value)}
              style={INPUT} placeholder="Who is coming back for it" autoFocus />
          </Field>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <Field label="Phone">
              <input value={d.hunter_phone} onChange={e => set('hunter_phone', e.target.value)}
                style={INPUT} placeholder="406…" inputMode="tel" />
            </Field>
            <Field label="Email">
              <input value={d.hunter_email} onChange={e => set('hunter_email', e.target.value)}
                style={INPUT} inputMode="email" />
            </Field>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <Field label="Species">
              <select value={d.species} style={INPUT}
                onChange={e => { set('species', e.target.value); set('sex', '') }}>
                {SPECIES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Sex">
              <select value={d.sex} style={INPUT} onChange={e => set('sex', e.target.value)}>
                <option value="">—</option>
                {sexOptions.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
          </div>

          <Field
            label="Licence / tag number"
            hint="Montana requires the tag to stay with the carcass. This is what says the meat in our cooler is lawfully somebody’s."
          >
            <input value={d.license_tag_no} onChange={e => set('license_tag_no', e.target.value)} style={INPUT} />
          </Field>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <Field label="Hunting district">
              <input value={d.hunting_district} onChange={e => set('hunting_district', e.target.value)}
                style={INPUT} placeholder="e.g. 704" />
            </Field>
            <Field label="Date taken">
              <input type="date" value={d.harvest_date} max={isoDate()}
                onChange={e => set('harvest_date', e.target.value)} style={INPUT} />
            </Field>
          </div>

          {/* Base Material and Weight are the top of the printed slip, and on a
              boned-out drop-off they ARE the description of the meat — there is
              no carcass left to point at. */}
          <Field label="Base material" hint="What came through the door, in your words.">
            <input value={d.base_material} onChange={e => set('base_material', e.target.value)}
              style={INPUT} placeholder="Boned-out elk — roasts and trim" />
          </Field>

          {/* Roasts and trim are weighed APART, because they cannot substitute
              for one another: steaks and jerky can only be cut from whole
              muscle, and everything else comes off the grind. One combined
              weight would let a jerky order look filled against a cooler with
              no roasts in it. */}
          <div style={{
            padding: '0.75rem', borderRadius: 4,
            background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(166,120,90,0.28)',
          }}>
            <div style={LABEL}>Weighed in — roasts and trim separately</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.6rem', alignItems: 'end' }}>
              <Field label="Roasts (lb)" hint="Steaks & jerky come off these.">
                <input type="number" min="0" step="0.1" value={d.roast_lbs}
                  onChange={e => set('roast_lbs', e.target.value)} style={INPUT} />
              </Field>
              <Field label="Trim (lb)" hint="Everything ground.">
                <input type="number" min="0" step="0.1" value={d.trim_lbs}
                  onChange={e => set('trim_lbs', e.target.value)} style={INPUT} />
              </Field>
              <Field label="Total (lb)" hint={totalTyped ? 'Typed — not the sum.' : 'Adds itself up.'}>
                <input type="number" min="0" step="0.1"
                  value={totalTyped ? d.weight_in_lbs : (derivedTotal || '')}
                  onChange={e => { setTotalTyped(true); set('weight_in_lbs', e.target.value) }}
                  style={{ ...INPUT, color: totalTyped ? C.cream : C.tan }} />
              </Field>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: '0.75rem' }}>
            <Field label="How it arrived">
              <select value={d.condition} style={INPUT} onChange={e => set('condition', e.target.value)}>
                {CONDITIONS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Finished product">
              <select value={d.finished_product} style={INPUT}
                onChange={e => set('finished_product', e.target.value)}>
                <option value="">-</option>
                <option value="Fresh">Fresh</option>
                <option value="Frozen">Frozen</option>
              </select>
            </Field>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <Field label="Where it went">
              <input value={d.storage_location} onChange={e => set('storage_location', e.target.value)}
                style={INPUT} placeholder="Game cooler, rail 3…" />
            </Field>
            <Field label="Taken in by">
              <input value={d.received_by} onChange={e => set('received_by', e.target.value)} style={INPUT} />
            </Field>
          </div>

          {/* Trophy items and the cleaning fee are agreed HERE, at the counter,
              with the hunter present — not discovered at packout. */}
          <div style={{
            marginTop: '0.3rem', padding: '0.85rem', borderRadius: 4,
            background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(166,120,90,0.25)',
          }}>
            <div style={LABEL}>Agreed at the counter</div>

            {/* $60/HR on the slip, with a blank for the hours - not a flat fee.
                A filthy hide-on elk that takes three hours is $180. */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', margin: '0.2rem 0 0.5rem' }}>
              <input type="number" min="0" step="0.25" value={d.cleaning_hours}
                onChange={e => set('cleaning_hours', e.target.value)}
                placeholder="hrs" aria-label="Cleaning hours"
                style={{ ...INPUT, width: 80, textAlign: 'right' }} />
              <span style={{ fontSize: '0.85rem', color: d.cleaning_hours ? C.cream : C.tan }}>
                hours cleaning <span style={{ color: C.yellow }}>@ $60/hr</span>
                <span style={{ color: C.lightBrown, fontSize: '0.75rem' }}> - dirty, hairy or hide-on</span>
              </span>
            </div>

            {/* Almost never used: a boned-out cooler has no cape, antlers or
                hide. Kept for the hunters who bring the animal in whole. */}
            {whole && (
              <>
                <Check on={d.cape_requested}   onToggle={() => set('cape_requested', !d.cape_requested)}>Save the cape</Check>
                <Check on={d.antlers_returned} onToggle={() => set('antlers_returned', !d.antlers_returned)}>Antlers back</Check>
                <Check on={d.hide_returned}    onToggle={() => set('hide_returned', !d.hide_returned)}>Hide back</Check>
              </>
            )}
          </div>

          <Field label="Notes">
            <textarea value={d.notes} rows={2} style={{ ...INPUT, resize: 'vertical' }}
              onChange={e => set('notes', e.target.value)}
              placeholder="Shot placement, bloodshot quarter, anything the cutter should know" />
          </Field>
        </div>
      </div>

      {/* ── Right: the cut sheet ── */}
      <div style={CARD}>
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          borderBottom: `1px solid ${C.medBrown}`, paddingBottom: '0.35rem', marginBottom: '1rem',
        }}>
          <span style={{ fontSize: '0.78rem', color: C.tan, textTransform: 'uppercase', letterSpacing: '0.14em', fontWeight: 700 }}>
            Order
          </span>
          <button onClick={() => setShowSheet(s => !s)}
            style={{ ...BTN('transparent', C.lightBrown), padding: '0.2rem 0.5rem', fontSize: '0.75rem' }}>
            {showSheet ? 'Hide' : 'Show'}
          </button>
        </div>

        {showSheet ? (
          <CutSheetEditor
            sheet={sheet} onChange={setSheet} compact
            // The weights typed on the left drive the fill plans on the right,
            // live and per pool — so the counter can see the order run out of
            // roasts while the hunter is still standing there.
            roastLbs={d.roast_lbs === '' ? null : Number(d.roast_lbs)}
            trimLbs={d.trim_lbs === '' ? null : Number(d.trim_lbs)}
          />
        ) : (
          <p style={{ fontSize: '0.8rem', color: C.lightBrown, lineHeight: 1.6 }}>
            Hidden. Meat can be taken in without an order — nothing can be made
            until one exists, and the work order will say so.
          </p>
        )}
      </div>

      {/* ── Save bar ── */}
      <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <button style={{ ...BTN(C.green), padding: '0.75rem 2rem', fontSize: '0.95rem' }}
          onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Take it in & print tag'}
        </button>
        {error && <span style={{ color: C.red, fontSize: '0.85rem' }}>{error}</span>}
        <span style={{ fontSize: '0.75rem', color: C.lightBrown, marginLeft: 'auto' }}>
          The claim number is issued by the database, so two people at this window never hand out the same one.
        </span>
      </div>
    </div>
  )
}
