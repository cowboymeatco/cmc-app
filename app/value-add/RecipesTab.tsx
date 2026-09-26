'use client'

// The smokehouse recipe book — one row per flavour: seasoning and its ratio,
// cure, other adds, casing, and the steps done from memory.
//
// Built 2026-09-26 when the people who carry the formulations announced they
// were leaving. Filling this in IS the knowledge capture; everything after it
// (scaled seasoning on the WIP tag, seasoning order suggestions) reads these
// rows. So the board leads with what's still BLANK.
//
// Every save needs a name typed at the top, stored as updated_by — who wrote a
// formulation down is never guessed.
import { useEffect, useState, useCallback } from 'react'

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
}

interface Flavor { id: string; product: string; val: string; label: string; plu_number: string | null }
interface Recipe {
  id: string; wizard_flavor_id: string | null; product: string; label: string
  seasoning_name: string | null; seasoning_supplier: string | null; seasoning_lb_per_100: number | null
  cure_name: string | null; cure_oz_per_100: number | null; other_adds: string | null
  casing_type: string | null; casing_size: string | null; steps: string | null; notes: string | null
  updated_by: string | null; updated_at: string
}
interface Profile { id: string; profile_key: string; display_name: string; lbs_per_batch: number | null; units_per_batch: number | null; unit_label: string | null }

// One line of the book: a wizard flavour (maybe no recipe yet) or a house row.
interface Line { key: string; product: string; label: string; plu: string | null; flavorId: string | null; recipe: Recipe | null }

// Wizard product keys → how the floor says them. We make BROTWURST — the
// wizard's key is 'brats' but the book never prints that word.
const GROUPS: { product: string; title: string; profileKey: string | null }[] = [
  { product: 'sticks',     title: 'Snack Sticks',   profileKey: 'SNACK STICKS' },
  { product: 'brats',      title: 'Brots',          profileKey: 'SMOKED BRATS' },
  { product: 'summer',     title: 'Summer Sausage', profileKey: 'SUMMER SAUSAGE' },
  { product: 'jerky',      title: 'Beef Jerky',     profileKey: 'BEEF JERKY' },
  { product: 'jerky-pork', title: 'Pork Jerky',     profileKey: null },
]
const HOUSE = 'house'
const CASINGS = ['collagen', 'cellulose', 'natural', 'fibrous', 'none']

const LABEL: React.CSSProperties = {
  display: 'block', fontSize: '0.68rem', color: C.lightBrown,
  textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.25rem',
}
const INPUT: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', background: 'rgba(0,0,0,0.25)',
  border: '1px solid rgba(166,120,90,0.35)', borderRadius: 3, color: C.cream,
  padding: '0.5rem 0.6rem', fontSize: '0.9rem', fontFamily: 'inherit',
}
const BTN = (bg: string, fg: string): React.CSSProperties => ({
  background: bg, color: fg, border: 'none', borderRadius: 3, cursor: 'pointer',
  padding: '0.5rem 1rem', fontSize: '0.85rem', fontWeight: 700,
})

const NAME_KEY = 'cmc.recipeBook.name'
function loadName(): string { try { return localStorage.getItem(NAME_KEY) ?? '' } catch { return '' } }
function saveName(n: string) { try { localStorage.setItem(NAME_KEY, n) } catch { /* private window */ } }

// "Written down" = the seasoning and its ratio exist. Cure and casing don't
// apply to every product (jerky has no casing), so they show as chips instead.
const isFilled = (r: Recipe | null) => !!r && !!r.seasoning_name && r.seasoning_lb_per_100 != null

function Chip({ on, children }: { on: boolean; children: React.ReactNode }) {
  const color = on ? C.green : C.lightBrown
  return (
    <span style={{
      background: `${color}1f`, border: `1px solid ${color}55`, color,
      fontSize: '0.65rem', fontWeight: 700, borderRadius: 99, padding: '0.1rem 0.5rem', whiteSpace: 'nowrap',
    }}>{on ? '✓ ' : ''}{children}</span>
  )
}

