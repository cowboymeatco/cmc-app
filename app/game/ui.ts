// Shared chrome for the wild game module — the same palette and control styles
// the receiving and processing screens use, pulled out so the four tabs cannot
// drift apart from each other.

export const C = {
  dark:       '#1A0A04',
  darkBrown:  '#351E0E',
  medBrown:   '#75471B',
  lightBrown: '#A6785A',
  tan:        '#C9A882',
  cream:      '#F2E8D9',
  green:      '#4CAF50',
  red:        '#E53E3E',
  blue:       '#3B82F6',
  yellow:     '#D97706',
  purple:     '#A78BFA',
  orange:     '#F97316',
}

export const INPUT: React.CSSProperties = {
  width: '100%', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(166,120,90,0.35)',
  borderRadius: 3, padding: '0.5rem 0.75rem', color: C.cream, fontSize: '0.88rem',
  outline: 'none', boxSizing: 'border-box',
}

export const LABEL: React.CSSProperties = {
  display: 'block', fontSize: '0.72rem', color: C.lightBrown,
  textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.3rem',
}

export const BTN = (bg: string, color = C.dark): React.CSSProperties => ({
  background: bg, color, border: 'none', borderRadius: 3,
  padding: '0.55rem 1.2rem', fontSize: '0.85rem', fontWeight: 600,
  cursor: 'pointer', letterSpacing: '0.04em',
})

export const CARD: React.CSSProperties = {
  background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(166,120,90,0.22)',
  borderRadius: 4, padding: '1rem',
}

// ── Status ────────────────────────────────────────────────────────────────
// These are the plant's own stations — Receiving, Processing, Value Add,
// Freezer — not a private vocabulary for game. Somebody who knows where a beef
// is knows where a hunter's elk is.
//
// Colours match the modules they name: Receiving blue, Processing green, Value
// Add orange, matching the dashboard tiles. Red is reserved for abandoned,
// which is the only status that is a problem rather than a place.
export const STATUS_META: Record<string, { label: string; color: string; short: string }> = {
  receiving:  { label: 'Receiving',  color: '#60A5FA', short: 'RECV' },
  processing: { label: 'Processing', color: '#4CAF50', short: 'PROC' },
  value_add:  { label: 'Value Add',  color: '#F97316', short: 'VA' },
  freezer:    { label: 'Freezer',    color: '#7DD3FC', short: 'FRZ' },
  picked_up:  { label: 'Picked up',  color: '#5A5A5A', short: 'GONE' },
  abandoned:  { label: 'Abandoned',  color: '#E53E3E', short: 'ABND' },
}

// The order it moves through the building. 'abandoned' is not in the flow — it
// is somewhere an animal ends up, never somewhere it heads.
export const STATUS_FLOW = ['receiving', 'processing', 'value_add', 'freezer', 'picked_up']

export const SPECIES = ['Deer', 'Elk', 'Antelope', 'Buffalo', 'Moose', 'Bear', 'Sheep', 'Goat', 'Other'] as const

// Sex matters for a game animal mostly because it is how a hunter identifies
// which of their two tags this was — "the cow elk", not "the 480 lb one".
export const SEX_BY_SPECIES: Record<string, string[]> = {
  Deer:     ['Buck', 'Doe'],
  Elk:      ['Bull', 'Cow'],
  Antelope: ['Buck', 'Doe'],
  Buffalo:  ['Bull', 'Cow'],
  Moose:    ['Bull', 'Cow'],
  Bear:     ['Boar', 'Sow'],
  Sheep:    ['Ram', 'Ewe'],
  Goat:     ['Billy', 'Nanny'],
  Other:    ['Male', 'Female'],
}

export const CONDITIONS = ['Whole - Hide On', 'Whole - Skinned', 'Quartered', 'Boned Out', 'Other'] as const

export const money = (n: number) => `$${n.toFixed(2)}`
export const lbs   = (n: number | null | undefined) => (n == null ? '—' : `${Number(n).toFixed(1)} lb`)

/** Days an animal has been in the building. The number that drives phone calls. */
export function daysHeld(receivedAt: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(receivedAt).getTime()) / 86400000))
}

/** A YYYY-MM-DD as a short human date, noon-anchored so it cannot shift a day. */
export const dateLabelSafe = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

/** Open a printable document in its own window. */
export function printHTML(html: string) {
  const w = window.open('', '_blank', 'width=820,height=1000')
  if (!w) { alert('Allow pop-ups to print.'); return }
  w.document.write(html)
  w.document.close()
}
