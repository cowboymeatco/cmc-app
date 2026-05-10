'use client'
import { useEffect, useState } from 'react'

// ── Palette (slightly lighter than ops dashboard — more welcoming) ─────────────
const C = {
  dark:       '#1A0A04',
  darkBrown:  '#2A1408',
  medBrown:   '#75471B',
  lightBrown: '#A6785A',
  tan:        '#C9A882',
  cream:      '#F2E8D9',
  orange:     '#E8883A',
  green:      '#4CAF50',
  yellow:     '#F59E0B',
  red:        '#EF4444',
}

const SPECIES_OPTIONS = ['Beef', 'Hog', 'Lamb', 'Goat']
const SPECIES_EMOJI: Record<string, string> = { Beef: '🐄', Hog: '🐷', Lamb: '🐑', Goat: '🐐' }
const SPECIES_UNIT: Record<string, string>  = { Beef: 'head', Hog: 'head', Lamb: 'head', Goat: 'head' }

interface Week {
  week_start:      string
  week_end:        string
  label:           string
  label_end:       string
  status:          'open' | 'limited' | 'full'
  available_beef:  number
  available_hogs:  number
  available_lambs: number
  available_goats: number
}

const STATUS_COLOR: Record<string, string> = {
  open:    C.green,
  limited: C.yellow,
  full:    C.red,
}
const STATUS_LABEL: Record<string, string> = {
  open:    '✓ Open',
  limited: '~ Limited',
  full:    '✕ Full',
}

const INPUT: React.CSSProperties = {
  width: '100%', background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(166,120,90,0.35)',
  borderRadius: 4, padding: '0.65rem 0.9rem', color: C.cream, fontSize: '0.92rem',
  outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit',
}
const LABEL: React.CSSProperties = {
  display: 'block', fontSize: '0.72rem', color: C.lightBrown,
  textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.35rem',
}

