'use client'
import { useEffect, useState, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { isoDate, addDaysISO, dateLabel } from '@/lib/dates'
import {
  summarize, netOf, sumWeights, lbsFmt, pctFmt, dollars,
  WASTE_KINDS, KIND_LABEL, WEIGH_METHODS, METHOD_LABEL, METHOD_HINT,
  DESTINATIONS, DEFAULT_DESTINATION,
  type WastePayload, type WasteHaul, type WasteKind, type WeighMethod,
} from '@/lib/waste'

// Waste hauling — pounds in, pounds out.
//
// Every animal is weighed on the way in. What leaves for the Colstrip landfill
// never was: barrels and totes went on the truck and that was that. This page
// is where each haul's scale weight lands, and it puts that beside the
// hanging pounds that came through the kill floor over the same days, so
// "how much are we throwing away" is a percentage instead of a guess.
//
// Pounds in is hanging (hot carcass) weight because it's on every animal.
// Live weight is shown when the producer brought it, and the page only
// quotes a percent of live when every head in the window has one — a ratio
// against half the animals would be a ratio against nothing.

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
  blue:       '#60A5FA',
}
const TAP = 48

type Preset = 'month' | '30d' | '90d' | 'ytd' | 'custom'

function presetRange(p: Preset, today: string): { from: string; to: string } {
  switch (p) {
    case 'month': return { from: today.slice(0, 8) + '01', to: today }
    case '90d':   return { from: addDaysISO(today, -89), to: today }
    case 'ytd':   return { from: today.slice(0, 4) + '-01-01', to: today }
    default:      return { from: addDaysISO(today, -29), to: today }
  }
}

