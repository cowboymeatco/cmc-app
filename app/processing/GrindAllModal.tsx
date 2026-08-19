'use client'
import { useState } from 'react'
import {
  BEEF_FAT_BLENDS, BEEF_PACK_SIZES, PORK_FLAVORS, PORK_FORMATS, LAMB_GOAT_TRIM,
  grindAllMissing, speciesKey, type GrindAllChoices,
} from '@/lib/grindAll'

const C = {
  dark:       '#1A0A04',
  medBrown:   '#75471B',
  lightBrown: '#A6785A',
  tan:        '#C9A882',
  cream:      '#F2E8D9',
  green:      '#4CAF50',
  red:        '#EF4444',
  amber:      '#F59E0B',
}

/** One tappable answer. Same shape for every question on the form. */
function Pick({ label, desc, on, onClick }: {
  label: string; desc?: string; on: boolean; onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        textAlign: 'left', padding: '0.4rem 0.65rem', borderRadius: 4, cursor: 'pointer',
        background: on ? 'rgba(76,175,80,0.16)' : C.dark,
        border: `1px solid ${on ? 'rgba(76,175,80,0.55)' : 'rgba(166,120,90,0.25)'}`,
        color: on ? C.cream : C.tan, fontSize: '0.82rem', fontWeight: on ? 700 : 500,
      }}
    >
      {label}
      {desc && <div style={{ color: C.lightBrown, fontSize: '0.7rem', fontWeight: 400, marginTop: 1 }}>{desc}</div>}
    </button>
  )
}

function Question({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: '0.9rem' }}>
      <div style={{
        color: C.medBrown, fontSize: '0.68rem', fontWeight: 700,
        textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.35rem',
      }}>
        {title}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>{children}</div>
    </div>
  )
}

