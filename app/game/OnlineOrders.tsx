'use client'

import { useCallback, useEffect, useState } from 'react'
import { describePick, type GameSheet } from '@/lib/gameCuts'
import { cheeseLabel, toRateMap, type GameRate, type RateMap } from '@/lib/gameBilling'
import { C, INPUT, LABEL, BTN, CARD, dateLabelSafe } from './ui'

// Orders hunters sent in before the meat arrived.
//
// These are REQUESTS, not intakes: no claim number has been issued and nothing
// is in the building yet. Taking one in is where it becomes real — the counter
// adds the two weights and the tag gets allocated, exactly as if they had
// walked up with nothing prepared. Everything the hunter already typed rides
// across, so nobody re-keys an order at a window with a truck idling outside.

interface GameOrder {
  id: string
  created_at: string
  hunter_name: string
  hunter_phone: string
  species: string
  base_material: string
  finished_product: string
  expected_date: string | null
  license_tag_no: string
  cut_sheet: GameSheet
  notes: string
}

export default function OnlineOrders({ onImported }: { onImported: () => void }) {
  const [orders, setOrders] = useState<GameOrder[]>([])
  const [rates, setRates]   = useState<RateMap>(() => toRateMap(null))
  const [openId, setOpenId] = useState<string | null>(null)
  const [err, setErr]       = useState('')

  const load = useCallback(() =>
    Promise.all([
      fetch('/api/game/orders?status=pending').then(r => r.json()),
      fetch('/api/game/rates').then(r => r.json()),
    ])
      .then(([o, r]) => {
        setOrders(Array.isArray(o) ? o : [])
        if (Array.isArray(r)) setRates(toRateMap(r as GameRate[]))
      })
      .catch(() => setErr('Could not load online orders.')),
  [])

  useEffect(() => { load() }, [load])

  if (!orders.length) return null

  return (
    <div style={{
      marginBottom: '1rem', padding: '0.85rem', borderRadius: 4,
      background: 'rgba(96,165,250,0.08)', border: `1px solid ${C.blue}`,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.6rem' }}>
        <span style={{ ...LABEL, color: C.blue, marginBottom: 0 }}>
          📨 {orders.length} order{orders.length === 1 ? '' : 's'} sent in online
        </span>
        <span style={{ fontSize: '0.7rem', color: C.lightBrown }}>
          Nothing is here yet — take one in when the meat arrives
        </span>
      </div>

      {err && <div style={{ color: C.red, fontSize: '0.8rem', marginBottom: '0.5rem' }}>{err}</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {orders.map(o => (
          <OrderCard
            key={o.id}
            order={o}
            rates={rates}
            open={openId === o.id}
            onToggle={() => setOpenId(openId === o.id ? null : o.id)}
            onDone={async () => { setOpenId(null); await load(); onImported() }}
            onError={setErr}
          />
        ))}
      </div>
    </div>
  )
}

function OrderCard({ order, rates, open, onToggle, onDone, onError }: {
  order: GameOrder
  rates: RateMap
  open: boolean
  onToggle: () => void
  onDone: () => void
  onError: (m: string) => void
}) {
  const [roast, setRoast]   = useState('')
  const [trim, setTrim]     = useState('')
  const [by, setBy]         = useState('')
  const [where, setWhere]   = useState('')
  const [hours, setHours]   = useState('')
  const [busy, setBusy]     = useState(false)

  const picks = order.cut_sheet?.smokehouse ?? []
  const label = (k: string) => rates[k]?.label ?? k

  async function takeIn() {
    setBusy(true); onError('')
    try {
      const res = await fetch('/api/game/orders', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order_id: order.id,
          roast_lbs: roast === '' ? null : Number(roast),
          trim_lbs:  trim === '' ? null : Number(trim),
          weight_in_lbs: (Number(roast) || 0) + (Number(trim) || 0) || null,
          received_by: by,
          storage_location: where,
          cleaning_hours: hours === '' ? null : Number(hours),
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not take it in')
      onDone()
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not take it in')
      setBusy(false)
    }
  }

  async function archive() {
    setBusy(true)
    await fetch('/api/game/orders', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: order.id, status: 'archived' }),
    })
    onDone()
  }

  return (
    <div style={{ ...CARD, padding: '0.7rem', background: 'rgba(255,255,255,0.03)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.6rem', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '0.92rem', color: C.cream, fontWeight: 600 }}>{order.hunter_name}</span>
        <span style={{ fontSize: '0.78rem', color: C.tan }}>{order.hunter_phone}</span>
        <span style={{ fontSize: '0.78rem', color: C.lightBrown }}>
          {order.species}
          {order.base_material ? ` · ${order.base_material}` : ''}
        </span>
        <span style={{ marginLeft: 'auto', fontSize: '0.72rem', color: C.lightBrown }}>
          {order.expected_date
            ? `dropping off ${dateLabelSafe(order.expected_date)}`
            : `sent ${dateLabelSafe(order.created_at.slice(0, 10))}`}
        </span>
      </div>

      {/* What they asked for, in their order of priority */}
      {picks.length > 0 && (
        <div style={{ fontSize: '0.74rem', color: C.tan, marginTop: '0.35rem', lineHeight: 1.5 }}>
          {picks.map((p, i) => (
            <span key={`${p.category}::${p.flavor}`}>
              {i > 0 && <span style={{ color: C.lightBrown }}> · </span>}
              <span style={{ color: C.lightBrown }}>{i + 1}.</span>{' '}
              {describePick(p, label, cheeseLabel)}
            </span>
          ))}
        </div>
      )}
      {order.notes && (
        <div style={{ fontSize: '0.73rem', color: C.lightBrown, marginTop: '0.25rem' }}>“{order.notes}”</div>
      )}

      {!open ? (
        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.55rem' }}>
          <button style={{ ...BTN(C.green), padding: '0.4rem 0.9rem', fontSize: '0.8rem' }} onClick={onToggle}>
            Take it in
          </button>
          <button style={{ ...BTN('transparent', C.lightBrown), padding: '0.4rem 0.7rem', fontSize: '0.78rem' }}
            onClick={archive} disabled={busy}>
            Never showed up
          </button>
        </div>
      ) : (
        <div style={{ marginTop: '0.6rem', paddingTop: '0.6rem', borderTop: '1px solid rgba(166,120,90,0.2)' }}>
          {/* The only things the counter can know that the hunter could not:
              what it actually weighs, split into the two pools. */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: '0.5rem' }}>
            <div>
              <label style={LABEL}>Roasts (lb)</label>
              <input type="number" min="0" step="0.1" value={roast} style={INPUT}
                onChange={e => setRoast(e.target.value)} autoFocus />
            </div>
            <div>
              <label style={LABEL}>Trim (lb)</label>
              <input type="number" min="0" step="0.1" value={trim} style={INPUT}
                onChange={e => setTrim(e.target.value)} />
            </div>
            <div>
              <label style={LABEL}>Cleaning hrs</label>
              <input type="number" min="0" step="0.25" value={hours} style={INPUT}
                onChange={e => setHours(e.target.value)} />
            </div>
            <div>
              <label style={LABEL}>Where it went</label>
              <input value={where} style={INPUT} onChange={e => setWhere(e.target.value)} placeholder="Game cooler" />
            </div>
            <div>
              <label style={LABEL}>Taken in by</label>
              <input value={by} style={INPUT} onChange={e => setBy(e.target.value)} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.6rem', alignItems: 'center' }}>
            <button style={BTN(C.green)} onClick={takeIn} disabled={busy}>
              {busy ? 'Taking it in…' : 'Issue claim tag'}
            </button>
            <button style={BTN('rgba(255,255,255,0.06)', C.cream)} onClick={onToggle} disabled={busy}>
              Cancel
            </button>
            <span style={{ fontSize: '0.72rem', color: C.lightBrown, marginLeft: 'auto' }}>
              Their order carries across — check it against the meat once the tag is on.
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