export default function WasteHauling() {
  const today = isoDate()
  const [preset, setPreset] = useState<Preset>('30d')
  const [range,  setRange]  = useState(() => presetRange('30d', today))
  const [data,   setData]   = useState<WastePayload | null>(null)
  const [error,  setError]  = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  const load = useCallback(() => {
    fetch(`/api/waste?from=${range.from}&to=${range.to}`)
      .then(r => r.json().then(b => ({ ok: r.ok, b })))
      .then(({ ok, b }) => { if (!ok) setError(b?.error ?? 'Could not load the waste log.'); else { setError(null); setData(b) } })
      .catch(() => setError('No connection.'))
  }, [range])

  useEffect(() => { load() }, [load])

  const pick = (p: Preset) => { setPreset(p); if (p !== 'custom') setRange(presetRange(p, today)) }

  const sum = useMemo(() => data ? summarize(data.hauls, data.pounds_in) : null, [data])

  const remove = (h: WasteHaul) => {
    if (!confirm(`Remove the ${lbsFmt(h.net_lbs)} haul on ${dateLabel(h.hauled_on, { month: 'short', day: 'numeric' })}?`)) return
    fetch(`/api/waste?id=${h.id}`, { method: 'DELETE' })
      .then(r => r.json().then(b => ({ ok: r.ok, b })))
      .then(({ ok, b }) => { if (!ok) setError(b?.error ?? 'Could not remove.'); else load() })
      .catch(() => setError('No connection.'))
  }

  const pin = data?.pounds_in

  return (
    <Shell>
      {error && <Banner tone="error">{error}</Banner>}

      {/* ── Window ─────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {([['month', 'This month'], ['30d', 'Last 30 days'], ['90d', 'Last 90 days'], ['ytd', 'Year to date'], ['custom', 'Pick dates']] as [Preset, string][]).map(([p, label]) => (
          <button key={p} onClick={() => pick(p)} style={{
            ...btn, minHeight: 40, padding: '6px 12px', fontSize: 13,
            background: preset === p ? C.medBrown : 'transparent',
            border: `1px solid ${preset === p ? C.medBrown : 'rgba(166,120,90,0.35)'}`,
            color: preset === p ? C.cream : C.tan,
          }}>{label}</button>
        ))}
      </div>
      {preset === 'custom' && (
        <div style={{ display: 'flex', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
          <Field label="From"><input type="date" value={range.from} max={range.to} onChange={e => setRange(r => ({ ...r, from: e.target.value || r.from }))} style={input} /></Field>
          <Field label="To"><input type="date" value={range.to} min={range.from} max={today} onChange={e => setRange(r => ({ ...r, to: e.target.value || r.to }))} style={input} /></Field>
        </div>
      )}

      {/* ── Pounds in, pounds out ──────────────────────────────────── */}
      {!data || !sum || !pin
        ? <p style={{ color: C.tan, marginTop: 16 }}>Loading…</p>
        : (
          <div style={{ ...card, marginTop: 12 }}>
            <div style={{ color: C.lightBrown, fontSize: 12, marginBottom: 10 }}>
              {dateLabel(pin.from, { month: 'short', day: 'numeric' })} – {dateLabel(pin.to, { month: 'short', day: 'numeric', year: 'numeric' })}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24 }}>
              <Figure label={`pounds in · ${pin.head} head hanging`} value={lbsFmt(pin.hanging_lbs)} tone={C.cream} />
              <Figure label={`pounds out · ${sum.hauls} haul${sum.hauls === 1 ? '' : 's'}`} value={lbsFmt(sum.net_lbs)} tone={C.amber} />
              <Figure label="out as % of hanging" value={pctFmt(sum.pct_of_hanging)} tone={sum.pct_of_hanging == null ? C.lightBrown : C.green} />
              <Figure label="waste per head" value={sum.lbs_per_head != null ? lbsFmt(sum.lbs_per_head, 1) : '—'} tone={C.blue} />
            </div>

            {/* Live weight, when it's there */}
            <div style={{ color: C.tan, fontSize: 13, marginTop: 12, lineHeight: 1.5 }}>
              {pin.live_lbs != null
                ? pin.live_head === pin.head
                  ? <>Live weight in: <b style={{ color: C.cream }}>{lbsFmt(pin.live_lbs)}</b> · waste is <b style={{ color: C.cream }}>{pctFmt(sum.pct_of_live)}</b> of live.</>
                  : <>Live weight on {pin.live_head} of {pin.head} head ({lbsFmt(pin.live_lbs)}). Percent of live needs it on every animal, so hanging is the yardstick here.</>
                : pin.head > 0
                  ? 'No live weights in this window; hanging weight is the yardstick.'
                  : 'Nothing on the harvest log for these days.'}
            </div>

            {(sum.fee_dollars > 0 || sum.miles != null) && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
                {sum.fee_dollars > 0 && <Chip tone={C.lightBrown}>{dollars(sum.fee_dollars)} in tipping fees</Chip>}
                {sum.miles != null && <Chip tone={C.lightBrown}>{sum.miles.toLocaleString('en-US', { maximumFractionDigits: 0 })} mi on the truck</Chip>}
                {sum.fee_dollars > 0 && sum.net_lbs > 0 && <Chip tone={C.lightBrown}>{dollars(sum.fee_dollars / sum.net_lbs * 100)} per 100 lb</Chip>}
              </div>
            )}

            {sum.by_destination.length > 1 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                {sum.by_destination.map(d => (
                  <Chip key={d.destination} tone={C.tan}>{d.destination} · {lbsFmt(d.net_lbs)} · {d.hauls} haul{d.hauls === 1 ? '' : 's'}</Chip>
                ))}
              </div>
            )}

            {pin.by_species.length > 0 && (
              <details style={{ marginTop: 10 }}>
                <summary style={{ color: C.lightBrown, fontSize: 12, cursor: 'pointer' }}>What came in, by species</summary>
                <table style={{ marginTop: 6, borderCollapse: 'collapse', fontSize: 13 }}>
                  <tbody>
                    {pin.by_species.map(s => (
                      <tr key={s.species}>
                        <td style={{ color: C.cream, padding: '2px 16px 2px 0' }}>{s.species}</td>
                        <td style={{ color: C.tan, padding: '2px 16px 2px 0', textAlign: 'right' }}>{s.head} head</td>
                        <td style={{ color: C.tan, padding: '2px 0', textAlign: 'right' }}>{lbsFmt(s.hanging_lbs)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            )}
          </div>
        )}

      {/* ── Log a haul ─────────────────────────────────────────────── */}
      {adding
        ? <HaulForm today={today} onDone={h => {
            setAdding(false)
            // A haul dated outside the window would vanish on save; widen so it shows.
            if (h.hauled_on < range.from || h.hauled_on > range.to) {
              setPreset('custom')
              setRange(r => ({ from: h.hauled_on < r.from ? h.hauled_on : r.from, to: h.hauled_on > r.to ? h.hauled_on : r.to }))
            } else load()
          }} onCancel={() => setAdding(false)} />
        : (
          <button onClick={() => setAdding(true)} style={{
            ...btn, width: '100%', marginTop: 16, minHeight: 56, fontSize: 16,
            background: C.medBrown, color: C.cream,
          }}>
            🚛 Log a haul
          </button>
        )}

      {/* ── Hauls ──────────────────────────────────────────────────── */}
      {data && data.hauls.length > 0 && (
        <>
          <SectionHead>{data.hauls.length} haul{data.hauls.length === 1 ? '' : 's'} · newest first</SectionHead>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {data.hauls.map(h => <HaulCard key={h.id} haul={h} onRemove={() => remove(h)} />)}
          </div>
        </>
      )}
      {data && data.hauls.length === 0 && (
        <div style={{ ...card, textAlign: 'center', color: C.tan, marginTop: 16, lineHeight: 1.5 }}>
          No hauls logged for these days. Weigh the barrels before the next Colstrip run and log it here.
        </div>
      )}
    </Shell>
  )
}

