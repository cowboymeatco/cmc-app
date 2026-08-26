'use client'

// What's in the cure cooler right now, read as smokehouse loads.
//
// Every ham and belly already gets a numbered seal scanned onto it at the gun
// (app/scanner — cure tags), so the plant has always known the COUNT without
// anybody adding a step. This board turns that count into the two numbers
// Charlie asked for on 2026-08-26: how many house loads it comes to at 24 hams
// / 72 bacons a load, and how much weight is about to go through the door.
//
// The pounds are only as good as the weights on the seals, and most seals still
// carry none — so weighed pounds, estimated pounds, and the unweighed piece
// count are shown as three separate things. A number that isn't fully evidenced
// never gets to look like one that is.
import { useEffect, useState, useCallback } from 'react'
import type { CureLoadSummary, RackLoad } from '@/lib/cureLoad'

const C = {
  dark:       '#1A0A04',
  darkBrown:  '#351E0E',
  medBrown:   '#75471B',
  lightBrown: '#A6785A',
  tan:        '#C9A882',
  cream:      '#F2E8D9',
  green:      '#4CAF50',
  yellow:     '#D97706',
  blue:       '#3B82F6',
  orange:     '#E8883A',
}

function Pill({ color, children, title }: { color: string; children: React.ReactNode; title?: string }) {
  return (
    <span title={title} style={{
      background: `${color}22`, border: `1px solid ${color}55`, color,
      fontSize: '0.68rem', fontWeight: 700, borderRadius: 99,
      padding: '0.15rem 0.55rem', letterSpacing: '0.04em', whiteSpace: 'nowrap',
    }}>{children}</span>
  )
}

function Stat({ label, value, sub, color = C.cream }: {
  label: string; value: string; sub?: string; color?: string
}) {
  return (
    <div style={{
      background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(166,120,90,0.2)',
      borderRadius: 4, padding: '0.75rem 1rem', minWidth: 130, flex: '1 1 130px',
    }}>
      <div style={{ fontSize: '0.65rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.09em' }}>
        {label}
      </div>
      <div style={{ color, fontSize: '1.5rem', fontWeight: 700, fontFamily: 'Georgia, serif', lineHeight: 1.3 }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: '0.7rem', color: C.lightBrown }}>{sub}</div>}
    </div>
  )
}

