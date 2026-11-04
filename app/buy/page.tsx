'use client'
import { useEffect, useMemo, useState } from 'react'
import { SPECIES_EMOJI } from '@/lib/cutSchedule'
import {
  SHARE_PORTIONS, SHARE_SPECIES, money, type SharePortion, type ShareSpecies,
} from '@/lib/shares'

// Public: buy a whole, half or quarter of one of our animals. Same look and
// shape as /book (the harvest request form), and like it the answer is "we'll
// call you": the request lands in the /shares queue for the desk to confirm,
// quote, and place on a kill date.
//
// Pricing is by hanging weight, so what is shown is the posted $/lb and a
// dollar estimate off a typical carcass. The real number comes off the scale.

const C = {
  dark:       '#1A0A04',
  darkBrown:  '#2A1408',
  medBrown:   '#75471B',
  lightBrown: '#A6785A',
  tan:        '#C9A882',
  cream:      '#F2E8D9',
  orange:     '#E8883A',
  green:      '#4CAF50',
  red:        '#EF4444',
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
const SECTION: React.CSSProperties = {
  background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(166,120,90,0.18)',
  borderRadius: 6, padding: '1.5rem', marginBottom: '1.25rem',
}
const H3: React.CSSProperties = {
  color: C.orange, fontFamily: 'Georgia, serif', fontSize: '1rem', margin: '0 0 1rem',
  textTransform: 'uppercase', letterSpacing: '0.06em',
}
const PHONE = '(406) 346-7660'

interface PriceRow {
  species: ShareSpecies; portion: SharePortion
  price_per_lb: number | null; typical_whole_lbs: number | null; typical_share_lbs: number | null
  typical_basis: string | null; estimate: number | null
}

/** The next six months as <input type="month"> values, labelled. */
function nextMonths(n = 6): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = []
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Denver' }))
  for (let i = 0; i < n; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1)
    out.push({
      value: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      label: d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
    })
  }
  return out
}