// ── One haul ────────────────────────────────────────────────────────────

function HaulCard({ haul: h, onRemove }: { haul: WasteHaul; onRemove: () => void }) {
  const miles = h.odometer_out != null && h.odometer_in != null ? Number(h.odometer_in) - Number(h.odometer_out) : null
  return (
    <div style={card}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: C.cream, fontSize: 16, fontWeight: 700 }}>
            {dateLabel(h.hauled_on, { weekday: 'short', month: 'short', day: 'numeric' })}
            <span style={{ color: C.tan, fontWeight: 400, fontSize: 14 }}> · {h.destination}</span>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
            <Chip tone={C.lightBrown}>{KIND_LABEL[h.kind] ?? h.kind}</Chip>
            <Chip tone={C.lightBrown}>{METHOD_LABEL[h.weigh_method] ?? h.weigh_method}</Chip>
            {h.container_count != null && <Chip tone={C.lightBrown}>{h.container_count} container{h.container_count === 1 ? '' : 's'}</Chip>}
            {h.gross_lbs != null && h.tare_lbs != null && <Chip tone={C.lightBrown}>{lbsFmt(h.gross_lbs)} gross · {lbsFmt(h.tare_lbs)} tare</Chip>}
            {h.ticket_no && <Chip tone={C.blue}>ticket {h.ticket_no}</Chip>}
            {h.fee_dollars != null && <Chip tone={C.blue}>{dollars(h.fee_dollars)}</Chip>}
            {miles != null && <Chip tone={C.lightBrown}>{miles.toLocaleString('en-US', { maximumFractionDigits: 0 })} mi</Chip>}
          </div>
          {h.container_weights && h.container_weights.length > 0 && (
            <div style={{ color: C.lightBrown, fontSize: 12, marginTop: 6 }}>
              {h.container_weights.map(w => Number(w).toLocaleString('en-US', { maximumFractionDigits: 1 })).join(' + ')} lb
            </div>
          )}
          {(h.hauled_by || h.notes) && (
            <div style={{ color: C.tan, fontSize: 13, marginTop: 6 }}>
              {h.hauled_by && <span>{h.hauled_by}</span>}
              {h.hauled_by && h.notes && ' · '}
              {h.notes}
            </div>
          )}
        </div>
        <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
          <div style={{ color: C.amber, fontSize: 20, fontWeight: 700 }}>{lbsFmt(h.net_lbs)}</div>
          <div style={{ color: C.lightBrown, fontSize: 11 }}>net</div>
          <button onClick={onRemove} style={{ ...btn, minHeight: 32, padding: '4px 10px', fontSize: 12, marginTop: 8, background: 'transparent', border: `1px solid rgba(166,120,90,0.35)`, color: C.lightBrown }}>
            Remove
          </button>
        </div>
      </div>
    </div>
  )
}

