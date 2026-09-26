'use client'

// The seasoning order list, and the shelf it's figured against.
//
// Top: what to ORDER (bought seasonings, cures, raw spices) and by when, from
// the booked kills' cut sheets × the recipe book, less what's on the shelf.
// Then what house blends to MIX. Then the demand nothing can count yet — a
// flavour with no recipe is seasoning this list can't see, so it's named.
//
// Bottom: the supplies themselves. A supply is bought or a house BLEND built
// from other supplies by % weight — building our own seasonings is just adding
// a blend here and pointing a recipe at it.
//
// The list suggests; a person orders. Every save carries the name typed at the
// top (shared with the Recipes tab).
import { useEffect, useState, useCallback } from 'react'
import type { SeasoningPlan, OrderLine } from '@/lib/seasoningOrders'

const C = {
  dark:       '#1A0A04',
  darkBrown:  '#351E0E',
  medBrown:   '#75471B',
  lightBrown: '#A6785A',
  tan:        '#C9A882',
  cream:      '#F2E8D9',
  green:      '#4CAF50',
  yellow:     '#D97706',
  red:        '#DC2626',
  blue:       '#3B82F6',
}

interface Supply {
  id: string; name: string; kind: 'bought' | 'blend'; supplier: string | null
  pack_lb: number | null; lead_days: number | null; on_hand_lb: number | null
  counted_at: string | null; cost_per_lb: number | null; notes: string | null; active: boolean
}
interface BlendLine { blend_id: string; ingredient_id: string; pct: number }

const LABEL: React.CSSProperties = {
  display: 'block', fontSize: '0.68rem', color: C.lightBrown,
  textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.25rem',
}
const INPUT: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', background: 'rgba(0,0,0,0.25)',
  border: '1px solid rgba(166,120,90,0.35)', borderRadius: 3, color: C.cream,
  padding: '0.45rem 0.55rem', fontSize: '0.88rem', fontFamily: 'inherit',
}
const BTN = (bg: string, fg: string): React.CSSProperties => ({
  background: bg, color: fg, border: 'none', borderRadius: 3, cursor: 'pointer',
  padding: '0.45rem 0.9rem', fontSize: '0.82rem', fontWeight: 700,
})
const CARD: React.CSSProperties = {
  background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(166,120,90,0.2)', borderRadius: 4,
}
const H3: React.CSSProperties = { margin: '0 0 0.5rem', color: C.tan, fontFamily: 'Georgia, serif', fontSize: '1.1rem' }

const NAME_KEY = 'cmc.recipeBook.name'
function loadName(): string { try { return localStorage.getItem(NAME_KEY) ?? '' } catch { return '' } }
function saveName(n: string) { try { localStorage.setItem(NAME_KEY, n) } catch { /* private window */ } }

const fmtLb = (n: number | null | undefined) => n == null ? '—' : n >= 10 ? `${Math.round(n)} lb` : `${Math.round(n * 100) / 100} lb`
const fmtDay = (iso: string | null) => iso
  ? new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : '—'
const ageDays = (iso: string | null) => iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) : null

const STATUS: Record<OrderLine['status'], { label: string; color: string }> = {
  overdue:     { label: 'LATE — order today', color: C.red },
  'order-now': { label: 'Order now',          color: C.yellow },
  upcoming:    { label: 'Upcoming',           color: C.blue },
  covered:     { label: 'Shelf covers it',    color: C.green },
}

function Pill({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span style={{
      background: `${color}22`, border: `1px solid ${color}55`, color,
      fontSize: '0.68rem', fontWeight: 700, borderRadius: 99, padding: '0.12rem 0.55rem', whiteSpace: 'nowrap',
    }}>{children}</span>
  )
}

