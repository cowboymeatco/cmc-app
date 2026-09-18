// What a primal actually says, as data.
//
// The printed cut card has been the cut room's only copy of this since the v2
// wizard landed: v2CardPages built the primal sections straight into an HTML
// string, so the answers only existed as markup. Putting the same card on the
// wall TVs meant either rebuilding that logic a second time or pulling it out
// here — and a wall that says "Roast" where the paper in the cutter's hand says
// "Grind" is worse than either screen being wrong on its own. Same reason
// buildPackList is built in one place for the packaging sheet and the scanner.
//
// So the sections are built once, as structure, and rendered twice: to HTML for
// the printable card (app/cutting-instructions), and to React for the cut room
// displays (app/display). Labels keep the two leading spaces the printed card
// uses to indent add-on rows — the HTML renderer relies on them staying put,
// and the screen renderer trims them and leans on `addon` instead.

import {
  BONE_IN_FILET_THICKNESS, beefTrimCutterRows, bellyRows, brisketLabel, fracThick,
  hamRows, isWholeAnimal, lgTrimLabel, loinFields, mergeSides, porkTrimCutterRows,
  ribeyeAdds, roastOr, shoulderFields, sidePair, smokehouseRows, smokehouseTotalLbs,
  stdThick, trimIsBagged, v2fmt,
} from '@/lib/packList'

export interface CutRow {
  /** Printed label, add-on rows indented by two spaces. */
  label: string
  value: string
  addon: boolean
}

export interface CutSection {
  title: string
  rows: CutRow[]
}

export interface PrimalColor { bar: string; text: string; tint: string }

// Primal color coding for the cutting table (Chris): chuck green,
// rib & plate yellow, rest of the beef red
export const PRIMAL_COLORS: Record<string, PrimalColor> = {
  'Chuck':              { bar: '#2e7d32', text: '#ffffff', tint: '#edf5ee' },
  'Plate & Short Ribs': { bar: '#f2c200', text: '#4a3800', tint: '#fdf8e0' },
  'Rib':                { bar: '#f2c200', text: '#4a3800', tint: '#fdf8e0' },
  'Short Loin':         { bar: '#b71c1c', text: '#ffffff', tint: '#fbecec' },
  'Sirloin':            { bar: '#b71c1c', text: '#ffffff', tint: '#fbecec' },
  'Flank':              { bar: '#b71c1c', text: '#ffffff', tint: '#fbecec' },
  'Round':              { bar: '#b71c1c', text: '#ffffff', tint: '#fbecec' },
}

// Leg steaks carry a thickness and pack count, and a split pair only needs one
// side asking for them.
export function lgLegSteaks(leg?: { cut?: string; cut2?: string | null } | null): boolean {
  return leg?.cut === 'leg-steaks' || leg?.cut2 === 'leg-steaks'
}

// Bone-in and boneless short loins name different cuts, and only boneless can
// produce a Filet row, which is exactly why the merge in the caller matters.
// `f` formats a cut value (the print and detail renderers format differently).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function shortLoinFields(sl: any, f: (v: string) => string, t: (v: string) => string): Array<[string, string]> {
  if (sl?.path === 'bone-in') return [
    ['T-Bone / Porterhouse', t(sl.tBoneThickness ?? '')],
    ['Filet', BONE_IN_FILET_THICKNESS],
  ]
  if (sl?.path === 'boneless') return [
    // One name per row — "Tenderloin: Filet Mignon" read as two cuts (Charlie)
    sl.tenderloin?.cut === 'filet' ? ['Filet', '2"'] : ['Tenderloin', f(sl.tenderloin?.cut ?? '')],
    ['Strip Loin', [f(sl.stripLoin?.cut ?? ''), t(sl.stripLoin?.thickness ?? '')].filter(Boolean).join(' — ')],
  ]
  return []
}