// ── The form ────────────────────────────────────────────────────────────

function HaulForm({ today, onDone, onCancel }: { today: string; onDone: (h: WasteHaul) => void; onCancel: () => void }) {
  const [hauledOn, setHauledOn] = useState(today)
  const [dest,     setDest]     = useState<string>(DEFAULT_DESTINATION)
  const [kind,     setKind]     = useState<WasteKind>('mixed')
  const [method,   setMethod]   = useState<WeighMethod>('shop_scale')
  // Shop scale: one weight per container as it crosses the floor scale.
  const [weights,  setWeights]  = useState<string[]>([''])
  // Landfill scale / estimate.
  const [gross,    setGross]    = useState('')
  const [tare,     setTare]     = useState('')
  const [net,      setNet]      = useState('')
  const [count,    setCount]    = useState('')
  const [ticket,   setTicket]   = useState('')
  const [fee,      setFee]      = useState('')
  const [odoOut,   setOdoOut]   = useState('')
  const [odoIn,    setOdoIn]    = useState('')
  const [by,       setBy]       = useState('')
  const [notes,    setNotes]    = useState('')
  const [busy,     setBusy]     = useState(false)
  const [err,      setErr]      = useState<string | null>(null)

  const n = (s: string): number | null => { const v = parseFloat(s.replace(/[,\s]/g, '')); return Number.isFinite(v) ? v : null }
  const ws = weights.map(n).filter((w): w is number => w != null && w >= 0)

  const grossNow = method === 'shop_scale' ? (ws.length ? sumWeights(ws) : null) : n(gross)
  const netNow   = method === 'estimate'
    ? n(net)
    : netOf(grossNow, n(tare), null)
  const containers = method === 'shop_scale' ? ws.length : n(count)

  const setW = (i: number, v: string) => setWeights(arr => {
    const next = [...arr]; next[i] = v
    // Always leave one empty slot at the end so the next barrel has somewhere to go.
    if (i === next.length - 1 && v.trim() !== '') next.push('')
    return next
  })
  const dropW = (i: number) => setWeights(arr => arr.length > 1 ? arr.filter((_, j) => j !== i) : [''])

  const save = () => {
    if (netNow == null) { setErr('Enter the weights first.'); return }
    setBusy(true); setErr(null)
    fetch('/api/waste', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hauled_on: hauledOn, destination: dest, kind, weigh_method: method,
        container_weights: method === 'shop_scale' ? ws : [],
        gross_lbs: method === 'shop_scale' ? null : gross,
        tare_lbs:  method === 'estimate'   ? null : tare,
        net_lbs:   method === 'estimate'   ? net  : null,
        container_count: method === 'shop_scale' ? ws.length : count,
        ticket_no: ticket, fee_dollars: fee,
        odometer_out: odoOut, odometer_in: odoIn,
        hauled_by: by, notes,
      }),
    })
      .then(r => r.json().then(b => ({ ok: r.ok, b })))
      .then(({ ok, b }) => { if (!ok) setErr(b?.error ?? 'Could not save.'); else onDone(b as WasteHaul) })
      .catch(() => setErr('No connection.'))
      .finally(() => setBusy(false))
  }

  return (
    <div style={{ ...card, marginTop: 16 }}>
      <div style={{ color: C.cream, fontSize: 16, fontWeight: 700, marginBottom: 12 }}>Log a haul</div>
      {err && <Banner tone="error">{err}</Banner>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0 12px' }}>
        <Field label="Hauled on">
          <input type="date" value={hauledOn} max={today} onChange={e => setHauledOn(e.target.value || today)} style={input} />
        </Field>
        <Field label="Where it went">
          <input list="waste-destinations" value={dest} onChange={e => setDest(e.target.value)} style={input} />
          <datalist id="waste-destinations">{DESTINATIONS.map(d => <option key={d} value={d} />)}</datalist>
        </Field>
      </div>

      <Field label="What was on the load">
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {WASTE_KINDS.map(k => <Tap key={k} on={kind === k} onClick={() => setKind(k)}>{KIND_LABEL[k]}</Tap>)}
        </div>
      </Field>

      <Field label="How it was weighed">
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {WEIGH_METHODS.map(m => <Tap key={m} on={method === m} onClick={() => setMethod(m)}>{METHOD_LABEL[m]}</Tap>)}
        </div>
        <div style={{ color: C.lightBrown, fontSize: 12, marginTop: 6, lineHeight: 1.4 }}>{METHOD_HINT[method]}</div>
      </Field>

      {method === 'shop_scale' && (
        <>
          <Field label="Each container, loaded (lb)">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {weights.map((w, i) => (
                <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span style={{ color: C.lightBrown, fontSize: 12, width: 22, textAlign: 'right' }}>{i + 1}</span>
                  <input type="number" inputMode="decimal" min={0} step="0.5" value={w} placeholder="lb"
                    onChange={e => setW(i, e.target.value)} style={{ ...input, flex: 1 }} />
                  {(weights.length > 1 && (w !== '' || i < weights.length - 1)) && (
                    <button type="button" onClick={() => dropW(i)} aria-label="Remove" style={{ ...btn, minHeight: 40, minWidth: 40, padding: 0, background: 'transparent', color: C.lightBrown, border: `1px solid rgba(166,120,90,0.35)` }}>×</button>
                  )}
                </div>
              ))}
            </div>
          </Field>
          <Field label="Empty containers, all together (lb) — optional">
            <input type="number" inputMode="decimal" min={0} step="0.5" value={tare} onChange={e => setTare(e.target.value)} placeholder="0" style={input} />
          </Field>
        </>
      )}

      {method === 'landfill_scale' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0 12px' }}>
          <Field label="Gross, loaded (lb)">
            <input type="number" inputMode="decimal" min={0} value={gross} onChange={e => setGross(e.target.value)} style={input} />
          </Field>
          <Field label="Tare, empty (lb)">
            <input type="number" inputMode="decimal" min={0} value={tare} onChange={e => setTare(e.target.value)} style={input} />
          </Field>
          <Field label="Containers">
            <input type="number" inputMode="numeric" min={0} step={1} value={count} onChange={e => setCount(e.target.value)} style={input} />
          </Field>
        </div>
      )}

      {method === 'estimate' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0 12px' }}>
          <Field label="About how much (lb)">
            <input type="number" inputMode="decimal" min={0} value={net} onChange={e => setNet(e.target.value)} style={input} />
          </Field>
          <Field label="Containers">
            <input type="number" inputMode="numeric" min={0} step={1} value={count} onChange={e => setCount(e.target.value)} style={input} />
          </Field>
        </div>
      )}

      <div style={{ ...card, background: C.dark, padding: '10px 14px', marginBottom: 12, display: 'flex', gap: 20, flexWrap: 'wrap' }}>
        <Figure label="net on this haul" value={lbsFmt(netNow, 1)} tone={netNow == null ? C.lightBrown : C.amber} />
        {grossNow != null && method !== 'estimate' && <Figure label="gross" value={lbsFmt(grossNow, 1)} tone={C.cream} />}
        {containers != null && containers > 0 && <Figure label="containers" value={String(containers)} tone={C.cream} />}
      </div>

      <details>
        <summary style={{ color: C.lightBrown, fontSize: 13, cursor: 'pointer', marginBottom: 10 }}>Ticket, fee, odometer, who hauled</summary>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0 12px' }}>
          <Field label="Landfill ticket #">
            <input value={ticket} onChange={e => setTicket(e.target.value)} style={input} />
          </Field>
          <Field label="Tipping fee ($)">
            <input type="number" inputMode="decimal" min={0} step="0.01" value={fee} onChange={e => setFee(e.target.value)} style={input} />
          </Field>
          <Field label="Odometer out">
            <input type="number" inputMode="decimal" min={0} step="0.1" value={odoOut} onChange={e => setOdoOut(e.target.value)} style={input} />
          </Field>
          <Field label="Odometer back">
            <input type="number" inputMode="decimal" min={0} step="0.1" value={odoIn} onChange={e => setOdoIn(e.target.value)} style={input} />
          </Field>
          <Field label="Hauled by">
            <input value={by} onChange={e => setBy(e.target.value)} style={input} />
          </Field>
        </div>
        <Field label="Notes">
          <input value={notes} onChange={e => setNotes(e.target.value)} style={input} />
        </Field>
      </details>

      <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
        <button onClick={save} disabled={busy || netNow == null} style={{ ...btn, flex: 1, background: netNow == null ? 'rgba(166,120,90,0.3)' : C.green, color: C.dark, opacity: busy ? 0.6 : 1 }}>
          {busy ? 'Saving…' : `Save ${netNow != null ? lbsFmt(netNow, 1) : 'haul'}`}
        </button>
        <button onClick={onCancel} disabled={busy} style={{ ...btn, background: 'transparent', border: `1px solid ${C.medBrown}`, color: C.tan }}>Cancel</button>
      </div>
    </div>
  )
}

