// What's actually on the Hobart scales, set against what the app thinks.
//
// The kiosk reads each scale back (scripts/2026-09-26_scale_reads.sql): every
// PLU record with its label format, and every label format with the logos and
// text in it. This turns those reads into the handful of questions the office
// actually has — is the scale missing something we sell, holding something we
// retired, printing an item on a label that doesn't exist, and is a producer's
// set really loaded. Pure: no database, so it can be checked against a real read.

export interface ScalePlu { plu_number: string; item_name: string | null; label_format: string | null }
export interface ScaleFormat { format_number: string; internal_name: string | null; texts: string[] }
export interface ScaleRead {
  scale_ip: string
  plu_read_at: string | null
  label_read_at: string | null
  plus: ScalePlu[] | null        // null = never read
  formats: ScaleFormat[] | null  // null = never read
}
export interface AppPlu {
  plu_number: string; item_name: string; active: boolean; price: number | null
  scale_l1: string | null        // ht_skeleton.l1 — what the app last captured
}
export interface AppProducerSet {
  name: string; label_format: string | null; loaded_at: string | null
  plus: { plu_number: string; house_plu: string }[]
}

// The push only sends items with a real price; $0.01 is the deliberate
// placeholder for things meant to stay off the scale (see the Processing page).
export const pushesToScale = (p: AppPlu) => p.active && p.price != null && Number(p.price) > 0.01

export interface ScaleCompare {
  scales: { ip: string; plu_read_at: string | null; label_read_at: string | null; plu_count: number | null; format_count: number | null }[]
  formats: { number: string; internal_name: string | null; texts: string[]; scales: string[]; plus_using: number }[]
  missingFromScale: { plu: string; name: string; missing: string[] }[]
  notInApp: { plu: string; name: string; scales: string[] }[]
  retiredOnScale: { plu: string; name: string; scales: string[] }[]
  unknownFormat: { plu: string; name: string; format: string; scales: string[] }[]
  differsFromApp: { plu: string; name: string; app: string; scale: string; scales: string[] }[]
  differsBetweenScales: { plu: string; name: string; byScale: Record<string, string> }[]
  producerSets: {
    name: string; label_format: string | null; format_texts: string[]; loaded_at: string | null
    total: number
    byScale: { ip: string; found: number; format_on_scale: boolean | null }[]
  }[]
}

const num = (a: string, b: string) => (Number(a) - Number(b)) || a.localeCompare(b)