/**
 * Every primal section of one cut card, in printing order.
 *
 * `d` is the cutting instruction's JSONB (`cutting_instructions.data`) and
 * `species` the card's species. A row whose value is blank drops out, and a
 * section left with no rows drops out with it — an unanswered question is not
 * an instruction, and printing it just costs the cutter a line to read past.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildCutSections(d: any, species: string): CutSection[] {
  const sp     = (species || 'Beef').toLowerCase()
  const isBeef = sp === 'beef'
  const isPork = sp === 'pork' || sp === 'hog'
  const isLG   = sp === 'lamb' || sp === 'goat'

  const fmt   = v2fmt
  const thick = (v: string) => fracThick(v)
  const withT = (cut: string, t: string) => [fmt(cut), thick(t)].filter(Boolean).join(' — ')
  const adds  = (arr: string[]) => arr?.length ? arr.map(fmt).join(', ') : ''
  // A per-side roast count doubles when the customer has the whole animal.
  const wholeAnimal = isWholeAnimal(d.portion)
  // Jill's wording: a kept-whole rack reads "Frenched Rack of Lamb/Goat"
  const rackDisplay = (v?: string) => v === 'whole-rack' ? `Frenched Rack of ${sp === 'goat' ? 'Goat' : 'Lamb'}` : fmt(v ?? '')

  const out: CutSection[] = []

  const row = (label: string, value: unknown, addon = false): CutRow | null => {
    const v = value != null ? String(value) : ''
    return v.trim() ? { label, value: v, addon } : null
  }
  const sec = (title: string, rows: (CutRow | null)[]): void => {
    const kept = rows.filter((r): r is CutRow => r != null)
    if (kept.length) out.push({ title, rows: kept })
  }

  // A round sent to jerky carries its flavor; split rounds print both sides. A
  // round taken as roasts carries a count like the arm and the tip do, and that
  // count is per side — but a split round already prints each side on its own,
  // so only the unsplit case doubles for a whole beef.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const roundOne = (r: any, perHalf = false) => r?.cut === 'jerky'
    ? `Jerky${r.jerkyFlavor ? ` — ${fmt(r.jerkyFlavor)}` : ''}`
    : roastOr(r?.cut, r?.roastCount, c => withT(c, r?.thickness ?? ''), perHalf)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const roundVal = (r: any) => r?.round2
    ? sidePair(roundOne(r), roundOne(r.round2))
    : roundOne(r, wholeAnimal)
  // Split rounds can be seasoned on one side and not the other, so each side
  // gets its own add-on line rather than one merged list.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const roundAddonRows = (r: any): (CutRow | null)[] => r?.round2
    ? [
        r.addons?.length        ? row('  Add-ons (1)', adds(r.addons), true)        : null,
        r.round2.addons?.length ? row('  Add-ons (2)', adds(r.round2.addons), true) : null,
      ]
    : [r?.addons?.length ? row('  Add-ons', adds(r.addons), true) : null]

  // No organs on the cut card: the cutters never handle them (Charlie,
  // 2026-07-22). Whatever the customer is keeping still reaches the floor on
  // the packaging sheet, where it's actually packed.

  // Grinding the whole animal: the band up top is the instruction, and no
  // primal section may contradict it — an order that once had cut answers and
  // was later switched to all-grind must not print them (Jill, 2026-07-27).
  if (isBeef && !d.grindWhole) {
    sec('Chuck', [
      row('Brisket', d.brisket?.cut2 ? sidePair(brisketLabel(d.brisket.cut, d.brisket.half, fmt), brisketLabel(d.brisket.cut2, d.brisket.half2, fmt)) : brisketLabel(d.brisket?.cut, d.brisket?.half, fmt)),
      d.brisket?.fat ? row('  Brisket Fat', fmt(d.brisket.fat)) : null,
      row('Shank', fmt(d.shank?.cut)),
      d.shank?.addons?.length ? row('  Add-ons', adds(d.shank.addons), true) : null,
      row('Arm Roast', d.armRoast?.arm2
        ? sidePair(roastOr(d.armRoast.cut, d.armRoast.roastCount, c => withT(c, stdThick(c))), roastOr(d.armRoast.arm2.cut, d.armRoast.arm2.roastCount, c => withT(c, stdThick(c))))
        : roastOr(d.armRoast?.cut, d.armRoast?.roastCount, c => withT(c, stdThick(c)), wholeAnimal)),
      ...(d.armRoast?.arm2
        ? [
            d.armRoast.addons?.length ? row('  Add-ons (1)', adds(d.armRoast.addons), true) : null,
            d.armRoast.arm2.addons?.length ? row('  Add-ons (2)', adds(d.armRoast.arm2.addons), true) : null,
          ]
        : [d.armRoast?.addons?.length ? row('  Add-ons', adds(d.armRoast.addons), true) : null]),
      row('Flat Iron', withT(d.flatIron?.cut ?? '', stdThick(d.flatIron?.cut, 'flat-iron'))),
      row('Chuck Roll', d.chuckRoll?.cut2
        ? sidePair(roastOr(d.chuckRoll.cut, d.chuckRoll.roastCount, c => withT(c, stdThick(c))), roastOr(d.chuckRoll.cut2, d.chuckRoll.roastCount2, c => withT(c, stdThick(c))))
        : roastOr(d.chuckRoll?.cut, d.chuckRoll?.roastCount, c => withT(c, stdThick(c)), wholeAnimal)),
      ...(d.chuckRoll?.cut2
        ? [
            d.chuckRoll.addons?.length ? row('  Add-ons (1)', adds(d.chuckRoll.addons), true) : null,
            d.chuckRoll.addons2?.length ? row('  Add-ons (2)', adds(d.chuckRoll.addons2), true) : null,
          ]
        : [d.chuckRoll?.addons?.length ? row('  Add-ons', adds(d.chuckRoll.addons), true) : null]),
    ])
    sec('Plate & Short Ribs', [
      row('Short Ribs', fmt(d.shortRibs?.cut)),
      d.shortRibs?.addons?.length ? row('  Add-ons', adds(d.shortRibs.addons), true) : null,
      row('Plate', fmt(d.plate?.cut)),
    ])
    // A split ribeye prints one line per side — style and cut together — the same
    // shape the packaging sheet uses. A Style row and a Cut row each carrying
    // "1: … / 2: …" made the cutter read across two rows to work out what side 2
    // actually was (Jill, 2026-07-28).
    const ribeyeLine = (r?: { style?: string | null; cut?: string | null; thickness?: string | null } | null) =>
      [fmt(r?.style ?? ''), withT(r?.cut ?? '', r?.thickness ?? '')].filter(Boolean).join(' · ')
    sec('Rib', d.ribeye?.ribeye2
      ? [
          row('Rib (1)', ribeyeLine(d.ribeye)),
          ribeyeAdds(d.ribeye).length ? row('  Add-ons (1)', adds(ribeyeAdds(d.ribeye)), true) : null,
          row('Rib (2)', ribeyeLine(d.ribeye.ribeye2)),
          ribeyeAdds(d.ribeye.ribeye2).length ? row('  Add-ons (2)', adds(ribeyeAdds(d.ribeye.ribeye2)), true) : null,
        ]
      : [
          row('Style', fmt(d.ribeye?.style)),
          row('Cut', withT(d.ribeye?.cut ?? '', d.ribeye?.thickness ?? '')),
          ribeyeAdds(d.ribeye).length ? row('  Add-ons', adds(ribeyeAdds(d.ribeye)), true) : null,
        ])
    const sl = d.shortLoin ?? {}
    sec('Short Loin', (sl.loin2
      ? mergeSides(shortLoinFields(sl, fmt, thick), shortLoinFields(sl.loin2, fmt, thick))
      : shortLoinFields(sl, fmt, thick)
    ).map(([label, value]) => row(label, value)))
    sec('Sirloin', [
      row('Top Sirloin', withT(d.topSirloin?.cut ?? '', d.topSirloin?.thickness ?? '')),
      d.topSirloin?.addons?.length ? row('  Add-ons', adds(d.topSirloin.addons), true) : null,
      row('Tri Tip', fmt(d.triTip?.cut)),
      d.triTip?.addons?.length ? row('  Add-ons', adds(d.triTip.addons), true) : null,
    ])
    sec('Flank', [
      row('Skirt', fmt(d.skirt?.cut)),
      row('Flank Steak', fmt(d.flank?.cut)),
    ])
    sec('Round', [
      row('Sirloin Tip', d.sirloinTip?.tip2
        ? sidePair(roastOr(d.sirloinTip.cut, d.sirloinTip.roastCount, c => withT(c, d.sirloinTip.thickness ?? '')), roastOr(d.sirloinTip.tip2.cut, d.sirloinTip.tip2.roastCount, c => withT(c, d.sirloinTip.tip2.thickness ?? '')))
        : roastOr(d.sirloinTip?.cut, d.sirloinTip?.roastCount, c => withT(c, d.sirloinTip?.thickness ?? ''), wholeAnimal)),
      ...(d.sirloinTip?.tip2
        ? [
            d.sirloinTip.addons?.length ? row('  Add-ons (1)', adds(d.sirloinTip.addons), true) : null,
            d.sirloinTip.tip2.addons?.length ? row('  Add-ons (2)', adds(d.sirloinTip.tip2.addons), true) : null,
          ]
        : [d.sirloinTip?.addons?.length ? row('  Add-ons', adds(d.sirloinTip.addons), true) : null]),
      row('Bottom Round', roundVal(d.bottomRound)),
      ...roundAddonRows(d.bottomRound),
      d.eyeOfRound?.cut ? row('Eye of Round', withT(d.eyeOfRound.cut, d.eyeOfRound.thickness ?? '')) : null,
      d.rumpRoast?.cut  ? row('Rump Roast',   withT(d.rumpRoast.cut,  d.rumpRoast.thickness  ?? '')) : null,
      row('Top Round', roundVal(d.topRound)),
      ...roundAddonRows(d.topRound),
      row('Round Shank / Marrow', fmt(d.roundShank?.marrow)),
    ])
  }

  if (isBeef) {
    sec(trimIsBagged(d.trim) ? 'Trim' : 'Trim & Ground Beef', beefTrimCutterRows(d.trim).map(([l, v]) => row(l, v)))
  }

  if (isPork && !d.grindWhole) {
    const loin = d.loin ?? {}
    sec('Shoulder', (d.shoulder?.shoulder2
      ? mergeSides(shoulderFields(d.shoulder, fmt, thick), shoulderFields(d.shoulder.shoulder2, fmt, thick))
      : shoulderFields(d.shoulder, fmt, thick)
    ).map(([label, value]) => row(label.startsWith('Add-ons') ? `  ${label}` : label, value, label.startsWith('Add-ons'))))
    sec('Loin', (loin.loin2
      ? mergeSides(loinFields(loin, fmt, thick), loinFields(loin.loin2, fmt, thick))
      : loinFields(loin, fmt, thick)
    ).map(([label, value]) => row(label.startsWith('Add-ons') ? `  ${label}` : label, value, label.startsWith('Add-ons'))))
    // A split belly used to print only side 1 here, so half the instruction
    // never reached the cutter.
    sec('Belly', bellyRows(d.belly).map(([l, v]) => row(l, v)))
    // Hocks come off the ham and always follow its style, so the cut card no
    // longer restates them — the cutter has that from the ham line (Charlie).
    sec('Ham', hamRows(d.ham).map(([l, v]) => row(l, v)))
    sec('Country Style Ribs', [
      row('Country Style Ribs', fmt(d.spareRibs?.cut)),
    ])
  }

  if (isPork) {
    sec(trimIsBagged(d.trim) ? 'Trim' : 'Sausage / Trim', porkTrimCutterRows(d.trim, fmt).map(([l, v]) => row(l, v)))
  }

  if (isLG) {
    sec('Primals', [
      row('Rack',     rackDisplay(d.rack?.cut)),
      row('Loin',     fmt(d.loin?.cut)),
      d.loin?.cut === 'loin-chops' && d.loin?.chopThickness ? row('Chop Thickness', thick(d.loin.chopThickness)) : null,
      d.loin?.cut === 'loin-chops' && d.loin?.chopPack ? row('Per Pack', d.loin.chopPack) : null,
      row('Leg',      sidePair(fmt(d.leg?.cut), fmt(d.leg?.cut2))),
      lgLegSteaks(d.leg) && d.leg?.steakThickness ? row('Steak Thickness', thick(d.leg.steakThickness)) : null,
      lgLegSteaks(d.leg) && d.leg?.steakPack ? row('Per Pack', d.leg.steakPack) : null,
      row('Shoulder', sidePair(fmt(d.shoulder?.cut), fmt(d.shoulder?.cut2))),
      row('Shank',    fmt(d.shank?.cut)),
      d.trim?.style ? row('Trim', lgTrimLabel(d.trim.style, species, d.trim.bagSize)) : null,
    ])
  }

  // Smokehouse on the CUTTER's page too — they're the ones deciding what goes
  // to the grind bucket, so they need the trim total before it's all ground.
  {
    const smokeCardRows = smokehouseRows(d.smokehouse, fmt, d)
    if (smokeCardRows.length) {
      const totalLbs = smokehouseTotalLbs(d.smokehouse)
      sec('Smokehouse', [
        ...smokeCardRows.map(([l, v]) => row(l, v)),
        totalLbs > 0 ? row('Trim to save', `${+totalLbs.toFixed(1)} lbs total`) : null,
      ])
    }
  }

  // A "no thanks" is an answered question, not an instruction — printing it just
  // costs the cutter a section to read past (Charlie, 2026-07-22). Only a yes
  // earns space, and any notes ride along with it.
  if (d.specialty?.interest === 'yes') {
    sec('Specialty Items', [
      row('Interested', 'Yes'),
      d.specialty.notes ? row('Notes', d.specialty.notes) : null,
    ])
  }
  if (d.notes) sec('Special Notes', [row('Notes', d.notes)])

  return out
}

// ── The cut room's own grouping ───────────────────────────────────────────────
//
// The wall TVs sort the same sections into the three colors the cutting table
// already works by, so a glance from across the room lands on the right board
// instead of reading section titles. Anything the color map doesn't name —
// pork, lamb, goat, trim, smokehouse, notes — is "other" and shows last.

export type PrimalBand = 'green' | 'yellow' | 'red' | 'other'

export const BAND_OF: Record<string, PrimalBand> = {
  'Chuck':              'green',
  'Rib':                'yellow',
  'Plate & Short Ribs': 'yellow',
  'Short Loin':         'red',
  'Sirloin':            'red',
  'Flank':              'red',
  'Round':              'red',
}

export function bandOf(title: string): PrimalBand {
  return BAND_OF[title] ?? 'other'
}
