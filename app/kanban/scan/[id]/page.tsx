'use client'
import { use, useEffect, useState } from 'react'
import Link from 'next/link'
import { dateLabel } from '@/lib/dates'
import { cardLabel, qtyText, type Item, type Signal } from '@/lib/kanban'
import { C, Banner, KanbanHeader, cardStyle, inputStyle, useWho } from '../../ui'

// ══════════════════════════════════════════════════════════════════════════════
// A KANBAN CARD, SCANNED
//
// The QR on a bin's card lands here. Scanning doesn't order anything by itself
// — a phone glancing at a shelf shouldn't page anyone. The tap is the pull.
// The card's number rides in the URL (?card=2) so the board knows which bin
// emptied, and the same card can't be pulled twice.
// ══════════════════════════════════════════════════════════════════════════════

export default function ScanCardPage({ params, searchParams }: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ card?: string }>
}) {
  const { id } = use(params)
  const { card } = use(searchParams)
  const seq = Number(card) || null
  const [who, setWho] = useWho()

  const [item, setItem] = useState<Item | null>(null)
  const [vendor, setVendor] = useState<string | null>(null)
  const [open, setOpen] = useState<Signal[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState<{ urgency: 'normal' | 'out'; merged: boolean; allOut: boolean } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    fetch(`/api/kanban/items?id=${encodeURIComponent(id)}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(d => {
        if (!live) return
        setItem(d?.item ?? null)
        setVendor(d?.vendor?.name ?? null)
        setOpen(Array.isArray(d?.open) ? d.open : [])
      })
      .catch(() => { if (live) setError('No signal — could not load this card.') })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [id])

  async function pull(urgency: 'normal' | 'out') {
    if (!who.trim()) { setError('Put your name on it so whoever orders can ask.'); return }
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/kanban/signals', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_id: id, card_seq: seq, urgency, pulled_by: who.trim(), source: 'scan' }),
      })
      const body = await res.json()
      if (!res.ok) { setError(body?.error ?? "That didn't send."); return }
      setSent({ urgency: body.urgency === 'out' ? 'out' : urgency, merged: !!body.merged, allOut: !!body.all_out })
    } catch {
      setError('No signal — nothing was sent. Try again where the wifi reaches.')
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return <div><KanbanHeader title="Kanban card" back="/kanban" /><p style={{ padding: 16, color: C.tan }}>Loading…</p></div>
  }

  if (!item || !item.active) {
    return (
      <div>
        <KanbanHeader title="Kanban card" back="/kanban" />
        <div style={{ padding: 16, maxWidth: 560, margin: '0 auto' }}>
          <Banner tone="error">
            {item ? `${item.name} has been retired.` : 'This card points at an item that is no longer in the system.'}{' '}
            Take the card off the bin, or bring the item back on the Kanban → Cards screen.
          </Banner>
          <Link href="/kanban" style={{ color: C.tan }}>→ Kanban board</Link>
        </div>
      </div>
    )
  }

  const thisCard = seq != null ? open.find(s => s.card_seq === seq) : undefined
  const ou = item.order_unit ?? item.unit

  return (
    <div style={{ minHeight: '100vh', background: C.darkBrown, paddingBottom: 60 }}>
      <KanbanHeader title="Pull card" back="/kanban" />
      <div style={{ padding: 16, maxWidth: 560, margin: '0 auto' }}>
        {error && <Banner tone="error">{error}</Banner>}

        {/* Big enough to check against the bin in front of you before tapping. */}
        <div style={{ ...cardStyle, marginBottom: 16 }}>
          <div style={{ color: C.tan, fontFamily: 'monospace', fontSize: 14 }}>
            {cardLabel(item.card_no)}{seq != null && item.cards_in_loop > 1 ? ` · card ${seq} of ${item.cards_in_loop}` : ''}
          </div>
          <div style={{ color: C.cream, fontSize: 26, fontWeight: 700, lineHeight: 1.15 }}>{item.name}</div>
          <div style={{ color: C.tan, fontSize: 14, marginTop: 6, lineHeight: 1.6 }}>
            {item.location && <div>📍 {item.location}</div>}
            {item.backstock_location && <div>📦 Backstock: {item.backstock_location}</div>}
            <div>Orders {qtyText(item.order_qty, ou)}{vendor ? ` from ${vendor}` : ''}</div>
          </div>
        </div>

        {sent ? (
          <>
            <Banner tone={sent.urgency === 'out' ? 'error' : 'ok'}>
              {sent.merged
                ? `Already pulled — added your name${sent.urgency === 'out' ? ' and flagged it OUT' : ''}.`
                : sent.allOut
                  ? `Every card for ${item.name} was already out — flagged OUT and somebody has been alerted.`
                  : sent.urgency === 'out'
                    ? `Pulled and flagged OUT. Somebody has been alerted.`
                    : `Card pulled — ${item.name} is on the order sheet.`}
            </Banner>
            {item.card_type === 'two_bin' && !sent.allOut && (
              <div style={{ ...cardStyle, color: C.tan, fontSize: 14, marginBottom: 12 }}>
                Move the full bin{item.backstock_location ? ` from ${item.backstock_location}` : ''} up to the working spot.
              </div>
            )}
            <Link href="/kanban" style={{ color: C.tan, fontSize: 15 }}>→ See the board</Link>
          </>
        ) : (
          <>
            {thisCard && (
              <div style={{ ...cardStyle, marginBottom: 16, borderColor: thisCard.urgency === 'out' ? C.red : C.amber }}>
                <div style={{ color: thisCard.urgency === 'out' ? C.red : C.amber, fontSize: 14 }}>
                  This card is already pulled — {thisCard.pulled_by} pulled it
                  {thisCard.status === 'ordered'
                    ? `, and it's been ordered${thisCard.expected_on ? ` (due ${dateLabel(thisCard.expected_on, { weekday: 'short', month: 'short', day: 'numeric' })})` : ''}.`
                    : '. Waiting to be ordered.'}
                </div>
              </div>
            )}

            <input value={who} onChange={e => setWho(e.target.value)} placeholder="Your name" style={{ ...inputStyle, marginBottom: 12 }} />

            <button disabled={busy} onClick={() => pull('normal')} style={{
              width: '100%', minHeight: 72, borderRadius: 10, marginBottom: 12,
              background: C.dark, border: `1px solid ${C.tan}`, color: C.cream,
              fontSize: 19, fontWeight: 600, cursor: busy ? 'default' : 'pointer',
            }}>
              {busy ? 'Sending…' : item.card_type === 'two_bin' ? 'Bin is empty — pull this card' : 'At the reorder line — pull this card'}
            </button>
            <button disabled={busy} onClick={() => pull('out')} style={{
              width: '100%', minHeight: 72, borderRadius: 10,
              background: busy ? C.dark : C.red, border: `1px solid ${C.red}`,
              color: C.cream, fontSize: 19, fontWeight: 700, cursor: busy ? 'default' : 'pointer',
            }}>
              🚨 We are OUT — alert right away
            </button>
          </>
        )}
      </div>
    </div>
  )
}