// Writes the cut card a house animal never gets from a customer: everything to
// grind. Only the grind questions are asked — that is the whole of a grind-all
// sheet, and anything else on the card would be an answer nobody gave.
export default function GrindAllModal({
  appointmentId, appointmentCustomerId, species, portion, producer, carcassTag,
  customerName, carcassCount, onClose, onSaved,
}: {
  appointmentId:          string
  appointmentCustomerId:  string
  species:                string   // as booked — 'Beef' | 'Hog' | 'Lamb' | 'Goat'
  portion:                string
  producer:               string
  carcassTag:             string
  /** The slot's name, blank on a house booking — prefilled with the producer. */
  customerName:           string
  /** How many carcasses on this booking share the slot, so the reach is stated. */
  carcassCount:           number
  onClose:                () => void
  onSaved:                () => void
}) {
  const k = speciesKey(species)
  const [name,   setName]   = useState(customerName || producer)
  const [notes,  setNotes]  = useState('')
  const [fatPct, setFatPct] = useState('')
  const [pack,   setPack]   = useState('')
  const [keepFat, setKeepFat] = useState(false)
  const [flavor, setFlavor] = useState('')
  const [format, setFormat] = useState('')
  const [style,  setStyle]  = useState('')
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')

  const choices: GrindAllChoices = {
    species, customerName: name, portion, killDate: null, notes,
    fatPct: fatPct || undefined, packSize: pack || undefined, keepFat,
    porkFlavor: flavor || undefined, porkFormat: format || undefined,
    lgStyle: style || undefined,
  }
  const missing = grindAllMissing(choices)

  async function save() {
    setSaving(true)
    setError('')
    const res = await fetch('/api/cutting-instructions/grind-all', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        appointment_id:          appointmentId,
        appointment_customer_id: appointmentCustomerId,
        customer_name:           name,
        notes,
        fatPct, packSize: pack, keepFat,
        porkFlavor: flavor, porkFormat: format,
        lgStyle: style,
      }),
    })
    const json = await res.json().catch(() => ({}))
    setSaving(false)
    if (!res.ok || json.error) { setError(json.error || 'Could not write that card.'); return }
    onSaved()
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.82)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem',
    }}>
      <div style={{
        background: '#1F0E06', border: '2px solid rgba(166,120,90,0.5)', borderRadius: 6,
        padding: '1.5rem', maxWidth: 560, width: '100%', maxHeight: '90vh', overflowY: 'auto',
      }}>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
          <div>
            <div style={{ color: C.cream, fontWeight: 700, fontSize: '1.05rem' }}>Grind the whole animal</div>
            <div style={{ color: C.lightBrown, fontSize: '0.82rem', marginTop: '0.2rem' }}>
              {producer || 'Appointment'} · {species} · tag {carcassTag || '—'}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.lightBrown, fontSize: '1.3rem', cursor: 'pointer', padding: '0 0.2rem' }}>✕</button>
        </div>

        <p style={{ fontSize: '0.78rem', color: C.lightBrown, lineHeight: 1.5, margin: '0.4rem 0 1rem' }}>
          Writes a real cut card that says <strong style={{ color: C.cream }}>grind everything — no steaks, chops or roasts</strong>, and puts it on this
          booking. It prints, packs and scans like any other card; you can edit it afterwards on the Cutting Instructions page.
          {carcassCount > 1 && (
            <> This booking&apos;s <strong style={{ color: C.cream }}>{carcassCount} carcasses</strong> share one cut customer, so the card covers all of them.</>
          )}
        </p>

        <Question title="Name on the card">
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Who this animal belongs to"
            style={{
              flex: 1, minWidth: 220, background: C.dark, color: C.cream,
              border: '1px solid rgba(166,120,90,0.35)', borderRadius: 4,
              padding: '0.4rem 0.6rem', fontSize: '0.86rem', outline: 'none',
            }}
          />
        </Question>

        {k === 'beef' && (<>
          <Question title="Fat blend">
            {BEEF_FAT_BLENDS.map(f => (
              <Pick key={f.val} label={f.label} desc={f.desc} on={fatPct === f.val} onClick={() => setFatPct(f.val)} />
            ))}
          </Question>
          <Question title="Loose grind — pack size">
            {BEEF_PACK_SIZES.map(p => (
              <Pick key={p.val} label={p.label} on={pack === p.val} onClick={() => setPack(p.val)} />
            ))}
          </Question>
          <Question title="Excess fat">
            <Pick label="Render it out" on={!keepFat} onClick={() => setKeepFat(false)} />
            <Pick label="Bag the fat back" on={keepFat} onClick={() => setKeepFat(true)} />
          </Question>
        </>)}

        {k === 'pork' && (<>
          <Question title="Flavor">
            {PORK_FLAVORS.map(f => (
              <Pick
                key={f.val} label={f.label} desc={f.desc} on={flavor === f.val}
                // Only pork sausage is offered in links; the rest are 1 lb chubs,
                // so switching away from it clears a format that no longer applies.
                onClick={() => { setFlavor(f.val); setFormat(f.val === 'pork-sausage' ? '' : 'loose-pack') }}
              />
            ))}
          </Question>
          {flavor === 'pork-sausage' && (
            <Question title="Format">
              {PORK_FORMATS.map(f => (
                <Pick key={f.val} label={f.label} on={format === f.val} onClick={() => setFormat(f.val)} />
              ))}
            </Question>
          )}
          {!!flavor && flavor !== 'pork-sausage' && (
            <div style={{ color: C.lightBrown, fontSize: '0.76rem', margin: '-0.4rem 0 0.9rem' }}>Packed in 1 lb chubs.</div>
          )}
        </>)}

        {(k === 'lamb' || k === 'goat') && (
          <Question title="Trim">
            {LAMB_GOAT_TRIM.map(t => (
              <Pick key={t.val} label={t.label} desc={t.desc} on={style === t.val} onClick={() => setStyle(t.val)} />
            ))}
          </Question>
        )}

        <Question title="Notes for the cutters">
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={2}
            placeholder="Organs, anything the floor should know…"
            style={{
              flex: 1, minWidth: 220, background: C.dark, color: C.cream,
              border: '1px solid rgba(166,120,90,0.35)', borderRadius: 4,
              padding: '0.4rem 0.6rem', fontSize: '0.82rem', outline: 'none', resize: 'vertical',
            }}
          />
        </Question>

        {error && (
          <div style={{ color: C.red, fontSize: '0.8rem', marginBottom: '0.7rem' }}>{error}</div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem', alignItems: 'center' }}>
          {missing && <span style={{ color: C.amber, fontSize: '0.76rem' }}>Still needs {missing}.</span>}
          <button
            onClick={onClose}
            style={{
              background: 'transparent', border: '1px solid rgba(166,120,90,0.4)', borderRadius: 4,
              color: C.tan, padding: '0.4rem 0.9rem', fontSize: '0.82rem', cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={!!missing || saving}
            style={{
              background: missing || saving ? 'rgba(76,175,80,0.12)' : 'rgba(76,175,80,0.22)',
              border: '1px solid rgba(76,175,80,0.5)', borderRadius: 4,
              color: missing || saving ? C.lightBrown : C.green,
              padding: '0.4rem 0.9rem', fontSize: '0.82rem', fontWeight: 700,
              cursor: missing || saving ? 'not-allowed' : 'pointer',
            }}
          >
            {saving ? 'Writing…' : 'Write the card'}
          </button>
        </div>
      </div>
    </div>
  )
}
