'use client'

import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import { GAME_SHEET, MIN_BATCH_LBS, type GameSheet } from '@/lib/gameCuts'
import OrderBuilder from './OrderBuilder'
import { rulesFor } from '@/lib/gameRules'
import { C, INPUT, LABEL, BTN } from './ui'

// The cut sheet, taken at the counter with the hunter standing there.
//
// This mirrors the printed Wild Game Processing slip, because that is the
// conversation: pick a flavour, say whether it takes cheese and which, put
// pounds against it, and note the fat going in. Cheese is its own column on the
// slip and its own field here — a $4.50 product becomes $5.25 the moment it is
// ticked, and Ghost Pepper is a cheese whose name contains no cheese word at
// all, so it can never be inferred from a flavour name.

export interface CatalogFlavor { id: string; name: string; plu: string | null; cheeseHint: boolean }
export interface CatalogGroup {
  key: string; label: string; source: string; rate: number; cheeseRate: number | null
  flavors: CatalogFlavor[]
}
export interface CheeseType { code: string; label: string }

export default function CutSheetEditor({
  sheet, onChange, compact, roastLbs = null, trimLbs = null,
}: {
  sheet: GameSheet
  // A setState dispatcher, not a plain callback, so every edit below can go
  // through a FUNCTIONAL update. Writing the whole sheet back from a render
  // closure loses taps: two flavours tapped inside one frame both start from
  // the same stale array and the second overwrites the first.
  onChange: Dispatch<SetStateAction<GameSheet>>
  compact?: boolean
  /** Weighed apart at the counter. Roasts and trim do not substitute. */
  roastLbs?: number | null
  trimLbs?: number | null
}) {
  const [roastGroups, setRoastGroups] = useState<CatalogGroup[]>([])
  const [trimGroups, setTrimGroups]   = useState<CatalogGroup[]>([])
  const [cheeseTypes, setCheeseTypes] = useState<CheeseType[]>([])
  // Flavours the slip offers that no wild game PLU can label. Shown rather
  // than hidden: we can sell it, we just cannot print a label for it, and a
  // gap nobody can see never gets closed.
  const [missingPlu, setMissingPlu] = useState<{ category: string; name: string }[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/game/catalog')
      .then(r => r.json())
      .then(d => {
        setRoastGroups(Array.isArray(d.roast) ? d.roast : [])
        setTrimGroups(Array.isArray(d.trim) ? d.trim : [])
        setCheeseTypes(Array.isArray(d.cheeseTypes) ? d.cheeseTypes : [])
        setMissingPlu(Array.isArray(d.missingPlu) ? d.missingPlu : [])
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const answers = (key: string) => (sheet[key as 'grind' | 'services' | 'returns'] ?? {}) as Record<string, string>

  const setAnswer = (section: string, field: string, value: string) =>
    onChange(prev => {
      const current = { ...((prev[section as 'grind' | 'services' | 'returns'] ?? {}) as Record<string, string>) }
      // Re-picking the same option clears it. Without this a mis-tap on a radio
      // row can never be undone, and "no answer" is a real answer on a cut sheet.
      if (current[field] === value) delete current[field]
      else current[field] = value
      return { ...prev, [section]: current }
    })

  const visible = (section: (typeof GAME_SHEET)[number], field: (typeof GAME_SHEET)[number]['fields'][number]) => {
    if (!field.showIf) return true
    return field.showIf.equals.includes(answers(section.key)[field.showIf.key] ?? '')
  }

  // ── Smokehouse picks ────────────────────────────────────────────────────
  const picks = sheet.smokehouse ?? []

  const catalog  = [...roastGroups, ...trimGroups]
  const findPick = (category: string, flavor: string) =>
    picks.find(p => p.category === category && p.flavor === flavor)

  const togglePick = (group: CatalogGroup, flavor: CatalogFlavor) =>
    onChange(prev => {
      const current = prev.smokehouse ?? []
      if (current.some(p => p.category === group.key && p.flavor === flavor.name)) {
        return { ...prev, smokehouse: current.filter(p => !(p.category === group.key && p.flavor === flavor.name)) }
      }
      return { ...prev, smokehouse: [...current, {
        category: group.key,
        flavor:   flavor.name,
        // A flavour that already names a cheese starts ticked; the counter can
        // untick it. A convenience, never the billing decision.
        cheese:      flavor.cheeseHint && group.cheeseRate != null,
        cheese_type: '',
        // One batch is the honest default: it is the smallest thing the
        // smokehouse will actually run, so it is never a quantity nobody meant.
        batches: 1,
        lbs:     MIN_BATCH_LBS,
        plu:     flavor.plu,
      }] }
    })

  // Quantity, cheese, rank and fat all live on the order lines now — see
  // OrderBuilder. This component's job stops at choosing flavours.

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: compact ? '1.25rem' : '1.75rem' }}>
      {GAME_SHEET.map(section => (
        <div key={section.key}>
          <div style={{
            fontSize: '0.78rem', color: C.tan, textTransform: 'uppercase', letterSpacing: '0.14em',
            fontWeight: 700, borderBottom: `1px solid ${C.medBrown}`, paddingBottom: '0.35rem',
          }}>
            {section.title}
          </div>
          {section.blurb && (
            <p style={{ fontSize: '0.76rem', color: C.lightBrown, margin: '0.5rem 0 0.85rem', lineHeight: 1.5 }}>
              {section.blurb}
            </p>
          )}

          {/* ── Fixed questions ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
            {section.fields.filter(f => visible(section, f)).map(field => {
              const value = answers(section.key)[field.key] ?? ''

              if (field.type === 'toggle') {
                const on = value === 'true'
                return (
                  <label key={field.key} style={{
                    display: 'flex', alignItems: 'center', gap: '0.6rem', cursor: 'pointer',
                    fontSize: '0.85rem', color: on ? C.cream : C.tan,
                  }}>
                    <input
                      type="checkbox" checked={on}
                      onChange={() => setAnswer(section.key, field.key, on ? '' : 'true')}
                      style={{ width: 16, height: 16, accentColor: C.green, cursor: 'pointer' }}
                    />
                    <span>{field.label}</span>
                    {field.help && <span style={{ fontSize: '0.72rem', color: C.lightBrown }}>· {field.help}</span>}
                  </label>
                )
              }

              if (field.type === 'number') {
                return (
                  <div key={field.key} style={{ maxWidth: 220 }}>
                    <label style={LABEL}>{field.label}</label>
                    <input
                      type="number" min="0" step="0.5" value={value} style={INPUT}
                      onChange={e => setAnswer(section.key, field.key, e.target.value)}
                    />
                  </div>
                )
              }

              if (field.type === 'text') {
                return (
                  <div key={field.key}>
                    <label style={LABEL}>{field.label}</label>
                    <input value={value} style={INPUT}
                      onChange={e => setAnswer(section.key, field.key, e.target.value)} />
                  </div>
                )
              }

              // choice — laid out as buttons, not a dropdown. At the counter you
              // want to see every option and tap one, not open a menu.
              return (
                <div key={field.key}>
                  <label style={LABEL}>{field.label}</label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                    {field.options?.map(opt => {
                      const on = value === opt.value
                      return (
                        <button
                          key={opt.value} type="button"
                          onClick={() => setAnswer(section.key, field.key, opt.value)}
                          style={{
                            ...BTN(on ? C.tan : 'rgba(255,255,255,0.05)', on ? C.dark : C.cream),
                            padding: '0.4rem 0.8rem', fontSize: '0.8rem',
                            border: `1px solid ${on ? C.tan : 'rgba(166,120,90,0.35)'}`,
                            fontWeight: on ? 700 : 500,
                          }}
                        >
                          {opt.label}
                          {/* The note rides inside the button rather than in a
                              title attribute: a tooltip replaces the button's
                              accessible name, so "Grind it" would announce
                              itself as "what most hunters do". */}
                          {opt.note && (
                            <span style={{ opacity: 0.7, fontWeight: 400, fontSize: '0.7rem' }}> · {opt.note}</span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                  {field.help && (
                    <div style={{ fontSize: '0.72rem', color: C.lightBrown, marginTop: '0.3rem' }}>{field.help}</div>
                  )}
                </div>
              )
            })}
          </div>

          {/* ── Smokehouse: the slip's five product tables ── */}
          {section.key === 'smokehouse' && (
            <div style={{ marginTop: '0.25rem' }}>
              {loading && <div style={{ color: C.lightBrown, fontSize: '0.82rem' }}>Loading the price list…</div>}
              {!loading && !catalog.length && (
                <div style={{ color: C.yellow, fontSize: '0.82rem' }}>
                  No products are priced yet — add them on the Pricing tab.
                </div>
              )}

              {/* Roasts first, because roasts get decided first. A category
                  with no flavours is still a line a hunter picks — "steak the
                  roasts" has no flavour, it is just a thing they want done. */}
              {([['roast', roastGroups], ['trim', trimGroups]] as const).map(([pool, groups]) => (
                groups.length > 0 && (
                  <div key={pool} style={{ marginBottom: '1.1rem' }}>
                    <div style={{
                      fontSize: '0.74rem', color: pool === 'roast' ? C.purple : C.orange,
                      fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em',
                      marginBottom: '0.5rem',
                    }}>
                      {pool === 'roast' ? 'From the roasts' : 'From the trim'}
                    </div>

                    {groups.map(group => (
                      <div key={group.key} style={{ marginBottom: '0.75rem' }}>
                        <div style={{
                          display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                          marginBottom: '0.35rem',
                        }}>
                          <span style={{ fontSize: '0.79rem', color: C.cream, fontWeight: 600 }}>{group.label}</span>
                          <span style={{ fontSize: '0.71rem', color: C.lightBrown }}>
                            ${group.rate.toFixed(2)}/lb
                            {group.cheeseRate != null ? ` · $${group.cheeseRate.toFixed(2)}/lb w/ cheese` : ''}
                          </span>
                        </div>

                        {group.flavors.length > 0 ? (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                            {group.flavors.map(f => {
                              const on = !!findPick(group.key, f.name)
                              return (
                                <button
                                  key={f.id} type="button"
                                  onClick={() => togglePick(group, f)}
                                  style={{
                                    ...BTN(on ? C.orange : 'rgba(255,255,255,0.05)', on ? C.dark : C.cream),
                                    padding: '0.38rem 0.7rem', fontSize: '0.78rem',
                                    border: `1px solid ${on ? C.orange : 'rgba(166,120,90,0.35)'}`,
                                    fontWeight: on ? 700 : 500,
                                  }}
                                >
                                  {f.name}
                                  {/* No PLU means no label can be printed for it.
                                      Worth a mark where somebody is about to sell it. */}
                                  {!f.plu && <span style={{ opacity: 0.65, fontSize: '0.68rem' }}> · no PLU</span>}
                                </button>
                              )
                            })}
                          </div>
                        ) : (
                          // Flavourless line — steaks, roasts kept whole, burger.
                          <button
                            type="button"
                            onClick={() => togglePick(group, { id: group.key, name: '', plu: null, cheeseHint: false })}
                            style={{
                              ...BTN(findPick(group.key, '') ? C.orange : 'rgba(255,255,255,0.05)',
                                findPick(group.key, '') ? C.dark : C.cream),
                              padding: '0.38rem 0.8rem', fontSize: '0.78rem',
                              border: `1px solid ${findPick(group.key, '') ? C.orange : 'rgba(166,120,90,0.35)'}`,
                              fontWeight: findPick(group.key, '') ? 700 : 500,
                            }}
                          >
                            {findPick(group.key, '') ? '✓ ' : '+ '}{group.label}
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )
              ))}

              {missingPlu.length > 0 && (
                <div style={{ fontSize: '0.72rem', color: C.lightBrown, lineHeight: 1.5, marginBottom: '0.6rem' }}>
                  ⚠ {missingPlu.length} flavours on the slip have no wild game PLU, so they can be made and
                  billed but not labelled: {missingPlu.map(m => m.name).join(', ')}.
                </div>
              )}

              <OrderBuilder
                sheet={sheet}
                onChange={onChange}
                categories={catalog.map(g => ({
                  key: g.key, label: g.label, source: g.source, rate: g.rate, cheeseRate: g.cheeseRate,
                }))}
                cheeseTypes={cheeseTypes}
                roastLbs={roastLbs}
                trimLbs={trimLbs}
              />

              {/* House rules that apply to THIS order. They appear as the
                  hunter chooses rather than after, because every one of them
                  changes what they would have asked for. */}
              <HouseRules sheet={sheet} />
            </div>
          )}
        </div>
      ))}

      <div>
        <label style={LABEL}>Anything else</label>
        <textarea
          value={sheet.notes ?? ''} rows={2} style={{ ...INPUT, resize: 'vertical' }}
          placeholder="What the hunter said that does not fit a box"
          onChange={e => onChange(prev => ({ ...prev, notes: e.target.value }))}
        />
      </div>
    </div>
  )
}

// ── House rules ───────────────────────────────────────────────────────────
// Defined in lib/gameRules.ts. Shown to whoever is taking the order; the
// floor-facing set prints on the work order instead.
function HouseRules({ sheet }: { sheet: GameSheet }) {
  const rules = rulesFor(sheet, 'hunter')
  if (!rules.length) return null

  return (
    <div style={{ marginTop: '0.85rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      {rules.map(r => {
        const warn = r.severity === 'warn'
        return (
          <div key={r.key} style={{
            padding: '0.6rem 0.75rem', borderRadius: 4,
            background: warn ? 'rgba(217,119,6,0.09)' : 'rgba(255,255,255,0.03)',
            border: `1px solid ${warn ? 'rgba(217,119,6,0.45)' : 'rgba(166,120,90,0.28)'}`,
          }}>
            <div style={{
              fontSize: '0.79rem', fontWeight: 700,
              color: warn ? C.yellow : C.tan,
            }}>
              {warn ? '⚠ ' : ''}{r.title}
            </div>
            <div style={{ fontSize: '0.74rem', color: C.lightBrown, marginTop: '0.2rem', lineHeight: 1.55 }}>
              {r.detail}
            </div>
          </div>
        )
      })}
    </div>
  )
}