export default function RecipesTab() {
  const [flavors,  setFlavors]  = useState<Flavor[]>([])
  const [recipes,  setRecipes]  = useState<Recipe[]>([])
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState('')
  const [name,     setName]     = useState('')
  const [open,     setOpen]     = useState<string | null>(null)
  const [onlyBlank, setOnlyBlank] = useState(false)

  useEffect(() => { setName(loadName()) }, [])

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/smokehouse-recipes', { cache: 'no-store' })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error ?? 'Load failed')
      setFlavors(j.flavors); setRecipes(j.recipes); setProfiles(j.profiles); setError('')
    } catch (e) { setError((e as Error).message) }
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const byFlavor = new Map(recipes.filter(r => r.wizard_flavor_id).map(r => [r.wizard_flavor_id!, r]))
  const linesFor = (product: string): Line[] => product === HOUSE
    ? recipes.filter(r => !r.wizard_flavor_id)
        .sort((a, b) => a.label.localeCompare(b.label))
        .map(r => ({ key: r.id, product: r.product, label: r.label, plu: null, flavorId: null, recipe: r }))
    : flavors.filter(f => f.product === product)
        .map(f => ({ key: f.id, product: f.product, label: f.label, plu: f.plu_number, flavorId: f.id, recipe: byFlavor.get(f.id) ?? null }))

  const all = [...GROUPS.map(g => g.product), HOUSE].flatMap(linesFor)
  const filled = all.filter(l => isFilled(l.recipe)).length

  const onSaved = (r: Recipe) => {
    setRecipes(prev => [...prev.filter(x => x.id !== r.id), r])
    setOpen(null)
  }

  if (loading) return <div style={{ color: C.lightBrown, padding: '2rem' }}>Loading the recipe book…</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <div style={{
        background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(166,120,90,0.25)',
        borderRadius: 4, padding: '1rem', display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'flex-end',
      }}>
        <div style={{ flex: '1 1 260px' }}>
          <div style={{ color: C.cream, fontFamily: 'Georgia, serif', fontSize: '1.3rem', fontWeight: 700 }}>
            {filled} of {all.length} written down
          </div>
          <div style={{ color: C.lightBrown, fontSize: '0.8rem', marginTop: '0.2rem' }}>
            A recipe counts once it has a seasoning and a ratio. Tap any flavour to fill it in.
          </div>
          <div style={{ height: 6, background: 'rgba(0,0,0,0.3)', borderRadius: 3, marginTop: '0.5rem', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${all.length ? (filled / all.length) * 100 : 0}%`, background: C.green }} />
          </div>
        </div>
        <div style={{ flex: '0 1 220px' }}>
          <label style={LABEL}>Your name (goes on every save)</label>
          <input style={{ ...INPUT, borderColor: name.trim() ? 'rgba(166,120,90,0.35)' : C.yellow }}
            value={name} placeholder="Who's writing this down?"
            onChange={e => { setName(e.target.value); saveName(e.target.value) }} />
        </div>
        <label style={{ color: C.tan, fontSize: '0.8rem', display: 'flex', gap: '0.4rem', alignItems: 'center', cursor: 'pointer' }}>
          <input type="checkbox" checked={onlyBlank} onChange={e => setOnlyBlank(e.target.checked)} /> Only show blanks
        </label>
      </div>

      {error && <div style={{ color: C.red, fontSize: '0.85rem' }}>{error}</div>}

      {GROUPS.map(g => (
        <Group key={g.product} title={g.title} lines={linesFor(g.product)} onlyBlank={onlyBlank}
          profile={g.profileKey ? profiles.find(p => p.profile_key === g.profileKey) ?? null : null}
          onProfileSaved={p => setProfiles(prev => prev.map(x => x.id === p.id ? { ...x, lbs_per_batch: p.lbs_per_batch } : x))}
          open={open} setOpen={setOpen} name={name} onSaved={onSaved} onDeleted={() => {}} />
      ))}

      <Group title="House products (hot dogs, bacon cure, ham brine…)" lines={linesFor(HOUSE)} onlyBlank={onlyBlank}
        profile={null} onProfileSaved={() => {}}
        open={open} setOpen={setOpen} name={name} onSaved={onSaved}
        onDeleted={id => { setRecipes(prev => prev.filter(r => r.id !== id)); setOpen(null) }}
        addHouse />
    </div>
  )
}

function Group({ title, lines, onlyBlank, profile, onProfileSaved, open, setOpen, name, onSaved, onDeleted, addHouse }: {
  title: string; lines: Line[]; onlyBlank: boolean
  profile: Profile | null; onProfileSaved: (p: Profile) => void
  open: string | null; setOpen: (k: string | null) => void
  name: string; onSaved: (r: Recipe) => void; onDeleted: (id: string) => void; addHouse?: boolean
}) {
  const done = lines.filter(l => isFilled(l.recipe)).length
  const shown = onlyBlank ? lines.filter(l => !isFilled(l.recipe)) : lines
  const newKey = `new:${title}`

  return (
    <section>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'baseline', marginBottom: '0.5rem' }}>
        <h3 style={{ margin: 0, color: C.tan, fontFamily: 'Georgia, serif', fontSize: '1.1rem' }}>{title}</h3>
        {!addHouse && <span style={{ color: C.lightBrown, fontSize: '0.8rem' }}>{done} / {lines.length}</span>}
        {profile && <LoadSize profile={profile} onSaved={onProfileSaved} />}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
        {shown.map(l => open === l.key
          ? <Editor key={l.key} line={l} name={name} onSaved={onSaved} onCancel={() => setOpen(null)} onDeleted={onDeleted} />
          : <Row key={l.key} line={l} onClick={() => setOpen(l.key)} />)}
        {shown.length === 0 && !addHouse && <div style={{ color: C.lightBrown, fontSize: '0.8rem' }}>All written down.</div>}
        {addHouse && (open === newKey
          ? <Editor line={{ key: newKey, product: '', label: '', plu: null, flavorId: null, recipe: null }} house
              name={name} onSaved={onSaved} onCancel={() => setOpen(null)} onDeleted={onDeleted} />
          : <button style={{ ...BTN('transparent', C.tan), border: '1px dashed rgba(166,120,90,0.45)', alignSelf: 'flex-start' }}
              onClick={() => setOpen(newKey)}>+ Add a house product</button>)}
      </div>
    </section>
  )
}

// Pounds per load lives on the cook profile, shared with the Schedule tab's
// Smokehouse Book — setting it here un-blanks that product's loads there too.
function LoadSize({ profile, onSaved }: { profile: Profile; onSaved: (p: Profile) => void }) {
  const [v, setV] = useState(profile.lbs_per_batch?.toString() ?? '')
  const [busy, setBusy] = useState(false)
  const dirty = v !== (profile.lbs_per_batch?.toString() ?? '')
  const save = async () => {
    const n = v.trim() === '' ? null : Number(v)
    if (n !== null && (!isFinite(n) || n <= 0)) return
    setBusy(true)
    const res = await fetch('/api/cook-profile', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: profile.id, lbs_per_batch: n }),
    })
    setBusy(false)
    if (res.ok) onSaved(await res.json())
  }
  return (
    <span style={{ display: 'inline-flex', gap: '0.35rem', alignItems: 'center', fontSize: '0.78rem',
      color: profile.lbs_per_batch == null ? C.yellow : C.lightBrown }}>
      lb per full smokehouse load:
      <input value={v} onChange={e => setV(e.target.value)} inputMode="decimal" placeholder="blank"
        style={{ ...INPUT, width: 70, padding: '0.2rem 0.4rem', fontSize: '0.8rem' }} />
      {dirty && <button style={{ ...BTN(C.medBrown, C.cream), padding: '0.2rem 0.6rem', fontSize: '0.75rem' }}
        disabled={busy} onClick={save}>{busy ? '…' : 'Save'}</button>}
    </span>
  )
}

function Row({ line, onClick }: { line: Line; onClick: () => void }) {
  const r = line.recipe
  const filled = isFilled(r)
  return (
    <button onClick={onClick} style={{
      textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit',
      background: filled ? 'rgba(76,175,80,0.06)' : 'rgba(255,255,255,0.03)',
      border: `1px solid ${filled ? 'rgba(76,175,80,0.3)' : 'rgba(166,120,90,0.2)'}`,
      borderRadius: 4, padding: '0.6rem 0.8rem', display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center',
    }}>
      <span style={{ color: C.cream, fontWeight: 700, fontSize: '0.92rem', flex: '1 1 160px' }}>
        {line.label}
        {line.plu && <span style={{ color: C.lightBrown, fontFamily: 'monospace', fontWeight: 400, fontSize: '0.75rem', marginLeft: '0.5rem' }}>PLU {line.plu}</span>}
      </span>
      <span style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
        <Chip on={filled}>{filled ? `${r!.seasoning_lb_per_100} lb/100` : 'Seasoning'}</Chip>
        <Chip on={!!r?.cure_name}>Cure</Chip>
        <Chip on={!!r?.casing_type}>{r?.casing_type ?? 'Casing'}</Chip>
        <Chip on={!!r?.steps}>Steps</Chip>
      </span>
      {r?.updated_by && (
        <span style={{ color: C.lightBrown, fontSize: '0.7rem', width: '100%' }}>
          {r.updated_by} · {new Date(r.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
        </span>
      )}
    </button>
  )
}

type Form = Record<'product' | 'label' | 'seasoning_name' | 'seasoning_supplier' | 'seasoning_lb_per_100' |
  'cure_name' | 'cure_oz_per_100' | 'other_adds' | 'casing_type' | 'casing_size' | 'steps' | 'notes', string>

function Editor({ line, house, name, onSaved, onCancel, onDeleted }: {
  line: Line; house?: boolean; name: string
  onSaved: (r: Recipe) => void; onCancel: () => void; onDeleted: (id: string) => void
}) {
  const r = line.recipe
  const s = (v: string | number | null | undefined) => v == null ? '' : String(v)
  const [form, setForm] = useState<Form>({
    product: r?.product ?? line.product, label: r?.label ?? line.label,
    seasoning_name: s(r?.seasoning_name), seasoning_supplier: s(r?.seasoning_supplier),
    seasoning_lb_per_100: s(r?.seasoning_lb_per_100), cure_name: s(r?.cure_name),
    cure_oz_per_100: s(r?.cure_oz_per_100), other_adds: s(r?.other_adds),
    casing_type: s(r?.casing_type), casing_size: s(r?.casing_size), steps: s(r?.steps), notes: s(r?.notes),
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const f = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }))

  const num = (v: string): number | null | 'bad' => {
    if (v.trim() === '') return null
    const n = Number(v)
    return isFinite(n) && n >= 0 ? n : 'bad'
  }

  const save = async () => {
    if (!name.trim()) { setErr('Type your name at the top first.'); return }
    if (house && (!form.label.trim())) { setErr('Name the product.'); return }
    const seas = num(form.seasoning_lb_per_100), cure = num(form.cure_oz_per_100)
    if (seas === 'bad' || cure === 'bad') { setErr('Ratios must be numbers.'); return }
    setBusy(true); setErr('')
    const res = await fetch('/api/smokehouse-recipes', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...form,
        product: house ? (form.product.trim() || HOUSE) : line.product,
        seasoning_lb_per_100: seas, cure_oz_per_100: cure,
        id: r?.id, wizard_flavor_id: line.flavorId, updated_by: name,
      }),
    })
    const j = await res.json()
    setBusy(false)
    if (!res.ok) { setErr(j.error ?? 'Save failed'); return }
    onSaved(j)
  }

  const remove = async () => {
    if (!r || !confirm(`Delete the ${r.label} recipe?`)) return
    const res = await fetch(`/api/smokehouse-recipes?id=${r.id}`, { method: 'DELETE' })
    if (res.ok) onDeleted(r.id)
    else setErr((await res.json()).error ?? 'Delete failed')
  }

  const grid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem' }

  return (
    <div style={{
      background: C.darkBrown, border: '1px solid rgba(201,168,130,0.5)', borderRadius: 4,
      padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.85rem',
    }}>
      {house ? (
        <div style={grid}>
          <div><label style={LABEL}>Product *</label><input style={INPUT} value={form.label} onChange={f('label')} placeholder="Hot dogs, bacon cure…" /></div>
        </div>
      ) : (
        <div style={{ color: C.cream, fontWeight: 700, fontSize: '1rem' }}>
          {line.label} {line.plu && <span style={{ color: C.lightBrown, fontFamily: 'monospace', fontWeight: 400, fontSize: '0.8rem' }}>PLU {line.plu}</span>}
        </div>
      )}

      <div style={grid}>
        <div><label style={LABEL}>Seasoning</label><input style={INPUT} value={form.seasoning_name} onChange={f('seasoning_name')} placeholder="Name on the bag" /></div>
        <div><label style={LABEL}>Supplier</label><input style={INPUT} value={form.seasoning_supplier} onChange={f('seasoning_supplier')} /></div>
        <div><label style={LABEL}>lb seasoning per 100 lb meat</label><input style={INPUT} inputMode="decimal" value={form.seasoning_lb_per_100} onChange={f('seasoning_lb_per_100')} /></div>
      </div>

      <div style={grid}>
        <div><label style={LABEL}>Cure</label><input style={INPUT} value={form.cure_name} onChange={f('cure_name')} placeholder="Blank if none" /></div>
        <div><label style={LABEL}>oz cure per 100 lb meat</label><input style={INPUT} inputMode="decimal" value={form.cure_oz_per_100} onChange={f('cure_oz_per_100')} /></div>
        <div>
          <label style={LABEL}>Casing</label>
          <select style={INPUT} value={form.casing_type} onChange={f('casing_type')}>
            <option value="">—</option>
            {CASINGS.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div><label style={LABEL}>Casing size</label><input style={INPUT} value={form.casing_size} onChange={f('casing_size')} placeholder="19mm, 2.5 in…" /></div>
      </div>

      <div>
        <label style={LABEL}>Other adds (with amounts)</label>
        <textarea style={{ ...INPUT, minHeight: 50 }} value={form.other_adds} onChange={f('other_adds')}
          placeholder="Cheese, water, binder, encapsulated citric…" />
      </div>
      <div>
        <label style={LABEL}>Steps — mixing order, stuffing, anything done from memory</label>
        <textarea style={{ ...INPUT, minHeight: 90 }} value={form.steps} onChange={f('steps')} />
      </div>
      <div>
        <label style={LABEL}>Notes</label>
        <textarea style={{ ...INPUT, minHeight: 40 }} value={form.notes} onChange={f('notes')} />
      </div>

      {err && <div style={{ color: C.red, fontSize: '0.82rem' }}>{err}</div>}
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <button style={BTN(C.green, '#fff')} disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
        <button style={{ ...BTN('transparent', C.lightBrown), border: '1px solid rgba(166,120,90,0.3)' }} onClick={onCancel}>Cancel</button>
        {r && !r.wizard_flavor_id && (
          <button style={{ ...BTN('transparent', C.red), marginLeft: 'auto' }} onClick={remove}>Delete</button>
        )}
      </div>
    </div>
  )
}
