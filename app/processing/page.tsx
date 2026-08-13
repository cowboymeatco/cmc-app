'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import Link from 'next/link'
import CutScheduleTab from './CutScheduleTab'
import CureTagsTab from './CureTagsTab'
import CloverTab from './CloverTab'
import QuickBooksTab from './QuickBooksTab'
import AlignmentTab from './AlignmentTab'
import { buildHtFile, needsIngredientStatement, type HobartPlu } from '@/lib/hobart'
import { isoDate } from '@/lib/dates'

type Tab = 'browser' | 'upload' | 'export' | 'cleanup' | 'cut-schedule' | 'in-cure' | 'box-labels' | 'clover' | 'quickbooks' | 'alignment'

interface PluItem {
  id:                 string
  plu_number:         string
  item_name:          string
  price:              number | null
  retail_price:       number | null
  wholesale_price:    number | null
  tare_weight:        number | null
  department:         string
  unit:               string
  species:            string
  description:        string
  is_retail:          boolean
  is_wholesale:       boolean
  clover_item_id:     string
  quickbooks_item_id: string
  upc:                string
  ingredients:        string
  label_message:      string
  sell_by_weight:     boolean
  active:             boolean
  notes:              string
  photo_url:          string
  updated_at:         string
  raw_data:           Record<string, string>
  // This PLU's RT89 record as captured from a scale backup. Carries the fields
  // the app doesn't own — above all l1, the label format. Null for a PLU the
  // scale has never seen.
  ht_skeleton:        Record<string, string> | null
}

const C = {
  dark:       '#1A0A04',
  darkBrown:  '#351E0E',
  medBrown:   '#75471B',
  lightBrown: '#A6785A',
  tan:        '#C9A882',
  cream:      '#F2E8D9',
  green:      '#4CAF50',
  red:        '#E53E3E',
  yellow:     '#D97706',
  blue:       '#3B82F6',
}

// The PLU browser and box-labels views are two-pane (list on the left, detail on
// the right). Pin the grid to a definite viewport height so each pane scrolls on
// its own — the detail pane stays put (frozen) while the list free-scrolls —
// instead of the whole page scrolling as one (which is what happens when the grid
// is height:100% under a min-height:100vh ancestor: 100% collapses to auto).
// 64px = fixed header height; 3rem = <main>'s vertical padding.
const TWO_PANE_HEIGHT = 'calc(100dvh - 64px - 3rem)'

const INPUT: React.CSSProperties = {
  width: '100%', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(166,120,90,0.35)',
  borderRadius: 3, padding: '0.45rem 0.7rem', color: C.cream, fontSize: '0.85rem',
  outline: 'none', boxSizing: 'border-box',
}
const LABEL: React.CSSProperties = {
  display: 'block', fontSize: '0.7rem', color: C.lightBrown,
  textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.25rem',
}
const BTN = (bg: string, color = C.dark): React.CSSProperties => ({
  background: bg, color, border: 'none', borderRadius: 3,
  padding: '0.5rem 1.1rem', fontSize: '0.83rem', fontWeight: 600,
  cursor: 'pointer', letterSpacing: '0.04em',
})

const SPECIES_LIST = ['', 'Beef', 'Pork', 'Lamb', 'Goat', 'Processed', 'Wild Game', 'Cheese', 'Wholesale', 'Other']

// â”€â”€ EAN-13 weight-embedded barcode parser â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Hobart format: 2 NNNNN F WWWWW C
//   [0]    = '2' (weight-embedded prefix)
//   [1–5]  = PLU number (5 digits, zero-padded)
//   [6]    = flag digit (always '0' on Hobart lb config)
//   [7–11] = weight in hundredths of a pound  (÷ 100)
//   [12]   = EAN-13 check digit (ignored)
// Example: 2 00114 0 00069 9  â†’  PLU=114, Weight=0.69 lbs
function parseEAN13(barcode: string): { plu: string; weight_lbs: number } | null {
  if (barcode.length !== 13 || !barcode.startsWith('2')) return null
  if (!/^\d{13}$/.test(barcode)) return null
  const plu        = String(parseInt(barcode.substring(1, 6), 10))   // "00114" â†’ "114"
  const weight_lbs = parseInt(barcode.substring(7, 12), 10) / 100    // "00069" â†’ 0.69
  if (!plu || isNaN(weight_lbs) || weight_lbs <= 0) return null
  return { plu, weight_lbs }
}

function detectSpecies(plu: string): string {
  const n = parseInt(plu)
  if (isNaN(n)) return ''
  if (n >= 413000)             return 'Wholesale'
  if (n >= 9000 && n <= 11999) return 'Cheese'
  if (n >= 8000 && n <= 8999)  return 'Wild Game'
  if (n >= 4000 && n <= 7999)  return 'Processed'
  if (n >= 3000 && n <= 3999)  return 'Goat'
  if (n >= 2000 && n <= 2999)  return 'Lamb'
  if (n >= 1000 && n <= 1999)  return 'Pork'
  if (n >= 100  && n <= 999)   return 'Beef'
  return ''
}

function Field({ label, children, span2 }: { label: string; children: React.ReactNode; span2?: boolean }) {
  return (
    <div style={{ marginBottom: '0.75rem', gridColumn: span2 ? 'span 2' : undefined }}>
      <label style={LABEL}>{label}</label>
      {children}
    </div>
  )
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.83rem', color: checked ? C.tan : C.lightBrown, marginBottom: '0.5rem' }}>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} style={{ accentColor: C.tan, width: 15, height: 15 }} />
      {label}
    </label>
  )
}

