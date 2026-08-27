'use client'

import {
  MIN_BATCH_LBS, movePickInPool, fillPlans,
  type SmokehousePick, type GameSheet, type Pool, type FillPlan,
} from '@/lib/gameCuts'
import { ADDITION_CATEGORIES } from '@/lib/gameBilling'
import { C, INPUT, LABEL, BTN } from './ui'

// The order, ranked — twice, once per material.
//
// ── Two pools, because roasts and trim do not substitute ──────────────────
// Roasts are whole muscle and are the only thing steaks and jerky can be made
// from. Trim is everything that goes through the grinder. So the roasts get
// decided first — all of them, into steaks or jerky, whichever the hunter puts
// on top — and then whatever they want done with the trim. Ranking one combined
// list would let a jerky order read as "filled" against a cooler with no roasts
// in it.
//
// ── The two things a hunter knows, and the one they don't ─────────────────
// They know the species and they know what they like. They do NOT know what
// their meat weighs — it is in a cooler in the truck and has never been on a
// scale — so quantity is asked in BATCHES. The smokehouse will not run a
// flavour under 25 lb anyway, which makes a batch both the real production unit
// and something a person can picture. One line per pool can be "as much as it
// takes" and soaks up the remainder.

export interface OrderCategory {
  key: string; label: string; rate: number; cheeseRate: number | null; source: string
}

const FAT_LABEL: Record<string, string> = {
  add_beef_fat:  'Beef fat',
  add_pork_fat:  'Pork fat',
  add_beef_trim: 'Beef trim',
  add_pork_trim: 'Pork trim',
}

const POOL_COPY: Record<Pool, { title: string; blurb: string; weight: string }> = {
  roast: {
    title: 'Off the roasts',
    blurb: 'Whole muscle — the only thing steaks and jerky can be made from. We take all the roasts they bring and make whatever we can from them, top of this list first.',
    weight: 'Roasts in',
  },
  trim: {
    title: 'Off the trim',
    blurb: 'Everything that goes through the grinder. Each line takes an added fat or trim — straight venison grinds dry.',
    weight: 'Trim in',
  },
}

