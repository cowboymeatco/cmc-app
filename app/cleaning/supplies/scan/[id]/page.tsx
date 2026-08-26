'use client'
import { useEffect, useState, use } from 'react'
import Link from 'next/link'
import { C, useCrewMember, CleaningHeader, Banner, cardStyle, inputStyle } from '../../../ui'

// ══════════════════════════════════════════════════════════════════════════════
// THE KANBAN CARD, SCANNED
//
// Charlie, 2026-08-26: "Create a lean kanban QR system for supply ordering."
//
// Two-bin kanban on paper: when the working bin runs out you pull the card off
// it and drop the card in a box, and the card IS the order. The QR sticker on
// the shelf is that card. Point a phone at it, one tap, done — no menu, no
// typing the product name, no finding the right row in a list, standing in a
// wet room holding an empty drum.
//
// Scanning does NOT order anything by itself. "We're out" texts a human, and a
// sticker that fires on sight would page somebody every time a phone happened
// to look at a shelf. Scan opens this; the tap is the order.
// ══════════════════════════════════════════════════════════════════════════════

interface Supply {
  id: string; name: string; unit: string | null; vendor: string | null
  par_level: number | null; notes: string | null
}
interface OpenRequest {
  id: string; urgency: 'normal' | 'out'; status: string
  requested_by: string; created_at: string
}

export default function ScanSupplyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { member } = useCrewMember()

  const [supply, setSupply]   = useState<Supply | null>(null)
  const [openReq, setOpenReq] = useState<OpenRequest | null>(null)
  const [loading, setLoading] = useState(true)
  const [sent,    setSent]    = useState<'normal' | 'out' | null>(null)
  const [busy,    setBusy]    = useState(false)
  const [error,   setError]   = useState<string | null>(null)
  // The crew picker remembers whoever used this phone last, but a shelf sticker
  // gets scanned by whoever is standing there — so the name stays editable and
  // is never assumed when it isn't known. Typed once it wins; until then the
  // remembered member stands in, derived rather than copied into state so the
  // picker loading late doesn't need an effect to catch up.
  const [typedWho, setTypedWho] = useState<string | null>(null)
  const who = typedWho ?? member?.name ?? ''

  useEffect(() => {
    let live = true
    Promise.allSettled([
      fetch('/api/cleaning/supplies').then(r => r.json()),
      fetch('/api/cleaning/supply-requests?status=open').then(r => r.json()),
    ]).then(([s, r]) => {
      if (!live) return
      if (s.status === 'fulfilled' && Array.isArray(s.value)) {
        setSupply((s.value as Supply[]).find(x => x.id === id) ?? null)
      }
      if (r.status === 'fulfilled' && Array.isArray(r.value)) {
        setOpenReq((r.value as (OpenRequest & { supply_id: string | null })[])
          .find(x => x.supply_id === id) ?? null)
      }
      setLoading(false)
    })
    return () => { live = false }
  }, [id])

  async function order(urgency: 'normal' | 'out') {
    if (!who.trim()) { setError('Put your name on it so the crew can ask about it.'); return }
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/cleaning/supply-requests', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          supply_id:    id,
          urgency,
          requested_by: who.trim(),
          note:         'scanned off the shelf card',
        }),
      })
      const body = await res.json()
      if (!res.ok) { setError(body?.error ?? "That didn't send."); return }
      setSent(urgency)
    } catch {
      setError('No signal — nothing was sent. Try again where the wifi reaches.')
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <div>
        <CleaningHeader title="Supply" back="/cleaning/supplies" member={member} />
        <p style={{ padding: 16, color: C.tan }}>Loading…</p>
      </div>
    )
  }

  // A sticker outlives the thing it names. If the supply has been retired or
  // deleted, say so plainly rather than showing a dead button — the sticker is
  // on a shelf and somebody has to know to take it down.
  if (!supply) {
    return (
      <div>
        <CleaningHeader title="Supply" back="/cleaning/supplies" member={member} />
        <div style={{ padding: 16, maxWidth: 560, margin: '0 auto' }}>
          <Banner tone="error">
            This card points at a supply that is no longer on the list. Take the sticker
            down, or add the supply back from the Supplies screen.
          </Banner>
          <Link href="/cleaning/supplies" style={{ color: C.tan, fontSize: 15 }}>
            → Supplies
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div style={{ paddingBottom: 60 }}>
      <CleaningHeader title="Reorder" back="/cleaning/supplies" member={member} />

      <div style={{ padding: 16, maxWidth: 560, margin: '0 auto' }}>
        {error && <Banner tone="error">{error}</Banner>}

        {/* The name big enough to check against the drum in your hand before
            you tap — scanning the wrong shelf card is the obvious mistake. */}
        <div style={{ ...cardStyle, marginBottom: 16 }}>
          <div style={{ color: C.cream, fontSize: 26, fontWeight: 700, lineHeight: 1.15 }}>
            {supply.name}
          </div>
          <div style={{ color: C.tan, fontSize: 14, marginTop: 4 }}>
            {[supply.unit, supply.vendor].filter(Boolean).join(' · ') || 'no unit or vendor recorded'}
          </div>
          {supply.notes && (
            <div style={{ color: C.lightBrown, fontSize: 13, marginTop: 6 }}>{supply.notes}</div>
          )}
        </div>

        {sent ? (
          <>
            <Banner tone="ok">
              {sent === 'out'
                ? `Told them we are OUT of ${supply.name}. Somebody has been texted.`
                : `${supply.name} is on the order list.`}
            </Banner>
            <Link href="/cleaning/supplies" style={{ color: C.tan, fontSize: 15 }}>
              → See the whole list
            </Link>
          </>
        ) : (
          <>
            {/* Already asked for. Not a blocker — a "getting low" that has since
                become "we're out" is worth saying — but the crew should know
                somebody got there first rather than assuming nobody did. */}
            {openReq && (
              <div style={{
                ...cardStyle, marginBottom: 16,
                borderColor: openReq.urgency === 'out' ? C.red : C.amber,
              }}>
                <div style={{ color: openReq.urgency === 'out' ? C.red : C.amber, fontSize: 14 }}>
                  Already on the list — {openReq.requested_by} asked
                  {openReq.urgency === 'out' ? ' (OUT)' : ''}
                  {openReq.status === 'ordered' ? ', and it has been ordered' : ''}.
                </div>
              </div>
            )}

            {!member?.name && (
              <input
                value={who}
                onChange={e => setTypedWho(e.target.value)}
                placeholder="Your name"
                style={{ ...inputStyle, marginBottom: 12 }}
              />
            )}

            <button
              disabled={busy}
              onClick={() => order('normal')}
              style={{
                width: '100%', minHeight: 72, borderRadius: 10, marginBottom: 12,
                background: C.dark, border: `1px solid ${C.tan}`, color: C.cream,
                fontSize: 19, fontWeight: 600, cursor: busy ? 'default' : 'pointer',
              }}
            >
              {busy ? 'Sending…' : 'Getting low — order more'}
            </button>

            {/* Same deliberate weight it has on the Supplies form: this one
                interrupts a person, so it looks like it does. */}
            <button
              disabled={busy}
              onClick={() => order('out')}
              style={{
                width: '100%', minHeight: 72, borderRadius: 10,
                background: busy ? C.dark : C.red, border: `1px solid ${C.red}`,
                color: C.cream, fontSize: 19, fontWeight: 700,
                cursor: busy ? 'default' : 'pointer',
              }}
            >
              🚨 We are OUT — texts right away
            </button>
          </>
        )}
      </div>
    </div>
  )
}