// ── bits ────────────────────────────────────────────────────────────────

const card: React.CSSProperties = {
  background: C.darkBrown, border: `1px solid ${C.medBrown}`,
  borderRadius: 12, padding: 16,
}

const input: React.CSSProperties = {
  width: '100%', minHeight: TAP, padding: '8px 10px', fontSize: 15, boxSizing: 'border-box',
  background: C.dark, color: C.cream, border: `1px solid ${C.medBrown}`, borderRadius: 8,
}

const btn: React.CSSProperties = {
  minHeight: TAP, padding: '8px 16px', fontSize: 14, fontWeight: 700,
  border: 'none', borderRadius: 10, cursor: 'pointer',
}

function Tap({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} style={{
      ...btn, minHeight: 40, padding: '6px 12px', fontSize: 13,
      background: on ? C.medBrown : 'transparent',
      border: `1px solid ${on ? C.medBrown : 'rgba(166,120,90,0.35)'}`,
      color: on ? C.cream : C.tan,
    }}>{children}</button>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ paddingBottom: 60, minHeight: '100vh', background: 'var(--dark-brown)' }}>
      <header style={{
        background: C.dark, borderBottom: `1px solid ${C.medBrown}`,
        padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12,
        position: 'sticky', top: 0, zIndex: 50,
      }}>
        <Link href="/" style={{ color: C.tan, fontSize: 26, textDecoration: 'none', lineHeight: 1, padding: '4px 8px 8px 0' }}>‹</Link>
        <h1 style={{ color: C.cream, fontSize: 18, fontWeight: 700, margin: 0 }}>Waste Hauling</h1>
        <span style={{ color: C.lightBrown, fontSize: 13, marginLeft: 'auto' }}>pounds in, pounds out</span>
      </header>
      <div style={{ padding: 16, maxWidth: 860, margin: '0 auto' }}>{children}</div>
    </div>
  )
}