export default function BookPage() {
  const [weeks,       setWeeks]       = useState<Week[]>([])
  const [loadingWeeks, setLoadingWeeks] = useState(true)

  const [selectedWeek, setSelectedWeek] = useState<string>('')
  const [species,      setSpecies]      = useState('Beef')
  const [headCount,    setHeadCount]    = useState(1)
  const [name,         setName]         = useState('')
  const [phone,        setPhone]        = useState('')
  const [email,        setEmail]        = useState('')
  const [notes,        setNotes]        = useState('')

  const [submitting,  setSubmitting]  = useState(false)
  const [submitted,   setSubmitted]   = useState(false)
  const [error,       setError]       = useState('')

  useEffect(() => {
    fetch('/api/availability')
      .then(r => r.json())
      .then(d => { setWeeks(Array.isArray(d.weeks) ? d.weeks : []); setLoadingWeeks(false) })
      .catch(() => setLoadingWeeks(false))
  }, [])

  const chosenWeek = weeks.find(w => w.week_start === selectedWeek)

  function availableForSpecies(w: Week): number {
    if (species === 'Hog')  return w.available_hogs
    if (species === 'Lamb') return w.available_lambs
    if (species === 'Goat') return w.available_goats
    return w.available_beef
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!selectedWeek) { setError('Please choose a preferred week.'); return }
    if (!name.trim())  { setError('Please enter your name.'); return }
    if (!phone.trim()) { setError('Please enter a phone number so we can confirm your appointment.'); return }

    setSubmitting(true)

    // Use Monday of the selected week as the harvest_date (we'll confirm exact day by phone)
    const res = await fetch('/api/appointments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        harvest_date: selectedWeek,
        species,
        head_count:  headCount,
        source:      name.trim(),
        notes:       [
          notes.trim(),
          `Phone: ${phone.trim()}`,
          email.trim() ? `Email: ${email.trim()}` : '',
        ].filter(Boolean).join('\n'),
        status:      'PendingRequest',
        customers:   [],
      }),
    })

    setSubmitting(false)
    if (res.ok) {
      setSubmitted(true)
    } else {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? 'Something went wrong — please call us at (406) 346-7660.')
    }
  }

  // ── Success screen ────────────────────────────────────────────────────────────
  if (submitted) {
    return (
      <div style={{ minHeight: '100vh', background: C.dark, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '2rem', textAlign: 'center' }}>
        <div style={{ fontSize: '3.5rem', marginBottom: '1rem' }}>🤠</div>
        <h1 style={{ fontFamily: 'Georgia, serif', color: C.cream, fontSize: '1.8rem', marginBottom: '0.5rem' }}>Request Received!</h1>
        <p style={{ color: C.tan, fontSize: '1rem', maxWidth: 480, lineHeight: 1.6, marginBottom: '1.5rem' }}>
          Thanks, <strong style={{ color: C.cream }}>{name}</strong>! We got your request for{' '}
          <strong style={{ color: C.orange }}>{headCount} {SPECIES_EMOJI[species]} {species}</strong>{' '}
          the week of <strong style={{ color: C.orange }}>{chosenWeek?.label}</strong>.
          <br /><br />
          We&apos;ll call or text <strong style={{ color: C.cream }}>{phone}</strong> within one business day to confirm your date and walk through any questions.
        </p>
        <div style={{ color: C.lightBrown, fontSize: '0.85rem' }}>
          Questions in the meantime? Call us at{' '}
          <a href="tel:4063467660" style={{ color: C.orange }}>(406) 346-7660</a>
        </div>
      </div>
    )
  }

  // ── Main form ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', background: C.dark, paddingBottom: '4rem' }}>

      {/* Header */}
      <header style={{ background: C.darkBrown, borderBottom: '1px solid rgba(166,120,90,0.25)', padding: '0 2rem', height: '72px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontFamily: 'Georgia, serif', fontSize: '1.2rem', fontWeight: 700, color: C.cream, letterSpacing: '0.08em', textTransform: 'uppercase', margin: 0 }}>
            🐄 Cowboy Meat Company
          </h1>
          <p style={{ fontSize: '0.68rem', color: C.lightBrown, letterSpacing: '0.15em', textTransform: 'uppercase', margin: 0 }}>
            Forsyth, Montana · Custom Exempt Harvest
          </p>
        </div>
        <a href="tel:4063467660" style={{ color: C.orange, textDecoration: 'none', fontSize: '0.9rem', fontWeight: 600 }}>
          📞 (406) 346-7660
        </a>
      </header>

      <main style={{ maxWidth: 680, margin: '0 auto', padding: '2.5rem 1.5rem' }}>

        {/* Hero */}
        <div style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
          <h2 style={{ fontFamily: 'Georgia, serif', fontSize: '1.75rem', color: C.cream, margin: '0 0 0.5rem' }}>
            Request a Harvest Appointment
          </h2>
          <p style={{ color: C.tan, fontSize: '0.95rem', lineHeight: 1.6, margin: 0 }}>
            Fill out the form below and we&apos;ll call to confirm your date, go over cutting instructions, and answer any questions. Takes about 2 minutes.
          </p>
        </div>

        <form onSubmit={handleSubmit}>

          {/* ── Step 1: Week ─────────────────────────────────────────────── */}
          <section style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(166,120,90,0.18)', borderRadius: 6, padding: '1.5rem', marginBottom: '1.25rem' }}>
            <h3 style={{ color: C.orange, fontFamily: 'Georgia, serif', fontSize: '1rem', margin: '0 0 1rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              1 · Preferred Week
            </h3>

            {loadingWeeks ? (
              <p style={{ color: C.lightBrown, fontSize: '0.85rem' }}>Loading availability…</p>
            ) : weeks.length === 0 ? (
              <p style={{ color: C.lightBrown, fontSize: '0.85rem' }}>Unable to load availability — please call us at (406) 346-7660.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {weeks.map(w => {
                  const isFull     = w.status === 'full'
                  const isSelected = selectedWeek === w.week_start
                  const clr        = STATUS_COLOR[w.status]
                  return (
                    <label key={w.week_start} style={{
                      display: 'flex', alignItems: 'center', gap: '1rem',
                      background: isSelected ? `${clr}18` : 'rgba(255,255,255,0.02)',
                      border: `1px solid ${isSelected ? clr + '60' : 'rgba(166,120,90,0.15)'}`,
                      borderRadius: 4, padding: '0.7rem 1rem',
                      cursor: isFull ? 'not-allowed' : 'pointer',
                      opacity: isFull ? 0.5 : 1,
                      transition: 'all 0.15s',
                    }}>
                      <input
                        type="radio" name="week" value={w.week_start}
                        disabled={isFull}
                        checked={isSelected}
                        onChange={() => setSelectedWeek(w.week_start)}
                        style={{ accentColor: clr, width: 16, height: 16, flexShrink: 0 }}
                      />
                      <span style={{ flex: 1 }}>
                        <span style={{ color: C.cream, fontWeight: 600, fontSize: '0.92rem' }}>
                          Week of {w.label}
                        </span>
                        <span style={{ color: C.lightBrown, fontSize: '0.8rem', marginLeft: '0.5rem' }}>
                          ({w.label} – {w.label_end})
                        </span>
                      </span>
                      <span style={{
                        fontSize: '0.75rem', fontWeight: 700, color: clr,
                        background: `${clr}18`, border: `1px solid ${clr}40`,
                        borderRadius: 99, padding: '2px 10px', flexShrink: 0,
                      }}>
                        {STATUS_LABEL[w.status]}
                      </span>
                    </label>
                  )
                })}
              </div>
            )}

            <p style={{ color: C.lightBrown, fontSize: '0.75rem', marginTop: '0.75rem', marginBottom: 0, fontStyle: 'italic' }}>
              We&apos;ll confirm your exact kill day (typically Monday or Thursday) when we call.
            </p>
          </section>

          {/* ── Step 2: Species & Count ───────────────────────────────────── */}
          <section style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(166,120,90,0.18)', borderRadius: 6, padding: '1.5rem', marginBottom: '1.25rem' }}>
            <h3 style={{ color: C.orange, fontFamily: 'Georgia, serif', fontSize: '1rem', margin: '0 0 1rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              2 · What Are You Bringing In?
            </h3>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div>
                <label style={LABEL}>Species</label>
                <select value={species} onChange={e => setSpecies(e.target.value)} style={{ ...INPUT, cursor: 'pointer' }}>
                  {SPECIES_OPTIONS.map(s => (
                    <option key={s} value={s}>{SPECIES_EMOJI[s]} {s}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={LABEL}>How many head?</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <button type="button"
                    onClick={() => setHeadCount(n => Math.max(1, n - 1))}
                    style={{ width: 36, height: 36, background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(166,120,90,0.35)', borderRadius: 4, color: C.cream, fontSize: '1.2rem', cursor: 'pointer', flexShrink: 0 }}>
                    −
                  </button>
                  <input
                    type="number" min={1} max={20} value={headCount}
                    onChange={e => setHeadCount(Math.max(1, parseInt(e.target.value) || 1))}
                    style={{ ...INPUT, textAlign: 'center', width: 70, flexShrink: 0 }}
                  />
                  <button type="button"
                    onClick={() => setHeadCount(n => Math.min(20, n + 1))}
                    style={{ width: 36, height: 36, background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(166,120,90,0.35)', borderRadius: 4, color: C.cream, fontSize: '1.2rem', cursor: 'pointer', flexShrink: 0 }}>
                    +
                  </button>
                </div>
              </div>
            </div>

            {/* Capacity note */}
            {chosenWeek && (
              <div style={{ marginTop: '0.85rem', background: 'rgba(232,136,58,0.08)', border: '1px solid rgba(232,136,58,0.2)', borderRadius: 4, padding: '0.6rem 0.9rem', fontSize: '0.82rem', color: C.tan }}>
                {availableForSpecies(chosenWeek) >= headCount ? (
                  <span>✓ We have room for <strong>{headCount} {species}</strong> that week.</span>
                ) : availableForSpecies(chosenWeek) > 0 ? (
                  <span>⚠ We may only have room for <strong>{availableForSpecies(chosenWeek)} {SPECIES_UNIT[species]}</strong> that week — we&apos;ll discuss when we call.</span>
                ) : (
                  <span>⚠ That week is getting tight — we&apos;ll check the schedule and call you.</span>
                )}
              </div>
            )}
          </section>

          {/* ── Step 3: Contact Info ──────────────────────────────────────── */}
          <section style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(166,120,90,0.18)', borderRadius: 6, padding: '1.5rem', marginBottom: '1.25rem' }}>
            <h3 style={{ color: C.orange, fontFamily: 'Georgia, serif', fontSize: '1rem', margin: '0 0 1rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              3 · Your Information
            </h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
              <div>
                <label style={LABEL}>Your name / ranch name <span style={{ color: C.red }}>*</span></label>
                <input
                  type="text" placeholder="e.g. John Smith or Rocking H Ranch"
                  value={name} onChange={e => setName(e.target.value)}
                  style={INPUT} required
                />
              </div>
              <div>
                <label style={LABEL}>Phone number <span style={{ color: C.red }}>*</span></label>
                <input
                  type="tel" placeholder="(406) 555-1234"
                  value={phone} onChange={e => setPhone(e.target.value)}
                  style={INPUT} required
                />
                <p style={{ margin: '0.25rem 0 0', fontSize: '0.72rem', color: C.lightBrown }}>We&apos;ll call or text to confirm. No spam, ever.</p>
              </div>
              <div>
                <label style={LABEL}>Email address <span style={{ color: C.lightBrown, fontWeight: 400 }}>(optional)</span></label>
                <input
                  type="email" placeholder="you@example.com"
                  value={email} onChange={e => setEmail(e.target.value)}
                  style={INPUT}
                />
              </div>
              <div>
                <label style={LABEL}>Notes or special requests <span style={{ color: C.lightBrown, fontWeight: 400 }}>(optional)</span></label>
                <textarea
                  rows={3} placeholder="e.g. split half-and-half with a neighbor, have a cut sheet ready, need delivery, etc."
                  value={notes} onChange={e => setNotes(e.target.value)}
                  style={{ ...INPUT, resize: 'vertical', minHeight: 80, lineHeight: 1.5 }}
                />
              </div>
            </div>
          </section>

          {/* Error */}
          {error && (
            <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.4)', borderRadius: 4, padding: '0.75rem 1rem', color: '#fca5a5', fontSize: '0.88rem', marginBottom: '1rem' }}>
              {error}
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={submitting}
            style={{
              width: '100%', padding: '0.9rem', fontSize: '1rem', fontWeight: 700,
              background: submitting ? C.medBrown : C.orange,
              color: C.dark, border: 'none', borderRadius: 5,
              cursor: submitting ? 'not-allowed' : 'pointer',
              letterSpacing: '0.04em', textTransform: 'uppercase',
              transition: 'background 0.2s',
            }}
          >
            {submitting ? 'Sending Request…' : 'Submit Request →'}
          </button>

          <p style={{ textAlign: 'center', color: C.lightBrown, fontSize: '0.78rem', marginTop: '1rem' }}>
            This is a request, not a confirmed booking. We&apos;ll call within one business day to lock in your date.
          </p>

        </form>
      </main>

      {/* Footer */}
      <footer style={{ textAlign: 'center', color: C.lightBrown, fontSize: '0.78rem', padding: '2rem 1rem 1rem' }}>
        Cowboy Meat Company · 1109 Front St, Forsyth MT 59337 ·{' '}
        <a href="tel:4063467660" style={{ color: C.tan }}>( 406) 346-7660</a> ·{' '}
        <a href="mailto:info@cowboymeats.com" style={{ color: C.tan }}>info@cowboymeats.com</a>
      </footer>
    </div>
  )
}