export default function SeasoningsTab() {
  const [plan, setPlan]         = useState<SeasoningPlan | null>(null)
  const [supplies, setSupplies] = useState<Supply[]>([])
  const [lines, setLines]       = useState<BlendLine[]>([])
  const [days, setDays]         = useState(28)
  const [back, setBack]         = useState(21)
  const [name, setName]         = useState('')
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(true)

  useEffect(() => { setName(loadName()) }, [])

  const load = useCallback(async () => {
    try {
      const [p, s] = await Promise.all([
        fetch(`/api/seasoning-orders?days=${days}&back=${back}`, { cache: 'no-store' }).then(r => r.json()),
        fetch('/api/smokehouse-supplies', { cache: 'no-store' }).then(r => r.json()),
      ])
      if (p.error) throw new Error(p.error)
      if (s.error) throw new Error(s.error)
      setPlan(p); setSupplies(s.supplies); setLines(s.lines); setError('')
    } catch (e) { setError((e as Error).message) }
    setLoading(false)
  }, [days, back])
  useEffect(() => { load() }, [load])

  if (loading) return <div style={{ color: C.lightBrown, padding: '2rem' }}>Adding up the seasoning…</div>

  const toOrder = plan?.orders.filter(o => o.status !== 'covered') ?? []
  const covered = plan?.orders.filter(o => o.status === 'covered') ?? []
  const gapLb = plan?.gaps.reduce((n, g) => n + g.lb, 0) ?? 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Window + who */}
      <div style={{ ...CARD, padding: '1rem', display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'flex-end' }}>
        <div style={{ flex: '1 1 240px' }}>
          <div style={{ color: C.cream, fontFamily: 'Georgia, serif', fontSize: '1.3rem', fontWeight: 700 }}>
            {toOrder.length ? `${toOrder.length} to order` : 'Nothing to order'}
          </div>
          {plan && (
            <div style={{ color: C.lightBrown, fontSize: '0.8rem', marginTop: '0.2rem' }}>
              Kills {fmtDay(plan.from)} → {fmtDay(plan.to)} · {plan.headOnSheet} head on a cut sheet
              {plan.headProjected > 0 && <>, {plan.headProjected} projected from past sheets</>}
            </div>
          )}
        </div>
        <div>
          <label style={LABEL}>Look ahead</label>
          <select style={{ ...INPUT, width: 'auto' }} value={days} onChange={e => setDays(Number(e.target.value))}>
            {[14, 28, 56, 90].map(d => <option key={d} value={d}>{d} days</option>)}
          </select>
        </div>
        <div>
          <label style={LABEL}>Kills already done</label>
          <select style={{ ...INPUT, width: 'auto' }} value={back} onChange={e => setBack(Number(e.target.value))}>
            {[0, 14, 21, 30].map(d => <option key={d} value={d}>{d ? `last ${d} days` : 'none'}</option>)}
          </select>
        </div>
        <div style={{ flex: '0 1 200px' }}>
          <label style={LABEL}>Your name</label>
          <input style={{ ...INPUT, borderColor: name.trim() ? 'rgba(166,120,90,0.35)' : C.yellow }}
            value={name} placeholder="Goes on every save"
            onChange={e => { setName(e.target.value); saveName(e.target.value) }} />
        </div>
      </div>

      {error && <div style={{ color: C.red, fontSize: '0.85rem' }}>{error}</div>}

      {/* ORDER */}
      <section>
        <h3 style={H3}>🛒 Order</h3>
        {!plan?.orders.length && (
          <div style={{ color: C.lightBrown, fontSize: '0.85rem' }}>
            Nothing adds up yet — a flavour needs a recipe with a seasoning and a ratio before its demand shows here.
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          {[...toOrder, ...covered].map(o => <OrderRow key={o.supply.id} o={o} />)}
        </div>
      </section>

      {/* MIX */}
      {!!plan?.mixes.length && (
        <section>
          <h3 style={H3}>🥣 Mix (house blends)</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            {plan.mixes.map(m => (
              <div key={m.blend.id} style={{ ...CARD, padding: '0.7rem 0.85rem' }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem', alignItems: 'baseline' }}>
                  <span style={{ color: C.cream, fontWeight: 700 }}>{m.blend.name}</span>
                  {m.mixLb > 0
                    ? <Pill color={C.yellow}>Mix {fmtLb(m.mixLb)} by {fmtDay(m.mixBy)}</Pill>
                    : <Pill color={C.green}>Shelf covers it</Pill>}
                  <span style={{ color: C.lightBrown, fontSize: '0.75rem' }}>
                    needs {fmtLb(m.needLb)} · on hand {fmtLb(m.onHandLb)}
                  </span>
                  {Math.abs(m.pctTotal - 100) > 0.01 && <Pill color={C.red}>Blend adds to {m.pctTotal}%, not 100%</Pill>}
                </div>
                {m.mixLb > 0 && m.ingredients.length > 0 && (
                  <div style={{ color: C.tan, fontSize: '0.8rem', marginTop: '0.35rem' }}>
                    {m.ingredients.map(i => `${i.name} ${fmtLb(i.lb)} (${i.pct}%)`).join(' · ')}
                  </div>
                )}
                {m.ingredients.length === 0 && (
                  <div style={{ color: C.yellow, fontSize: '0.78rem', marginTop: '0.35rem' }}>
                    No ingredients entered — add them under Supplies below.
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* GAPS */}
      {!!plan?.gaps.length && (
        <section>
          <h3 style={H3}>⚠️ Can&apos;t count yet — {Math.round(gapLb)} lb of product</h3>
          <div style={{ color: C.lightBrown, fontSize: '0.8rem', marginBottom: '0.5rem' }}>
            These flavours are booked but their seasoning isn&apos;t on the list above. Fill in the recipe on the 📖 Recipes tab.
          </div>
          <div style={{ ...CARD, padding: '0.4rem 0.85rem' }}>
            {plan.gaps.map((g, i) => (
              <div key={i} style={{
                display: 'flex', gap: '0.75rem', padding: '0.35rem 0', fontSize: '0.84rem',
                borderTop: i ? '1px solid rgba(166,120,90,0.12)' : 'none',
              }}>
                <span style={{ color: C.cream, flex: 1 }}>{g.title} — {g.label}</span>
                <span style={{ color: C.tan, width: 70, textAlign: 'right' }}>{g.lb ? fmtLb(g.lb) : ''}</span>
                <span style={{ color: C.lightBrown, flex: 1 }}>{g.reason}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <SuppliesPanel supplies={supplies} lines={lines} name={name} onChanged={load} />
    </div>
  )
}

function OrderRow({ o }: { o: OrderLine }) {
  const [open, setOpen] = useState(false)
  const st = STATUS[o.status]
  const age = ageDays(o.supply.counted_at)
  return (
    <div style={{ ...CARD, padding: '0.7rem 0.85rem', borderColor: `${st.color}44` }}>
      <button onClick={() => setOpen(v => !v)} style={{
        all: 'unset', cursor: 'pointer', display: 'flex', flexWrap: 'wrap', gap: '0.6rem', alignItems: 'baseline', width: '100%',
      }}>
        <Pill color={st.color}>{st.label}</Pill>
        <span style={{ color: C.cream, fontWeight: 700, fontSize: '0.95rem' }}>{o.supply.name}</span>
        {o.supply.supplier && <span style={{ color: C.lightBrown, fontSize: '0.78rem' }}>{o.supply.supplier}</span>}
        <span style={{ marginLeft: 'auto', color: C.cream, fontWeight: 700 }}>
          {o.status === 'covered' ? '' : o.packs ? `${o.packs} × ${o.supply.pack_lb} lb` : `${fmtLb(o.orderLb)}`}
        </span>
      </button>
      <div style={{ color: C.lightBrown, fontSize: '0.76rem', marginTop: '0.3rem', display: 'flex', flexWrap: 'wrap', gap: '0.9rem' }}>
        <span>Needs {fmtLb(o.needLb)}</span>
        <span>
          On hand {o.onHandLb == null ? <b style={{ color: C.yellow }}>never counted</b> : fmtLb(o.onHandLb)}
          {age != null && age > 14 && <b style={{ color: C.yellow }}> (count is {age} days old)</b>}
        </span>
        {o.status !== 'covered' && <span>Short {fmtLb(o.shortLb)}</span>}
        {o.orderBy && <span>Order by <b style={{ color: C.cream }}>{fmtDay(o.orderBy)}</b>{o.supply.lead_days == null && <b style={{ color: C.yellow }}> (no lead time set)</b>}</span>}
        {o.needBy && <span>Runs out {fmtDay(o.needBy)}</span>}
        {o.cost != null && <span>≈ ${o.cost.toFixed(2)}</span>}
        {o.status !== 'covered' && !o.packs && <b style={{ color: C.yellow }}>no pack size — shows exact lb</b>}
      </div>
      {open && (
        <div style={{ color: C.tan, fontSize: '0.78rem', marginTop: '0.4rem' }}>
          {o.uses.map(u => <div key={u.why}>{u.why}: {fmtLb(u.lb)}</div>)}
        </div>
      )}
    </div>
  )
}

// ── Supplies: the shelf, the suppliers, and the house blends ─────────────────
function SuppliesPanel({ supplies, lines, name, onChanged }: {
  supplies: Supply[]; lines: BlendLine[]; name: string; onChanged: () => void
}) {
  const [open, setOpen] = useState<string | null>(null)
  return (
    <section>
      <h3 style={H3}>🧂 Supplies &amp; house blends</h3>
      <div style={{ color: C.lightBrown, fontSize: '0.8rem', marginBottom: '0.5rem' }}>
        Pack size and lead time decide the order; on hand is the last count. A house blend lists its ingredients by % of weight.
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
        {supplies.map(s => open === s.id
          ? <SupplyEditor key={s.id} supply={s} supplies={supplies} lines={lines.filter(l => l.blend_id === s.id)}
              name={name} onDone={() => { setOpen(null); onChanged() }} onCancel={() => setOpen(null)} />
          : (
            <button key={s.id} onClick={() => setOpen(s.id)} style={{
              ...CARD, textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit', padding: '0.55rem 0.8rem',
              display: 'flex', flexWrap: 'wrap', gap: '0.6rem', alignItems: 'baseline', opacity: s.active ? 1 : 0.5,
            }}>
              <span style={{ color: C.cream, fontWeight: 700 }}>{s.name}</span>
              {s.kind === 'blend' && <Pill color={C.blue}>house blend · {lines.filter(l => l.blend_id === s.id).length} ingredients</Pill>}
              {!s.active && <Pill color={C.lightBrown}>inactive</Pill>}
              <span style={{ color: C.lightBrown, fontSize: '0.76rem' }}>
                {[s.supplier, s.pack_lb ? `${s.pack_lb} lb pack` : null, s.lead_days != null ? `${s.lead_days}d lead` : null,
                  s.on_hand_lb != null ? `${s.on_hand_lb} lb on hand` : 'not counted'].filter(Boolean).join(' · ')}
              </span>
            </button>
          ))}
        {open === 'new'
          ? <SupplyEditor supply={null} supplies={supplies} lines={[]} name={name}
              onDone={() => { setOpen(null); onChanged() }} onCancel={() => setOpen(null)} />
          : <button style={{ ...BTN('transparent', C.tan), border: '1px dashed rgba(166,120,90,0.45)', alignSelf: 'flex-start' }}
              onClick={() => setOpen('new')}>+ Add a supply or house blend</button>}
      </div>
    </section>
  )
}

function SupplyEditor({ supply, supplies, lines, name, onDone, onCancel }: {
  supply: Supply | null; supplies: Supply[]; lines: BlendLine[]; name: string
  onDone: () => void; onCancel: () => void
}) {
  const s = (v: string | number | null | undefined) => v == null ? '' : String(v)
  const [f, setF] = useState({
    name: s(supply?.name), kind: supply?.kind ?? 'bought', supplier: s(supply?.supplier),
    pack_lb: s(supply?.pack_lb), lead_days: s(supply?.lead_days), on_hand_lb: s(supply?.on_hand_lb),
    cost_per_lb: s(supply?.cost_per_lb), notes: s(supply?.notes), active: supply?.active ?? true,
  })
  const [blend, setBlend] = useState(lines.map(l => ({ ingredient_id: l.ingredient_id, pct: String(l.pct) })))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF(p => ({ ...p, [k]: e.target.value }))

  const num = (v: string) => v.trim() === '' ? null : Number(v)
  const pctTotal = blend.reduce((n, b) => n + (Number(b.pct) || 0), 0)
  const onHandChanged = f.on_hand_lb !== s(supply?.on_hand_lb)

  const save = async () => {
    if (!name.trim()) { setErr('Type your name at the top first.'); return }
    if (!f.name.trim()) { setErr('Name it.'); return }
    const nums = { pack_lb: num(f.pack_lb), lead_days: num(f.lead_days), cost_per_lb: num(f.cost_per_lb), on_hand_lb: num(f.on_hand_lb) }
    if (Object.values(nums).some(v => v != null && (!isFinite(v) || v < 0))) { setErr('Numbers only, zero or more.'); return }
    setBusy(true); setErr('')
    const body: Record<string, unknown> = {
      id: supply?.id, name: f.name, kind: f.kind, supplier: f.supplier, notes: f.notes, active: f.active,
      pack_lb: nums.pack_lb, lead_days: nums.lead_days != null ? Math.round(nums.lead_days) : null, cost_per_lb: nums.cost_per_lb,
      updated_by: name,
    }
    // Only a changed count restamps counted_at.
    if (!supply || onHandChanged) body.on_hand_lb = nums.on_hand_lb
    const res = await fetch('/api/smokehouse-supplies', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    const j = await res.json()
    if (!res.ok) { setBusy(false); setErr(j.error ?? 'Save failed'); return }
    if (f.kind === 'blend') {
      const r2 = await fetch('/api/smokehouse-supplies', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blend_id: j.id, lines: blend, updated_by: name }),
      })
      if (!r2.ok) { setBusy(false); setErr((await r2.json()).error ?? 'Blend save failed'); return }
    }
    setBusy(false); onDone()
  }

  const remove = async () => {
    if (!supply || !confirm(`Delete ${supply.name}? Recipes using it go blank.`)) return
    const res = await fetch(`/api/smokehouse-supplies?id=${supply.id}`, { method: 'DELETE' })
    if (res.ok) onDone()
    else setErr((await res.json()).error ?? 'Delete failed')
  }

  const grid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.7rem' }
  const choices = supplies.filter(x => x.id !== supply?.id)

  return (
    <div style={{ background: C.darkBrown, border: '1px solid rgba(201,168,130,0.5)', borderRadius: 4, padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
      <div style={grid}>
        <div><label style={LABEL}>Name *</label><input style={INPUT} value={f.name} onChange={set('name')} placeholder="As on the bag" /></div>
        <div>
          <label style={LABEL}>Kind</label>
          <select style={INPUT} value={f.kind} onChange={set('kind')}>
            <option value="bought">Bought</option>
            <option value="blend">House blend (we mix it)</option>
          </select>
        </div>
        {f.kind === 'bought' && <div><label style={LABEL}>Supplier</label><input style={INPUT} value={f.supplier} onChange={set('supplier')} /></div>}
      </div>
      <div style={grid}>
        {f.kind === 'bought' && <div><label style={LABEL}>lb per pack</label><input style={INPUT} inputMode="decimal" value={f.pack_lb} onChange={set('pack_lb')} /></div>}
        {f.kind === 'bought' && <div><label style={LABEL}>Lead time (days)</label><input style={INPUT} inputMode="numeric" value={f.lead_days} onChange={set('lead_days')} /></div>}
        <div><label style={LABEL}>On hand (lb)</label><input style={INPUT} inputMode="decimal" value={f.on_hand_lb} onChange={set('on_hand_lb')} placeholder="Count it" /></div>
        {f.kind === 'bought' && <div><label style={LABEL}>$ per lb</label><input style={INPUT} inputMode="decimal" value={f.cost_per_lb} onChange={set('cost_per_lb')} /></div>}
      </div>

      {f.kind === 'blend' && (
        <div>
          <label style={LABEL}>Ingredients — % of the blend by weight</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            {blend.map((b, i) => (
              <div key={i} style={{ display: 'flex', gap: '0.4rem' }}>
                <select style={{ ...INPUT, flex: 1 }} value={b.ingredient_id}
                  onChange={e => setBlend(p => p.map((x, j) => j === i ? { ...x, ingredient_id: e.target.value } : x))}>
                  <option value="">— ingredient —</option>
                  {choices.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <input style={{ ...INPUT, width: 80 }} inputMode="decimal" value={b.pct} placeholder="%"
                  onChange={e => setBlend(p => p.map((x, j) => j === i ? { ...x, pct: e.target.value } : x))} />
                <button style={BTN('transparent', C.lightBrown)} onClick={() => setBlend(p => p.filter((_, j) => j !== i))}>✕</button>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: '0.8rem', alignItems: 'center', marginTop: '0.4rem' }}>
            <button style={{ ...BTN('transparent', C.tan), border: '1px dashed rgba(166,120,90,0.45)' }}
              onClick={() => setBlend(p => [...p, { ingredient_id: '', pct: '' }])}>+ Ingredient</button>
            <span style={{ color: Math.abs(pctTotal - 100) < 0.01 ? C.green : C.yellow, fontSize: '0.8rem', fontWeight: 700 }}>
              Total {Math.round(pctTotal * 100) / 100}%
            </span>
          </div>
          <div style={{ color: C.lightBrown, fontSize: '0.74rem', marginTop: '0.3rem' }}>
            Ingredients are supplies too — add each raw spice as a Bought supply first, then pick it here.
          </div>
        </div>
      )}

      <div><label style={LABEL}>Notes</label><textarea style={{ ...INPUT, minHeight: 40 }} value={f.notes} onChange={set('notes')} /></div>
      {supply && (
        <label style={{ color: C.tan, fontSize: '0.8rem', display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
          <input type="checkbox" checked={f.active} onChange={e => setF(p => ({ ...p, active: e.target.checked }))} /> Active (unticked = hidden from the recipe pickers)
        </label>
      )}
      {err && <div style={{ color: C.red, fontSize: '0.82rem' }}>{err}</div>}
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <button style={BTN(C.green, '#fff')} disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
        <button style={{ ...BTN('transparent', C.lightBrown), border: '1px solid rgba(166,120,90,0.3)' }} onClick={onCancel}>Cancel</button>
        {supply && <button style={{ ...BTN('transparent', C.red), marginLeft: 'auto' }} onClick={remove}>Delete</button>}
      </div>
    </div>
  )
}
