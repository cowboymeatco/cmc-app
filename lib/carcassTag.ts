// Carcass tag barcodes — the one place that knows the grammar.
//
// Three shapes reach a scan gun, all of them printed by us at one time or
// another:
//   YYMMDD-TAG-SIDE   calendar half tag off /harvest  (260514-001-R)
//   YYDDD-TAG[-SIDE]  Julian tag off a pre-printed sheet (26169-06-L)
//   CT-<uuid>         legacy, the harvest_log id itself
// No side suffix means the whole carcass; with one it's a half.
//
// Processing inputs has parsed these since the cut room started scanning
// animals in; Load Out needs the same answer to put a hanging carcass on a
// delivery (Charlie, 2026-09-11), so the grammar lives here rather than in two
// regexes that can drift apart.

export interface ParsedCarcassTag {
  /** The code as scanned, upper-cased. */
  code: string
  /** harvest_log.id, only for the legacy CT- form. */
  legacyId: string | null
  /** ISO date the animal was killed — the other half of the lookup key. */
  harvestDate: string | null
  /** The number written on the tag. */
  tag: string | null
  /** 'L' or 'R' for a half; null for a whole carcass. */
  side: 'L' | 'R' | null
}

export function parseCarcassTag(raw: string): ParsedCarcassTag | null {
  const code = String(raw ?? '').trim().toUpperCase()
  if (!code) return null

  if (/^CT-[0-9A-F-]{36}$/.test(code)) {
    return { code, legacyId: code.slice(3).toLowerCase(), harvestDate: null, tag: null, side: null }
  }

  const cal = code.match(/^(\d{2})(\d{2})(\d{2})-(\w+)-([LR])$/)
  if (cal) {
    return {
      code,
      legacyId: null,
      harvestDate: `20${cal[1]}-${cal[2]}-${cal[3]}`,
      tag: cal[4],
      side: cal[5] as 'L' | 'R',
    }
  }

  const jul = code.match(/^(\d{2})(\d{3})-(\w+?)(?:-([LR]))?$/)
  if (jul) {
    const d = new Date(Date.UTC(2000 + Number(jul[1]), 0, Number(jul[2])))
    return {
      code,
      legacyId: null,
      harvestDate: d.toISOString().slice(0, 10),
      tag: jul[3],
      side: (jul[4] as 'L' | 'R') ?? null,
    }
  }

  return null
}

export const isCarcassTag = (raw: string) => parseCarcassTag(raw) !== null

// What the floor should see the instant the gun beeps, before any lookup:
// "Tag 001 · R half". The animal's species, producer and weight come from the
// database — this is only what the barcode itself says.
export function carcassTagLabel(p: ParsedCarcassTag): string {
  if (p.legacyId) return `Carcass ${p.code.slice(0, 11)}…`
  return `Tag ${p.tag}${p.side ? ` · ${p.side} half` : ''}`
}