export function compareScales(reads: ScaleRead[], app: AppPlu[], sets: AppProducerSet[]): ScaleCompare {
  const appBy = new Map(app.map(p => [p.plu_number, p]))
  const producerPlus = new Set(sets.flatMap(s => s.plus.map(p => p.plu_number)))
  const withPlus = reads.filter(r => r.plus)
  const withFormats = reads.filter(r => r.formats)

  // plu -> ip -> scale record
  const onScale = new Map<string, Map<string, ScalePlu>>()
  for (const r of withPlus) {
    for (const p of r.plus!) {
      if (!onScale.has(p.plu_number)) onScale.set(p.plu_number, new Map())
      onScale.get(p.plu_number)!.set(r.scale_ip, p)
    }
  }
  const formatsOn = new Map(withFormats.map(r => [r.scale_ip, new Set(r.formats!.map(f => f.format_number))]))
  const nameOf = (plu: string) => appBy.get(plu)?.item_name ?? [...(onScale.get(plu)?.values() ?? [])][0]?.item_name ?? ''

  // Label formats, once each, with who holds them and how many PLUs print on them.
  const fmt = new Map<string, ScaleCompare['formats'][number]>()
  for (const r of withFormats) {
    for (const f of r.formats!) {
      const cur = fmt.get(f.format_number) ?? { number: f.format_number, internal_name: f.internal_name, texts: f.texts, scales: [], plus_using: 0 }
      cur.scales.push(r.scale_ip)
      fmt.set(f.format_number, cur)
    }
  }
  const usedBy = new Map<string, Set<string>>()
  for (const [plu, by] of onScale) for (const p of by.values()) {
    if (!p.label_format) continue
    if (!usedBy.has(p.label_format)) usedBy.set(p.label_format, new Set())
    usedBy.get(p.label_format)!.add(plu)
  }
  for (const f of fmt.values()) f.plus_using = usedBy.get(f.number)?.size ?? 0

  const missingFromScale = app.filter(pushesToScale).map(p => ({
    plu: p.plu_number, name: p.item_name,
    missing: withPlus.filter(r => !onScale.get(p.plu_number)?.has(r.scale_ip)).map(r => r.scale_ip),
  })).filter(x => x.missing.length)

  const notInApp: ScaleCompare['notInApp'] = []
  const retiredOnScale: ScaleCompare['retiredOnScale'] = []
  const unknownFormat: ScaleCompare['unknownFormat'] = []
  const differsFromApp: ScaleCompare['differsFromApp'] = []
  const differsBetweenScales: ScaleCompare['differsBetweenScales'] = []
  for (const [plu, by] of onScale) {
    const ips = [...by.keys()]
    const a = appBy.get(plu)
    if (!a && !producerPlus.has(plu)) notInApp.push({ plu, name: nameOf(plu), scales: ips })
    if (a && !a.active) retiredOnScale.push({ plu, name: nameOf(plu), scales: ips })

    // A format the scale itself doesn't have — prints on whatever the scale
    // falls back to. Only judged where that scale's formats have been read.
    const bad = new Map<string, string[]>()
    for (const [ip, p] of by) {
      const known = formatsOn.get(ip)
      if (known && p.label_format && !known.has(p.label_format)) {
        bad.set(p.label_format, [...(bad.get(p.label_format) ?? []), ip])
      }
    }
    for (const [format, s] of bad) unknownFormat.push({ plu, name: nameOf(plu), format, scales: s })

    const l1s = new Map<string, string[]>()
    for (const [ip, p] of by) {
      const k = p.label_format ?? ''
      l1s.set(k, [...(l1s.get(k) ?? []), ip])
    }
    if (l1s.size > 1) {
      differsBetweenScales.push({ plu, name: nameOf(plu), byScale: Object.fromEntries([...by].map(([ip, p]) => [ip, p.label_format ?? ''])) })
    }
    if (a?.scale_l1) {
      for (const [k, s] of l1s) if (k && k !== a.scale_l1) differsFromApp.push({ plu, name: nameOf(plu), app: a.scale_l1, scale: k, scales: s })
    }
  }

  const producerSets = sets.map(s => ({
    name: s.name, label_format: s.label_format, loaded_at: s.loaded_at,
    format_texts: s.label_format ? (fmt.get(s.label_format)?.texts ?? []) : [],
    total: s.plus.length,
    byScale: reads.map(r => ({
      ip: r.scale_ip,
      found: r.plus ? s.plus.filter(p => onScale.get(p.plu_number)?.has(r.scale_ip)).length : 0,
      format_on_scale: s.label_format && formatsOn.has(r.scale_ip) ? formatsOn.get(r.scale_ip)!.has(s.label_format) : null,
    })),
  }))

  const byPlu = (a: { plu: string }, b: { plu: string }) => num(a.plu, b.plu)
  return {
    scales: reads.map(r => ({
      ip: r.scale_ip, plu_read_at: r.plu_read_at, label_read_at: r.label_read_at,
      plu_count: r.plus?.length ?? null, format_count: r.formats?.length ?? null,
    })),
    formats: [...fmt.values()].sort((a, b) => num(a.number, b.number)),
    missingFromScale: missingFromScale.sort(byPlu),
    notInApp: notInApp.sort(byPlu),
    retiredOnScale: retiredOnScale.sort(byPlu),
    unknownFormat: unknownFormat.sort(byPlu),
    differsFromApp: differsFromApp.sort(byPlu),
    differsBetweenScales: differsBetweenScales.sort(byPlu),
    producerSets,
  }
}
