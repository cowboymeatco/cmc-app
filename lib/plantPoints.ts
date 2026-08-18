// Fixed points in the building — drains, water, electrical, and the rest.
//
// Everything here is shared between the capture flow and the map so the two
// can't disagree about what a drain is called or what colour it draws.

export const POINT_KINDS = [
  'drain', 'hose_station', 'hand_sink', 'outlet', 'panel',
  'footbath', 'air_line', 'steam', 'floor_sink',
  'thermometer', 'fire_extinguisher', 'other',
] as const
export type PointKind = typeof POINT_KINDS[number]

export interface PointKindDef {
  label:  string
  icon:   string
  color:  string
  /** Which layer toggle it sits under on the map. */
  layer:  'water' | 'electrical' | 'sanitation' | 'safety'
  /** Shown under the name during capture, so people know what counts as one. */
  hint?:  string
}

export const POINT_KIND: Record<PointKind, PointKindDef> = {
  drain: {
    label: 'Drain', icon: '🕳️', color: '#60A5FA', layer: 'sanitation',
    hint: 'Floor drains. Mark it as a swab site if it is one — drains are where Listeria lives.',
  },
  floor_sink: {
    label: 'Floor sink', icon: '▫️', color: '#60A5FA', layer: 'sanitation',
  },
  hose_station: {
    label: 'Hose station', icon: '🚿', color: '#4CAF50', layer: 'water',
    hint: 'Hose bibs and wash-down points. Note whether hot water is available.',
  },
  hand_sink: {
    label: 'Hand sink', icon: '🧼', color: '#4CAF50', layer: 'water',
    hint: 'Stocked hand sinks are a pre-op check — soap, towels, hot water.',
  },
  footbath: {
    label: 'Footbath', icon: '🥾', color: '#4CAF50', layer: 'sanitation',
  },
  outlet: {
    label: 'Outlet', icon: '🔌', color: '#F59E0B', layer: 'electrical',
    hint: 'Where a foamer or a light can actually be plugged in.',
  },
  panel: {
    label: 'Panel / disconnect', icon: '⚡', color: '#EF4444', layer: 'electrical',
    hint: 'Breaker panels and machine disconnects — this is what gets locked out before a teardown.',
  },
  air_line: {
    label: 'Air line', icon: '💨', color: '#A78BFA', layer: 'electrical',
  },
  steam: {
    label: 'Steam', icon: '♨️', color: '#A78BFA', layer: 'water',
  },
  thermometer: {
    label: 'Thermometer', icon: '🌡️', color: '#C9A882', layer: 'safety',
  },
  fire_extinguisher: {
    label: 'Fire extinguisher', icon: '🧯', color: '#EF4444', layer: 'safety',
  },
  other: {
    label: 'Other', icon: '📍', color: '#A6785A', layer: 'safety',
  },
}

export const LAYERS = ['sanitation', 'water', 'electrical', 'safety'] as const
export type Layer = typeof LAYERS[number]

export const LAYER_LABEL: Record<Layer, string> = {
  sanitation: 'Drains & sanitation',
  water:      'Water',
  electrical: 'Electrical & air',
  safety:     'Safety & other',
}

export interface PlantPoint {
  id: string
  area_id: string | null
  kind: PointKind
  label: string | null
  map_x: number | null
  map_y: number | null
  photo_url: string | null
  notes: string | null
  attributes: Record<string, unknown>
  swab_site: boolean
  last_swabbed_on: string | null
  active: boolean
}

/** What to call a point when it has no label of its own. */
export function pointName(p: Pick<PlantPoint, 'kind' | 'label'>): string {
  return p.label?.trim() || POINT_KIND[p.kind].label
}

/**
 * Days since a swab site was last swabbed — null when it has never been, or
 * when the point isn't a swab site at all.
 *
 * Deliberately not turned into a pass/fail or a due date. Swab frequency comes
 * from the Lm Program, not from this app, and inventing an interval here would
 * put a number in front of an inspector that no written program supports.
 */
export function daysSinceSwab(
  p: Pick<PlantPoint, 'swab_site' | 'last_swabbed_on'>,
  todayISO: string,
): number | null {
  if (!p.swab_site || !p.last_swabbed_on) return null
  return Math.floor((Date.parse(todayISO) - Date.parse(p.last_swabbed_on)) / 86_400_000)
}

/** Group points by the layer their kind belongs to. */
export function byLayer(points: PlantPoint[]): Record<Layer, PlantPoint[]> {
  const out = { sanitation: [], water: [], electrical: [], safety: [] } as Record<Layer, PlantPoint[]>
  for (const p of points) out[POINT_KIND[p.kind].layer].push(p)
  return out
}