function SectionHead({ children }: { children: React.ReactNode }) {
  return <div style={{ color: C.cream, fontSize: 16, fontWeight: 700, margin: '22px 0 10px' }}>{children}</div>
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block', marginBottom: 10 }}>
      <div style={{ color: C.tan, fontSize: 12, marginBottom: 4 }}>{label}</div>
      {children}
    </label>
  )
}

function Figure({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div>
      <div style={{ color: tone, fontSize: 20, fontWeight: 700 }}>{value}</div>
      <div style={{ color: C.lightBrown, fontSize: 12 }}>{label}</div>
    </div>
  )
}

function Chip({ children, tone }: { children: React.ReactNode; tone: string }) {
  return (
    <span style={{
      fontSize: 11, color: tone, border: `1px solid ${tone}`,
      borderRadius: 4, padding: '1px 6px', whiteSpace: 'nowrap',
    }}>
      {children}
    </span>
  )
}

function Banner({ tone, children }: { tone: 'error' | 'warn'; children: React.ReactNode }) {
  const color = tone === 'error' ? C.red : C.amber
  return (
    <div style={{
      background: `${color}22`, border: `1px solid ${color}`, borderRadius: 8,
      padding: '10px 14px', color: C.cream, fontSize: 14, marginBottom: 14,
    }}>
      {children}
    </div>
  )
}
