'use client'

import { useCallback, useEffect, useState } from 'react'
import type { GameIntake, GameOutput, GameAddition, GameEvent } from '@/lib/types'
import type { BillingCharge } from '@/lib/billingRules'
import {
  toRateMap, cheeseLabel, rateFor, ADDITION_CATEGORIES, PRODUCT_CATEGORIES, SERVICE_CATEGORIES,
  CHEESE_TYPES, type GameRate, type RateMap,
} from '@/lib/gameBilling'
import { summariseSheet, type GameSheet } from '@/lib/gameCuts'
import { generateGameTag, generateGameWorkOrder } from '@/lib/labelGameTag'
import CutSheetEditor from './CutSheetEditor'
import { C, INPUT, LABEL, BTN, CARD, STATUS_META, STATUS_FLOW, money, lbs, daysHeld, printHTML } from './ui'

interface Detail {
  intake:    GameIntake
  outputs:   GameOutput[]
  additions: GameAddition[]
  events:    GameEvent[]
  charges:   BillingCharge[]
  total:     number
  buckets:   { product: number; other: number; grand: number }
  rates:     GameRate[]
  yield_pct: number | null
}

const FAT_LABEL: Record<string, string> = {
  add_beef_fat:  'Beef fat',
  add_pork_fat:  'Pork fat',
  add_beef_trim: 'Beef trim',
  add_pork_trim: 'Pork trim',
}