export default function BuyPage() {
  const [prices, setPrices]   = useState<PriceRow[] | null>(null)
  const [speciesPick, setSpecies] = useState<ShareSpecies>('Beef')
  const [portionPick, setPortion] = useState<SharePortion>('Half')
  const [qty, setQty]         = useState(1)
  const [name, setName]       = useState('')
  const [phone, setPhone]     = useState('')
  const [email, setEmail]     = useState('')
  const [contact, setContact] = useState('Text Message')
  const [month, setMonth]     = useState('')
  const [fulfillment, setFulfillment] = useState<'pickup' | 'delivery'>('pickup')
  const [address, setAddress] = useState('')
  const [notes, setNotes]     = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted]   = useState(false)
  const [error, setError]     = useState('')
  const months = useMemo(() => nextMonths(), [])

  useEffect(() => {
    fetch('/api/shares/prices').then(r => r.json())
      .then(d => setPrices(Array.isArray(d.prices) ? d.prices : []))
      .catch(() => setPrices([]))
  }, [])

  // Only sizes with a posted price are offered.
  const offered = (s: ShareSpecies) => (prices ?? []).filter(p => p.species === s && p.price_per_lb != null)
  const speciesOffered = SHARE_SPECIES.filter(s => offered(s).length > 0)
  // The pick falls back to the first size on offer, so a species or portion
  // the price list doesn't sell can never be submitted.
  const species: ShareSpecies = speciesOffered.includes(speciesPick) ? speciesPick : (speciesOffered[0] ?? speciesPick)
  const portionsOffered = SHARE_PORTIONS[species].filter(p => offered(species).some(r => r.portion === p))
  const portion: SharePortion = portionsOffered.includes(portionPick) ? portionPick : (portionsOffered[0] ?? portionPick)

  const chosen = (prices ?? []).find(p => p.species === species && p.portion === portion) ?? null

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!name.trim())  { setError('Please enter your name.'); return }
    if (!phone.trim() && !email.trim()) { setError('Please give us a phone number or email so we can confirm.'); return }
    if (fulfillment === 'delivery' && !address.trim()) { setError('Please tell us where to deliver.'); return }
    setSubmitting(true)
    const res = await fetch('/api/shares', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'web', species, portion, qty,
        customer_name: name, phone, email, preferred_contact: contact,
        wanted_month: month || null, fulfillment, delivery_address: fulfillment === 'delivery' ? address : null,
        notes,
      }),
    })
    setSubmitting(false)
    if (res.ok) setSubmitted(true)
    else {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? `Something went wrong — please call us at ${PHONE}.`)
    }
  }

  const sizeWord = `${qty > 1 ? `${qty} ${portion.toLowerCase()}s` : `a ${portion.toLowerCase()}`} of ${qty > 1 ? '' : 'a '}${species.toLowerCase()}`

  if (submitted) {
    return (
      <div style={{ minHeight: '100vh', background: C.dark, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '2rem', textAlign: 'center' }}>
        <div style={{ fontSize: '3.5rem', marginBottom: '1rem' }}>🤠</div>
        <h1 style={{ fontFamily: 'Georgia, serif', color: C.cream, fontSize: '1.8rem', marginBottom: '0.5rem' }}>Got it!</h1>
        <p style={{ color: C.tan, fontSize: '1rem', maxWidth: 480, lineHeight: 1.6, marginBottom: '1.5rem' }}>
          Thanks, <strong style={{ color: C.cream }}>{name}</strong>. You asked for{' '}
          <strong style={{ color: C.orange }}>{SPECIES_EMOJI[species]} {sizeWord}</strong>
          {month ? <> around <strong style={{ color: C.orange }}>{months.find(m => m.value === month)?.label}</strong></> : null}.
          <br /><br />
          We&apos;ll {contact === 'Email' ? 'email' : contact === 'Text Message' ? 'text' : 'call'}{' '}
          <strong style={{ color: C.cream }}>{contact === 'Email' ? email : phone || email}</strong> within one business day
          to confirm, go over your cutting instructions, and give you a date.
        </p>
        <div style={{ color: C.lightBrown, fontSize: '0.85rem' }}>
          Questions in the meantime? Call us at <a href="tel:4063467660" style={{ color: C.orange }}>{PHONE}</a>
        </div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: C.dark, paddingBottom: '4rem' }}>
      <header style={{ background: C.darkBrown, borderBottom: '1px solid rgba(166,120,90,0.25)', padding: '0 2rem', height: '72px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontFamily: 'Georgia, serif', fontSize: '1.2rem', fontWeight: 700, color: C.cream, letterSpacing: '0.08em', textTransform: 'uppercase', margin: 0 }}>
            🐄 Cowboy Meat Company
          </h1>
          <p style={{ fontSize: '0.68rem', color: C.lightBrown, letterSpacing: '0.15em', textTransform: 'uppercase', margin: 0 }}>
            Forsyth, Montana · Beef, Pork &amp; Lamb by the Share
          </p>
        </div>
        <a href="tel:4063467660" style={{ color: C.orange, textDecoration: 'none', fontSize: '0.9rem', fontWeight: 600 }}>📞 {PHONE}</a>
      </header>

      <main style={{ maxWidth: 680, margin: '0 auto', padding: '2.5rem 1.5rem' }}>
        <div style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
          <h2 style={{ fontFamily: 'Georgia, serif', fontSize: '1.75rem', color: C.cream, margin: '0 0 0.5rem' }}>
            Buy a Whole, Half or Quarter
          </h2>
          <p style={{ color: C.tan, fontSize: '0.95rem', lineHeight: 1.6, margin: 0 }}>
            Processed right here in Forsyth under USDA inspection. Tell us what you want and we&apos;ll call to confirm
            the price, take your cutting instructions, and give you a pickup date. About 2 minutes.
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          {/* ── 1 · What ─────────────────────────────────────────────── */}
          <section style={SECTION}>
            <h3 style={H3}>1 · What would you like?</h3>
            {prices === null ? (
              <p style={{ color: C.lightBrown, fontSize: '0.85rem' }}>Loading prices…</p>
            ) : speciesOffered.length === 0 ? (
              <p style={{ color: C.lightBrown, fontSize: '0.85rem' }}>We&apos;re between animals right now — call us at {PHONE} and we&apos;ll get you on the list.</p>
            ) : (
              <>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
                  {speciesOffered.map(s => (
                    <button key={s} type="button" onClick={() => setSpecies(s)} style={{
                      flex: '1 1 120px', padding: '0.75rem', borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.95rem', fontWeight: 600,
                      background: species === s ? `${C.orange}22` : 'rgba(255,255,255,0.02)',
                      border: `1px solid ${species === s ? C.orange : 'rgba(166,120,90,0.25)'}`, color: species === s ? C.cream : C.tan,
                    }}>{SPECIES_EMOJI[s]} {s === 'Hog' ? 'Pork' : s}</button>
                  ))}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {offered(species).map(p => {
                    const on = p.portion === portion
                    return (
                      <label key={p.portion} style={{
                        display: 'flex', alignItems: 'center', gap: '1rem', cursor: 'pointer',
                        background: on ? `${C.green}18` : 'rgba(255,255,255,0.02)',
                        border: `1px solid ${on ? C.green + '60' : 'rgba(166,120,90,0.15)'}`, borderRadius: 4, padding: '0.7rem 1rem',
                      }}>
                        <input type="radio" name="portion" checked={on} onChange={() => setPortion(p.portion)} style={{ accentColor: C.green }} />
                        <div style={{ flex: 1 }}>
                          <div style={{ color: C.cream, fontWeight: 600 }}>{p.portion} {species === 'Hog' ? 'Hog' : species}</div>
                          <div style={{ color: C.lightBrown, fontSize: '0.8rem' }}>
                            {money(p.price_per_lb, 2)}/lb hanging weight
                            {p.typical_share_lbs != null ? ` · typically about ${Math.round(p.typical_share_lbs)} lb hanging` : ''}
                          </div>
                        </div>
                        {p.estimate != null && (
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ color: C.cream, fontWeight: 700 }}>≈ {money(p.estimate)}</div>
                            <div style={{ color: C.lightBrown, fontSize: '0.7rem' }}>estimate</div>
                          </div>
                        )}
                      </label>
                    )
                  })}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: '1rem' }}>
                  <label style={{ ...LABEL, marginBottom: 0 }}>How many</label>
                  <select value={qty} onChange={e => setQty(Number(e.target.value))} style={{ ...INPUT, width: 90 }}>
                    {[1, 2, 3, 4].map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
                <p style={{ color: C.lightBrown, fontSize: '0.8rem', lineHeight: 1.5, margin: '1rem 0 0' }}>
                  The price is per pound of hanging weight and includes the kill, cutting, wrapping and freezing.
                  {chosen?.typical_basis ? ` The estimate is based on the ${chosen.typical_basis}; ` : ' '}
                  your final price comes off the scale. You take home roughly 60–65% of the hanging weight in packaged meat, depending on your cuts.
                </p>
              </>
            )}
          </section>

          {/* ── 2 · Who ──────────────────────────────────────────────── */}
          <section style={SECTION}>
            <h3 style={H3}>2 · Your info</h3>
            <div style={{ display: 'grid', gap: '1rem' }}>
              <div><label style={LABEL}>Name *</label><input style={INPUT} value={name} onChange={e => setName(e.target.value)} autoComplete="name" /></div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div><label style={LABEL}>Phone</label><input style={INPUT} value={phone} onChange={e => setPhone(e.target.value)} type="tel" autoComplete="tel" placeholder="(406) 555-0100" /></div>
                <div><label style={LABEL}>Email</label><input style={INPUT} value={email} onChange={e => setEmail(e.target.value)} type="email" autoComplete="email" /></div>
              </div>
              <div>
                <label style={LABEL}>Best way to reach you</label>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  {['Text Message', 'Phone Call', 'Email'].map(c => (
                    <button key={c} type="button" onClick={() => setContact(c)} style={{
                      padding: '0.45rem 0.9rem', borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.85rem',
                      background: contact === c ? C.tan : 'rgba(255,255,255,0.04)', color: contact === c ? C.dark : C.tan,
                      border: `1px solid ${contact === c ? C.tan : 'rgba(166,120,90,0.3)'}`, fontWeight: 600,
                    }}>{c === 'Text Message' ? 'Text' : c === 'Phone Call' ? 'Call' : 'Email'}</button>
                  ))}
                </div>
              </div>
            </div>
          </section>

          {/* ── 3 · When & where ─────────────────────────────────────── */}
          <section style={SECTION}>
            <h3 style={H3}>3 · When &amp; where</h3>
            <div style={{ display: 'grid', gap: '1rem' }}>
              <div>
                <label style={LABEL}>When would you like it?</label>
                <select style={INPUT} value={month} onChange={e => setMonth(e.target.value)}>
                  <option value="">Soonest available</option>
                  {months.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </div>
              <div>
                <label style={LABEL}>Pickup or delivery</label>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  {(['pickup', 'delivery'] as const).map(f => (
                    <button key={f} type="button" onClick={() => setFulfillment(f)} style={{
                      flex: 1, padding: '0.6rem', borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.9rem', fontWeight: 600,
                      background: fulfillment === f ? C.tan : 'rgba(255,255,255,0.04)', color: fulfillment === f ? C.dark : C.tan,
                      border: `1px solid ${fulfillment === f ? C.tan : 'rgba(166,120,90,0.3)'}`,
                    }}>{f === 'pickup' ? 'Pick up in Forsyth' : 'Deliver to me'}</button>
                  ))}
                </div>
              </div>
              {fulfillment === 'delivery' && (
                <div><label style={LABEL}>Delivery address *</label><input style={INPUT} value={address} onChange={e => setAddress(e.target.value)} autoComplete="street-address" /></div>
              )}
              <div>
                <label style={LABEL}>Anything else?</label>
                <textarea style={{ ...INPUT, resize: 'vertical' }} rows={3} value={notes} onChange={e => setNotes(e.target.value)}
                  placeholder="e.g. splitting with a neighbor, want it mostly burger, need it before the holidays…" />
              </div>
            </div>
          </section>

          {error && <p style={{ color: C.red, fontSize: '0.9rem', margin: '0 0 1rem' }}>{error}</p>}
          <button type="submit" disabled={submitting || speciesOffered.length === 0} style={{
            width: '100%', padding: '1rem', borderRadius: 4, border: 'none', cursor: submitting ? 'wait' : 'pointer',
            background: C.orange, color: C.dark, fontFamily: 'inherit', fontSize: '1.05rem', fontWeight: 700, letterSpacing: '0.04em',
            opacity: submitting || speciesOffered.length === 0 ? 0.6 : 1,
          }}>{submitting ? 'Sending…' : 'Send my request'}</button>
          <p style={{ color: C.lightBrown, fontSize: '0.78rem', textAlign: 'center', marginTop: '0.75rem' }}>
            Nothing is charged now. We confirm by phone, and you pay by hanging weight when it&apos;s ready.
          </p>
        </form>
      </main>
    </div>
  )
}