// One rack — hams, bacon combs, whatever else came through on a seal.
function RackCard({ rack }: { rack: RackLoad }) {
  const capacityKnown = rack.unitsPerBatch != null && rack.unitsPerBatch > 0
  const unit = rack.unitLabel ?? 'pieces'

  return (
    <div style={{
      background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(166,120,90,0.2)',
      borderRadius: 4, padding: '0.9rem 1.1rem',
    }}>
      <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ color: C.cream, fontWeight: 700, fontSize: '0.95rem', fontFamily: 'Georgia, serif' }}>
          {rack.label}
        </span>
        <Pill color={C.tan}>{rack.pieces} in cure</Pill>
        {capacityKnown ? (
          <>
            <Pill color={C.orange} title={`${rack.unitsPerBatch} ${unit} to a load`}>
              {rack.loads} load{rack.loads === 1 ? '' : 's'}
            </Pill>
            <span style={{ fontSize: '0.72rem', color: C.lightBrown }}>
              at {rack.unitsPerBatch} {unit} a load
              {rack.spaceLeft ? ` · room for ${rack.spaceLeft} more on the last one` : ' · the last load is full'}
            </span>
          </>
        ) : (
          <span style={{ fontSize: '0.72rem', color: C.lightBrown }}>
            no counted load size yet — set one under 🌡️ Cook Profiles on the Schedule tab
          </span>
        )}
      </div>

      {/* Products on this rack. A rack is only ever one row unless something
          shares it, so the breakdown stays out of the way when it's redundant. */}
      {rack.products.length > 1 && (
        <div style={{ marginTop: '0.6rem', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
          {rack.products.map(p => (
            <div key={p.product} style={{ display: 'flex', gap: '0.5rem', fontSize: '0.78rem', color: C.tan }}>
              <span style={{ minWidth: 130 }}>{p.product}</span>
              <span style={{ color: C.cream }}>{p.pieces}</span>
              <span style={{ color: C.lightBrown }}>
                {p.weighed > 0
                  ? `${p.weighedLbs} lb over ${p.weighed} weighed`
                  : 'none weighed'}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Weight. Three separate facts, never one blended total. */}
      <div style={{ marginTop: '0.6rem', paddingTop: '0.5rem', borderTop: '1px dashed rgba(166,120,90,0.2)', fontSize: '0.78rem' }}>
        {rack.weightComplete ? (
          <span style={{ color: C.green }}>
            <strong>{rack.weighedLbs} lb</strong> going in — every piece weighed.
          </span>
        ) : rack.weighed > 0 ? (
          <span style={{ color: C.tan }}>
            <strong style={{ color: C.cream }}>{rack.weighedLbs} lb</strong> weighed over {rack.weighed} of {rack.pieces} pieces
            {rack.estimatedLbs > 0 && (
              <> · <span style={{ color: C.yellow }}>≈{rack.totalLbs} lb</span> for the rack if the rest run the same</>
            )}
          </span>
        ) : (
          <span style={{ color: C.lightBrown }}>
            No weights on these seals yet — the count is solid, the pounds aren&apos;t there.
          </span>
        )}
      </div>
    </div>
  )
}

export default function CureTab() {
  const [data,    setData]    = useState<CureLoadSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [err,     setErr]     = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/cure-load')
      const d = await res.json()
      if (!res.ok) throw new Error(d?.error ?? 'load failed')
      setData(d)
      setErr(null)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not read the cure cooler')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  if (loading && !data) {
    return <div style={{ color: C.lightBrown, padding: '2rem 0' }}>Reading the cure cooler…</div>
  }
  if (err) {
    return <div style={{ color: C.yellow, padding: '2rem 0' }}>{err}</div>
  }
  if (!data || data.pieces === 0) {
    return (
      <div style={{ color: C.lightBrown, padding: '2rem 0', lineHeight: 1.7 }}>
        Nothing is in cure. Pieces land here the moment a numbered seal is scanned
        at the gun — no separate entry, no list to keep.
      </div>
    )
  }

  const weightPct = data.pieces > 0 ? Math.round(((data.pieces - data.unweighed) / data.pieces) * 100) : 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
        <Stat label="In cure" value={String(data.pieces)} sub={data.oldestDate ? `oldest tagged ${data.oldestDate}` : undefined} />
        <Stat
          label="House loads"
          value={data.loads != null ? String(data.loads) : '—'}
          sub={data.loads != null ? 'at the counted rack sizes' : 'no rack has a counted size'}
          color={C.orange}
        />
        <Stat
          label="Weighed in"
          value={`${data.weighedLbs} lb`}
          sub={`${data.pieces - data.unweighed} of ${data.pieces} pieces · ${weightPct}%`}
          color={C.green}
        />
        <Stat
          label="Rack estimate"
          value={data.estimatedLbs > 0 ? `≈${data.totalLbs} lb` : '—'}
          sub={data.estimatedLbs > 0 ? 'weighed plus the rest at the same size' : 'not enough weighed pieces yet'}
          color={data.estimatedLbs > 0 ? C.yellow : C.lightBrown}
        />
      </div>

      {data.unweighed > 0 && (
        <div style={{
          background: 'rgba(217,119,6,0.1)', border: '1px solid rgba(217,119,6,0.35)',
          borderRadius: 4, padding: '0.75rem 1rem', color: C.yellow, fontSize: '0.8rem', lineHeight: 1.6,
        }}>
          <strong>{data.unweighed} of {data.pieces} pieces went to cure without a weight.</strong>{' '}
          <span style={{ color: C.tan }}>
            The weight goes on at the gun: scan the seal, and either scan the piece&apos;s
            Hobart label or key the pounds in. A seal already in cure can still be
            weighed — rescan it and the same box is there. Until then the piece
            count is exact and the pounds are a partial figure.
          </span>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
        {data.racks.map(r => <RackCard key={r.group} rack={r} />)}
      </div>

      <div style={{ fontSize: '0.72rem', color: C.lightBrown, lineHeight: 1.7 }}>
        Load sizes were counted on the floor, not fitted from the controller logs —
        24 hams and 72 bacons to a load (Charlie, 2026-08-25). Shoulder bacon is
        counted against the bacon comb; change either number, or give another rack
        a size, under 🌡️ Cook Profiles on the Schedule tab.
        <button
          onClick={load}
          style={{
            marginLeft: '0.6rem', background: 'transparent', border: '1px solid rgba(166,120,90,0.3)',
            color: C.lightBrown, borderRadius: 3, cursor: 'pointer', fontSize: '0.72rem', padding: '0.15rem 0.6rem',
          }}>
          ↻ Refresh
        </button>
      </div>
    </div>
  )
}