export default function OrderBuilder({
  sheet, onChange, categories, cheeseTypes, roastLbs, trimLbs, showFat = true,
}: {
  sheet: GameSheet
  onChange: (next: GameSheet) => void
  categories: OrderCategory[]
  cheeseTypes: { code: string; label: string }[]
  /** Weighed apart at the counter. Null on the hunter's own form. */
  roastLbs: number | null
  trimLbs:  number | null
  /** The counter records added fat; hunters are not asked for pounds. */
  showFat?: boolean
}) {
  const picks = sheet.smokehouse ?? []
  const setPicks = (next: SmokehousePick[]) => onChange({ ...sheet, smokehouse: next })

  const catFor  = (key: string) => categories.find(c => c.key === key)
  const poolOf  = (key: string): Pool | null => {
    const src = catFor(key)?.source
    return src === 'roast' || src === 'trim' ? src : null
  }

  const plans = fillPlans(sheet, poolOf, { roastLbs, trimLbs })

  if (!picks.length) {
    return (
      <p style={{ fontSize: '0.8rem', color: C.lightBrown, lineHeight: 1.6 }}>
        Nothing chosen yet. Pick what they want above — then put each list in the
        order that matters, because that is the order it gets filled in.
      </p>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
      {(['roast', 'trim'] as Pool[]).map(pool => (
        <PoolList
          key={pool}
          pool={pool}
          plan={plans[pool]}
          picks={picks}
          poolOf={poolOf}
          catFor={catFor}
          cheeseTypes={cheeseTypes}
          showFat={showFat && pool === 'trim'}
          onPicks={setPicks}
        />
      ))}
    </div>
  )
}

function PoolList({
  pool, plan, picks, poolOf, catFor, cheeseTypes, showFat, onPicks,
}: {
  pool: Pool
  plan: FillPlan
  picks: SmokehousePick[]
  poolOf: (key: string) => Pool | null
  catFor: (key: string) => OrderCategory | undefined
  cheeseTypes: { code: string; label: string }[]
  showFat: boolean
  onPicks: (next: SmokehousePick[]) => void
}) {
  if (!plan.lines.length) return null
  const copy = POOL_COPY[pool]

  // Patch a line by its position WITHIN this pool, into the full array.
  const update = (indexInPool: number, patch: Partial<SmokehousePick>) => {
    const positions = picks.map((p, i) => ({ p, i })).filter(x => poolOf(x.p.category) === pool).map(x => x.i)
    const at = positions[indexInPool]
    if (at == null) return
    onPicks(picks.map((p, i) => (i === at ? { ...p, ...patch } : p)))
  }
  const removeAt = (indexInPool: number) => {
    const positions = picks.map((p, i) => ({ p, i })).filter(x => poolOf(x.p.category) === pool).map(x => x.i)
    const at = positions[indexInPool]
    if (at == null) return
    onPicks(picks.filter((_, i) => i !== at))
  }

  const tint = pool === 'roast' ? '167,139,250' : '249,115,22'   // purple / orange
  const accent = pool === 'roast' ? C.purple : C.orange

  return (
    <div style={{
      padding: '0.85rem', borderRadius: 4,
      background: `rgba(${tint},0.07)`, border: `1px solid rgba(${tint},0.32)`,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '0.5rem' }}>
        <span style={{ ...LABEL, color: accent, marginBottom: 0 }}>{copy.title} — fill in this order</span>
        <span style={{ fontSize: '0.7rem', color: C.lightBrown }}>1 batch = {MIN_BATCH_LBS} lb</span>
      </div>
      <p style={{ fontSize: '0.72rem', color: C.lightBrown, margin: '0.3rem 0 0.7rem', lineHeight: 1.5 }}>
        {copy.blurb}
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
        {plan.lines.map((line, i) => {
          const p = line.pick
          const cat = catFor(p.category)
          const canCheese = cat?.cheeseRate != null
          const dim = line.fill === 'short'

          return (
            <div key={`${p.category}::${p.flavor}`} style={{
              borderBottom: `1px solid rgba(${tint},0.18)`, paddingBottom: '0.5rem',
              opacity: dim ? 0.5 : 1,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                {/* Rank + reorder. Buttons rather than drag: this gets used on a
                    tablet at a counter with cold hands, and a drag that
                    half-lands silently reorders somebody's priorities. */}
                <span style={{
                  width: 22, height: 22, borderRadius: 11, flexShrink: 0,
                  background: accent, color: C.dark, fontSize: '0.72rem', fontWeight: 700,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>{line.rank}</span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <button type="button" disabled={i === 0}
                    onClick={() => onPicks(movePickInPool(picks, poolOf, pool, i, -1))}
                    aria-label={`Move ${p.flavor || cat?.label} up`}
                    style={{ ...BTN('transparent', i === 0 ? 'rgba(166,120,90,0.3)' : C.tan), padding: 0, fontSize: '0.62rem', lineHeight: 1 }}>▲</button>
                  <button type="button" disabled={i === plan.lines.length - 1}
                    onClick={() => onPicks(movePickInPool(picks, poolOf, pool, i, 1))}
                    aria-label={`Move ${p.flavor || cat?.label} down`}
                    style={{ ...BTN('transparent', i === plan.lines.length - 1 ? 'rgba(166,120,90,0.3)' : C.tan), padding: 0, fontSize: '0.62rem', lineHeight: 1 }}>▼</button>
                </div>

                <span style={{ flex: '1 1 160px', fontSize: '0.82rem', color: C.cream }}>
                  {p.flavor ? <>{p.flavor} <span style={{ color: C.lightBrown }}>{cat?.label}</span></> : cat?.label}
                </span>

                {canCheese && (
                  <label style={{
                    display: 'flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer',
                    fontSize: '0.74rem', color: p.cheese ? C.cream : C.tan,
                  }}>
                    <input type="checkbox" checked={p.cheese}
                      onChange={() => update(i, { cheese: !p.cheese, cheese_type: !p.cheese ? p.cheese_type : '' })}
                      style={{ width: 14, height: 14, accentColor: C.yellow, cursor: 'pointer' }} />
                    cheese
                  </label>
                )}
                {p.cheese && canCheese && (
                  <select value={p.cheese_type ?? ''}
                    onChange={e => update(i, { cheese_type: e.target.value })}
                    aria-label={`Cheese for ${p.flavor}`}
                    style={{ ...INPUT, width: 'auto', padding: '0.25rem 0.35rem', fontSize: '0.73rem' }}>
                    <option value="">which…</option>
                    {cheeseTypes.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
                  </select>
                )}

                <select
                  value={p.takeRest ? 'rest' : String(p.batches ?? 1)}
                  onChange={e => {
                    const v = e.target.value
                    if (v === 'rest') update(i, { takeRest: true, batches: undefined, lbs: 0 })
                    else update(i, { takeRest: false, batches: Number(v), lbs: Number(v) * MIN_BATCH_LBS })
                  }}
                  aria-label={`How much ${p.flavor || cat?.label}`}
                  style={{ ...INPUT, width: 'auto', padding: '0.28rem 0.4rem', fontSize: '0.76rem' }}
                >
                  {[1, 2, 3, 4, 5, 6].map(n => (
                    <option key={n} value={n}>{n} batch{n === 1 ? '' : 'es'} · {n * MIN_BATCH_LBS} lb</option>
                  ))}
                  <option value="rest">as much as it takes</option>
                </select>

                <button type="button" onClick={() => removeAt(i)}
                  aria-label={`Remove ${p.flavor || cat?.label}`}
                  style={{ ...BTN('transparent', C.lightBrown), padding: '0.1rem 0.4rem', fontSize: '1rem' }}>×</button>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.3rem', flexWrap: 'wrap' }}>
                {line.fill === 'full'    && <Note color={C.green}>✓ {line.lbs} lb</Note>}
                {line.fill === 'rest'    && <Note color={C.green}>✓ takes the remaining {line.availableLbs} lb</Note>}
                {line.fill === 'partial' && <Note color={C.yellow}>⚠ only {line.availableLbs} lb left — short of the {line.lbs} lb asked for</Note>}
                {line.fill === 'short'   && <Note color={C.red}>✕ no {pool} left for this one</Note>}
                {line.fill === 'unknown' && <Note color={C.lightBrown}>{p.takeRest ? 'sized once it is weighed' : `${line.lbs} lb`}</Note>}
                {line.belowMinimum && (
                  <Note color={C.yellow}>under the {MIN_BATCH_LBS} lb minimum — needs topping up with beef or pork trim</Note>
                )}

                {/* Every grinding option carries an added fat or trim — straight
                    venison grinds dry and crumbly. Roast products do not. */}
                {showFat && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', marginLeft: 'auto' }}>
                    <span style={{ fontSize: '0.68rem', color: C.lightBrown }}>add</span>
                    <select value={p.fat_trim_kind ?? ''}
                      onChange={e => update(i, { fat_trim_kind: e.target.value })}
                      aria-label={`Fat or trim for ${p.flavor || cat?.label}`}
                      style={{ ...INPUT, width: 'auto', padding: '0.2rem 0.35rem', fontSize: '0.7rem' }}>
                      <option value="">none</option>
                      {ADDITION_CATEGORIES.map(k => <option key={k} value={k}>{FAT_LABEL[k]}</option>)}
                    </select>
                    {p.fat_trim_kind && (
                      <input type="number" min="0" step="0.5" value={p.fat_trim_lbs || ''}
                        onChange={e => update(i, { fat_trim_lbs: Number(e.target.value) })}
                        aria-label={`Added pounds for ${p.flavor || cat?.label}`}
                        style={{ ...INPUT, width: 62, textAlign: 'right', padding: '0.2rem 0.35rem', fontSize: '0.7rem' }}
                        placeholder="lb" />
                    )}
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* ── The balance for this pool ── */}
      <div style={{ marginTop: '0.7rem', paddingTop: '0.55rem', borderTop: `1px solid rgba(${tint},0.25)` }}>
        <Balance label="Ordered" value={`${plan.ordered} lb${plan.hasRest ? ' + the rest' : ''}`} />
        {plan.available == null ? (
          <div style={{ fontSize: '0.73rem', color: C.lightBrown, marginTop: '0.3rem', lineHeight: 1.5 }}>
            No {pool} weight recorded yet — this is the order of priority only.
          </div>
        ) : (
          <>
            <Balance label={copy.weight} value={`${plan.available} lb`} />
            {plan.shortBy > 0 ? (
              <div style={{
                marginTop: '0.45rem', padding: '0.5rem 0.6rem', borderRadius: 3,
                background: 'rgba(229,62,62,0.12)', border: `1px solid ${C.red}`,
                fontSize: '0.76rem', color: C.cream, lineHeight: 1.5,
              }}>
                <strong style={{ color: C.red }}>Short by {plan.shortBy} lb of {pool}.</strong>{' '}
                {(() => {
                  // Name what actually happens to each line. "Everything from
                  // rank N down" is wrong when rank N is the one that gets a
                  // partial batch — it does get made, just smaller.
                  const partial = plan.lines.find(l => l.fill === 'partial')
                  const shorts  = plan.lines.filter(l => l.fill === 'short')
                  const name = (l: typeof plan.lines[number]) => l.pick.flavor || catFor(l.pick.category)?.label || l.pick.category
                  const bits: string[] = []
                  if (partial) bits.push(`#${partial.rank} ${name(partial)} runs out at ${partial.availableLbs} lb`)
                  if (shorts.length === 1) bits.push(`#${shorts[0].rank} ${name(shorts[0])} gets nothing`)
                  else if (shorts.length > 1) bits.push(`#${shorts[0].rank}–#${shorts[shorts.length - 1].rank} get nothing`)
                  return bits.join(', ') + '.'
                })()}{' '}
                Move what matters up, drop a batch, or add beef or pork trim at market
                price — and tell the hunter now, at the counter.
              </div>
            ) : (
              <Balance
                label={pool === 'trim' ? 'Trim left over' : 'Roasts left over'}
                value={`${Math.max(0, plan.remaining ?? 0)} lb`}
                good
              />
            )}
          </>
        )}
      </div>
    </div>
  )
}

function Note({ color, children }: { color: string; children: React.ReactNode }) {
  return <span style={{ fontSize: '0.7rem', color, lineHeight: 1.4 }}>{children}</span>
}

function Balance({ label, value, good }: { label: string; value: string; good?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', color: C.cream, padding: '0.1rem 0' }}>
      <span style={{ color: C.lightBrown }}>{label}</span>
      <strong style={{ color: good ? C.green : C.cream }}>{value}</strong>
    </div>
  )
}