export default function GameDetail({
  id, onClose, onChanged,
}: {
  id: string
  onClose: () => void
  onChanged: () => void
}) {
  const [d, setD]           = useState<Detail | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab]       = useState<'work' | 'sheet' | 'ticket' | 'history'>('work')
  const [busy, setBusy]     = useState(false)
  const [err, setErr]       = useState('')

  const load = useCallback(() =>
    fetch(`/api/game/${id}`)
      .then(r => (r.ok ? r.json() : null))
      .then(json => { if (json) setD(json) })
      .catch(() => {})
      .finally(() => setLoading(false)),
  [id])

  useEffect(() => { load() }, [load])

  async function patchIntake(fields: Record<string, unknown>) {
    setBusy(true); setErr('')
    try {
      const res = await fetch('/api/game', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...fields }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Update failed')
      await load(); onChanged()
    } catch (e) { setErr(e instanceof Error ? e.message : 'Update failed') }
    finally { setBusy(false) }
  }

  if (loading) return <Shell onClose={onClose}><div style={{ color: C.lightBrown }}>Loading…</div></Shell>
  if (!d)      return <Shell onClose={onClose}><div style={{ color: C.red }}>Not found.</div></Shell>

  const { intake } = d
  const rates = toRateMap(d.rates)
  const meta  = STATUS_META[intake.status] ?? STATUS_META.receiving
  const held  = daysHeld(intake.received_at)
  const flowIdx = STATUS_FLOW.indexOf(intake.status)
  const nextStatus = flowIdx >= 0 && flowIdx < STATUS_FLOW.length - 1 ? STATUS_FLOW[flowIdx + 1] : null

  return (
    <Shell onClose={onClose}>
      {/* ── Header ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem' }}>
        <div>
          <div style={{ fontFamily: 'monospace', fontSize: '1.6rem', fontWeight: 700, color: C.cream, letterSpacing: '0.04em' }}>
            {intake.tag_number}
          </div>
          <div style={{ fontSize: '1.05rem', color: C.cream, fontWeight: 600, marginTop: '0.15rem' }}>
            {intake.hunter_name}
          </div>
          <div style={{ fontSize: '0.82rem', color: C.tan, marginTop: '0.15rem' }}>
            {intake.species}{intake.sex ? ` · ${intake.sex}` : ''} · {intake.condition}
            {intake.hunter_phone ? ` · ${intake.hunter_phone}` : ''}
          </div>
          {/* What came through the door — the slip's Base Material line. On a
              boned-out drop-off this is the only description of the meat there
              is, so it sits with the name rather than buried in a tab. */}
          <div style={{ fontSize: '0.8rem', color: C.lightBrown, marginTop: '0.25rem' }}>
            {intake.base_material || 'no base material recorded'} · {lbs(intake.weight_in_lbs)} in
            {intake.finished_product ? ` · ${intake.finished_product}` : ''}
          </div>
          {/* The split is what the order is actually filled against. */}
          {(intake.roast_lbs != null || intake.trim_lbs != null) && (
            <div style={{ fontSize: '0.76rem', color: C.tan, marginTop: '0.15rem' }}>
              <span style={{ color: C.purple }}>{lbs(intake.roast_lbs)} roasts</span>
              {' · '}
              <span style={{ color: C.orange }}>{lbs(intake.trim_lbs)} trim</span>
            </div>
          )}
        </div>
        <div style={{ textAlign: 'right' }}>
          <span style={{
            display: 'inline-block', padding: '0.3rem 0.7rem', borderRadius: 3,
            background: meta.color, color: C.dark, fontSize: '0.75rem', fontWeight: 700,
            textTransform: 'uppercase', letterSpacing: '0.1em',
          }}>{meta.label}</span>
          <div style={{
            fontSize: '0.78rem', marginTop: '0.4rem',
            color: held > 21 && intake.status !== 'picked_up' ? C.red : C.lightBrown,
          }}>
            {held} {held === 1 ? 'day' : 'days'} in the building
          </div>
        </div>
      </div>

      {/* ── Move it along ── */}
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', margin: '1rem 0', alignItems: 'center' }}>
        {nextStatus && (
          <button style={BTN(STATUS_META[nextStatus].color)} disabled={busy}
            onClick={() => patchIntake({ status: nextStatus })}>
            → {STATUS_META[nextStatus].label}
          </button>
        )}
        <select
          value={intake.status} style={{ ...INPUT, width: 'auto', padding: '0.45rem 0.7rem' }}
          aria-label="Status"
          onChange={e => patchIntake({ status: e.target.value })}
        >
          {Object.entries(STATUS_META).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
        </select>

        {intake.status === 'freezer' && !intake.notified_at && (
          <button style={BTN(C.blue, C.cream)} disabled={busy}
            onClick={() => patchIntake({ notified_at: new Date().toISOString() })}>
            📞 Mark hunter called
          </button>
        )}
        {intake.notified_at && (
          <span style={{ fontSize: '0.75rem', color: C.green }}>
            Called {new Date(intake.notified_at).toLocaleDateString()}
          </span>
        )}

        <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem' }}>
          <button style={{ ...BTN('rgba(255,255,255,0.06)', C.cream), padding: '0.45rem 0.8rem', fontSize: '0.8rem' }}
            onClick={() => printHTML(generateGameTag(intake))}>🏷 Tag</button>
          <button style={{ ...BTN('rgba(255,255,255,0.06)', C.cream), padding: '0.45rem 0.8rem', fontSize: '0.8rem' }}
            onClick={() => printHTML(generateGameWorkOrder(intake, intake.cut_sheet as GameSheet, rates))}>
            📋 Work order
          </button>
        </div>
      </div>

      {err && <div style={{ color: C.red, fontSize: '0.82rem', marginBottom: '0.75rem' }}>{err}</div>}

      {/* ── Tabs ── */}
      <div style={{ display: 'flex', gap: '0.25rem', borderBottom: `1px solid ${C.medBrown}`, marginBottom: '1rem' }}>
        {([
          ['work', 'Weigh out'], ['sheet', 'Order'],
          ['ticket', `Ticket · ${money(d.total)}`], ['history', 'History'],
        ] as const).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            style={{
              ...BTN('transparent', tab === k ? C.cream : C.lightBrown),
              padding: '0.5rem 0.9rem', fontSize: '0.82rem',
              borderBottom: tab === k ? `2px solid ${C.tan}` : '2px solid transparent',
              borderRadius: 0, fontWeight: tab === k ? 700 : 500,
            }}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'work'    && <WeighOut detail={d} rates={rates} onChanged={async () => { await load(); onChanged() }} />}
      {tab === 'sheet'   && <SheetTab detail={d} rates={rates} onSave={sheet => patchIntake({ cut_sheet: sheet })} busy={busy} />}
      {tab === 'ticket'  && <Ticket detail={d} rates={rates} onSaveHours={h => patchIntake({ cleaning_hours: h })} busy={busy} />}
      {tab === 'history' && <History detail={d} />}
    </Shell>
  )
}