// Shrink a photo to <= `max` px on its longest side and re-encode as JPEG,
// client-side, so a 12 MP phone shot isn't stored (or downloaded by shoppers)
// at full size. Keeps the shop fast on mobile.
async function resizeImage(file: File, max = 1000): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const scale  = Math.min(1, max / Math.max(bitmap.width, bitmap.height))
  const w = Math.round(bitmap.width * scale)
  const h = Math.round(bitmap.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas unavailable')
  ctx.drawImage(bitmap, 0, 0, w, h)
  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('resize failed'))), 'image/jpeg', 0.85))
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// EDIT PANEL
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function EditPanel({ item, onSaved, onDeleted, onClose }: {
  item: PluItem
  onSaved: (updated: PluItem) => void
  onDeleted: (id: string) => void
  onClose: () => void
}) {
  const [form, setForm] = useState<PluItem>({ ...item, species: item.species || detectSpecies(item.plu_number) })
  const [saving, setSaving]   = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [editTab, setEditTab] = useState<'basic' | 'pricing' | 'label' | 'photo' | 'connections'>('basic')
  const [photoBusy, setPhotoBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const isNew = !form.id

  // Photos upload immediately (resized client-side) and write straight to
  // plu_items.photo_url, so the thumbnail reflects saved state — Cancel won't
  // undo a photo, same as any image field.
  async function onPhotoPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !form.id) return
    setPhotoBusy(true); setError(null)
    try {
      const blob = await resizeImage(file)
      const fd = new FormData()
      fd.append('id', form.id)
      fd.append('file', blob, 'photo.jpg')
      const res = await fetch('/api/processing/photo', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok || data?.error) setError(data?.error ?? 'Photo upload failed.')
      else setForm(p => ({ ...p, photo_url: data.url }))
    } catch {
      setError('Photo upload failed.')
    }
    setPhotoBusy(false)
  }

  async function removePhoto() {
    if (!form.id) return
    setPhotoBusy(true); setError(null)
    const fd = new FormData()
    fd.append('id', form.id)
    fd.append('remove', 'true')
    const res = await fetch('/api/processing/photo', { method: 'POST', body: fd })
    if (res.ok) setForm(p => ({ ...p, photo_url: '' }))
    else setError('Could not remove photo.')
    setPhotoBusy(false)
  }

  const f = (k: keyof PluItem) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }))
  const num = (k: keyof PluItem) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value === '' ? null : parseFloat(e.target.value) }))
  const bool = (k: keyof PluItem) => (v: boolean) => setForm(p => ({ ...p, [k]: v }))

  async function save() {
    if (isNew && (!form.plu_number.trim() || !form.item_name.trim())) {
      setError('PLU number and item name are required.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/processing', {
        method: isNew ? 'PUT' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        // ALL CAPS names (Jill's standard); the API enforces it too.
        body: JSON.stringify({ ...form, item_name: form.item_name.toUpperCase() }),
      })
      const data = await res.json()
      if (!res.ok || data?.error) {
        setError(data?.error ?? 'Save failed.')
        setSaving(false)
        return
      }
      setSaving(false)
      onSaved(data)
    } catch {
      setError('Save failed — check your connection.')
      setSaving(false)
    }
  }

  async function del() {
    if (!confirm(`Delete PLU ${form.plu_number} — ${form.item_name}? This cannot be undone.`)) return
    setDeleting(true)
    await fetch(`/api/processing?id=${form.id}`, { method: 'DELETE' })
    setDeleting(false)
    onDeleted(form.id)
  }

  const editTabs = ['basic', 'pricing', 'label', 'photo', 'connections'] as const

  return (
    <div style={{ background: C.dark, border: '1px solid rgba(166,120,90,0.25)', borderRadius: 4, display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Edit header */}
      <div style={{ padding: '0.85rem 1.25rem', borderBottom: '1px solid rgba(166,120,90,0.2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <span style={{ fontFamily: 'monospace', color: C.lightBrown, fontSize: '0.8rem' }}>{isNew ? '＋ NEW PLU' : `PLU ${form.plu_number}`}</span>
          <span style={{ color: C.cream, fontWeight: 600, marginLeft: '0.75rem', fontSize: '0.95rem' }}>{form.item_name || (isNew ? 'Fill in the details →' : 'Unnamed')}</span>
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.lightBrown, cursor: 'pointer', fontSize: '1.1rem', lineHeight: 1 }}>×</button>
      </div>

      {/* Sub-tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid rgba(166,120,90,0.15)', background: 'rgba(0,0,0,0.15)' }}>
        {editTabs.map(t => (
          <button key={t} onClick={() => setEditTab(t)} style={{
            padding: '0.5rem 1rem', border: 'none', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600,
            background: editTab === t ? 'rgba(166,120,90,0.15)' : 'transparent',
            color: editTab === t ? C.tan : C.lightBrown, textTransform: 'capitalize',
            borderBottom: editTab === t ? `2px solid ${C.tan}` : '2px solid transparent',
          }}>{t}</button>
        ))}
      </div>

      <div style={{ overflowY: 'auto', flex: 1, padding: '1rem 1.25rem' }}>
        {/* BASIC */}
        {editTab === 'basic' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 1rem' }}>
            <Field label="PLU #">
              <input style={INPUT} value={form.plu_number} onChange={f('plu_number')} />
            </Field>
            <Field label="Species">
              <select style={{ ...INPUT }} value={form.species} onChange={f('species')}>
                {SPECIES_LIST.map(s => <option key={s} value={s}>{s || '— auto-detect —'}</option>)}
              </select>
            </Field>
            <Field label="Item Name" span2>
              <input style={INPUT} value={form.item_name} onChange={f('item_name')} />
            </Field>
            <Field label="Description" span2>
              <input style={INPUT} value={form.description} onChange={f('description')} placeholder="Extended description" />
            </Field>
            <Field label="Department">
              <input style={INPUT} value={form.department} onChange={f('department')} />
            </Field>
            <Field label="Unit">
              <input style={INPUT} value={form.unit} onChange={f('unit')} placeholder="LB / EA / OZ" />
            </Field>
            <div style={{ gridColumn: 'span 2', marginBottom: '0.5rem' }}>
              <Toggle label="Sell by Weight" checked={form.sell_by_weight} onChange={bool('sell_by_weight')} />
              <Toggle label="Active" checked={form.active} onChange={bool('active')} />
            </div>
            <Field label="Notes" span2>
              <textarea style={{ ...INPUT, height: 64, resize: 'vertical' }} value={form.notes} onChange={f('notes')} />
            </Field>
          </div>
        )}

        {/* PRICING */}
        {editTab === 'pricing' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 1rem' }}>
            <Field label="Scale Price ($/lb)">
              <input type="number" step="0.01" style={INPUT} value={form.price ?? ''} onChange={num('price')} placeholder="0.00" />
            </Field>
            <Field label="Retail Price ($/lb)">
              <input type="number" step="0.01" style={INPUT} value={form.retail_price ?? ''} onChange={num('retail_price')} placeholder="0.00" />
            </Field>
            <Field label="Wholesale Price ($/lb)">
              <input type="number" step="0.01" style={INPUT} value={form.wholesale_price ?? ''} onChange={num('wholesale_price')} placeholder="0.00" />
            </Field>
            <Field label="Tare Weight (lbs)">
              <input type="number" step="0.01" style={INPUT} value={form.tare_weight ?? ''} onChange={num('tare_weight')} placeholder="0.00" />
            </Field>
            <div style={{ gridColumn: 'span 2', marginTop: '0.25rem' }}>
              <Toggle label="Sell in Clover (retail)" checked={form.is_retail} onChange={bool('is_retail')} />
              <Toggle label="Available wholesale" checked={form.is_wholesale} onChange={bool('is_wholesale')} />
            </div>
          </div>
        )}

        {/* LABEL */}
        {editTab === 'label' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 1rem' }}>
            <Field label="UPC / Barcode">
              <input style={{ ...INPUT, fontFamily: 'monospace' }} value={form.upc} onChange={f('upc')} />
            </Field>
            <Field label="Tare Weight (lbs)">
              <input type="number" step="0.01" style={INPUT} value={form.tare_weight ?? ''} onChange={num('tare_weight')} />
            </Field>
            <Field label="Ingredient Statement" span2>
              <textarea style={{ ...INPUT, height: 80, resize: 'vertical' }} value={form.ingredients} onChange={f('ingredients')} placeholder="Ingredients printed on scale label (e.g. PORK, WATER, SALT, SPICES)" />
            </Field>
            <Field label="Label Message" span2>
              <textarea style={{ ...INPUT, height: 80, resize: 'vertical' }} value={form.label_message} onChange={f('label_message')} placeholder="Message printed on scale label" />
            </Field>
          </div>
        )}

        {/* PHOTO */}
        {editTab === 'photo' && (
          isNew ? (
            <p style={{ color: C.lightBrown, fontSize: '0.85rem' }}>Create the PLU first, then come back to add a photo.</p>
          ) : (
            <div style={{ display: 'flex', gap: '1.25rem', alignItems: 'flex-start' }}>
              <div style={{ width: 150, height: 150, borderRadius: 6, border: '1px solid rgba(166,120,90,0.35)', background: 'rgba(255,255,255,0.04)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0 }}>
                {form.photo_url
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={form.photo_url} alt={form.item_name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : <span style={{ color: C.lightBrown, fontSize: '0.75rem' }}>No photo</span>}
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ color: C.lightBrown, fontSize: '0.8rem', lineHeight: 1.5, margin: '0 0 0.85rem' }}>
                  A generic photo of this cut. It shows on the customer shop at portal.cowboymeats.com for any product tied to this PLU. Large images are resized automatically.
                </p>
                <input ref={fileRef} type="file" accept="image/*" onChange={onPhotoPick} style={{ display: 'none' }} />
                <div style={{ display: 'flex', gap: '0.6rem' }}>
                  <button onClick={() => fileRef.current?.click()} disabled={photoBusy} style={BTN(C.tan)}>
                    {photoBusy ? 'Working…' : form.photo_url ? 'Replace Photo' : 'Upload Photo'}
                  </button>
                  {form.photo_url && (
                    <button onClick={removePhoto} disabled={photoBusy} style={{ ...BTN('transparent', C.red), border: `1px solid ${C.red}` }}>Remove</button>
                  )}
                </div>
              </div>
            </div>
          )
        )}

        {/* CONNECTIONS */}
        {editTab === 'connections' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 1rem' }}>
            <Field label="Clover Item ID">
              <input style={{ ...INPUT, fontFamily: 'monospace' }} value={form.clover_item_id} onChange={f('clover_item_id')} placeholder="Synced from Clover" />
            </Field>
            <div style={{ marginBottom: '0.75rem' }}>
              <label style={LABEL}>Clover Status</label>
              <div style={{ padding: '0.45rem 0.7rem', background: 'rgba(255,255,255,0.04)', borderRadius: 3, fontSize: '0.83rem', color: form.clover_item_id ? C.green : C.lightBrown }}>
                {form.clover_item_id ? '✓ Synced' : 'Not synced'}
              </div>
            </div>
            <Field label="QuickBooks Item ID">
              <input style={{ ...INPUT, fontFamily: 'monospace' }} value={form.quickbooks_item_id} onChange={f('quickbooks_item_id')} placeholder="Linked from QuickBooks tab" />
            </Field>
            <div style={{ marginBottom: '0.75rem' }}>
              <label style={LABEL}>QuickBooks Status</label>
              <div style={{ padding: '0.45rem 0.7rem', background: 'rgba(255,255,255,0.04)', borderRadius: 3, fontSize: '0.83rem', color: form.quickbooks_item_id ? C.green : C.lightBrown }}>
                {form.quickbooks_item_id ? '✓ Linked' : 'Not linked'}
              </div>
            </div>
            <div style={{ gridColumn: 'span 2', background: 'rgba(255,255,255,0.03)', borderRadius: 4, padding: '0.85rem 1rem', fontSize: '0.8rem', color: C.lightBrown }}>
              <strong style={{ color: C.tan, display: 'block', marginBottom: '0.4rem' }}>Connections</strong>
              Clover sync and QuickBooks integration are managed from their respective tabs.
              IDs here are set automatically during sync.
            </div>
          </div>
        )}
      </div>

      {/* Error banner */}
      {error && (
        <div style={{ padding: '0.55rem 1.25rem', background: 'rgba(224,96,58,0.12)', color: '#E0603A', fontSize: '0.8rem', borderTop: '1px solid rgba(224,96,58,0.3)' }}>
          {error}
        </div>
      )}

      {/* Action bar */}
      <div style={{ padding: '0.85rem 1.25rem', borderTop: '1px solid rgba(166,120,90,0.2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        {isNew ? <span /> : (
          <button onClick={del} disabled={deleting} style={{ ...BTN('transparent', C.red), border: `1px solid ${C.red}`, opacity: 0.7 }}>
            {deleting ? 'Deleting…' : 'Delete'}
          </button>
        )}
        <div style={{ display: 'flex', gap: '0.6rem' }}>
          <button onClick={onClose} style={{ ...BTN('transparent', C.lightBrown), border: '1px solid rgba(166,120,90,0.3)' }}>Cancel</button>
          <button onClick={save} disabled={saving} style={BTN(C.tan)}>
            {saving ? (isNew ? 'Creating…' : 'Saving…') : (isNew ? 'Create PLU' : 'Save Changes')}
          </button>
        </div>
      </div>
    </div>
  )
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// PLU BROWSER TAB
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function BrowserTab() {
  const [items, setItems]       = useState<PluItem[]>([])
  const [search, setSearch]     = useState('')
  const [speciesFilter, setSpeciesFilter] = useState('')
  const [showInactive, setShowInactive]   = useState(false)
  const [selected, setSelected] = useState<PluItem | null>(null)
  const [loading, setLoading]   = useState(true)

  const load = useCallback(async (q = '', sp = '', inactive = false) => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (q)  params.set('search', q)
      if (sp) params.set('species', sp)
      if (!inactive) params.set('active', 'true')
      const res = await fetch(`/api/processing?${params}`)
      const json = await res.json()
      setItems(Array.isArray(json) ? json : [])
    } catch { setItems([]) }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const t = setTimeout(() => load(search, speciesFilter, showInactive), 250)
    return () => clearTimeout(t)
  }, [search, speciesFilter, showInactive, load])

  function handleSaved(updated: PluItem) {
    // add-or-update: a newly created PLU won't be in the list yet
    setItems(prev => prev.some(x => x.id === updated.id)
      ? prev.map(x => x.id === updated.id ? updated : x)
      : [updated, ...prev])
    setSelected(updated)
  }

  function handleDeleted(id: string) {
    setItems(prev => prev.filter(x => x.id !== id))
    setSelected(null)
  }

  function startNew() {
    setSelected({
      id: '', plu_number: '', item_name: '', price: null, retail_price: null, wholesale_price: null,
      tare_weight: 0, department: '0', unit: '02', species: '', description: '',
      is_retail: false, is_wholesale: false, clover_item_id: '', quickbooks_item_id: '', upc: '', ingredients: '', label_message: '',
      // No skeleton: the scale has never seen this PLU, so the export falls back
      // to the canonical new-PLU defaults — which is the right layout for it.
      sell_by_weight: true, active: true, notes: '', photo_url: '', updated_at: '', raw_data: {}, ht_skeleton: null,
    })
  }

  const speciesCounts = items.reduce<Record<string, number>>((acc, item) => {
    const s = item.species || 'Unknown'
    acc[s] = (acc[s] ?? 0) + 1
    return acc
  }, {})

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: '1.5rem', height: TWO_PANE_HEIGHT, minHeight: 0 }}>
      {/* Left — list */}
      <div style={{ background: C.dark, border: '1px solid rgba(166,120,90,0.25)', borderRadius: 4, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {/* Search + filters */}
        <div style={{ padding: '0.75rem', borderBottom: '1px solid rgba(166,120,90,0.2)' }}>
          <button
            onClick={startNew}
            style={{ ...BTN(selected?.id === '' ? C.medBrown : C.tan), width: '100%', marginBottom: '0.6rem', fontSize: '0.85rem' }}
          >
            ＋ New PLU
          </button>
          <input style={{ ...INPUT, marginBottom: '0.5rem' }} value={search} onChange={e => setSearch(e.target.value)} placeholder="Search PLU # or name…" />
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
            <select style={{ ...INPUT, width: 'auto', flex: 1, fontSize: '0.78rem', padding: '0.3rem 0.5rem' }} value={speciesFilter} onChange={e => setSpeciesFilter(e.target.value)}>
              <option value="">All species</option>
              {SPECIES_LIST.filter(Boolean).map(s => (
                <option key={s} value={s}>{s} {speciesCounts[s] ? `(${speciesCounts[s]})` : ''}</option>
              ))}
            </select>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.4rem', fontSize: '0.75rem', color: C.lightBrown, cursor: 'pointer' }}>
            <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} style={{ accentColor: C.tan }} />
            Show inactive
          </label>
        </div>

        <div style={{ padding: '0.4rem 0.75rem', borderBottom: '1px solid rgba(166,120,90,0.1)', fontSize: '0.72rem', color: C.lightBrown }}>
          {loading ? 'Loading…' : `${items.length} items`}
        </div>

        <div style={{ overflowY: 'auto', flex: 1 }}>
          {!loading && items.length === 0 && (
            <div style={{ padding: '2rem', textAlign: 'center', color: C.lightBrown, fontSize: '0.85rem' }}>
              {search || speciesFilter ? 'No matches' : 'No items yet — upload a file to get started'}
            </div>
          )}
          {items.map(item => (
            <div
              key={item.id}
              onClick={() => setSelected(item)}
              style={{
                padding: '0.65rem 0.85rem', borderBottom: '1px solid rgba(166,120,90,0.08)',
                cursor: 'pointer', background: selected?.id === item.id ? 'rgba(166,120,90,0.12)' : 'transparent',
                transition: 'background 0.15s', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                opacity: item.active ? 1 : 0.45,
              }}
            >
              <div>
                <div style={{ color: C.cream, fontSize: '0.86rem', fontWeight: 500 }}>{item.item_name || '—'}</div>
                <div style={{ color: C.lightBrown, fontSize: '0.72rem', fontFamily: 'monospace', marginTop: '0.1rem' }}>
                  {item.plu_number}
                  {item.species ? ` · ${item.species}` : ''}
                </div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: '0.5rem' }}>
                {item.price != null && <div style={{ color: C.tan, fontSize: '0.85rem', fontWeight: 600 }}>${item.price.toFixed(2)}</div>}
                {item.is_retail && <div style={{ fontSize: '0.65rem', color: C.blue }}>RETAIL</div>}
                {/* A processed item with no statement prints a label with no
                    ingredients on it — flagged here so it's caught while
                    someone is already looking at the item. */}
                {item.active && needsIngredientStatement(item.item_name) && (item.ingredients ?? '').trim() === '' && (
                  <div title="No ingredient statement — this label will print without ingredients" style={{ fontSize: '0.65rem', color: C.yellow, fontWeight: 700 }}>⚠ NO INGR</div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Right — edit panel or placeholder */}
      {selected ? (
        <EditPanel
          key={selected.id}
          item={selected}
          onSaved={handleSaved}
          onDeleted={handleDeleted}
          onClose={() => setSelected(null)}
        />
      ) : (
        <div style={{ background: C.dark, border: '1px solid rgba(166,120,90,0.25)', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.lightBrown, fontSize: '0.9rem' }}>
          ← Select an item to edit
        </div>
      )}
    </div>
  )
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// EXPORT TAB
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
interface PushReq {
  id: string
  created_at: string
  status: string
  requested_by?: string | null
  completed_at?: string | null
  result?: { plus?: number; scales?: { ip: string; ok: boolean; asleep?: boolean; records?: number }[] } | null
}

function ExportTab() {
  const [species, setSpecies]     = useState('')
  const [retailOnly, setRetailOnly] = useState(false)
  const [activeOnly, setActiveOnly] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [exportingHt, setExportingHt] = useState(false)
  const [count, setCount]         = useState<number | null>(null)
  const [pushing, setPushing]     = useState(false)
  const [pushLog, setPushLog]     = useState<PushReq[]>([])
  // Deleted PLUs — HCT imports merge, so these stay on the scale until someone
  // deletes them at the scale itself. Shown as a standing removal checklist.
  const [retired, setRetired]     = useState<PluItem[]>([])
  // Processed items in this export with no ingredient statement. They export
  // fine and print a label with no ingredients on it — the gap only shows up at
  // the packing table, so it gets called out here instead.
  const [missingIng, setMissingIng] = useState<PluItem[]>([])
  // Items that HAVE a statement here but whose record on the scale carries no
  // Ec pointer at it. The text is in the scale's expanded-text library and the
  // label still prints blank, because nothing references it. Importing a fresh
  // .ht repairs the link — this is what actually bit the jerky.
  const [unlinkedIng, setUnlinkedIng] = useState<PluItem[]>([])
  // Active PLUs the kiosk push will silently leave behind, because it only sends
  // items with a real price. $0.01 is the deliberate placeholder for wild-game
  // service items, wholesale cut codes, meat boxes and NFHC — those are meant to
  // be skipped. No price at all means unfinished, and the push says "3/3 scales"
  // either way, so the item just never shows up at the scale (Charlie's German
  // Cheddar Brotwurst, 2026-08-06). Not filtered by the export controls above —
  // the push always covers every active PLU, whatever this tab is showing.
  const [unpriced, setUnpriced] = useState<PluItem[]>([])

  useEffect(() => {
    fetch('/api/processing?active=false')
      .then(r => r.json())
      .then(d => setRetired(Array.isArray(d) ? d : []))
      .catch(() => {})
    fetch('/api/processing?active=true')
      .then(r => r.json())
      .then(d => setUnpriced(
        (Array.isArray(d) ? d : []).filter((i: PluItem) => i.price == null || Number(i.price) === 0)
      ))
      .catch(() => {})
  }, [])

  async function fetchCount() {
    const params = new URLSearchParams()
    if (species)    params.set('species', species)
    if (activeOnly) params.set('active', 'true')
    const res  = await fetch(`/api/processing?${params}`)
    const json = await res.json()
    const items: PluItem[] = Array.isArray(json) ? json : []
    const filtered = retailOnly ? items.filter(i => i.is_retail) : items
    setCount(filtered.length)
    setMissingIng(filtered.filter(i =>
      needsIngredientStatement(i.item_name) && (i.ingredients ?? '').trim() === ''
    ))
    setUnlinkedIng(filtered.filter(i =>
      (i.ingredients ?? '').trim() !== '' &&
      i.ht_skeleton != null && (i.ht_skeleton.Ec ?? '').trim() === ''
    ))
    return filtered
  }

  useEffect(() => { fetchCount() }, [species, retailOnly, activeOnly]) // eslint-disable-line

  async function handleExport() {
    setExporting(true)
    const items = await fetchCount()

    // Hobart CSV format — standard 28-column layout
    const headers = [
      'PLU_NO','ITEM_NAME','PRICE1','PRICE2','PRICE3',
      'TARE','DEPT','UNIT','DESCRIPTION','UPC',
      'SELL_BY_WEIGHT','INGREDIENTS','LABEL_MSG','ACTIVE',
      'RETAIL_PRICE','WHOLESALE_PRICE','SPECIES',
    ]

    const rows = items.map(i => [
      i.plu_number,
      `"${(i.item_name ?? '').replace(/"/g, '—')}"`,
      i.price?.toFixed(2) ?? '0.00',
      i.retail_price?.toFixed(2) ?? '0.00',
      i.wholesale_price?.toFixed(2) ?? '0.00',
      i.tare_weight?.toFixed(3) ?? '0.000',
      i.department ?? '',
      i.unit ?? 'LB',
      `"${(i.description ?? '').replace(/"/g, '—')}"`,
      i.upc ?? '',
      i.sell_by_weight ? '1' : '0',
      `"${(i.ingredients ?? '').replace(/"/g, '—')}"`,
      `"${(i.label_message ?? '').replace(/"/g, '—')}"`,
      i.active ? '1' : '0',
      i.retail_price?.toFixed(2) ?? '',
      i.wholesale_price?.toFixed(2) ?? '',
      i.species ?? '',
    ].join(','))

    const csv = [headers.join(','), ...rows].join('\r\n')
    // UTF-8 BOM (﻿) tells Excel and Hobart to read as UTF-8, prevents mojibake
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `PLU_Export_${new Date().toISOString().slice(0,10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
    setExporting(false)
  }

  // Native Hobart .ht export — the ONLY format HCT's "Import HT File" accepts.
  // Builds RT89 PLU records via lib/hobart (round-trip-validated against the
  // shop's real scale export). Faithful, conservative: only new/changed PLUs
  // are written, and HCT merges them into the existing book.
  async function handleExportHt() {
    setExportingHt(true)
    const items = await fetchCount()
    const plus: HobartPlu[] = items.map(i => ({
      plu_number:    i.plu_number,
      item_name:     i.item_name,
      price:         i.price,
      tare_weight:   i.tare_weight,
      upc:           i.upc,
      unit:          i.unit,
      department:    i.department,
      label_message: i.label_message,
      ingredients:   i.ingredients, // drives the Ec "Expanded text" reference
      skeleton:      i.ht_skeleton, // this item's own on-scale fields (label format et al)
    }))
    const ht = buildHtFile(plus)
    // Encode latin-1 (one byte per char) so the 0x1E/0x1F framing bytes match
    // the scale's native file exactly — no UTF-8 BOM, no multi-byte expansion.
    const bytes = new Uint8Array(ht.length)
    for (let n = 0; n < ht.length; n++) bytes[n] = ht.charCodeAt(n) & 0xff
    const blob = new Blob([bytes], { type: 'application/octet-stream' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `PLU_Export_${new Date().toISOString().slice(0,10)}.ht`
    a.click()
    URL.revokeObjectURL(url)
    setExportingHt(false)
  }

  // Push to scales: queue a request; the shop kiosk (watch mode) picks it up
  // and sends current prices to all scales on-site.
  async function loadPushLog() {
    try {
      const res = await fetch('/api/scale-push')
      const j = await res.json()
      setPushLog(Array.isArray(j) ? j : [])
    } catch { /* ignore transient errors */ }
  }
  useEffect(() => {
    loadPushLog()
    const t = setInterval(loadPushLog, 8000)
    return () => clearInterval(t)
  }, [])

  async function handlePush() {
    setPushing(true)
    try {
      await fetch('/api/scale-push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requested_by: 'app' }),
      })
      await loadPushLog()
    } finally {
      setPushing(false)
    }
  }

  return (
    <div style={{ maxWidth: 680, margin: '0 auto' }}>
      <div style={{ background: C.dark, border: '1px solid rgba(166,120,90,0.25)', borderRadius: 4, padding: '1.5rem', marginBottom: '1.25rem' }}>
        <h3 style={{ color: C.cream, fontFamily: 'Georgia, serif', fontSize: '1rem', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 1.25rem' }}>
          Export PLU List
        </h3>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 1.25rem', marginBottom: '1rem' }}>
          <div style={{ marginBottom: '0.85rem' }}>
            <label style={LABEL}>Species Filter</label>
            <select style={{ ...INPUT }} value={species} onChange={e => setSpecies(e.target.value)}>
              <option value="">All species</option>
              {SPECIES_LIST.filter(Boolean).map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div />
        </div>

        <Toggle label="Active items only" checked={activeOnly} onChange={setActiveOnly} />
        <Toggle label="Retail items only (Clover)" checked={retailOnly} onChange={setRetailOnly} />

        <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 4, padding: '0.85rem 1rem', margin: '1rem 0', fontSize: '0.85rem', color: C.tan }}>
          {count !== null ? <><strong style={{ color: C.cream }}>{count}</strong> items will be exported</> : 'Calculating…'}
        </div>

        {/* Statement present here, no pointer to it on the scale. The text is
            already in the scale's expanded-text library; the PLU record just
            doesn't reference it, so the label prints blank. A fresh .ht import
            writes the Ec pointer and fixes it (Charlie's jerky, 2026-07-29). */}
        {unlinkedIng.length > 0 && (
          <div style={{ background: 'rgba(245,158,11,0.10)', border: `1px solid ${C.yellow}`, borderRadius: 4, padding: '0.85rem 1rem', margin: '1rem 0' }}>
            <div style={{ color: C.yellow, fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.3rem' }}>
              🔗 {unlinkedIng.length} {unlinkedIng.length === 1 ? 'item has' : 'items have'} an ingredient statement the scale isn&apos;t linked to
            </div>
            <div style={{ color: C.lightBrown, fontSize: '0.78rem', lineHeight: 1.6, marginBottom: '0.5rem' }}>
              These have a statement here, but the PLU record on the scale carries no reference to
              one, so the label prints without ingredients anyway.
              <strong style={{ color: C.tan }}> 🛰 Push to scales</strong> now sends the statement itself
              along with the link and fixes them — so does importing the <strong style={{ color: C.tan }}>.ht</strong> below in HCT.
              <div style={{ marginTop: '0.3rem', opacity: 0.8 }}>
                Reflects the last scale capture — items already repaired by a later import will clear on the next capture.
              </div>
            </div>
            <div style={{ maxHeight: 160, overflowY: 'auto', fontSize: '0.76rem', color: C.tan, lineHeight: 1.75 }}>
              {unlinkedIng.map(i => (
                <div key={i.id}>
                  <span style={{ fontFamily: 'monospace', color: C.lightBrown }}>{i.plu_number}</span>{' '}{i.item_name}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Blank ingredient statements. These export without complaint and then
            print a label with no ingredients — nobody finds out until the
            product is already on the packing table (Charlie, 2026-07-29). */}
        {missingIng.length > 0 && (
          <div style={{ background: 'rgba(239,68,68,0.08)', border: `1px solid ${C.yellow}`, borderRadius: 4, padding: '0.85rem 1rem', margin: '1rem 0' }}>
            <div style={{ color: C.yellow, fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.3rem' }}>
              ⚠ {missingIng.length} {missingIng.length === 1 ? 'item has' : 'items have'} no ingredient statement
            </div>
            <div style={{ color: C.lightBrown, fontSize: '0.78rem', lineHeight: 1.6, marginBottom: '0.5rem' }}>
              These are processed products — jerky, sausage, snack sticks, anything cured or seasoned — so
              their labels are supposed to carry ingredients. They will print without one.
              Add the statement on each item&apos;s <strong style={{ color: C.tan }}>Label</strong> tab in the PLU
              Browser, then re-export.
            </div>
            <div style={{ maxHeight: 190, overflowY: 'auto', fontSize: '0.76rem', color: C.tan, lineHeight: 1.75 }}>
              {missingIng.map(i => (
                <div key={i.id}>
                  <span style={{ fontFamily: 'monospace', color: C.lightBrown }}>{i.plu_number}</span>{' '}{i.item_name}
                </div>
              ))}
            </div>
          </div>
        )}

        <button style={BTN(count ? C.tan : C.medBrown)} onClick={handleExportHt} disabled={exportingHt || !count}>
          {exportingHt ? 'Generating…' : '⬇ Download .ht for Hobart (HCT)'}
        </button>
        <button
          style={{ ...BTN(C.medBrown), marginTop: '0.6rem', fontSize: '0.78rem', opacity: 0.8 }}
          onClick={handleExport}
          disabled={exporting || !count}
        >
          {exporting ? 'Generating…' : '⬇ Download CSV (spreadsheets only — HCT can’t read this)'}
        </button>
      </div>

      <div style={{ background: 'rgba(26,10,4,0.6)', border: '1px solid rgba(166,120,90,0.15)', borderRadius: 4, padding: '1.25rem 1.5rem', fontSize: '0.82rem', color: C.lightBrown, lineHeight: 1.8 }}>
        <strong style={{ color: C.tan, display: 'block', marginBottom: '0.5rem' }}>To load into the Hobart scale:</strong>
        <ol style={{ margin: 0, paddingLeft: '1.25rem' }}>
          <li>Download the <strong>.ht</strong> file above (not the CSV — HCT only reads HT/Access/HLX).</li>
          <li>Open HCT (Hobart Communication Tool).</li>
          <li>Choose <em>Import HT File</em> and select this file.</li>
          <li>HCT <strong>merges</strong> these PLUs into the scale — existing PLUs not in the file are left untouched.</li>
        </ol>
        <div style={{ marginTop: '0.85rem', color: C.tan }}>
          <strong style={{ color: C.tan }}>Ingredient statements ride along.</strong> The .ht carries each item&apos;s
          statement and the link to it, so there is no separate EXPTXT import to do — and
          <strong style={{ color: C.tan }}> 🛰 Push to scales</strong> sends them the same way, without HCT.
        </div>
      </div>

      {retired.length > 0 && (
        <div style={{ background: C.dark, border: `1px solid ${C.yellow}`, borderRadius: 4, padding: '1.25rem 1.5rem', marginTop: '1.25rem' }}>
          <h3 style={{ color: C.yellow, fontFamily: 'Georgia, serif', fontSize: '1rem', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 0.6rem' }}>
            ⚠ Deleted PLUs — remove from the scale by hand
          </h3>
          <p style={{ color: C.tan, fontSize: '0.82rem', lineHeight: 1.6, margin: '0 0 0.85rem' }}>
            HCT imports can only add or update — they never delete. These {retired.length} PLUs were
            deleted in the app but stay on the Hobart until removed at the scale
            (Manager Mode → PLU edit → delete). Scanning one flags it at the scanner box.
          </p>
          <div style={{ fontSize: '0.82rem' }}>
            {retired.map(i => (
              <div key={i.id} style={{ display: 'flex', gap: '1rem', padding: '0.3rem 0', borderTop: '1px solid rgba(166,120,90,0.12)', color: C.lightBrown }}>
                <span style={{ fontFamily: 'monospace', color: C.yellow, minWidth: '3.5rem' }}>{i.plu_number}</span>
                <span>{i.item_name}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ background: C.dark, border: '1px solid rgba(166,120,90,0.25)', borderRadius: 4, padding: '1.25rem 1.5rem', marginTop: '1.25rem' }}>
        <h3 style={{ color: C.cream, fontFamily: 'Georgia, serif', fontSize: '1rem', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 0.6rem' }}>
          🛰 Push to Scales
        </h3>
        <p style={{ color: C.tan, fontSize: '0.82rem', lineHeight: 1.6, margin: '0 0 1rem' }}>
          Send current prices to all shop scales automatically — the kiosk does the on-site push. No file, no HCT.
          Only PLUs that <strong style={{ color: C.cream }}>have a price</strong> are sent.
        </p>

        {/* A push reports "3/3 scales" whether or not your item was in it, so an
            unpriced PLU looks synced and simply isn't on the scale. Call the
            skipped ones out by name here, next to the button that skips them. */}
        {unpriced.length > 0 && (
          <div style={{ background: 'rgba(245,158,11,0.10)', border: `1px solid ${C.yellow}`, borderRadius: 4, padding: '0.85rem 1rem', margin: '0 0 1rem' }}>
            <div style={{ color: C.yellow, fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.3rem' }}>
              ⚠ {unpriced.length} active {unpriced.length === 1 ? 'PLU has' : 'PLUs have'} no price — {unpriced.length === 1 ? 'it won’t' : 'they won’t'} be pushed
            </div>
            <div style={{ color: C.lightBrown, fontSize: '0.78rem', lineHeight: 1.6, marginBottom: '0.5rem' }}>
              The push only sends priced items, and it still reports every scale as updated — so these
              look synced and never arrive. Set a price on the item&apos;s <strong style={{ color: C.tan }}>Pricing</strong>{' '}
              tab in the PLU Browser and push again. (Wild game, cut codes and meat boxes are priced $0.01 on
              purpose and are meant to stay off the scale — they aren&apos;t listed here.)
            </div>
            <div style={{ maxHeight: 160, overflowY: 'auto', fontSize: '0.76rem', color: C.tan, lineHeight: 1.75 }}>
              {unpriced.map(i => (
                <div key={i.id}>
                  <span style={{ fontFamily: 'monospace', color: C.lightBrown }}>{i.plu_number}</span>{' '}{i.item_name}
                </div>
              ))}
            </div>
          </div>
        )}

        <button style={BTN(pushing ? C.medBrown : C.tan)} onClick={handlePush} disabled={pushing}>
          {pushing ? 'Queuing…' : '🛰 Push to scales'}
        </button>

        {pushLog.length > 0 && (
          <div style={{ marginTop: '1rem', fontSize: '0.78rem' }}>
            {pushLog.map(r => {
              const scales = r.result?.scales
              const okN = scales ? scales.filter(s => s.ok).length : 0
              const color = r.status === 'done' ? C.green : r.status === 'error' ? '#E0603A' : C.tan
              const label =
                r.status === 'pending' ? '⏳ waiting for kiosk'
                : r.status === 'running' ? '⏳ pushing…'
                : `${okN}/${scales?.length ?? 0} scales${r.result?.plus ? ` · ${r.result.plus} PLUs` : ''}`
              return (
                <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', padding: '0.35rem 0', borderTop: '1px solid rgba(166,120,90,0.12)', color: C.lightBrown }}>
                  <span>{new Date(r.created_at).toLocaleString()}</span>
                  <span style={{ color, fontWeight: 600, whiteSpace: 'nowrap' }}>{label}</span>
                </div>
              )
            })}
          </div>
        )}

        <p style={{ color: C.lightBrown, fontSize: '0.72rem', marginTop: '0.85rem', opacity: 0.8 }}>
          Needs the kiosk watcher running (<code>watch.bat</code>) and the scales awake.
        </p>
      </div>
    </div>
  )
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// CLEANUP TAB
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function CleanupTab() {
  const [items, setItems] = useState<PluItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const res  = await fetch('/api/processing')
      const json = await res.json()
      setItems(Array.isArray(json) ? json : [])
      setLoading(false)
    }
    load()
  }, [])

  const noPrice     = items.filter(i => i.price == null && i.active)
  const noName      = items.filter(i => !i.item_name?.trim() && i.active)
  const noSpecies   = items.filter(i => !i.species && i.active)
  const retailNoId  = items.filter(i => i.is_retail && !i.clover_item_id && i.active)
  const inactive    = items.filter(i => !i.active)

  const groups = [
    { label: 'No price set',          color: C.red,    items: noPrice },
    { label: 'Missing name',           color: C.red,    items: noName },
    { label: 'No species assigned',    color: C.yellow, items: noSpecies },
    { label: 'Retail but no Clover ID', color: C.yellow, items: retailNoId },
    { label: 'Inactive items',         color: C.lightBrown, items: inactive },
  ]

  if (loading) return <div style={{ color: C.lightBrown, padding: '2rem' }}>Loading…</div>

  const totalIssues = noPrice.length + noName.length + noSpecies.length + retailNoId.length

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      {/* Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginBottom: '1.5rem' }}>
        {[
          ['Total PLUs',      items.length,        C.tan],
          ['Active',          items.filter(i => i.active).length, C.green],
          ['Issues Found',    totalIssues,          totalIssues > 0 ? C.red : C.green],
          ['Inactive',        inactive.length,      C.lightBrown],
        ].map(([label, val, color]) => (
          <div key={label as string} style={{ background: C.dark, border: '1px solid rgba(166,120,90,0.25)', borderRadius: 4, padding: '1rem 1.25rem', textAlign: 'center' }}>
            <div style={{ fontSize: '1.8rem', fontWeight: 700, color: color as string, lineHeight: 1 }}>{val}</div>
            <div style={{ fontSize: '0.72rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.1em', marginTop: '0.3rem' }}>{label as string}</div>
          </div>
        ))}
      </div>

      {/* Issue groups */}
      {groups.map(g => g.items.length > 0 && (
        <div key={g.label} style={{ background: C.dark, border: '1px solid rgba(166,120,90,0.25)', borderRadius: 4, marginBottom: '1rem', overflow: 'hidden' }}>
          <div style={{ padding: '0.75rem 1.25rem', borderBottom: '1px solid rgba(166,120,90,0.15)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: g.color, fontSize: '0.85rem', fontWeight: 600 }}>{g.label}</span>
            <span style={{ background: g.color, color: C.dark, fontSize: '0.7rem', fontWeight: 700, borderRadius: 99, padding: '2px 10px' }}>{g.items.length}</span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
              <thead>
                <tr style={{ background: 'rgba(255,255,255,0.03)' }}>
                  {['PLU #', 'Name', 'Species', 'Price', 'Retail'].map(h => (
                    <th key={h} style={{ padding: '0.4rem 0.85rem', borderBottom: '1px solid rgba(166,120,90,0.15)', color: C.tan, textAlign: 'left' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {g.items.slice(0, 20).map(item => (
                  <tr key={item.id} style={{ borderBottom: '1px solid rgba(166,120,90,0.07)' }}>
                    <td style={{ padding: '0.4rem 0.85rem', color: C.lightBrown, fontFamily: 'monospace' }}>{item.plu_number}</td>
                    <td style={{ padding: '0.4rem 0.85rem', color: C.cream }}>{item.item_name || <em style={{ color: C.red }}>missing</em>}</td>
                    <td style={{ padding: '0.4rem 0.85rem', color: item.species ? C.tan : C.red }}>{item.species || 'not set'}</td>
                    <td style={{ padding: '0.4rem 0.85rem', color: item.price != null ? C.tan : C.red }}>{item.price != null ? `$${item.price.toFixed(2)}` : 'not set'}</td>
                    <td style={{ padding: '0.4rem 0.85rem', color: item.is_retail ? C.blue : C.lightBrown }}>{item.is_retail ? 'Yes' : '—'}</td>
                  </tr>
                ))}
                {g.items.length > 20 && (
                  <tr><td colSpan={5} style={{ padding: '0.5rem 0.85rem', color: C.lightBrown, fontSize: '0.75rem', fontStyle: 'italic' }}>…and {g.items.length - 20} more</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {totalIssues === 0 && inactive.length === 0 && (
        <div style={{ background: 'rgba(76,175,80,0.1)', border: '1px solid rgba(76,175,80,0.3)', borderRadius: 4, padding: '1.5rem', textAlign: 'center', color: C.green, fontSize: '0.9rem' }}>
          ✓ No issues found — all items look good
        </div>
      )}
    </div>
  )
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// UPLOAD TAB (unchanged)
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
interface ParsedPlu {
  plu_number:  string
  item_name:   string
  price:       number | null
  tare_weight: number | null
  department:  string
  unit:        string
  species:     string
  raw_data:    Record<string, string>
}

function parseHobartDat(raw: string): ParsedPlu[] {
  const text   = raw.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '|')
  const blocks = text.split('RT89').slice(1).filter(b => /p#\d+/.test(b))

  return blocks.map(block => {
    const get = (pattern: RegExp) => { const m = block.match(pattern); return m ? m[1].trim() : '' }
    const plu_number  = get(/p#(\d+)/)
    const item_name   = get(/dt([^|\r\n]+)/)
    const priceRaw    = get(/\$(\d+)/)
    const department  = get(/d#(\d+)/)
    const tareRaw     = get(/ta(\d+)/)
    const upc         = get(/up(\w+)/)
    const unit_code   = get(/u#(\w+)/)
    const price       = priceRaw ? parseInt(priceRaw) / 100 : null
    const tare_weight = tareRaw  ? Math.round((parseInt(tareRaw) / 453.592) * 100) / 100 : null
    return {
      plu_number, item_name, price, tare_weight, department, unit: unit_code, species: detectSpecies(plu_number),
      raw_data: { plu: plu_number, name: item_name, price: priceRaw, dept: department, tare: tareRaw, upc, unit: unit_code },
    }
  }).filter(item => item.plu_number)
}

function parseCSVFile(text: string): ParsedPlu[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim())
  if (lines.length < 2) return []
  const headers  = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''))
  const lower    = (s: string) => s.toLowerCase()
  const col      = (kw: string) => headers.find(h => lower(h).includes(kw)) ?? ''
  const pluCol   = col('plu') || col('number') || col('no')
  const nameCol  = col('name') || col('desc')
  const priceCol = col('price') || col('cost')
  const tareCol  = col('tare') || col('weight')
  const deptCol  = col('dept')
  const unitCol  = col('unit') || col('uom')
  return lines.slice(1).map(line => {
    const vals = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''))
    const r: Record<string, string> = Object.fromEntries(headers.map((h, i) => [h, vals[i] ?? '']))
    const plu = r[pluCol] ?? ''
    return {
      plu_number: plu, item_name: r[nameCol] ?? '',
      price: r[priceCol] ? parseFloat(r[priceCol]) || null : null,
      tare_weight: r[tareCol] ? parseFloat(r[tareCol]) || null : null,
      department: r[deptCol] ?? '', unit: r[unitCol] ?? '',
      species: detectSpecies(plu), raw_data: r,
    }
  }).filter(item => item.plu_number.trim())
}

function UploadTab() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview]     = useState<ParsedPlu[]>([])
  const [fileName, setFileName]   = useState('')
  const [fileType, setFileType]   = useState<'dat' | 'csv' | null>(null)
  const [uploading, setUploading] = useState(false)
  const [result, setResult]       = useState<{ ok: boolean; count?: number; error?: string } | null>(null)
  const [allItems, setAllItems]   = useState<ParsedPlu[]>([])

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    setResult(null)
    const isDat = file.name.toLowerCase().endsWith('.dat')
    setFileType(isDat ? 'dat' : 'csv')
    const reader = new FileReader()
    reader.onload = ev => {
      const raw   = ev.target?.result as string
      const items = isDat ? parseHobartDat(raw) : parseCSVFile(raw)
      setAllItems(items)
      setPreview(items.slice(0, 8))
    }
    // .dat files need raw bytes; CSV files should be decoded as text (handles UTF-8 + BOM)
    if (isDat) {
      reader.readAsBinaryString(file)
    } else {
      reader.readAsText(file, 'utf-8')
    }
  }

  async function handleUpload() {
    if (!allItems.length) return
    setUploading(true)
    setResult(null)
    const res  = await fetch('/api/processing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: allItems }),
    })
    const json = await res.json()
    setResult(json.ok ? { ok: true, count: json.count } : { ok: false, error: json.error })
    setUploading(false)
  }

  return (
    <div style={{ maxWidth: 860, margin: '0 auto' }}>
      <div style={{ background: C.dark, border: '1px solid rgba(166,120,90,0.25)', borderRadius: 4, padding: '1.5rem', marginBottom: '1.5rem' }}>
        <h3 style={{ color: C.cream, fontFamily: 'Georgia, serif', fontSize: '1rem', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 1rem' }}>Upload PLU File</h3>
        <div onClick={() => fileRef.current?.click()} style={{ border: '2px dashed rgba(166,120,90,0.4)', borderRadius: 4, padding: '2rem', textAlign: 'center', cursor: 'pointer', marginBottom: '1.25rem', background: 'rgba(255,255,255,0.02)' }}>
          <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>ðŸ“‚</div>
          <div style={{ color: C.tan, fontSize: '0.9rem', marginBottom: '0.25rem' }}>
            {fileName ? <><strong>{fileName}</strong> — {allItems.length} PLU items found</> : 'Click to select PLU.dat or a CSV file'}
          </div>
          <div style={{ color: C.lightBrown, fontSize: '0.78rem' }}>Accepts Hobart .dat backup files and .csv exports</div>
          <input ref={fileRef} type="file" accept=".dat,.csv,.txt" onChange={handleFile} style={{ display: 'none' }} />
        </div>
        {fileType && (
          <div style={{ marginBottom: '1rem' }}>
            <span style={{ background: fileType === 'dat' ? C.tan : C.medBrown, color: C.dark, fontSize: '0.72rem', fontWeight: 700, borderRadius: 99, padding: '3px 12px', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
              {fileType === 'dat' ? 'Hobart DAT — auto-parsed' : 'CSV — auto-mapped'}
            </span>
          </div>
        )}
        {preview.length > 0 && (
          <>
            <div style={{ fontSize: '0.75rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.5rem' }}>Preview — first 8 items</div>
            <div style={{ overflowX: 'auto', marginBottom: '1.25rem' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                <thead>
                  <tr>{['PLU #', 'Name', 'Species', 'Price', 'Tare (lbs)'].map(h => (
                    <th key={h} style={{ padding: '0.4rem 0.75rem', borderBottom: '1px solid rgba(166,120,90,0.3)', color: C.tan, textAlign: 'left' }}>{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {preview.map((row, i) => (
                    <tr key={i} style={{ background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)' }}>
                      <td style={{ padding: '0.4rem 0.75rem', color: C.lightBrown, fontFamily: 'monospace' }}>{row.plu_number}</td>
                      <td style={{ padding: '0.4rem 0.75rem', color: C.cream }}>{row.item_name}</td>
                      <td style={{ padding: '0.4rem 0.75rem', color: C.tan }}>{row.species || '—'}</td>
                      <td style={{ padding: '0.4rem 0.75rem', color: C.tan }}>{row.price != null ? `$${row.price.toFixed(2)}` : '—'}</td>
                      <td style={{ padding: '0.4rem 0.75rem', color: C.lightBrown }}>{row.tare_weight ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {result && (
              <div style={{ background: result.ok ? 'rgba(76,175,80,0.15)' : 'rgba(229,62,62,0.15)', border: `1px solid ${result.ok ? 'rgba(76,175,80,0.4)' : 'rgba(229,62,62,0.4)'}`, borderRadius: 4, padding: '0.75rem 1rem', marginBottom: '1rem', color: result.ok ? C.green : C.red, fontSize: '0.85rem' }}>
                {result.ok ? `✓ ${result.count} PLU items saved / updated` : `Error: ${result.error}`}
              </div>
            )}
            <button style={BTN(C.tan)} onClick={handleUpload} disabled={uploading}>
              {uploading ? 'Uploading…' : `Push ${allItems.length} items to Supabase`}
            </button>
          </>
        )}
      </div>
    </div>
  )
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// BOX LABELS TAB
// The label itself is rendered server-side by /api/boxes/label (lib/label.ts).
// These describe what this tab holds and which flags it puts on that URL.
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
interface BoxScan   { id: string; item_name: string; plu_number: string; weight_lbs: number; quantity: number }
interface BoxRecord { id: string; customer_name: string; pack_date: string; box_number: number; is_closed: boolean; is_final: boolean; total_weight_lbs: number; total_cuts: number; serial_number?: string }
interface LabelFlags { usda_bug: boolean; retail_exempt: boolean; not_for_sale: boolean }

const DEFAULT_FLAGS: LabelFlags = { usda_bug: true, retail_exempt: false, not_for_sale: false }

function BoxLabelsTab() {
  const pluRef    = useRef<HTMLInputElement>(null)
  const weightRef = useRef<HTMLInputElement>(null)

  const [customer, setCustomer]   = useState('')
  const [date, setDate]           = useState(isoDate())
  const [boxes, setBoxes]         = useState<BoxRecord[]>([])
  const [scans, setScans]         = useState<Record<string, BoxScan[]>>({})
  const [activeBox, setActiveBox] = useState<BoxRecord | null>(null)

  const [pluInput,    setPluInput]    = useState('')
  const [itemName,    setItemName]    = useState('')
  const [weight,      setWeight]      = useState('')
  const [qty,         setQty]         = useState('1')
  const [pluStatus,   setPluStatus]   = useState<'idle' | 'found' | 'notfound'>('idle')
  const [saving,      setSaving]      = useState(false)
  const [labelFlags,  setLabelFlags]  = useState<LabelFlags>(DEFAULT_FLAGS)

  function toggleFlag(k: keyof LabelFlags) {
    setLabelFlags(f => ({ ...f, [k]: !f[k] }))
  }

  async function lookupPlu(plu: string) {
    if (!plu.trim()) return
    const res  = await fetch(`/api/processing?search=${encodeURIComponent(plu.trim())}`)
    const json = await res.json()
    const items: PluItem[] = Array.isArray(json) ? json : []
    const match = items.find(i => i.plu_number === plu.trim())
    if (match) { setItemName(match.item_name); setPluStatus('found'); weightRef.current?.focus() }
    else       { setItemName(''); setPluStatus('notfound') }
  }

  // Scan a barcode — auto-adds to active box if EAN-13 weight format
  async function scanBarcode(barcode: string) {
    if (!activeBox) return
    const parsed = parseEAN13(barcode)
    if (!parsed) {
      // Treat as PLU
      setPluInput(barcode)
      lookupPlu(barcode)
      return
    }
    // EAN-13: look up PLU, then auto-add
    const res   = await fetch(`/api/processing?search=${encodeURIComponent(parsed.plu)}`)
    const json  = await res.json()
    const items: PluItem[] = Array.isArray(json) ? json : []
    const match = items.find(i => i.plu_number === parsed.plu)
    const name  = match?.item_name ?? ''
    if (!name) {
      // Unknown PLU — fill in fields for manual completion
      setPluInput(parsed.plu)
      setWeight(parsed.weight_lbs.toFixed(3))
      setPluStatus('notfound')
      return
    }
    // Auto-add scan
    setSaving(true)
    const res2  = await fetch('/api/boxes/scans', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ box_id: activeBox.id, plu_number: parsed.plu, item_name: name, weight_lbs: parsed.weight_lbs, quantity: 1 }),
    })
    const scan: BoxScan = await res2.json()
    setScans(prev => ({ ...prev, [activeBox.id]: [...(prev[activeBox.id] ?? []), scan] }))
    setPluInput(''); setItemName(''); setWeight(''); setQty('1'); setPluStatus('idle')
    setSaving(false)
    pluRef.current?.focus()
  }

  async function loadScans(boxId: string) {
    const res  = await fetch(`/api/boxes/scans?box_id=${boxId}`)
    const data = await res.json()
    setScans(prev => ({ ...prev, [boxId]: Array.isArray(data) ? data : [] }))
  }

  async function addBox(isFinal = false) {
    if (!customer.trim()) { alert('Enter customer name first'); return }
    setSaving(true)
    const nextNum = boxes.length + 1
    // The boxes API mints the CMC serial when none is sent — one generator,
    // so the printed barcode format can never drift from the server's.
    const res  = await fetch('/api/boxes', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customer_name: customer, pack_date: date, box_number: nextNum, is_final: isFinal }),
    })
    const data = await res.json()
    const box: BoxRecord = { ...data }
    setBoxes(prev => [...prev, box])
    setScans(prev => ({ ...prev, [box.id]: [] }))
    setActiveBox(box)
    setSaving(false)
    pluRef.current?.focus()
  }

  async function addScan() {
    if (!activeBox || !itemName || !weight) return
    setSaving(true)
    const res  = await fetch('/api/boxes/scans', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ box_id: activeBox.id, plu_number: pluInput, item_name: itemName, weight_lbs: parseFloat(weight), quantity: parseInt(qty) || 1 }),
    })
    const scan: BoxScan = await res.json()
    setScans(prev => ({ ...prev, [activeBox.id]: [...(prev[activeBox.id] ?? []), scan] }))
    setPluInput(''); setItemName(''); setWeight(''); setQty('1'); setPluStatus('idle')
    setSaving(false)
    pluRef.current?.focus()
  }

  async function removeScan(boxId: string, scanId: string) {
    await fetch(`/api/boxes/scans?id=${scanId}`, { method: 'DELETE' })
    setScans(prev => ({ ...prev, [boxId]: prev[boxId].filter(s => s.id !== scanId) }))
  }

  function labelUrl(box_id: string) {
    const p = new URLSearchParams({ box_id })
    if (!labelFlags.usda_bug)     p.set('usda',   '0')
    if (labelFlags.retail_exempt) p.set('exempt', '1')
    if (labelFlags.not_for_sale)  p.set('nfs',    '1')
    return `/api/boxes/label?${p}`
  }

  async function closeBox(box: BoxRecord) {
    const boxScans = scans[box.id] ?? []
    const totalWeight = boxScans.reduce((s, sc) => s + (Number(sc.weight_lbs) || 0), 0)
    const totalCuts   = boxScans.reduce((s, sc) => s + (sc.quantity || 1), 0)
    await fetch('/api/boxes', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: box.id, is_closed: true, total_weight_lbs: totalWeight, total_cuts: totalCuts }),
    })
    setBoxes(prev => prev.map(b => b.id === box.id ? { ...b, is_closed: true, total_weight_lbs: totalWeight, total_cuts: totalCuts } : b))
    window.open(labelUrl(box.id), '_blank')
  }

  async function printLabel(box: BoxRecord) {
    window.open(labelUrl(box.id), '_blank')
  }

  async function deleteBox(box: BoxRecord) {
    if (!confirm(`Delete Box ${box.box_number}?`)) return
    await fetch(`/api/boxes?id=${box.id}`, { method: 'DELETE' })
    setBoxes(prev => prev.filter(b => b.id !== box.id))
    if (activeBox?.id === box.id) setActiveBox(null)
  }

  const activeScans = activeBox ? (scans[activeBox.id] ?? []) : []
  const activeTotal = activeScans.reduce((s, sc) => s + (Number(sc.weight_lbs) || 0), 0)

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: '1.5rem', height: TWO_PANE_HEIGHT, minHeight: 0 }}>
      {/* Left — session + box list */}
      <div style={{ background: C.dark, border: '1px solid rgba(166,120,90,0.25)', borderRadius: 4, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '1rem', borderBottom: '1px solid rgba(166,120,90,0.2)' }}>
          <div style={{ marginBottom: '0.65rem' }}>
            <label style={LABEL}>Customer</label>
            <input style={INPUT} value={customer} onChange={e => setCustomer(e.target.value)} placeholder="Customer name" />
          </div>
          <div style={{ marginBottom: '0.75rem' }}>
            <label style={LABEL}>Pack Date</label>
            <input type="date" style={INPUT} value={date} onChange={e => setDate(e.target.value)} />
          </div>
          {/* Label flags */}
          <div style={{ marginBottom: '0.65rem' }}>
            <label style={LABEL}>Label Options</label>
            <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
              {([
                { k: 'usda_bug'      as keyof LabelFlags, label: 'USDA Bug'       },
                { k: 'retail_exempt' as keyof LabelFlags, label: 'Retail Exempt'  },
                { k: 'not_for_sale'  as keyof LabelFlags, label: 'Not For Sale'   },
              ] as { k: keyof LabelFlags; label: string }[]).map(({ k, label }) => {
                // Retail exempt is why the product was NOT inspected, so the
                // label drops the mark whatever this says (lib/label.ts
                // marksInspection). Show the chip as overridden rather than
                // leaving it lit and lying.
                const overridden = k === 'usda_bug' && labelFlags.retail_exempt
                const on = labelFlags[k] && !overridden
                return (
                <button key={k} onClick={() => toggleFlag(k)}
                  title={overridden ? 'Retail exempt — no USDA mark prints on this label.' : undefined}
                  style={{
                  background: on ? 'rgba(201,168,130,0.25)' : 'rgba(255,255,255,0.04)',
                  border: `1px solid ${on ? C.tan : 'rgba(166,120,90,0.2)'}`,
                  color: on ? C.cream : C.lightBrown,
                  borderRadius: 3, padding: '0.3rem 0.6rem', fontSize: '0.72rem',
                  cursor: 'pointer', fontWeight: on ? 700 : 400,
                  textDecoration: overridden ? 'line-through' : undefined,
                  opacity: overridden ? 0.55 : 1,
                }}>
                  {on ? '✓ ' : ''}{label}
                </button>
              )})}
            </div>
            {labelFlags.retail_exempt && (
              <div style={{ fontSize: '0.66rem', color: C.lightBrown, marginTop: '0.35rem' }}>
                Retail exempt — labels print RETAIL EXEMPT and no USDA mark.
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button style={{ ...BTN(C.tan), flex: 1, fontSize: '0.8rem' }} onClick={() => addBox(false)} disabled={saving}>
              + Add Box
            </button>
            <button
              style={{ ...BTN('transparent', C.tan), border: `1px solid ${C.tan}`, fontSize: '0.8rem', whiteSpace: 'nowrap' }}
              onClick={() => addBox(true)}
              title="Mark as final box (adds â˜… to label)"
              disabled={saving}
            >
              + Final â˜…
            </button>
          </div>
        </div>

        <div style={{ overflowY: 'auto', flex: 1 }}>
          {boxes.length === 0 && (
            <p style={{ color: C.lightBrown, fontSize: '0.82rem', padding: '1.25rem', textAlign: 'center' }}>
              Enter customer name then add a box
            </p>
          )}
          {boxes.map(box => (
            <div
              key={box.id}
              onClick={() => { setActiveBox(box); if (!scans[box.id]) loadScans(box.id) }}
              style={{
                padding: '0.85rem 1rem', borderBottom: '1px solid rgba(166,120,90,0.1)',
                cursor: 'pointer', background: activeBox?.id === box.id ? 'rgba(166,120,90,0.12)' : 'transparent',
                transition: 'background 0.15s',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: C.cream, fontWeight: 700, fontSize: '0.95rem' }}>
                  Box {box.box_number}{box.is_final ? ' â˜…' : ''}
                </span>
                <span style={{ fontSize: '0.7rem', fontWeight: 700, borderRadius: 99, padding: '2px 8px',
                  background: box.is_closed ? 'rgba(76,175,80,0.2)' : 'rgba(201,168,130,0.2)',
                  color: box.is_closed ? C.green : C.tan,
                }}>
                  {box.is_closed ? 'Closed' : 'Open'}
                </span>
              </div>
              {box.is_closed && (
                <div style={{ fontSize: '0.75rem', color: C.lightBrown, marginTop: '0.2rem' }}>
                  {box.total_cuts} cuts · {Number(box.total_weight_lbs).toFixed(2)} lbs
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Session totals */}
        {boxes.length > 0 && (
          <div style={{ padding: '0.85rem 1rem', borderTop: '1px solid rgba(166,120,90,0.2)', fontSize: '0.78rem', color: C.lightBrown }}>
            {boxes.length} box{boxes.length !== 1 ? 'es' : ''} ·&nbsp;
            {boxes.filter(b => b.is_closed).reduce((s, b) => s + (Number(b.total_weight_lbs) || 0), 0).toFixed(2)} lbs closed
          </div>
        )}
      </div>

      {/* Right — active box */}
      <div style={{ background: C.dark, border: '1px solid rgba(166,120,90,0.25)', borderRadius: 4, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {!activeBox ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: C.lightBrown, fontSize: '0.9rem' }}>
            ← Select or create a box
          </div>
        ) : (
          <>
            {/* Box header */}
            <div style={{ padding: '0.85rem 1.25rem', borderBottom: '1px solid rgba(166,120,90,0.2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <span style={{ color: C.cream, fontWeight: 700, fontSize: '1rem' }}>
                  Box {activeBox.box_number}{activeBox.is_final ? ' â˜…' : ''}
                </span>
                <span style={{ color: C.lightBrown, fontSize: '0.8rem', marginLeft: '0.75rem' }}>{customer}</span>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button onClick={() => printLabel(activeBox)} style={{ ...BTN('transparent', C.tan), border: `1px solid ${C.tan}`, fontSize: '0.78rem' }}>
                  ðŸ–¨ Print Label
                </button>
                {!activeBox.is_closed && (
                  <button onClick={() => closeBox(activeBox)} style={{ ...BTN(C.green, C.dark), fontSize: '0.78rem' }}>
                    ✓ Close Box
                  </button>
                )}
                <button onClick={() => deleteBox(activeBox)} style={{ ...BTN('transparent', C.lightBrown), border: '1px solid rgba(166,120,90,0.2)', fontSize: '0.78rem' }}>
                  ×
                </button>
              </div>
            </div>

            {/* Add item form — only for open boxes */}
            {!activeBox.is_closed && (
              <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid rgba(166,120,90,0.15)', background: 'rgba(0,0,0,0.15)' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 80px 80px', gap: '0.5rem', alignItems: 'end' }}>
                  <div>
                    <label style={LABEL}>Barcode / PLU #</label>
                    <input
                      ref={pluRef}
                      style={{ ...INPUT, fontFamily: 'monospace',
                        borderColor: pluStatus === 'found' ? 'rgba(76,175,80,0.6)' : pluStatus === 'notfound' ? 'rgba(229,62,62,0.5)' : 'rgba(166,120,90,0.35)',
                      }}
                      value={pluInput}
                      onChange={e => {
                        const v = e.target.value
                        setPluInput(v)
                        setPluStatus('idle')
                        // Auto-fire on 13-digit EAN-13 scan
                        if (/^\d{13}$/.test(v) && parseEAN13(v)) {
                          scanBarcode(v)
                          setPluInput('')
                        }
                      }}
                      onKeyDown={e => {
                        if (e.key === 'Enter' || e.key === 'Tab') {
                          e.preventDefault()
                          if (/^\d{13}$/.test(pluInput) && parseEAN13(pluInput)) {
                            scanBarcode(pluInput); setPluInput('')
                          } else {
                            lookupPlu(pluInput)
                          }
                        }
                      }}
                      placeholder="Scan barcode or type PLU â†’ Enter"
                    />
                  </div>
                  <div>
                    <label style={LABEL}>
                      {pluStatus === 'found' ? <span style={{ color: C.green }}>✓ {itemName}</span> : 'Item Name'}
                    </label>
                    <input style={INPUT} value={itemName} onChange={e => setItemName(e.target.value)} placeholder="Name" />
                  </div>
                  <div>
                    <label style={LABEL}>Wt (lbs)</label>
                    <input ref={weightRef} type="number" step="0.001" style={INPUT} value={weight} onChange={e => setWeight(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addScan() } }} placeholder="0.00" />
                  </div>
                  <div>
                    <label style={LABEL}>Qty</label>
                    <input type="number" min="1" style={INPUT} value={qty} onChange={e => setQty(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addScan() } }} />
                  </div>
                </div>
                <button
                  style={{ ...BTN(itemName && weight ? C.tan : C.medBrown), marginTop: '0.65rem', opacity: itemName && weight ? 1 : 0.5 }}
                  onClick={addScan}
                  disabled={saving || !itemName || !weight}
                >
                  + Add to Box
                </button>
              </div>
            )}

            {/* Scan list */}
            <div style={{ overflowY: 'auto', flex: 1 }}>
              {activeScans.length === 0 && (
                <div style={{ padding: '2rem', textAlign: 'center', color: C.lightBrown, fontSize: '0.85rem' }}>
                  {activeBox.is_closed ? 'Box is closed' : 'No items yet — add items above'}
                </div>
              )}
              {activeScans.map(scan => (
                <div key={scan.id} style={{ padding: '0.75rem 1.25rem', borderBottom: '1px solid rgba(166,120,90,0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <span style={{ color: C.cream, fontSize: '0.88rem' }}>
                      <span style={{ color: C.lightBrown, marginRight: '0.5rem' }}>({scan.quantity ?? 1})</span>
                      {scan.item_name || scan.plu_number}
                    </span>
                    {scan.plu_number && <span style={{ color: C.lightBrown, fontSize: '0.75rem', marginLeft: '0.5rem', fontFamily: 'monospace' }}>PLU {scan.plu_number}</span>}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <span style={{ color: C.tan, fontWeight: 600 }}>{Number(scan.weight_lbs).toFixed(3)} lb</span>
                    {!activeBox.is_closed && (
                      <button onClick={() => removeScan(activeBox.id, scan.id)} style={{ background: 'none', border: 'none', color: C.lightBrown, cursor: 'pointer', fontSize: '1rem' }}>×</button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Box footer */}
            <div style={{ padding: '0.75rem 1.25rem', borderTop: '1px solid rgba(166,120,90,0.2)', display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
              <span style={{ color: C.lightBrown }}>{activeScans.length} line{activeScans.length !== 1 ? 's' : ''}</span>
              <span style={{ color: C.cream, fontWeight: 600 }}>{activeTotal.toFixed(3)} lbs total</span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}


// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// PAGE
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
interface TabDef { id: Tab; label: string }

// Used every shift — always visible.
const DAILY_TABS: TabDef[] = [
  { id: 'cut-schedule', label: '📋 Cut Schedule' },
  { id: 'in-cure',      label: '🧊 In Cure' },
  { id: 'box-labels',   label: '🏷️ Box Labels' },
  { id: 'browser',      label: '🔪 PLU Browser' },
]
// Catalog plumbing — opened occasionally, so they hide behind a menu.
const INTEGRATION_TABS: TabDef[] = [
  { id: 'alignment',    label: '🔗 Alignment' },
  { id: 'clover',       label: '🍀 Clover' },
  { id: 'quickbooks',   label: '📗 QuickBooks' },
]
const PLU_TOOL_TABS: TabDef[] = [
  { id: 'export',       label: '📤 Export' },
  { id: 'cleanup',      label: '🧹 Cleanup' },
  { id: 'upload',       label: '📂 Upload File' },
]

// Dropdown of tabs. Collapsed it shows the group name, or the open tab's label
// when the active tab is one of its own, so you can always see where you are.
function TabMenu({ label, items, tab, setTab }: {
  label: string; items: TabDef[]; tab: Tab; setTab: (t: Tab) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const active = items.find(i => i.id === tab)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button onClick={() => setOpen(o => !o)} style={{
        padding: '0.45rem 0.9rem', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600,
        background: active ? C.medBrown : 'rgba(255,255,255,0.05)',
        border: '1px solid rgba(166,120,90,0.25)', borderRadius: 4,
        color: active ? C.cream : C.lightBrown,
        letterSpacing: '0.04em', whiteSpace: 'nowrap',
      }}>
        {active ? active.label : label} <span style={{ fontSize: '0.65rem' }}>▾</span>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', right: 0, zIndex: 40, minWidth: 180,
          background: C.dark, border: '1px solid rgba(166,120,90,0.35)', borderRadius: 4,
          boxShadow: '0 8px 24px rgba(0,0,0,0.5)', overflow: 'hidden',
        }}>
          {items.map(i => (
            <button key={i.id} onClick={() => { setTab(i.id); setOpen(false) }} style={{
              display: 'block', width: '100%', textAlign: 'left',
              padding: '0.55rem 0.95rem', border: 'none', cursor: 'pointer',
              fontSize: '0.8rem', fontWeight: 600, letterSpacing: '0.04em',
              background: tab === i.id ? C.medBrown : 'transparent',
              color: tab === i.id ? C.cream : C.lightBrown,
            }}>{i.label}</button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function ProcessingPage() {
  const [tab, setTab] = useState<Tab>('browser')

  // Land on the QuickBooks tab when returning from the QBO OAuth redirect
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has('qbo')) setTab('quickbooks')
  }, [])

  return (
    <div style={{ minHeight: '100vh', background: 'var(--dark-brown)', display: 'flex', flexDirection: 'column' }}>
      <header style={{ background: 'var(--dark)', borderBottom: '1px solid rgba(166,120,90,0.3)', padding: '0 2rem', height: '64px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <Link href="/" style={{ color: C.lightBrown, textDecoration: 'none', fontSize: '0.82rem' }}>← Dashboard</Link>
          <span style={{ color: 'rgba(166,120,90,0.4)' }}>|</span>
          <h1 style={{ fontFamily: 'Georgia, serif', fontSize: '1.1rem', fontWeight: 700, color: C.cream, letterSpacing: '0.08em', textTransform: 'uppercase', margin: 0 }}>Processing</h1>
          <span style={{ color: 'rgba(166,120,90,0.4)' }}>|</span>
          <Link href="/scanner" style={{ background: C.green, color: C.dark, textDecoration: 'none', fontSize: '0.78rem', fontWeight: 700, padding: '0.3rem 0.75rem', borderRadius: 3, letterSpacing: '0.04em' }}>🔍 Processing Scanner ↗</Link>
          <Link href="/plu-book" style={{ background: C.tan, color: C.dark, textDecoration: 'none', fontSize: '0.78rem', fontWeight: 700, padding: '0.3rem 0.75rem', borderRadius: 3, letterSpacing: '0.04em' }}>📖 Barcode Book ↗</Link>
        </div>
        {/* Day-to-day tabs stay flat; the catalog-plumbing tabs live behind two
            menus so the header is 5 controls wide instead of 9. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <div style={{ display: 'flex', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(166,120,90,0.25)', borderRadius: 4, overflow: 'hidden' }}>
            {DAILY_TABS.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)} style={{
                padding: '0.45rem 1.1rem', border: 'none', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600,
                background: tab === t.id ? C.medBrown : 'transparent',
                color: tab === t.id ? C.cream : C.lightBrown,
                letterSpacing: '0.04em', transition: 'background 0.15s',
              }}>{t.label}</button>
            ))}
          </div>
          <TabMenu label="🔗 Integrations" items={INTEGRATION_TABS} tab={tab} setTab={setTab} />
          <TabMenu label="🗂 PLU Tools"    items={PLU_TOOL_TABS}    tab={tab} setTab={setTab} />
        </div>
      </header>

      <main style={{ flex: 1, padding: '1.5rem 2rem', maxWidth: '1400px', width: '100%', margin: '0 auto', boxSizing: 'border-box', display: 'flex', flexDirection: 'column' }}>
        {tab === 'cut-schedule' && <CutScheduleTab />}
        {tab === 'in-cure'      && <CureTagsTab />}
        {tab === 'box-labels'   && <BoxLabelsTab />}
        {tab === 'browser'      && <BrowserTab />}
        {tab === 'alignment'    && <AlignmentTab />}
        {tab === 'clover'       && <CloverTab />}
        {tab === 'quickbooks'   && <QuickBooksTab />}
        {tab === 'export'       && <ExportTab />}
        {tab === 'cleanup'      && <CleanupTab />}
        {tab === 'upload'       && <UploadTab />}
      </main>

      <footer style={{ background: 'var(--dark)', borderTop: '1px solid rgba(166,120,90,0.2)', padding: '0.5rem 2rem', textAlign: 'center', fontSize: '0.72rem', color: C.lightBrown, flexShrink: 0 }}>
        Cowboy Meat Company · 1109 Front St, Forsyth MT · (406) 346-7660
      </footer>
    </div>
  )
}