// ── Weigh out ───────────────────────────────────────────────────────────────
// Packout. Everything that leaves gets weighed onto a line, and the line prices
// itself off the live list. This is the only screen that creates money here.
function WeighOut({ detail, rates, onChanged }: {
  detail: Detail; rates: RateMap; onChanged: () => void
}) {
  const { intake, outputs, additions } = detail
  const [category, setCategory] = useState<string>('sticks')
  const [flavor, setFlavor]     = useState('')
  const [cheese, setCheese]     = useState(false)
  const [cheeseType, setCheeseType] = useState('')
  const [weight, setWeight]     = useState('')
  const [fatKind, setFatKind]   = useState('')
  const [fatLbs, setFatLbs]     = useState('')
  const [busy, setBusy]         = useState(false)
  const [err, setErr]           = useState('')

  const sheet = (intake.cut_sheet ?? {}) as GameSheet
  const picks = sheet.smokehouse ?? []

  const svc = rates[category]
  const canCheese = svc?.cheese_rate != null
  const shownRate = rateFor(rates, category, cheese && canCheese)

  async function addOutput() {
    const w = Number(weight)
    if (!w || w <= 0) { setErr('Put a weight on it.'); return }
    setBusy(true); setErr('')
    try {
      const res = await fetch('/api/game/outputs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          intake_id: intake.id, category, flavor,
          cheese: cheese && canCheese, cheese_type: cheeseType,
          weight_lbs: w,
          fat_trim_kind: fatKind || undefined,
          fat_trim_lbs:  fatKind && Number(fatLbs) > 0 ? Number(fatLbs) : undefined,
        }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed')
      setWeight(''); setFlavor(''); setCheese(false); setCheeseType(''); setFatKind(''); setFatLbs('')
      onChanged()
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed') }
    finally { setBusy(false) }
  }

  async function addAddition(kind: string, w: number) {
    if (!w || w <= 0) return
    setBusy(true)
    await fetch('/api/game/outputs', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ intake_id: intake.id, kind, weight_lbs: w }),
    })
    setBusy(false); onChanged()
  }

  async function removeRow(id: string, table?: 'additions') {
    setBusy(true)
    await fetch(`/api/game/outputs?id=${id}${table ? `&table=${table}` : ''}`, { method: 'DELETE' })
    setBusy(false); onChanged()
  }

  const weighable = [...PRODUCT_CATEGORIES, ...SERVICE_CATEGORIES].filter(k => rates[k])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

      {/* What they ordered — one tap loads the line, ready for a weight */}
      {picks.length > 0 && (
        <div>
          <div style={LABEL}>The order — tap to load a line</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
            {picks.map(p => {
              const done = outputs.find(o => o.category === p.category && o.flavor === p.flavor)
              return (
                <button key={`${p.category}::${p.flavor}`} disabled={busy}
                  onClick={() => {
                    setCategory(p.category); setFlavor(p.flavor)
                    setCheese(!!p.cheese); setCheeseType(p.cheese_type ?? '')
                    setFatKind(p.fat_trim_kind ?? ''); setFatLbs(p.fat_trim_lbs ? String(p.fat_trim_lbs) : '')
                  }}
                  style={{
                    ...BTN(done ? 'rgba(76,175,80,0.18)' : 'rgba(249,115,22,0.15)', C.cream),
                    padding: '0.35rem 0.7rem', fontSize: '0.76rem',
                    border: `1px solid ${done ? C.green : C.orange}`,
                  }}>
                  {p.flavor} {rates[p.category]?.label}
                  {p.cheese && <span style={{ color: C.yellow }}> w/{p.cheese_type || '?'}</span>}
                  <span style={{ color: C.lightBrown }}> · ordered {p.lbs} lb</span>
                  {done && <span style={{ color: C.green }}> ✓ {done.weight_lbs} lb</span>}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Add a line */}
      <div style={{ ...CARD, display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1.4fr 0.8fr auto', gap: '0.6rem', alignItems: 'end' }}>
          <div>
            <label style={LABEL}>What</label>
            <select value={category} style={INPUT}
              onChange={e => { setCategory(e.target.value); setCheese(false); setCheeseType('') }}>
              {weighable.map(k => <option key={k} value={k}>{rates[k].label}</option>)}
            </select>
          </div>
          <div>
            <label style={LABEL}>Flavour</label>
            <input value={flavor} style={INPUT} onChange={e => setFlavor(e.target.value)}
              placeholder={(PRODUCT_CATEGORIES as readonly string[]).includes(category) ? 'Jalapeno' : 'optional'} />
          </div>
          <div>
            <label style={LABEL}>Weight lb</label>
            <input type="number" min="0" step="0.1" value={weight} style={{ ...INPUT, textAlign: 'right' }}
              onChange={e => setWeight(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addOutput() }} />
          </div>
          <button style={BTN(C.green)} disabled={busy} onClick={addOutput}>Add</button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
          {canCheese && (
            <label style={{
              display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer',
              fontSize: '0.78rem', color: cheese ? C.cream : C.tan,
            }}>
              <input type="checkbox" checked={cheese}
                onChange={() => { setCheese(!cheese); if (cheese) setCheeseType('') }}
                style={{ width: 15, height: 15, accentColor: C.yellow, cursor: 'pointer' }} />
              w/ cheese
            </label>
          )}
          {cheese && canCheese && (
            <select value={cheeseType} onChange={e => setCheeseType(e.target.value)}
              aria-label="Which cheese"
              style={{ ...INPUT, width: 'auto', padding: '0.3rem 0.45rem', fontSize: '0.78rem' }}>
              <option value="">Which cheese…</option>
              {CHEESE_TYPES.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
            </select>
          )}

          <span style={{ fontSize: '0.72rem', color: C.lightBrown, marginLeft: canCheese ? '0.5rem' : 0 }}>
            Fat/trim into this batch
          </span>
          <select value={fatKind} onChange={e => setFatKind(e.target.value)}
            aria-label="Fat or trim kind"
            style={{ ...INPUT, width: 'auto', padding: '0.3rem 0.45rem', fontSize: '0.78rem' }}>
            <option value="">none</option>
            {ADDITION_CATEGORIES.map(k => <option key={k} value={k}>{FAT_LABEL[k]}</option>)}
          </select>
          {fatKind && (
            <input type="number" min="0" step="0.5" value={fatLbs} placeholder="lb"
              onChange={e => setFatLbs(e.target.value)}
              aria-label="Fat or trim pounds"
              style={{ ...INPUT, width: 76, textAlign: 'right', padding: '0.3rem 0.45rem' }} />
          )}

          <span style={{ marginLeft: 'auto', fontSize: '0.76rem', color: C.tan }}>
            ${shownRate.toFixed(2)}/lb
            {canCheese && !cheese && svc?.cheese_rate != null &&
              <span style={{ color: C.lightBrown }}> · ${Number(svc.cheese_rate).toFixed(2)} w/ cheese</span>}
          </span>
        </div>
        {err && <div style={{ color: C.red, fontSize: '0.8rem' }}>{err}</div>}
      </div>

      {/* Weighed lines */}
      <div>
        <div style={LABEL}>Weighed out</div>
        {!outputs.length && <div style={{ color: C.lightBrown, fontSize: '0.82rem' }}>Nothing weighed yet.</div>}
        {outputs.map(o => (
          <Row key={o.id} onRemove={() => removeRow(o.id)}
            left={o.product_name || rates[o.category]?.label || o.category}
            sub={[
              o.qbo_item_name,
              o.rate_override ? 'rate typed over' : '',
              o.fat_trim_lbs ? `+${o.fat_trim_lbs} lb ${FAT_LABEL[o.fat_trim_kind] ?? o.fat_trim_kind}` : '',
            ].filter(Boolean).join(' · ')}
            mid={lbs(o.weight_lbs)}
            right={money(Number(o.weight_lbs) * Number(o.rate))}
            rate={`@ $${Number(o.rate).toFixed(2)}`} />
        ))}
      </div>

      {/* Fat & trim into the burger grind, not into one batch */}
      <div>
        <div style={LABEL}>Into the burger grind — our beef & pork</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.6rem' }}>
          {ADDITION_CATEGORIES.filter(k => rates[k]).map(kind => (
            <AddButton key={kind} label={FAT_LABEL[kind]} rate={Number(rates[kind].rate)}
              busy={busy} onAdd={w => addAddition(kind, w)} />
          ))}
        </div>
        {additions.map(a => (
          <Row key={a.id} onRemove={() => removeRow(a.id, 'additions')}
            left={a.qbo_item_name || FAT_LABEL[a.kind]} sub="Our product, into their burger"
            mid={lbs(a.weight_lbs)}
            right={money(Number(a.weight_lbs) * Number(a.rate))}
            rate={`@ $${Number(a.rate).toFixed(2)}`} />
        ))}
      </div>

      {/* Yield */}
      <div style={{
        ...CARD, display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        background: 'rgba(255,255,255,0.02)',
      }}>
        <div>
          <div style={{ fontSize: '0.75rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
            Finished vs base material
          </div>
          <div style={{ fontSize: '0.72rem', color: C.lightBrown, marginTop: '0.2rem' }}>
            Off {lbs(intake.weight_in_lbs)} in. Added fat and trim are excluded — that is our product, not theirs.
          </div>
        </div>
        <div style={{ fontSize: '1.6rem', fontWeight: 700, color: detail.yield_pct == null ? C.lightBrown : C.cream }}>
          {detail.yield_pct == null ? '—' : `${detail.yield_pct}%`}
        </div>
      </div>
    </div>
  )
}

// A weight prompt attached to a button, so adding 12 lbs of pork fat is two
// taps rather than a form.
function AddButton({ label, rate, busy, onAdd }: {
  label: string; rate: number; busy: boolean; onAdd: (w: number) => void
}) {
  const [w, setW] = useState('')
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
      <input type="number" min="0" step="0.1" value={w} placeholder="lb"
        onChange={e => setW(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && Number(w) > 0) { onAdd(Number(w)); setW('') } }}
        aria-label={`${label} pounds`}
        style={{ ...INPUT, width: 68, padding: '0.35rem 0.45rem', textAlign: 'right' }} />
      <button disabled={busy || !Number(w)}
        onClick={() => { onAdd(Number(w)); setW('') }}
        style={{ ...BTN('rgba(255,255,255,0.06)', C.cream), padding: '0.35rem 0.6rem', fontSize: '0.76rem' }}>
        {label} <span style={{ color: C.lightBrown }}>${rate.toFixed(2)}</span>
      </button>
    </div>
  )
}

function Row({ left, sub, mid, right, rate, onRemove }: {
  left: string; sub?: string; mid: string; right: string; rate?: string; onRemove: () => void
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.5rem 0',
      borderBottom: '1px solid rgba(166,120,90,0.15)',
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '0.85rem', color: C.cream }}>{left}</div>
        {sub && <div style={{ fontSize: '0.7rem', color: C.lightBrown }}>{sub}</div>}
      </div>
      <div style={{ fontSize: '0.85rem', color: C.tan, width: 80, textAlign: 'right' }}>{mid}</div>
      <div style={{ fontSize: '0.7rem', color: C.lightBrown, width: 60, textAlign: 'right' }}>{rate}</div>
      <div style={{ fontSize: '0.9rem', color: C.cream, fontWeight: 600, width: 80, textAlign: 'right' }}>{right}</div>
      <button onClick={onRemove} aria-label={`Remove ${left}`}
        style={{ ...BTN('transparent', C.lightBrown), padding: '0.1rem 0.4rem', fontSize: '1rem' }}>×</button>
    </div>
  )
}

// ── The order ───────────────────────────────────────────────────────────────
function SheetTab({ detail, rates, onSave, busy }: {
  detail: Detail; rates: RateMap; onSave: (s: GameSheet) => void; busy: boolean
}) {
  const [sheet, setSheet] = useState<GameSheet>((detail.intake.cut_sheet ?? {}) as GameSheet)
  const [editing, setEditing] = useState(false)
  const summary = summariseSheet(sheet, k => rates[k]?.label ?? k, cheeseLabel)

  if (editing) {
    return (
      <div>
        <CutSheetEditor
          sheet={sheet} onChange={setSheet} compact
          roastLbs={detail.intake.roast_lbs}
          trimLbs={detail.intake.trim_lbs}
        />
        <div style={{ display: 'flex', gap: '0.6rem', marginTop: '1.25rem' }}>
          <button style={BTN(C.green)} disabled={busy} onClick={() => { onSave(sheet); setEditing(false) }}>
            Save order
          </button>
          <button style={BTN('rgba(255,255,255,0.06)', C.cream)}
            onClick={() => { setSheet((detail.intake.cut_sheet ?? {}) as GameSheet); setEditing(false) }}>
            Cancel
          </button>
        </div>
      </div>
    )
  }

  return (
    <div>
      {!summary.length && (
        <div style={{ ...CARD, borderColor: C.yellow, background: 'rgba(217,119,6,0.08)', marginBottom: '1rem' }}>
          <div style={{ color: C.yellow, fontWeight: 600, fontSize: '0.88rem' }}>Nothing ordered yet</div>
          <div style={{ color: C.tan, fontSize: '0.8rem', marginTop: '0.3rem' }}>
            Nothing can be made until somebody takes the order. Call the hunter.
          </div>
        </div>
      )}
      {summary.map(s => (
        <div key={s.title} style={{ marginBottom: '1.1rem' }}>
          <div style={{
            fontSize: '0.72rem', color: C.tan, textTransform: 'uppercase', letterSpacing: '0.14em',
            fontWeight: 700, borderBottom: `1px solid ${C.medBrown}`, paddingBottom: '0.25rem', marginBottom: '0.45rem',
          }}>{s.title}</div>
          {s.lines.map((l, i) => (
            <div key={i} style={{ fontSize: '0.85rem', color: C.cream, padding: '0.15rem 0' }}>▪ {l}</div>
          ))}
        </div>
      ))}
      <button style={BTN(C.tan)} onClick={() => setEditing(true)}>Edit order</button>
    </div>
  )
}

// ── Ticket ──────────────────────────────────────────────────────────────────
function Ticket({ detail, rates, onSaveHours, busy }: {
  detail: Detail; rates: RateMap; onSaveHours: (h: number | null) => void; busy: boolean
}) {
  const { charges, buckets, intake } = detail
  const [hours, setHours] = useState(intake.cleaning_hours == null ? '' : String(intake.cleaning_hours))
  const cleaningRate = Number(rates.cleaning?.rate ?? 0)

  return (
    <div>
      {/* The cleaning fee is hourly on the slip, with a blank for how many —
          so the hours are entered here, next to the money they produce. */}
      <div style={{ ...CARD, marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 180 }}>
          <div style={{ fontSize: '0.8rem', color: C.cream }}>Cleaning fee</div>
          <div style={{ fontSize: '0.72rem', color: C.lightBrown }}>
            ${cleaningRate.toFixed(2)}/hr — hours spent cleaning a dirty or hide-on animal
          </div>
        </div>
        <input type="number" min="0" step="0.25" value={hours} placeholder="hrs"
          onChange={e => setHours(e.target.value)}
          aria-label="Cleaning hours"
          style={{ ...INPUT, width: 90, textAlign: 'right' }} />
        <button style={BTN(C.tan)} disabled={busy}
          onClick={() => onSaveHours(hours.trim() === '' ? null : Number(hours))}>
          Save
        </button>
      </div>

      {!charges.length && (
        <div style={{ color: C.lightBrown, fontSize: '0.85rem' }}>
          Nothing to bill yet — the ticket is built from what gets weighed out.
        </div>
      )}
      {charges.map((c, i) => (
        <div key={i} style={{
          display: 'flex', alignItems: 'baseline', gap: '0.75rem', padding: '0.55rem 0',
          borderBottom: '1px solid rgba(166,120,90,0.15)',
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '0.85rem', color: C.cream }}>{c.qboItemName}</div>
            <div style={{ fontSize: '0.72rem', color: C.lightBrown }}>{c.description}</div>
          </div>
          <div style={{ fontSize: '0.78rem', color: C.tan, whiteSpace: 'nowrap' }}>
            {c.qty} × ${c.rate.toFixed(2)}
          </div>
          <div style={{ fontSize: '0.95rem', color: C.cream, fontWeight: 600, width: 84, textAlign: 'right' }}>
            {money(c.amount)}
          </div>
        </div>
      ))}

      {/* The slip's three totals, in its own order */}
      <div style={{ marginTop: '0.9rem', paddingTop: '0.75rem', borderTop: `2px solid ${C.medBrown}` }}>
        <TotalRow label="Total Product" value={buckets?.product ?? 0} />
        <TotalRow label="Total Other"   value={buckets?.other ?? 0} />
        <TotalRow label="Grand Total"   value={buckets?.grand ?? detail.total} big />
      </div>

      <p style={{ fontSize: '0.74rem', color: C.lightBrown, marginTop: '1rem', lineHeight: 1.6 }}>
        Rates are the live wild game price list, stamped onto each line when it was weighed — so
        re-pricing later never moves this ticket. Most hunters pay at the register; nothing here
        posts to QuickBooks on its own.
      </p>
      <button style={{ ...BTN(C.tan), marginTop: '0.75rem' }}
        onClick={() => printHTML(ticketHTML(intake, charges, detail.buckets ?? { product: 0, other: 0, grand: detail.total }))}>
        🧾 Print ticket
      </button>
    </div>
  )
}

function TotalRow({ label, value, big }: { label: string; value: number; big?: boolean }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
      padding: big ? '0.4rem 0 0' : '0.15rem 0',
      borderTop: big ? `1px solid ${C.medBrown}` : undefined,
      marginTop: big ? '0.35rem' : undefined,
    }}>
      <span style={{
        fontSize: big ? '0.82rem' : '0.76rem', color: big ? C.tan : C.lightBrown,
        textTransform: 'uppercase', letterSpacing: '0.12em',
      }}>{label}</span>
      <span style={{
        fontSize: big ? '1.5rem' : '0.95rem', fontWeight: big ? 700 : 600,
        color: big ? C.green : C.cream,
      }}>{money(value)}</span>
    </div>
  )
}

function ticketHTML(
  intake: GameIntake, charges: BillingCharge[],
  buckets: { product: number; other: number; grand: number },
): string {
  const esc = (v: unknown) => String(v ?? '').replace(/[&<>"]/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))
  const rows = charges.map(c => `
    <tr>
      <td>${esc(c.qboItemName)}<div class="d">${esc(c.description)}</div></td>
      <td class="n">${c.qty}</td>
      <td class="n">$${c.rate.toFixed(2)}</td>
      <td class="n b">$${c.amount.toFixed(2)}</td>
    </tr>`).join('')

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(intake.tag_number)} ticket</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Arial,Helvetica,sans-serif;color:#000;background:#fff;padding:.5in;font-size:11pt}
  .h{display:flex;justify-content:space-between;border-bottom:2.5pt solid #000;padding-bottom:6px}
  .who{font-size:18pt;font-weight:bold;text-transform:uppercase}
  .tag{font-family:'Courier New',monospace;font-size:24pt;font-weight:bold}
  .sub{font-size:10pt;color:#333}
  table{width:100%;border-collapse:collapse;margin-top:14px}
  th{font-size:8pt;text-transform:uppercase;letter-spacing:.1em;color:#555;text-align:left;
     border-bottom:1pt solid #000;padding-bottom:3px}
  td{padding:6px 0;border-bottom:.5pt solid #ccc;vertical-align:top;font-size:11pt}
  .n{text-align:right;white-space:nowrap;padding-left:12px}
  .b{font-weight:bold}
  .d{font-size:8.5pt;color:#555;margin-top:1px}
  .tot{display:flex;justify-content:space-between;margin-top:5px;font-size:11pt}
  .grand{display:flex;justify-content:space-between;margin-top:8px;padding-top:8px;
       border-top:2.5pt solid #000;font-size:15pt;font-weight:bold}
  .nfs{margin:10px 0;padding:5px;background:#000;color:#fff;text-align:center;
       font-size:11pt;font-weight:bold;letter-spacing:.18em}
  .foot{margin-top:22px;font-size:8.5pt;color:#555}
</style></head><body>
  <div class="h">
    <div><div class="who">${esc(intake.hunter_name)}</div>
      <div class="sub">${esc(intake.hunter_phone)}</div>
      <div class="sub">${esc(intake.base_material)}${intake.weight_in_lbs ? ` &middot; ${intake.weight_in_lbs} lb in` : ''}</div></div>
    <div style="text-align:right"><div class="tag">${esc(intake.tag_number)}</div>
      <div class="sub">${esc(intake.species)}${intake.sex ? ` &middot; ${esc(intake.sex)}` : ''}</div></div>
  </div>
  <div class="nfs">NOT FOR SALE — CUSTOMER'S OWN GAME</div>
  <table>
    <tr><th>Service</th><th class="n">Qty</th><th class="n">Rate</th><th class="n">Amount</th></tr>
    ${rows}
  </table>
  <div class="tot"><span>Total Product</span><span>$${buckets.product.toFixed(2)}</span></div>
  <div class="tot"><span>Total Other</span><span>$${buckets.other.toFixed(2)}</span></div>
  <div class="grand"><span>Grand Total</span><span>$${buckets.grand.toFixed(2)}</span></div>
  <div class="foot">Cowboy Meat Co &middot; Forsyth MT &middot; ${esc(intake.tag_number)}</div>
  <script>window.onload = () => setTimeout(() => window.print(), 250)</script>
</body></html>`
}

// ── History ─────────────────────────────────────────────────────────────────
function History({ detail }: { detail: Detail }) {
  if (!detail.events.length) return <div style={{ color: C.lightBrown, fontSize: '0.85rem' }}>Nothing logged yet.</div>
  return (
    <div>
      {detail.events.map(e => (
        <div key={e.id} style={{
          display: 'flex', gap: '0.75rem', padding: '0.5rem 0',
          borderBottom: '1px solid rgba(166,120,90,0.15)',
        }}>
          <div style={{ fontSize: '0.72rem', color: C.lightBrown, width: 130, flexShrink: 0 }}>
            {new Date(e.created_at).toLocaleString('en-US', {
              month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
            })}
          </div>
          <div style={{ flex: 1, fontSize: '0.84rem', color: C.cream }}>
            {e.detail}
            {e.actor && <span style={{ color: C.lightBrown, fontSize: '0.75rem' }}> · {e.actor}</span>}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Drawer shell ────────────────────────────────────────────────────────────
function Shell({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 100,
        display: 'flex', justifyContent: 'flex-end',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 'min(780px, 100%)', height: '100%', overflowY: 'auto',
          background: C.darkBrown, borderLeft: `1px solid ${C.medBrown}`, padding: '1.5rem',
        }}
      >
        <button onClick={onClose} aria-label="Close"
          style={{ ...BTN('transparent', C.lightBrown), float: 'right', fontSize: '1.3rem', padding: '0 0.4rem' }}>
          ×
        </button>
        {children}
      </div>
    </div>
  )
}
