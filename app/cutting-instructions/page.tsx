'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { HarvestAppointment } from '@/lib/types'

// ── Types ─────────────────────────────────────────────────────────────────────

interface RawInstruction {
  id:         string
  created_at: string
  status:     string
  species?:   string   // top-level column — v2 wizard writes species here, not in data
  data:       Record<string, any>
}

// v1 stores species in data; v2 stores it as a top-level column
function speciesOf(ci: RawInstruction): string {
  return ci.data?.species ?? ci.species ?? '—'
}

// The two halves of the app disagree on the word: appointments get booked as
// "Hog" (a couple as "Pork"), while every cutting instruction says "Pork".
// Anything comparing the two has to match on the animal, not the spelling.
const SPECIES_KEY: Record<string, string> = { hog: 'pork', pork: 'pork', beef: 'beef', lamb: 'lamb', goat: 'goat' }
function speciesKey(s?: string | null): string {
  const k = (s ?? '').trim().toLowerCase()
  return SPECIES_KEY[k] ?? k
}
function sameSpecies(a?: string | null, b?: string | null): boolean {
  return !!a && !!b && speciesKey(a) === speciesKey(b)
}

// Falls back to a generic cut rather than a cow — an unknown species showing a
// beef emblem is exactly the bug this replaced (Charlie, 2026-07-22).
const SPECIES_EMBLEM: Record<string, string> = { beef: '🐄', pork: '🐖', lamb: '🐑', goat: '🐐' }
function speciesEmblem(s?: string | null): string {
  return SPECIES_EMBLEM[speciesKey(s)] ?? '🥩'
}

// Bagged trim (trim.dest === 'bag'): the customer takes their trim un-ground in
// bulk bags, so none of the grind/patty/flavor answers exist on the card. The
// cutters' line has to be loud about it — trim reaching a grinder is not
// recoverable (Jill, 2026-07-28).
const trimIsBagged = (t: any) => t?.dest === 'bag'
const bagSizeLabel = (t: any) => (t?.bagSize ? `${t.bagSize} lb bags` : 'bag size not specified')
const baggedTrimCutterRows = (): Array<[string, string]> => [['Trim', 'BAG — do not grind']]
const baggedTrimPackRows   = (t: any): Array<[string, string]> => [['Bagged Trim', bagSizeLabel(t)]]

// v2 beef `trim` prefs split by audience: the blend is the cutters' call
// (cut card), packaging style & size is the packaging side's (packaging sheet)
function beefTrimCutterRows(t: any): Array<[string, string]> {
  if (trimIsBagged(t)) return baggedTrimCutterRows()
  const rows: Array<[string, string]> = []
  if (t?.fatPct) rows.push(['Grind Blend', t.fatPct])
  // Excess fat is thrown away unless the customer asked for it, and that call
  // gets made at the table while the animal is being broken — long before
  // anything reaches packing. Silent when they didn't ask, so the cutters only
  // read a line that means "don't bin this" (Jill/Charlie, 2026-08-04).
  if (t?.keepFat) rows.push(['Excess Fat', 'SAVE — customer wants it back'])
  return rows
}

function beefTrimPackRows(t: any): Array<[string, string]> {
  if (!t) return []
  if (trimIsBagged(t)) return baggedTrimPackRows(t)
  const rows: Array<[string, string]> = []
  const pattyPct = Number(t.pattyPct ?? 0)
  if (pattyPct < 100) {
    const parts = [
      t.loose?.packSize ? `${t.loose.packSize} lb ${t.loose?.rollstock ? 'rollstock' : 'packs'}` : '',
      pattyPct > 0 ? `${100 - pattyPct}% of trim` : '',
    ].filter(Boolean)
    if (parts.length) rows.push(['Loose Grind', parts.join(' · ')])
  }
  if (pattyPct > 0) {
    const parts = [
      t.patties?.size ?? '',
      t.patties?.pkg === '1lb' ? '1 lb pkgs' : t.patties?.pkg === '10lb' ? '10 lb box' : '',
      pattyPct < 100 ? `${pattyPct}% of trim` : 'all trim',
    ].filter(Boolean)
    rows.push(['Patties', parts.join(' · ')])
  }
  // Saved fat leaves as its own bagged item, so packing has to see it too —
  // same treatment bagged trim gets.
  if (t.keepFat) rows.push(['Excess Fat', 'Bag back — customer renders it'])
  return rows
}

// Office detail view shows the whole picture
function beefTrimRows(t: any): Array<[string, string]> {
  return [...beefTrimCutterRows(t), ...beefTrimPackRows(t)]
}

// v2 pork sausage: flavor is a processing decision, format is packaging —
// the packaging rows keep the flavor so each format is tied to its sausage
// Rows are named for the flavor rather than "Sausage 1 / 2". Plain ground pork
// under a "Sausage 1" label read as a stale leftover row (Jill), and naming the
// flavor still separates two rows that share one — a trim split into pork
// sausage links AND pork sausage patties reads as two clear lines.
const trimSplitOf = (t: any) => t?.split === 'yes' && !!t?.flavor2

// The cutter's page carries flavor AND format now, plus each flavor's share, so
// the trim gets divided at the table instead of guessed at (Jill, 2026-07-21).
function porkTrimCutterRows(t: any, f: (s: string) => string): Array<[string, string]> {
  if (!t) return []
  if (trimIsBagged(t)) return baggedTrimCutterRows()
  const split = trimSplitOf(t)
  const share = split ? '50% of trim' : 'all trim'
  const rows: Array<[string, string]> = []
  if (t.flavor1) rows.push([f(t.flavor1), [f(t.format1 ?? ''), share].filter(Boolean).join(' · ')])
  if (split)     rows.push([f(t.flavor2), [f(t.format2 ?? ''), share].filter(Boolean).join(' · ')])
  return rows
}

function porkTrimRows(t: any, f: (s: string) => string): Array<[string, string]> {
  if (!t) return []
  if (trimIsBagged(t)) return [...baggedTrimCutterRows(), ...baggedTrimPackRows(t)]
  const split = trimSplitOf(t)
  const share = split ? '50% of trim' : ''
  const rows: Array<[string, string]> = []
  if (t.flavor1) rows.push([f(t.flavor1), [f(t.format1 ?? ''), share].filter(Boolean).join(' · ')])
  if (split)     rows.push([f(t.flavor2), [f(t.format2 ?? ''), share].filter(Boolean).join(' · ')])
  return rows
}

// Lamb/goat trim destination. All three renderers used to hardcode
// "grind ? Ground : Stew", so any new wizard option printed as Stew — a wrong
// instruction to the floor rather than a missing one. One place now, and an
// unknown value falls back to its own name instead of a confident lie.
// `species` names the sausage — "Lamb Sausage", not "Breakfast Sausage" — so the
// card matches what goes on the label (Jill, 2026-07-21).
function lgTrimLabel(style?: string | null, species?: string | null, bagSize?: string | null): string {
  if (!style) return ''
  if (style === 'grind')   return 'Ground — 1 lb packs'
  if (style === 'stew')    return 'Stew — 1 lb packs'
  if (style === 'sausage') return `${v2fmt(species ?? '') || 'Lamb'} Sausage — 1 lb packs`
  if (style === 'bag')     return `BAG — do not grind · ${bagSize ? `${bagSize} lb bags` : 'bag size not specified'}`
  return v2fmt(style)
}

// Smokehouse orders — what the customer wants built out of their trim. These
// never reached any printed sheet, so the floor had no way to know how much
// trim to hold back before the rest went to grind (Charlie, 2026-07-21).
function smokehouseRows(sm: any, f: (s: string) => string): Array<[string, string]> {
  if (!sm) return []
  const rows: Array<[string, string]> = []
  const add = (label: string, items: any) => {
    if (!Array.isArray(items)) return
    for (const it of items) {
      const spec = [it?.lbs ? `${it.lbs} lbs` : '', f(it?.flavor ?? ''), it?.cheese ? f(it.cheese) : '']
        .filter(Boolean).join(' · ')
      if (spec) rows.push([label, spec])
    }
  }
  add('Snack Sticks',   sm.sticks)
  add('Brats',          sm.brats)
  add('Summer Sausage', sm.summer)
  add('Jerky',          sm.jerky)
  if (sm.hotDogs) {
    const spec = [sm.hotDogs.lbs ? `${sm.hotDogs.lbs} lbs` : '', sm.hotDogs.cheese ? f(sm.hotDogs.cheese) : '']
      .filter(Boolean).join(' · ')
    if (spec) rows.push(['Hot Dogs', spec])
  }
  return rows
}

// Trim committed to the smokehouse, in lbs — the number that decides how much
// to save back, so the crew doesn't have to add up the lines themselves.
function smokehouseTotalLbs(sm: any): number {
  if (!sm) return 0
  const sum = (items: any) => Array.isArray(items)
    ? items.reduce((s: number, i: any) => s + (Number(i?.lbs) || 0), 0) : 0
  return sum(sm.sticks) + sum(sm.brats) + sum(sm.summer) + sum(sm.jerky) + (Number(sm.hotDogs?.lbs) || 0)
}

// Everything we charge to MAKE — curing (bacon, cured hams) and sausage work.
// Billing is on the raw weight going in, which nothing captured, so each of
// these gets a blank to write on. Driven off the order, so a customer who
// didn't buy bacon never gets a bacon line.
function rawWeighInRows(d: any, f: (s: string) => string): Array<[string, string]> {
  const rows: Array<[string, string]> = []
  const belly = d?.belly
  if (belly?.cut === 'bacon' || belly?.cut2 === 'bacon') {
    const both = belly.cut === 'bacon' && belly.cut2 === 'bacon'
    rows.push(['Bacon', both ? 'Both bellies · cure & smoke' : 'Cure & smoke'])
  }
  // Shoulder bacon is a cured add-on chosen on the shoulder step (data.shoulder
  // .addons, or shoulder2.addons for a split whole hog). Like belly bacon it's
  // billed on the raw weight into the cure, so it earns its own weigh-in line.
  const sh = d?.shoulder
  const shoulderBacon  = Array.isArray(sh?.addons) && sh.addons.includes('shoulder-bacon')
  const shoulderBacon2 = Array.isArray(sh?.shoulder2?.addons) && sh.shoulder2.addons.includes('shoulder-bacon')
  if (shoulderBacon || shoulderBacon2) {
    const both = shoulderBacon && shoulderBacon2
    rows.push(['Shoulder Bacon', both ? 'Both shoulders · cure & smoke' : 'Cure & smoke'])
  }
  const ham = d?.ham
  const curedHams = [ham?.style, ham?.style2].filter(s => s === 'cured-smoked').length
  if (curedHams > 0) {
    // Name the cut of the ham actually being cured — with split hams the cured
    // one may be the second, whose cut lives in cut2.
    const curedCuts = [
      ham?.style === 'cured-smoked' ? ham?.cut : null,
      ham?.style2 === 'cured-smoked' ? ham?.cut2 : null,
    ].filter(Boolean).map(c => f(c as string))
    const cutLabel = curedCuts.length === 2 && curedCuts[0] !== curedCuts[1]
      ? curedCuts.join(' / ')
      : curedCuts[0] ?? ''
    rows.push(['Ham — Cure & Smoke', [curedHams > 1 ? 'Both hams' : '', cutLabel].filter(Boolean).join(' · ')])
  }
  // Plain ground pork is just grinding, not sausage making — no making charge,
  // so it gets no weigh-in line.
  const t = d?.trim
  const billable = (flavor?: string | null) => !!flavor && flavor !== 'ground-pork'
  if (billable(t?.flavor1)) rows.push([f(t.flavor1), f(t.format1 ?? '')])
  if (t?.split === 'yes' && billable(t?.flavor2)) rows.push([f(t.flavor2), f(t.format2 ?? '')])
  // Smokehouse products used to be repeated down here for their weigh-in
  // blank, which put a "Curing & Sausage" heading on beef cards that have
  // neither (Jill, 2026-07-27). They're weighed on their own Smokehouse rows
  // now, so a beef card with no cure work prints no section at all.
  return rows
}

// ── Cut card field definitions by species ─────────────────────────────────────

const BEEF_SECTIONS = [
  { label: 'Customer Info', fields: [
    ['customerName','Customer'],['mailingAddress','Mailing Address'],
    ['contactPreference','Contact Pref'],['contactValue','Contact'],
    ['beefSource','Beef Source'],['deliveryDate','Delivery Date'],
    ['beefSize','Beef Size'],['usadaInspection','USDA Inspection'],
  ]},
  { label: 'Cut Preferences', fields: [
    ['grindEntire','Grind Entire Animal'],['steakThickness','Steak Thickness'],
    ['steaksPerPackage','Steaks / Package'],['roastSize','Roast Size'],['soupBones','Soup Bones'],
    ['organs','Organs'],
  ]},
  { label: 'Individual Cuts', fields: [
    ['ribeye','Ribeye'],['shortRibs','Short Ribs'],['shortLoin','Short Loin'],
    ['brisket','Brisket'],['flatIronSteak','Flat Iron'],['armRoast','Arm Roast'],
    ['chuckRoast','Chuck Roast'],['topRound','Top Round'],['bottomRound','Bottom Round'],
    ['tritip','Tri-Tip'],['topSirloin','Top Sirloin'],['sirTip','Sirloin Tip'],
    ['flankSteak','Flank Steak'],['skirtSteak','Skirt Steak'],['stewMeat','Stew Meat'],
  ]},
  { label: 'Ground Beef & Specialty', fields: [
    ['burgerBlend','Burger Blend'],['burgerPackaging','Burger Packaging'],
    ['groundBeefPatties','Beef Patties'],['pattySize','Patty Size'],['pattyBoxCount','Patty Box Count'],
    ['beefSausage','Beef Sausage'],['breakfastSausage','Breakfast Sausage'],
  ]},
  { label: 'Notes', fields: [['cuttingNotes','Cutting Notes']] },
]

const HOG_SECTIONS = [
  { label: 'Customer Info', fields: [
    ['customerName','Customer'],['contactPreference','Contact Pref'],['contactValue','Contact'],
    ['deliveryDate','Delivery Date'],
  ]},
  { label: 'Hog Cuts', fields: [
    ['hogChops','Chops'],['hogSpareRibs','Country Style Ribs'],['hogHam','Ham 1'],['hogHam2','Ham 2'],
    ['hogHamCut','Ham Cut'],['hogBelly','Belly'],['hogBostonButt','Boston Butt'],
  ]},
  { label: 'Sausage', fields: [
    ['hogSausage1Type','Sausage 1 Type'],['hogSausage1Format','Sausage 1 Format'],
    ['hogSausage2Type','Sausage 2 Type'],['hogSausage2Format','Sausage 2 Format'],
  ]},
  { label: 'Notes', fields: [['cuttingNotes','Cutting Notes']] },
]

const LAMB_SECTIONS = [
  { label: 'Customer Info', fields: [
    ['customerName','Customer'],['contactPreference','Contact Pref'],['contactValue','Contact'],
    ['deliveryDate','Delivery Date'],
  ]},
  { label: 'Lamb Cuts', fields: [
    ['lambRack','Rack'],['lambLoinChops','Loin Chops'],['lambLeg','Leg'],
    ['lambLegChops','Leg Chops'],['lambShoulder','Shoulder'],['lambShank','Shank'],
  ]},
  { label: 'Ground & Trim', fields: [
    ['burgerBlend','Grind Blend'],['burgerPackaging','Packaging'],
  ]},
  { label: 'Notes', fields: [['cuttingNotes','Cutting Notes']] },
]

const GOAT_SECTIONS = [
  { label: 'Customer Info', fields: [
    ['customerName','Customer'],['contactPreference','Contact Pref'],['contactValue','Contact'],
    ['deliveryDate','Delivery Date'],
  ]},
  { label: 'Goat Cuts', fields: [
    ['goatRack','Rack'],['goatLoinChops','Loin Chops'],['goatLeg','Leg'],
    ['goatLegChops','Leg Chops'],['goatShoulder','Shoulder'],['goatShank','Shank'],
  ]},
  { label: 'Ground & Trim', fields: [
    ['burgerBlend','Grind Blend'],['burgerPackaging','Packaging'],
  ]},
  { label: 'Notes', fields: [['cuttingNotes','Cutting Notes']] },
]

function sectionsFor(species: string) {
  if (species === 'Hog')  return HOG_SECTIONS
  if (species === 'Lamb') return LAMB_SECTIONS
  if (species === 'Goat') return GOAT_SECTIONS
  return BEEF_SECTIONS
}

function formatValue(v: any): string {
  if (!v && v !== 0) return ''
  if (Array.isArray(v)) return v.join(', ')
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

function isEmpty(v: any): boolean {
  if (!v && v !== 0) return true
  if (Array.isArray(v)) return v.length === 0
  if (typeof v === 'string') return v.trim() === ''
  return false
}

// Compact date for the list table — handles ISO timestamps, YYYY-MM-DD, or free text
function fmtShortDate(v?: string | null): string {
  if (!v || v === 'Unknown') return '—'
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(v) ? v + 'T12:00:00' : v)
  if (isNaN(d.getTime())) return v
  return d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' })
}

// Carcass tag for a linked instruction: exact carcass assignment first
// (carcass_assignments), else the appointment's only animal, else '' → the
// printed card keeps its blank handwriting line.
//
// Linking a card attaches it to a CUSTOMER SLOT on a check-in ("one of Cook's
// hogs is Gabby's"), not to an animal. When the check-in brought one animal the
// two are the same thing; when it brought several, the slot alone can't say
// which carcass is hers, and the card would print a blank tag, a blank hanging
// weight and — worse, because nothing marks its absence — no kill-type badge.
// `state` is what tells those cases apart so the UI and the card can say so.
//   assigned    — an explicit carcass_assignments row. Trustworthy.
//   sole        — one animal on the check-in, so there is nothing to choose.
//   ambiguous   — several animals, none assigned to this card. Needs a human.
//   unharvested — not killed yet; blank lines are expected, nothing is wrong.
type CarcassState = 'assigned' | 'sole' | 'ambiguous' | 'unharvested'
type Candidate = { id: string; tag: string; hcw: number | string | null; heldBy: string[] }
type CarcassInfo = {
  tag: string; lot: string; producer: string; hcw: number | string | null; killType: string
  over30: boolean | null    // null = unknown, so the card stays quiet rather than guessing
  state: CarcassState
  apptId: string
  candidates: Candidate[]   // the animals on this check-in, for the picker
}
const EMPTY_CARCASS: CarcassInfo = {
  tag: '', lot: '', producer: '', hcw: null, killType: '', over30: null,
  state: 'unharvested', apptId: '', candidates: [],
}

// USDA vs Custom Exempt decides whether the meat can ever be sold, so it has to
// be on the card the floor works from (Jill, 2026-07-21). Part B stores
// 'Custom'; spell it out — "Custom" alone doesn't say "not for sale".
function killTypeLabel(kt?: string | null): string {
  if (!kt) return ''
  return kt === 'Custom' ? 'CUSTOM EXEMPT — NOT FOR SALE' : kt === 'USDA' ? 'USDA INSPECTED' : v2fmt(kt)
}

// Julian lot code YYDDD (e.g. 2026-06-25 → "26176") — matches the pre-printed
// carcass tags from the harvest worksheet.
function julianLot(dateISO: string | null | undefined): string {
  if (!dateISO) return ''
  const dt = new Date(dateISO + 'T12:00:00')
  if (isNaN(dt.getTime())) return ''
  const dayOfYear = Math.floor((dt.getTime() - new Date(dt.getFullYear(), 0, 1).getTime()) / 86400000) + 1
  return `${String(dt.getFullYear()).slice(-2)}${String(dayOfYear).padStart(3, '0')}`
}

// Appointments are loaded once when the page mounts, so a tab that has been
// open since before a card was linked — or since the tag and weight were
// entered in Part B — would print producer, lot, tag and hanging weight as
// blank handwriting lines (Jill, 2026-07-21). Re-read them at print time and
// fall back to what's in hand if the refresh fails, so printing never breaks.
async function freshAppointments(current: HarvestAppointment[]): Promise<HarvestAppointment[]> {
  try {
    const res = await fetch('/api/appointments')
    const data = await res.json()
    return Array.isArray(data) && data.length ? data as HarvestAppointment[] : current
  } catch {
    return current
  }
}

// Every carcass this card is linked to. A customer taking more than one
// animal's worth is linked on several appointments, and each gets its own card.
async function carcassInfosFor(ci: RawInstruction, appointments: HarvestAppointment[]): Promise<CarcassInfo[]> {
  const appts = appointments.filter(a => a.customers?.some(c => c.linked_cutting_instruction_id === ci.id))
  if (!appts.length) return [EMPTY_CARCASS]
  const infos = await Promise.all(appts.map(a => carcassInfoForAppt(ci, a)))
  // Drop duplicates so two links onto the same animal don't print twice.
  const seen = new Set<string>()
  const out = infos.filter(i => {
    const key = `${i.lot}|${i.tag}|${i.producer}`
    if (seen.has(key)) return false
    seen.add(key); return true
  })
  return out.length ? out : [EMPTY_CARCASS]
}

// Pure resolution, given the check-in's animals and assignment rows already in
// hand. Split out from fetching so the page can work out every card's state
// from two bulk calls, and the print path can do the same from its own reads.
function resolveCarcass(
  ciId: string,
  appt: HarvestAppointment,
  logs: any[],
  asgs: any[],
  // Every carcass in play, not just this booking's. A producer's buyer can be
  // moved onto the animal booked under a sibling appointment, and the card still
  // has to print that animal's tag and weight (Jill, 2026-07-28).
  allLogs?: any[],
): CarcassInfo {
  const animals = Array.isArray(logs) ? logs : []
  const rows    = Array.isArray(asgs) ? asgs : []
  const pool    = Array.isArray(allLogs) && allLogs.length ? allLogs : animals
  // Match on the customer slot first. Carcasses are normally assigned at
  // harvest, before the cut sheet has even arrived, so the assignment row's
  // own linked_cutting_instruction_id is empty on exactly the rows that matter
  // most — matching only on it reported assigned animals as unassigned.
  const slot = appt.customers?.find(c => c.linked_cutting_instruction_id === ciId)
  const asg  = rows.find((a: any) =>
    (slot && a.appointment_customer_id === slot.id) || a.linked_cutting_instruction_id === ciId) ?? null

  const log = animals.length === 0 ? null
    : asg ? pool.find((l: any) => l.id === asg.harvest_log_id) ?? null
    : animals.length === 1 ? animals[0] : null

  const state: CarcassState =
    animals.length === 0 ? 'unharvested'
    : log && asg          ? 'assigned'
    : log                 ? 'sole'
    : 'ambiguous'

  // Even without a specific carcass, the appointment pins down producer and
  // lot (Julian of the harvest date) — only tag & weight stay handwriting.
  const rawTag: string = log?.carcass_tag ?? ''
  // Tags print as <julian>-<seq>; Part B usually stores just the seq. Split
  // out a lot prefix ONLY when it actually looks like a 5-digit Julian —
  // a side-suffixed tag like "2-R" is a tag alone, not lot-tag.
  const hasLotPrefix = /^\d{5}-/.test(rawTag)
  const dash = rawTag.indexOf('-')

  // A kill type shared by every animal on the check-in is known even when the
  // individual animal isn't — so CUSTOM EXEMPT — NOT FOR SALE still prints on
  // an unassigned card. That marking is the one thing that must never go quiet.
  const killTypes = [...new Set(animals.map((l: any) => l.kill_type).filter(Boolean))]
  const killType  = log?.kill_type ?? (killTypes.length === 1 ? killTypes[0] : '')

  // Over/under 30 months decides whether the vertebral column is SRM and has to
  // come out, so the floor needs it on the card (Jill, 2026-07-24). Like kill
  // type, an unassigned card can still say it when every animal on the check-in
  // agrees. null = genuinely unknown, which prints nothing rather than "under".
  const ages = [...new Set(animals.map((l: any) => l.over_30_months).filter((v: any) => v === true || v === false))]
  const over30: boolean | null =
    typeof log?.over_30_months === 'boolean' ? log.over_30_months
    : ages.length === 1 ? ages[0] as boolean
    : null

  return {
    over30,
    lot: hasLotPrefix ? rawTag.slice(0, dash) : julianLot(appt.harvest_date),
    tag: hasLotPrefix ? rawTag.slice(dash + 1) : rawTag,
    producer: log?.producer || appt.source || '',
    hcw: log?.hot_carcass_weight_lbs ?? null,
    killType,
    state,
    apptId: appt.id,
    candidates: animals.map((l: any) => ({
      id:  l.id,
      tag: l.carcass_tag ?? '',
      hcw: l.hot_carcass_weight_lbs ?? null,
      heldBy: rows.filter((a: any) => a.harvest_log_id === l.id).map((a: any) => a.customer_name || 'someone'),
    })),
  }
}

async function carcassInfoForAppt(ci: RawInstruction, appt: HarvestAppointment): Promise<CarcassInfo> {
  try {
    const [logsRes, asgRes] = await Promise.all([
      fetch(`/api/harvest?appointment_id=${encodeURIComponent(appt.id)}`),
      fetch(`/api/carcass-assignments?appointment_id=${encodeURIComponent(appt.id)}`),
    ])
    const logs = await logsRes.json()
    const asgs = await asgRes.json()
    const own  = Array.isArray(logs) ? logs : []
    const rows = Array.isArray(asgs) ? asgs : []
    // A buyer moved onto one of the producer's other animals has an assignment
    // pointing outside this booking — pull that carcass in so the card still
    // prints its tag and weight.
    const away = [...new Set(rows.map((a: any) => a.harvest_log_id)
      .filter((id: string) => id && !own.some((l: any) => l.id === id)))]
    const extra = away.length
      ? await fetch(`/api/harvest?ids=${encodeURIComponent(away.join(','))}`)
          .then(r => r.json()).then(d => (Array.isArray(d) ? d : [])).catch(() => [])
      : []
    return resolveCarcass(ci.id, appt, own, rows, [...own, ...extra])
  } catch {
    return EMPTY_CARCASS
  }
}

// Scheduled slaughter date: linked appointment's harvest date wins,
// otherwise the kill date the customer picked on the form (v2)
function slaughterDateFor(ci: RawInstruction, appointments: HarvestAppointment[]): string | null {
  const appt = appointments.find(a => a.customers?.some(c => c.linked_cutting_instruction_id === ci.id))
  if (appt?.harvest_date) return appt.harvest_date
  const kd = ci.data?.killDate
  if (kd && kd !== 'Unknown') return kd
  return null
}

// Leading 26px column is the batch-print tickbox.
const LIST_GRID_COLS = '26px minmax(0,1fr) 54px 70px 70px 76px'

// ── V2 form helpers ───────────────────────────────────────────────────────────

// The team doesn't use "loose pack" — hog sausage goes into 1 lb chubs, so both
// the on-screen order detail and the printed card name that format "1 lb Packs".
// Keyed on the exact slug so nothing else the generic title-caser handles is
// affected. (Lamb sausage already reads "1 lb packs" a few lines down.)
// The only loin-roast the wizard offers is boneless, but the slug title-cased to
// plain "Loin Roast" — cutters missed the debone and lost roast size (2026-07-23).
// Spell it out so the card says "Boneless" right in the cut name.
// Split-share portions carry an A|B suffix the title-caser mangles ("Whole Ab"),
// so name them the way the wizard shows them.
// Shares a card can be copied onto, mirroring the wizard's portion step. Beef
// splits every way; a hog only goes whole or by the side.
const BEEF_PORTION_OPTIONS = ['whole', 'whole-ab', 'whole-abcd', 'three-quarter', 'three-quarter-abc', 'half', 'half-ab', 'quarter']
const PORK_PORTION_OPTIONS = ['whole', 'whole-ab', 'half']
const PORTION_LABELS: Record<string, string> = {
  'whole': 'Whole', 'whole-ab': 'Whole A|B', 'whole-abcd': 'Whole A|B|C|D',
  'three-quarter': '¾ Beef', 'three-quarter-abc': '¾ A|B|C',
  'half': 'Half', 'half-ab': 'Half A|B', 'quarter': 'Quarter',
}

const FMT_OVERRIDES: Record<string, string> = {
  'loose-pack': '1 lb Packs',
  'loin-roast': 'Boneless Loin Roast',
  'whole-ab': 'Whole A|B',
  'whole-abcd': 'Whole A|B|C|D',
  'half-ab': 'Half A|B',
  'three-quarter': '¾ Beef',
  'three-quarter-abc': '¾ A|B|C',
  // Brisket is kept whole; Jill dropped the half options, so the packer/flat
  // slugs read as plain "Packer" / "Flat" instead of "Packer Whole".
  'packer-whole': 'Packer',
  'flat-whole': 'Flat',
}

function v2fmt(val: string): string {
  if (!val) return ''
  return FMT_OVERRIDES[val] ?? val.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

// Leg steaks carry a thickness and pack count, and a split pair only needs one
// side asking for them.
function lgLegSteaks(leg?: { cut?: string; cut2?: string | null } | null): boolean {
  return leg?.cut === 'leg-steaks' || leg?.cut2 === 'leg-steaks'
}

// Two sides of a split primal. Identical answers collapse to one value —
// "1: Filet 2" / 2: Filet 2"" is just noise when both sides match (Charlie).
function sidePair(a: string, b: string): string {
  if (!a) return b ?? ''
  if (!b || a === b) return a
  return `1: ${a} / 2: ${b}`
}

// Hocks follow the ham style (the wizard leaves hocks.cut empty). The cutter
// only needs the word: Fresh or Smoked. Whole-hog split hams (style2) can
// differ, so print both when they do; grind hams get no hock line.
function hockStyle(ham?: { style?: string | null; style2?: string | null }): string {
  const word = (s?: string | null) => (s === 'fresh' ? 'Fresh' : s === 'cured-smoked' ? 'Smoked' : '')
  if (!ham?.style) return ''
  if (ham.style2) {
    const parts = [word(ham.style), word(ham.style2)]
    return parts.every(Boolean) ? sidePair(parts[0], parts[1]) : parts.filter(Boolean).join(' / ')
  }
  return word(ham.style)
}

// The wizard's ham-cut buttons say "Cut in Half" / "Cut in Quarters" but store
// bare values — print the button wording so "Half" can't read as half a ham
function hamCut(cut?: string | null): string {
  if (!cut) return ''
  return cut === 'half' ? 'Cut in Half' : cut === 'quarters' ? 'Cut in Quarters' : v2fmt(cut)
}

// Everything cured here also gets smoked, so "Cured & Smoked" is two words of
// noise on a card read at arm's length — it prints as "Cured" (Charlie).
function hamStyleWord(style?: string | null): string {
  return style === 'cured-smoked' ? 'Cured' : v2fmt(style ?? '')
}

// One ham, one line, whole story: "Cured: Cut in Quarters". A ham going to
// grind has no cut, so it's just the style — and any cut is ignored outright,
// since legacy split-ham orders (before the per-ham cut split, 2026-07-22) can
// carry a stale cut under a grind style and would otherwise read as the
// contradiction "Grind: Steaks" (Charlie, 2026-07-23). The packaging sheet keys
// on the bare word "Grind" to route the ham to the grind pile, so dropping the
// cut also stops a ground ham being packed as a whole ham.
function hamLine(style?: string | null, cut?: string | null): string {
  const s = hamStyleWord(style)
  if (!s) return ''
  if (style === 'grind') return s
  const c = hamCut(cut)
  return c ? `${s}: ${c}` : s
}

// Split hams read as one row each; matched hams collapse to a single
// instruction, since repeating an identical line twice is just more to read.
function hamRows(ham?: { style?: string | null; cut?: string | null; style2?: string | null; cut2?: string | null }): Array<[string, string]> {
  if (!ham?.style) return []
  const one = hamLine(ham.style, ham.cut)
  if (!ham.style2) return one ? [['Ham', one]] : []
  const two = hamLine(ham.style2, ham.cut2)
  if (!two || one === two) return one ? [['Ham', one]] : []
  return [['Ham (1)', one], ['Ham (2)', two]]
}

// A cured belly IS bacon and the packagers know it, so the belly reads the same
// way the ham does rather than naming the product it becomes (Charlie).
function bellyWord(cut?: string | null): string {
  return cut === 'bacon' ? 'Cured' : v2fmt(cut ?? '')
}

function bellyRows(belly?: { cut?: string | null; cut2?: string | null }): Array<[string, string]> {
  if (!belly?.cut) return []
  const one = bellyWord(belly.cut)
  if (!belly.cut2) return [['Belly', one]]
  const two = bellyWord(belly.cut2)
  if (!two || one === two) return [['Belly', one]]
  return [['Belly (1)', one], ['Belly (2)', two]]
}

// Shop-standard steak thicknesses the wizard states in its labels but doesn't
// store — printed on the cards so new cutters don't have to ask
const STEAK_STANDARDS: Record<string, string> = {
  'chuck-steaks':      '1',     // wizard label: Chuck Steaks (1")
  'rancher-steaks':    '0.75',  // wizard label: Rancher Steaks (¾")
  'flat-iron:steaks':  '1',     // flat iron — shop standard per Charlie 2026-07-16
}
// primal disambiguates generic cut values like 'steaks' that several primals share
function stdThick(cut?: string, primal?: string): string {
  if (!cut) return ''
  return STEAK_STANDARDS[`${primal}:${cut}`] ?? STEAK_STANDARDS[cut] ?? ''
}

// Arm / chuck / sirloin-tip roasts are portioned by a count now ("3 Roasts"),
// replacing the old whole/half/thirds/quarters fractions (Jill, 2026-07-23).
//
// The count the customer picked is per side — these primals come one per half —
// so on a whole beef the floor has to cut twice that many. Spell out both
// numbers rather than making the cutter double it (Jill, 2026-07-24).
function roastText(count?: string | null, perHalf = false): string {
  if (!count) return 'Roasts'
  const n = Number(count)
  const plural = (x: number) => `${x} Roast${x === 1 ? '' : 's'}`
  if (!perHalf || !Number.isFinite(n) || n <= 0) return plural(n || 0)
  return `${count} per half — ${plural(n * 2)} total`
}
// Render a roast-count cut, or fall back to the caller's normal cut formatter.
function roastOr(cut: string | undefined | null, count: string | undefined | null, renderCut: (cut: string) => string, perHalf = false): string {
  return cut === 'roasts' ? roastText(count, perHalf) : renderCut(cut ?? '')
}
// Both halves are in play, so a per-side count doubles. A split primal already
// carries its own count per side, so those never double.
function isWholeAnimal(portion?: string | null): boolean {
  return portion === 'whole' || portion === 'whole-ab'
}

// A whole packer/flat brisket can be halved via a toggle (whole/half beef).
function brisketLabel(cut: string | undefined | null, half: boolean | undefined, f: (c: string) => string): string {
  const base = f(cut ?? '')
  return half && (cut === 'packer-whole' || cut === 'flat-whole') ? `${base} — Cut in Half` : base
}

// Bone-in short loin still yields filets: the tenderloin head runs past the
// last rib, so 3–4 filet mignons come off before the T-bones start. That's why
// the row prints at all on a bone-in loin — the cutter only needs the thickness.
const BONE_IN_FILET_THICKNESS = '2"'
// The wizard offers thicknesses as fractions (¾", 1¼") but stores the decimal.
// Print the fraction the customer actually picked — a cutter reading 0.75" has
// to translate it back to a tape measure anyway (Jill, 2026-07-24).
const EIGHTHS = ['', '⅛', '¼', '⅜', '½', '⅝', '¾', '⅞']
export function fracThick(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === '') return ''
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) return String(v)
  const whole = Math.floor(n)
  const eighth = Math.round((n - whole) * 8)
  // Rounded up to the next whole inch (e.g. 1.99)
  if (eighth === 8) return `${whole + 1}"`
  const frac = EIGHTHS[eighth]
  if (!frac) return `${whole}"`
  return whole > 0 ? `${whole}${frac}"` : `${frac}"`
}

function v2thick(v: string): string { return fracThick(v) }
function v2withT(cut: string, t: string): string { return [v2fmt(cut), v2thick(t)].filter(Boolean).join(' — ') }
function v2adds(arr: string[]): string { return arr?.length ? arr.map(v2fmt).join(', ') : '' }
// A round sent to jerky carries its flavor; split rounds show both sides
function v2roundOne(r: any): string { return r?.cut === 'jerky' ? `Jerky${r.jerkyFlavor ? ` — ${v2fmt(r.jerkyFlavor)}` : ''}` : v2withT(r?.cut ?? '', r?.thickness ?? '') }
function v2roundVal(r: any): string { return r?.round2 ? sidePair(v2roundOne(r), v2roundOne(r.round2)) : v2roundOne(r) }

// The ribeye's only value-add is Seasoned (roast cuts only), and the wizard
// stores it as a boolean rather than the addons array every other primal uses.
// Older saved forms carry an addons array instead, so merge both shapes and let
// the ribeye print under the same add-on rows as the rest of the card.
function ribeyeAdds(r?: { addons?: string[]; seasoned?: boolean } | null): string[] {
  const a: string[] = [...(r?.addons ?? [])]
  if (r?.seasoned && !a.includes('seasoned')) a.push('seasoned')
  return a
}

const V2_CELL: React.CSSProperties = { background: 'rgba(0,0,0,0.25)', borderRadius: '3px', padding: '0.5rem 0.75rem' }
const V2_ADDON_CELL: React.CSSProperties = { background: 'rgba(240,192,64,0.08)', border: '1px solid rgba(240,192,64,0.2)', borderRadius: '3px', padding: '0.5rem 0.75rem' }
const V2_LBL: React.CSSProperties = { fontSize: '0.67rem', color: 'var(--light-brown)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '0.2rem' }
const V2_VAL: React.CSSProperties = { fontSize: '0.88rem', color: 'var(--cream)' }

function V2Field({ label, value, addon }: { label: string; value?: string; addon?: boolean }) {
  if (!value) return null
  return (
    <div style={addon ? V2_ADDON_CELL : V2_CELL}>
      <div style={V2_LBL}>{label}</div>
      <div style={V2_VAL}>{value}</div>
    </div>
  )
}

function V2Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: '1.5rem' }}>
      <div style={{ fontSize: '0.7rem', letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--light-brown)', marginBottom: '0.5rem', paddingBottom: '0.4rem', borderBottom: '1px solid rgba(166,120,90,0.15)' }}>
        {title}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '0.5rem' }}>
        {children}
      </div>
    </div>
  )
}

// One short-loin side as (label, value) pairs. A bone-in loin still yields
// filets — the tenderloin head runs past the last rib — so both paths can
// produce a Filet row, which is exactly why the merge below matters.
// `f` formats a cut value (the print and detail renderers format differently).
function shortLoinFields(sl: any, f: (v: string) => string, t: (v: string) => string): Array<[string, string]> {
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

// One pork shoulder as (label, value) pairs. A whole hog's two shoulders can
// be cut differently (one roast, one grind), so each renders through here and
// the pair gets merged below.
function shoulderFields(sh: any, f: (v: string) => string, t: (v: string) => string): Array<[string, string]> {
  if (!sh?.cut) return []
  const out: Array<[string, string]> = [['Cut', f(sh.cut)]]
  if (sh.cut === 'roast') {
    out.push(['Roast Size', sh.addons?.includes('pulled-pork') ? 'Whole shoulder — pulled pork' : sh.roastSize ? `${sh.roastSize} lb` : ''])
  }
  if (sh.cut === 'steaks' && sh.steakThickness) out.push(['Thickness', t(sh.steakThickness)])
  if (sh.addons?.length) out.push(['Add-ons', sh.addons.map(f).join(', ')])
  return out.filter(([, v]) => v)
}

// One pork loin as (label, value) pairs. A whole hog's two loins can be cut
// differently (one chops, one roast), each with its own tenderloin, so each
// renders through here and the pair gets merged below.
function loinFields(loin: any, f: (v: string) => string, t: (v: string) => string): Array<[string, string]> {
  if (!loin?.cut) return []
  const out: Array<[string, string]> = [['Cut', f(loin.cut)]]
  if (loin.cut === 'bone-in-chops' || loin.cut === 'boneless-chops' || loin.cut === 'smoked-chops') {
    if (loin.chopThickness) out.push(['Chop Thickness', t(loin.chopThickness)])
    if (loin.chopPack) out.push(['Per Pack', String(loin.chopPack)])
  }
  if (loin.cut === 'boneless-chops') out.push(['Baby Back Ribs', f(loin.babyBack ?? '')])
  if (loin.cut === 'loin-roast') out.push(['Roast Size', f(loin.roastSize ?? '')])
  // Bone-in chops keep the tenderloin, so it carries no separate line.
  if (loin.cut !== 'bone-in-chops') out.push(['Tenderloin', f(loin.tenderloin ?? '')])
  if (loin.addons?.length) out.push(['Add-ons', loin.addons.map(f).join(', ')])
  return out.filter(([, v]) => v)
}

// Merge the two sides of a split primal row-by-row: a row that comes out the
// same on both sides prints once, unsuffixed; only rows that actually differ
// get labelled (1) / (2). Two loins both yielding a 2" filet is one line.
function mergeSides(a: Array<[string, string]>, b: Array<[string, string]>): Array<[string, string]> {
  const out: Array<[string, string]> = []
  const usedB = new Set<number>()
  for (const [la, va] of a) {
    const j = b.findIndex(([lb, vb], i) => !usedB.has(i) && lb === la && vb === va)
    if (j >= 0) { usedB.add(j); out.push([la, va]) }
    else out.push([`${la} (1)`, va])
  }
  b.forEach(([lb, vb], i) => { if (!usedB.has(i)) out.push([`${lb} (2)`, vb]) })
  return out
}

function renderV2Detail(ci: RawInstruction) {
  const d = ci.data ?? {}
  const sp = speciesOf(ci).toLowerCase()
  const isBeef = sp === 'beef'
  const isPork = sp === 'pork' || sp === 'hog'
  const isLG = sp === 'lamb' || sp === 'goat'
  return (
    <>
      <V2Section title="Customer Info">
        <V2Field label="Name" value={d.customerName} />
        <V2Field label="Phone" value={d.customerPhone} />
        <V2Field label="Email" value={d.customerEmail} />
        <V2Field label="Harvest Date" value={d.killDate} />
        <V2Field label="Portion" value={v2fmt(d.portion)} />
        {/* Grinding it all replaces every primal answer, so it reads up here
            with the portion rather than as a missing section below. */}
        <V2Field label="Cut Style" value={d.grindWhole ? 'GRIND WHOLE ANIMAL — no steaks or roasts' : undefined} />
        {/* Asked once for the whole order, so it lives here rather than on each cut. */}
        <V2Field label="Steaks Per Pack" value={d.steakPack} />
        <V2Field label="Notes" value={d.notes} />
      </V2Section>

      {d.organs && (
        <V2Section title="Organs">
          <V2Field label="Heart" value={v2fmt(d.organs.heart)} />
          <V2Field label="Liver" value={v2fmt(d.organs.liver)} />
          {isBeef && <V2Field label="Tongue" value={v2fmt(d.organs.tongue)} />}
          {isBeef && <V2Field label="Oxtail" value={v2fmt(d.organs.oxtail)} />}
        </V2Section>
      )}

      {isBeef && (
        <>
          {!d.grindWhole && (<>
          <V2Section title="Chuck">
            <V2Field label="Brisket" value={
              d.brisket?.cut2
                ? sidePair(brisketLabel(d.brisket.cut, d.brisket.half, v2fmt), brisketLabel(d.brisket.cut2, d.brisket.half2, v2fmt))
                : brisketLabel(d.brisket?.cut, d.brisket?.half, v2fmt)
            } />
            <V2Field label="Shank" value={v2fmt(d.shank?.cut)} />
            <V2Field label="Shank Add-ons" value={v2adds(d.shank?.addons)} addon />
            <V2Field label="Arm Roast" value={
              d.armRoast?.arm2
                ? sidePair(roastOr(d.armRoast.cut, d.armRoast.roastCount, c => v2withT(c, stdThick(c))), roastOr(d.armRoast.arm2.cut, d.armRoast.arm2.roastCount, c => v2withT(c, stdThick(c))))
                : roastOr(d.armRoast?.cut, d.armRoast?.roastCount, c => v2withT(c, stdThick(c)), isWholeAnimal(d.portion))
            } />
            {d.armRoast?.arm2 ? (
              <>
                <V2Field label="Arm 1 Add-ons" value={v2adds(d.armRoast.addons)} addon />
                <V2Field label="Arm 2 Add-ons" value={v2adds(d.armRoast.arm2.addons)} addon />
              </>
            ) : (
              <V2Field label="Arm Add-ons" value={v2adds(d.armRoast?.addons)} addon />
            )}
            <V2Field label="Flat Iron" value={v2withT(d.flatIron?.cut ?? '', stdThick(d.flatIron?.cut, 'flat-iron'))} />
            <V2Field label="Chuck Roll" value={
              d.chuckRoll?.cut2
                ? sidePair(roastOr(d.chuckRoll.cut, d.chuckRoll.roastCount, c => v2withT(c, stdThick(c))), roastOr(d.chuckRoll.cut2, d.chuckRoll.roastCount2, c => v2withT(c, stdThick(c))))
                : roastOr(d.chuckRoll?.cut, d.chuckRoll?.roastCount, c => v2withT(c, stdThick(c)), isWholeAnimal(d.portion))
            } />
            {d.chuckRoll?.cut2 ? (
              <>
                <V2Field label="Chuck Roll 1 Add-ons" value={v2adds(d.chuckRoll.addons)} addon />
                <V2Field label="Chuck Roll 2 Add-ons" value={v2adds(d.chuckRoll.addons2)} addon />
              </>
            ) : (
              <V2Field label="Chuck Roll Add-ons" value={v2adds(d.chuckRoll?.addons)} addon />
            )}
          </V2Section>
          <V2Section title="Plate & Short Ribs">
            <V2Field label="Short Ribs" value={v2fmt(d.shortRibs?.cut)} />
            <V2Field label="Short Ribs Add-ons" value={v2adds(d.shortRibs?.addons)} addon />
            <V2Field label="Plate" value={v2fmt(d.plate?.cut)} />
          </V2Section>
          <V2Section title="Ribeye">
            <V2Field label="Style" value={
              d.ribeye?.ribeye2
                ? sidePair(v2fmt(d.ribeye.style), v2fmt(d.ribeye.ribeye2.style))
                : v2fmt(d.ribeye?.style)
            } />
            <V2Field label="Cut" value={
              d.ribeye?.ribeye2
                ? sidePair(v2withT(d.ribeye.cut ?? '', d.ribeye.thickness ?? ''), v2withT(d.ribeye.ribeye2.cut ?? '', d.ribeye.ribeye2.thickness ?? ''))
                : v2withT(d.ribeye?.cut ?? '', d.ribeye?.thickness ?? '')
            } />
            {d.ribeye?.ribeye2 ? (
              <>
                <V2Field label="Ribeye 1 Add-ons" value={v2adds(ribeyeAdds(d.ribeye))} addon />
                <V2Field label="Ribeye 2 Add-ons" value={v2adds(ribeyeAdds(d.ribeye.ribeye2))} addon />
              </>
            ) : (
              <V2Field label="Add-ons" value={v2adds(ribeyeAdds(d.ribeye))} addon />
            )}
          </V2Section>
          <V2Section title="Short Loin">
            {(d.shortLoin?.loin2
              ? mergeSides(shortLoinFields(d.shortLoin, v2fmt, v2thick), shortLoinFields(d.shortLoin.loin2, v2fmt, v2thick))
              : shortLoinFields(d.shortLoin, v2fmt, v2thick)
            ).map(([label, value]) => <V2Field key={label} label={label} value={value} />)}
          </V2Section>
          <V2Section title="Sirloin">
            <V2Field label="Top Sirloin" value={v2withT(d.topSirloin?.cut ?? '', d.topSirloin?.thickness ?? '')} />
            <V2Field label="Top Sirloin Add-ons" value={v2adds(d.topSirloin?.addons)} addon />
            <V2Field label="Tri Tip" value={v2fmt(d.triTip?.cut)} />
            <V2Field label="Tri Tip Add-ons" value={v2adds(d.triTip?.addons)} addon />
          </V2Section>
          <V2Section title="Flank">
            <V2Field label="Skirt" value={v2fmt(d.skirt?.cut)} />
            <V2Field label="Flank Steak" value={v2fmt(d.flank?.cut)} />
          </V2Section>
          <V2Section title="Round">
            <V2Field label="Sirloin Tip" value={
              d.sirloinTip?.tip2
                ? sidePair(roastOr(d.sirloinTip.cut, d.sirloinTip.roastCount, c => v2withT(c, d.sirloinTip.thickness ?? '')), roastOr(d.sirloinTip.tip2.cut, d.sirloinTip.tip2.roastCount, c => v2withT(c, d.sirloinTip.tip2.thickness ?? '')))
                : roastOr(d.sirloinTip?.cut, d.sirloinTip?.roastCount, c => v2withT(c, d.sirloinTip?.thickness ?? ''), isWholeAnimal(d.portion))
            } />
            {d.sirloinTip?.tip2 ? (
              <>
                <V2Field label="Sirloin Tip 1 Add-ons" value={v2adds(d.sirloinTip.addons)} addon />
                <V2Field label="Sirloin Tip 2 Add-ons" value={v2adds(d.sirloinTip.tip2.addons)} addon />
              </>
            ) : (
              <V2Field label="Sirloin Tip Add-ons" value={v2adds(d.sirloinTip?.addons)} addon />
            )}
            <V2Field label="Bottom Round" value={v2roundVal(d.bottomRound)} />
            <V2Field label="Bottom Round Add-ons" value={v2adds(d.bottomRound?.addons)} addon />
            <V2Field label="Top Round" value={v2roundVal(d.topRound)} />
            <V2Field label="Top Round Add-ons" value={v2adds(d.topRound?.addons)} addon />
            <V2Field label="Round Shank / Marrow" value={v2fmt(d.roundShank?.marrow)} />
          </V2Section>
          </>)}
          {beefTrimRows(d.trim).length > 0 && (
            <V2Section title="Trim & Ground Beef">
              {beefTrimRows(d.trim).map(([label, value]) => <V2Field key={label} label={label} value={value} />)}
            </V2Section>
          )}
        </>
      )}

      {isPork && (
        <>
          {!d.grindWhole && (<>
          <V2Section title="Shoulder">
            {(d.shoulder?.shoulder2
              ? mergeSides(shoulderFields(d.shoulder, v2fmt, v2thick), shoulderFields(d.shoulder.shoulder2, v2fmt, v2thick))
              : shoulderFields(d.shoulder, v2fmt, v2thick)
            ).map(([label, value]) => <V2Field key={label} label={label} value={value} addon={label.startsWith('Add-ons')} />)}
          </V2Section>
          <V2Section title="Loin">
            {(d.loin?.loin2
              ? mergeSides(loinFields(d.loin, v2fmt, v2thick), loinFields(d.loin.loin2, v2fmt, v2thick))
              : loinFields(d.loin, v2fmt, v2thick)
            ).map(([label, value]) => <V2Field key={label} label={label} value={value} addon={label.startsWith('Add-ons')} />)}
          </V2Section>
          {/* This detail reads the same as the printed cut card (Charlie): the
              belly says "Cured" not "Bacon", the ham is one line per side with
              smoking assumed, and hocks aren't listed since they follow the ham.
              bellyRows / hamRows are the same helpers the card is built from. */}
          <V2Section title="Belly">
            {bellyRows(d.belly).map(([l, v]) => <V2Field key={l} label={l} value={v} />)}
          </V2Section>
          <V2Section title="Ham">
            {hamRows(d.ham).map(([l, v]) => <V2Field key={l} label={l} value={v} />)}
          </V2Section>
          <V2Section title="Country Style Ribs">
            <V2Field label="Country Style Ribs" value={v2fmt(d.spareRibs?.cut)} />
          </V2Section>
          </>)}
          {porkTrimRows(d.trim, v2fmt).length > 0 && (
            <V2Section title="Sausage / Trim">
              {porkTrimRows(d.trim, v2fmt).map(([label, value]) => <V2Field key={label} label={label} value={value} />)}
            </V2Section>
          )}
        </>
      )}

      {isLG && (
        <V2Section title="Primals">
          <V2Field label="Rack" value={d.rack?.cut === 'whole-rack' ? `Frenched Rack of ${sp === 'goat' ? 'Goat' : 'Lamb'}` : v2fmt(d.rack?.cut)} />
          <V2Field label="Loin" value={v2fmt(d.loin?.cut)} />
          {d.loin?.cut === 'loin-chops' && (
            <>
              <V2Field label="Chop Thickness" value={v2thick(d.loin?.chopThickness)} />
              <V2Field label="Per Pack" value={d.loin?.chopPack} />
            </>
          )}
          <V2Field label="Leg" value={sidePair(v2fmt(d.leg?.cut), v2fmt(d.leg?.cut2))} />
          {lgLegSteaks(d.leg) && (
            <>
              <V2Field label="Steak Thickness" value={v2thick(d.leg?.steakThickness)} />
              <V2Field label="Per Pack" value={d.leg?.steakPack} />
            </>
          )}
          <V2Field label="Shoulder" value={sidePair(v2fmt(d.shoulder?.cut), v2fmt(d.shoulder?.cut2))} />
          <V2Field label="Shank" value={v2fmt(d.shank?.cut)} />
          <V2Field label="Trim" value={lgTrimLabel(d.trim?.style, sp === 'goat' ? 'Goat' : 'Lamb', d.trim?.bagSize) || undefined} />
        </V2Section>
      )}

      {smokehouseRows(d.smokehouse, v2fmt).length > 0 && (
        <V2Section title="Smokehouse">
          {smokehouseRows(d.smokehouse, v2fmt).map(([label, value], i) => (
            <V2Field key={i} label={label} value={value} />
          ))}
          {smokehouseTotalLbs(d.smokehouse) > 0 && (
            <V2Field label="Trim to save" value={`${+smokehouseTotalLbs(d.smokehouse).toFixed(1)} lbs total`} />
          )}
        </V2Section>
      )}

      {d.specialty?.interest && (
        <V2Section title="Specialty Items">
          <V2Field label="Interested" value={d.specialty.interest === 'yes' ? 'Yes' : 'No thanks'} />
          <V2Field label="Notes" value={d.specialty.notes} />
        </V2Section>
      )}
    </>
  )
}

// Builds one card's pages — cut card + packaging sheet per carcass — WITHOUT the
// document shell, so several cards can be printed into a single document
// (Jill wanted to select a batch and print them in one go).
//
// A customer buying more than one animal's worth (Wendy Warren's hog and a half)
// is linked to several carcasses, and each one gets its own card — same cuts,
// but its own tag, lot and hanging weight — so the pair on the rail can't be
// mixed up. Pass one carcass or many.
//
// isLastCard suppresses the trailing page break so a batch doesn't end on a
// blank sheet.
function v2CardPages(ci: RawInstruction, carcassArg: CarcassInfo | CarcassInfo[] = EMPTY_CARCASS, isLastCard = true): string {
  const carcassList = (Array.isArray(carcassArg) ? carcassArg : [carcassArg])
  const carcasses   = carcassList.length ? carcassList : [EMPTY_CARCASS]
  const d = ci.data ?? {}
  const species = ci.data?.species ?? ci.species ?? 'Beef'
  const name = d.customerName ?? '—'
  const sp = species.toLowerCase()
  const isBeef = sp === 'beef'
  const isPork = sp === 'pork' || sp === 'hog'
  const isLG   = sp === 'lamb' || sp === 'goat'

  const fmt   = (v: string) => v ? (FMT_OVERRIDES[v] ?? v.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())) : ''
  // The card is built as an HTML string from a public form's JSONB, so anything
  // interpolated raw gets escaped first.
  const esc   = (v: unknown) => String(v ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))
  const thick = (v: string) => fracThick(v)
  const withT = (cut: string, t: string) => [fmt(cut), thick(t)].filter(Boolean).join(' — ')
  const adds  = (arr: string[]) => arr?.length ? arr.map(fmt).join(', ') : ''
  // A per-side roast count doubles when the customer has the whole animal.
  const wholeAnimal = isWholeAnimal(d.portion)
  // Handwriting blank — anything the system doesn't know gets a line to write on
  const wline = (w: number) => `<span style="display:inline-block;min-width:${w}px;border-bottom:1.5px solid #1A0A04">&nbsp;</span>`
  // Jill's wording: a kept-whole rack reads "Frenched Rack of Lamb/Goat"
  const rackDisplay = (v?: string) => v === 'whole-rack' ? `Frenched Rack of ${sp === 'goat' ? 'Goat' : 'Lamb'}` : fmt(v ?? '')
  // A round sent to jerky carries its flavor; split rounds print both sides
  const roundOne = (r: any) => r?.cut === 'jerky' ? `Jerky${r.jerkyFlavor ? ` — ${fmt(r.jerkyFlavor)}` : ''}` : withT(r?.cut ?? '', r?.thickness ?? '')
  const roundVal = (r: any) => r?.round2 ? sidePair(roundOne(r), roundOne(r.round2)) : roundOne(r)

  // Primal color coding for the cutting table (Chris): chuck green,
  // rib & plate yellow, rest of the beef red
  const PRIMAL_COLORS: Record<string, { bar: string; text: string; tint: string }> = {
    'Chuck':              { bar: '#2e7d32', text: '#ffffff', tint: '#edf5ee' },
    'Plate & Short Ribs': { bar: '#f2c200', text: '#4a3800', tint: '#fdf8e0' },
    'Ribeye':             { bar: '#f2c200', text: '#4a3800', tint: '#fdf8e0' },
    'Short Loin':         { bar: '#b71c1c', text: '#ffffff', tint: '#fbecec' },
    'Sirloin':            { bar: '#b71c1c', text: '#ffffff', tint: '#fbecec' },
    'Flank':              { bar: '#b71c1c', text: '#ffffff', tint: '#fbecec' },
    'Round':              { bar: '#b71c1c', text: '#ffffff', tint: '#fbecec' },
  }

  // ── Page 1: Cut Card ──────────────────────────────────────────────────────
  // Compact rows + sections wrapped in break-inside:avoid for 2-column CSS layout
  const row = (label: string, value: any, addon = false): string => {
    const v = value != null ? String(value) : ''
    if (!v.trim()) return ''
    const lc = addon ? '#8a6200' : '#75471B'
    const fi = addon ? 'italic'  : 'normal'
    // 24px values (18px labels) — readable across the cutting room (Charlie)
    return `<tr style="${addon ? 'background:#fffbe8' : ''}">
      <td style="padding:3px 8px;color:${lc};font-size:18px;width:150px;vertical-align:top">${label}</td>
      <td style="padding:3px 8px;font-size:24px;font-weight:600;font-style:${fi};vertical-align:top;border-left:1px solid #eee">${v}</td>
    </tr>`
  }
  // Each section is a single div with break-inside:avoid so CSS columns won't split it mid-section
  const sec = (title: string, rows: string): string => {
    if (!rows.trim()) return ''
    const c = PRIMAL_COLORS[title]
    return `<div style="break-inside:avoid;margin-top:6px">
           <div style="background:${c?.bar ?? '#351E0E'};color:${c?.text ?? '#F2E8D9'};padding:4px 10px;font-size:18px;letter-spacing:0.12em;text-transform:uppercase;font-weight:bold">${title}</div>
           <table style="width:100%;border-collapse:collapse;border:1px solid #e0d5c8;${c ? `background:${c.tint}` : ''}">${rows}</table>
         </div>`
  }

  let cutSections = ''

  // No organs on the cut card: the cutters never handle them (Charlie,
  // 2026-07-22). Whatever the customer is keeping still reaches the floor on
  // the packaging sheet, where it's actually packed.

  // Grinding the whole animal: the band up top is the instruction, and no
  // primal section may contradict it — an order that once had cut answers and
  // was later switched to all-grind must not print them (Jill, 2026-07-27).
  if (isBeef && !d.grindWhole) {
    cutSections += sec('Chuck', [
      row('Brisket', d.brisket?.cut2 ? sidePair(brisketLabel(d.brisket.cut, d.brisket.half, fmt), brisketLabel(d.brisket.cut2, d.brisket.half2, fmt)) : brisketLabel(d.brisket?.cut, d.brisket?.half, fmt)),
      d.brisket?.fat ? row('  Brisket Fat', fmt(d.brisket.fat)) : '',
      row('Shank', fmt(d.shank?.cut)),
      d.shank?.addons?.length ? row('  Add-ons', adds(d.shank.addons), true) : '',
      row('Arm Roast', d.armRoast?.arm2
        ? sidePair(roastOr(d.armRoast.cut, d.armRoast.roastCount, c => withT(c, stdThick(c))), roastOr(d.armRoast.arm2.cut, d.armRoast.arm2.roastCount, c => withT(c, stdThick(c))))
        : roastOr(d.armRoast?.cut, d.armRoast?.roastCount, c => withT(c, stdThick(c)), wholeAnimal)),
      d.armRoast?.arm2
        ? [
            d.armRoast.addons?.length ? row('  Add-ons (1)', adds(d.armRoast.addons), true) : '',
            d.armRoast.arm2.addons?.length ? row('  Add-ons (2)', adds(d.armRoast.arm2.addons), true) : '',
          ].join('')
        : (d.armRoast?.addons?.length ? row('  Add-ons', adds(d.armRoast.addons), true) : ''),
      row('Flat Iron', withT(d.flatIron?.cut ?? '', stdThick(d.flatIron?.cut, 'flat-iron'))),
      row('Chuck Roll', d.chuckRoll?.cut2
        ? sidePair(roastOr(d.chuckRoll.cut, d.chuckRoll.roastCount, c => withT(c, stdThick(c))), roastOr(d.chuckRoll.cut2, d.chuckRoll.roastCount2, c => withT(c, stdThick(c))))
        : roastOr(d.chuckRoll?.cut, d.chuckRoll?.roastCount, c => withT(c, stdThick(c)), wholeAnimal)),
      d.chuckRoll?.cut2
        ? [
            d.chuckRoll.addons?.length ? row('  Add-ons (1)', adds(d.chuckRoll.addons), true) : '',
            d.chuckRoll.addons2?.length ? row('  Add-ons (2)', adds(d.chuckRoll.addons2), true) : '',
          ].join('')
        : (d.chuckRoll?.addons?.length ? row('  Add-ons', adds(d.chuckRoll.addons), true) : ''),
    ].join(''))
    cutSections += sec('Plate & Short Ribs', [
      row('Short Ribs', fmt(d.shortRibs?.cut)),
      d.shortRibs?.addons?.length ? row('  Add-ons', adds(d.shortRibs.addons), true) : '',
      row('Plate', fmt(d.plate?.cut)),
    ].join(''))
    // A split ribeye prints one line per side — style and cut together — the same
    // shape the packaging sheet uses. A Style row and a Cut row each carrying
    // "1: … / 2: …" made the cutter read across two rows to work out what side 2
    // actually was (Jill, 2026-07-28).
    const ribeyeLine = (r?: { style?: string | null; cut?: string | null; thickness?: string | null } | null) =>
      [fmt(r?.style ?? ''), withT(r?.cut ?? '', r?.thickness ?? '')].filter(Boolean).join(' · ')
    cutSections += sec('Ribeye', (d.ribeye?.ribeye2
      ? [
          row('Ribeye (1)', ribeyeLine(d.ribeye)),
          ribeyeAdds(d.ribeye).length ? row('  Add-ons (1)', adds(ribeyeAdds(d.ribeye)), true) : '',
          row('Ribeye (2)', ribeyeLine(d.ribeye.ribeye2)),
          ribeyeAdds(d.ribeye.ribeye2).length ? row('  Add-ons (2)', adds(ribeyeAdds(d.ribeye.ribeye2)), true) : '',
        ]
      : [
          row('Style', fmt(d.ribeye?.style)),
          row('Cut', withT(d.ribeye?.cut ?? '', d.ribeye?.thickness ?? '')),
          ribeyeAdds(d.ribeye).length ? row('  Add-ons', adds(ribeyeAdds(d.ribeye)), true) : '',
        ]
    ).join(''))
    const sl = d.shortLoin ?? {}
    cutSections += sec('Short Loin', (sl.loin2
      ? mergeSides(shortLoinFields(sl, fmt, thick), shortLoinFields(sl.loin2, fmt, thick))
      : shortLoinFields(sl, fmt, thick)
    ).map(([label, value]) => row(label, value)).join(''))
    cutSections += sec('Sirloin', [
      row('Top Sirloin', withT(d.topSirloin?.cut ?? '', d.topSirloin?.thickness ?? '')),
      d.topSirloin?.addons?.length ? row('  Add-ons', adds(d.topSirloin.addons), true) : '',
      row('Tri Tip', fmt(d.triTip?.cut)),
      d.triTip?.addons?.length ? row('  Add-ons', adds(d.triTip.addons), true) : '',
    ].join(''))
    cutSections += sec('Flank', [
      row('Skirt', fmt(d.skirt?.cut)),
      row('Flank Steak', fmt(d.flank?.cut)),
    ].join(''))
    cutSections += sec('Round', [
      row('Sirloin Tip', d.sirloinTip?.tip2
        ? sidePair(roastOr(d.sirloinTip.cut, d.sirloinTip.roastCount, c => withT(c, d.sirloinTip.thickness ?? '')), roastOr(d.sirloinTip.tip2.cut, d.sirloinTip.tip2.roastCount, c => withT(c, d.sirloinTip.tip2.thickness ?? '')))
        : roastOr(d.sirloinTip?.cut, d.sirloinTip?.roastCount, c => withT(c, d.sirloinTip?.thickness ?? ''), wholeAnimal)),
      d.sirloinTip?.tip2
        ? [
            d.sirloinTip.addons?.length ? row('  Add-ons (1)', adds(d.sirloinTip.addons), true) : '',
            d.sirloinTip.tip2.addons?.length ? row('  Add-ons (2)', adds(d.sirloinTip.tip2.addons), true) : '',
          ].join('')
        : (d.sirloinTip?.addons?.length ? row('  Add-ons', adds(d.sirloinTip.addons), true) : ''),
      row('Bottom Round', roundVal(d.bottomRound)),
      d.bottomRound?.addons?.length ? row('  Add-ons', adds(d.bottomRound.addons), true) : '',
      d.eyeOfRound?.cut ? row('Eye of Round', withT(d.eyeOfRound.cut, d.eyeOfRound.thickness ?? '')) : '',
      d.rumpRoast?.cut  ? row('Rump Roast',   withT(d.rumpRoast.cut,  d.rumpRoast.thickness  ?? '')) : '',
      row('Top Round', roundVal(d.topRound)),
      d.topRound?.addons?.length ? row('  Add-ons', adds(d.topRound.addons), true) : '',
      row('Round Shank / Marrow', fmt(d.roundShank?.marrow)),
    ].join(''))
  }

  if (isBeef) {
    cutSections += sec(trimIsBagged(d.trim) ? 'Trim' : 'Trim & Ground Beef', beefTrimCutterRows(d.trim).map(([l, v]) => row(l, v)).join(''))
  }

  if (isPork && !d.grindWhole) {
    const loin = d.loin ?? {}
    cutSections += sec('Shoulder', (d.shoulder?.shoulder2
      ? mergeSides(shoulderFields(d.shoulder, fmt, thick), shoulderFields(d.shoulder.shoulder2, fmt, thick))
      : shoulderFields(d.shoulder, fmt, thick)
    ).map(([label, value]) => row(label.startsWith('Add-ons') ? `  ${label}` : label, value, label.startsWith('Add-ons'))).join(''))
    cutSections += sec('Loin', (loin.loin2
      ? mergeSides(loinFields(loin, fmt, thick), loinFields(loin.loin2, fmt, thick))
      : loinFields(loin, fmt, thick)
    ).map(([label, value]) => row(label.startsWith('Add-ons') ? `  ${label}` : label, value, label.startsWith('Add-ons'))).join(''))
    // A split belly used to print only side 1 here, so half the instruction
    // never reached the cutter.
    cutSections += sec('Belly', bellyRows(d.belly).map(([l, v]) => row(l, v)).join(''))
    // Hocks come off the ham and always follow its style, so the cut card no
    // longer restates them — the cutter has that from the ham line (Charlie).
    cutSections += sec('Ham', hamRows(d.ham).map(([l, v]) => row(l, v)).join(''))
    cutSections += sec('Country Style Ribs', [
      row('Country Style Ribs', fmt(d.spareRibs?.cut)),
    ].join(''))
  }

  if (isPork) {
    cutSections += sec(trimIsBagged(d.trim) ? 'Trim' : 'Sausage / Trim', porkTrimCutterRows(d.trim, fmt).map(([l, v]) => row(l, v)).join(''))
  }

  if (isLG) {
    cutSections += sec('Primals', [
      row('Rack',     rackDisplay(d.rack?.cut)),
      row('Loin',     fmt(d.loin?.cut)),
      d.loin?.cut === 'loin-chops' && d.loin?.chopThickness ? row('Chop Thickness', thick(d.loin.chopThickness)) : '',
      d.loin?.cut === 'loin-chops' && d.loin?.chopPack ? row('Per Pack', d.loin.chopPack) : '',
      row('Leg',      sidePair(fmt(d.leg?.cut), fmt(d.leg?.cut2))),
      lgLegSteaks(d.leg) && d.leg?.steakThickness ? row('Steak Thickness', thick(d.leg.steakThickness)) : '',
      lgLegSteaks(d.leg) && d.leg?.steakPack ? row('Per Pack', d.leg.steakPack) : '',
      row('Shoulder', sidePair(fmt(d.shoulder?.cut), fmt(d.shoulder?.cut2))),
      row('Shank',    fmt(d.shank?.cut)),
      d.trim?.style ? row('Trim', lgTrimLabel(d.trim.style, species, d.trim.bagSize)) : '',
    ].join(''))
  }

  // Smokehouse on the CUTTER's page too — they're the ones deciding what goes
  // to the grind bucket, so they need the trim total before it's all ground.
  {
    const smokeCardRows = smokehouseRows(d.smokehouse, fmt)
    if (smokeCardRows.length) {
      const totalLbs = smokehouseTotalLbs(d.smokehouse)
      cutSections += sec('Smokehouse', [
        ...smokeCardRows.map(([l, v]) => row(l, v)),
        totalLbs > 0 ? row('Trim to save', `${+totalLbs.toFixed(1)} lbs total`) : '',
      ].join(''))
    }
  }

  // A "no thanks" is an answered question, not an instruction — printing it just
  // costs the cutter a section to read past (Charlie, 2026-07-22). Only a yes
  // earns space, and any notes ride along with it.
  if (d.specialty?.interest === 'yes') {
    cutSections += sec('Specialty Items', [
      row('Interested', 'Yes'),
      d.specialty.notes ? row('Notes', d.specialty.notes) : '',
    ].join(''))
  }
  if (d.notes) cutSections += sec('Special Notes', row('Notes', d.notes))

  // ── Page 2: Packaging Sheet ───────────────────────────────────────────────
  type PR = { sectionTitle?: string; cut?: string; spec?: string; isGrind?: boolean; isAddon?: boolean; writeIn?: boolean }
  const prs: PR[] = []
  const grindFrom: string[] = []

  const ps  = (title: string)                          => prs.push({ sectionTitle: title })
  const pc  = (cut: string, spec: string, isAddon = false) => prs.push({ cut, spec, isAddon })
  const pg  = (src: string)                            => grindFrom.push(src)

  // Nothing the customer turned down belongs on this sheet: every row here is a
  // packing row with a checkbox, so "Liver · Discard" reads like something to
  // put in the box (Charlie + Jill's card, 2026-07-22). The cut card still
  // carries these — the cutter has to know to discard rather than save.
  // The wizard writes 'keep' / 'discard'; older orders used yes/no, so both
  // vocabularies count as declined.
  const wanted = (v?: string | null) => !!v && !['discard', 'no', 'none'].includes(v.toLowerCase())
  if (d.organs) {
    const orgPacks: string[] = []
    if (wanted(d.organs.heart)) orgPacks.push(`Heart · ${fmt(d.organs.heart)}`)
    if (wanted(d.organs.liver)) orgPacks.push(`Liver · ${fmt(d.organs.liver)}`)
    if (isBeef && wanted(d.organs.tongue)) orgPacks.push(`Tongue · ${fmt(d.organs.tongue)}`)
    if (isBeef && wanted(d.organs.oxtail)) orgPacks.push(`Oxtail · ${fmt(d.organs.oxtail)}`)
    if (orgPacks.length) { ps('Organs'); orgPacks.forEach(o => pc(o, '')) }
  }

  if (isBeef && !d.grindWhole) {
    ps('Chuck')
    if (d.brisket?.cut) {
      if (d.brisket.cut === 'grind') { pg('Brisket') }
      else {
        const bSpec = (d.brisket.cut2 ? sidePair(brisketLabel(d.brisket.cut, d.brisket.half, fmt), brisketLabel(d.brisket.cut2, d.brisket.half2, fmt)) : brisketLabel(d.brisket.cut, d.brisket.half, fmt))
          + (d.brisket.fat ? ` · ${fmt(d.brisket.fat)}` : '')
        pc('Brisket', bSpec)
      }
    }
    if (d.shank?.cut) {
      if (d.shank.cut === 'grind' || d.shank.cut === 'grind-marrow') {
        pg('Shank')
        if (d.shank.cut === 'grind-marrow') pc('Shank Marrow Bones', 'Return marrow bones')
      } else { pc('Shank', fmt(d.shank.cut)) }
      if (d.shank.addons?.length) pc('  Add-on', adds(d.shank.addons), true)
    }
    if (d.armRoast?.arm2) {
      if (d.armRoast.cut === 'grind') pg('Arm Roast (1)')
      else if (d.armRoast.cut) { pc('Arm Roast (1)', roastOr(d.armRoast.cut, d.armRoast.roastCount, c => withT(c, stdThick(c)))); if (d.armRoast.addons?.length) pc('  Add-on', adds(d.armRoast.addons), true) }
      if (d.armRoast.arm2.cut === 'grind') pg('Arm Roast (2)')
      else if (d.armRoast.arm2.cut) { pc('Arm Roast (2)', roastOr(d.armRoast.arm2.cut, d.armRoast.arm2.roastCount, c => withT(c, stdThick(c)))); if (d.armRoast.arm2.addons?.length) pc('  Add-on', adds(d.armRoast.arm2.addons), true) }
    } else if (d.armRoast?.cut) {
      if (d.armRoast.cut === 'grind') pg('Arm Roast')
      else { pc('Arm Roast', roastOr(d.armRoast.cut, d.armRoast.roastCount, c => withT(c, stdThick(c)), wholeAnimal)); if (d.armRoast.addons?.length) pc('  Add-on', adds(d.armRoast.addons), true) }
    }
    if (d.flatIron?.cut) { d.flatIron.cut === 'grind' ? pg('Flat Iron') : pc('Flat Iron', withT(d.flatIron.cut, stdThick(d.flatIron.cut, 'flat-iron'))) }
    if (d.chuckRoll?.cut2) {
      if (d.chuckRoll.cut === 'grind') pg('Chuck Roll (1)')
      else if (d.chuckRoll.cut) { pc('Chuck Roll (1)', roastOr(d.chuckRoll.cut, d.chuckRoll.roastCount, c => withT(c, stdThick(c)))); if (d.chuckRoll.addons?.length) pc('  Add-on', adds(d.chuckRoll.addons), true) }
      if (d.chuckRoll.cut2 === 'grind') pg('Chuck Roll (2)')
      else { pc('Chuck Roll (2)', roastOr(d.chuckRoll.cut2, d.chuckRoll.roastCount2, c => withT(c, stdThick(c)))); if (d.chuckRoll.addons2?.length) pc('  Add-on', adds(d.chuckRoll.addons2), true) }
    } else if (d.chuckRoll?.cut) {
      if (d.chuckRoll.cut === 'grind') pg('Chuck Roll')
      else { pc('Chuck Roll', roastOr(d.chuckRoll.cut, d.chuckRoll.roastCount, c => withT(c, stdThick(c)), wholeAnimal)); if (d.chuckRoll.addons?.length) pc('  Add-on', adds(d.chuckRoll.addons), true) }
    }
    ps('Plate & Short Ribs')
    if (d.shortRibs?.cut) {
      if (d.shortRibs.cut === 'grind') pg('Short Ribs')
      else { pc('Short Ribs', fmt(d.shortRibs.cut)); if (d.shortRibs.addons?.length) pc('  Add-on', adds(d.shortRibs.addons), true) }
    }
    if (d.plate?.cut) { d.plate.cut === 'grind' ? pg('Plate') : pc('Plate / Beef Bacon', fmt(d.plate.cut)) }
    ps('Ribeye')
    // grind lives at the style level for ribeye (the wizard clears cut when style is grind)
    const packRibeye = (r: any, sfx: string) => {
      if (r.style === 'grind' || r.cut === 'grind') { pg(`Ribeye${sfx}`); return }
      if (!r.cut) return
      pc(`Ribeye${sfx}`, [fmt(r.style), withT(r.cut, r.thickness ?? '')].filter(Boolean).join(' · '))
      const a = ribeyeAdds(r)
      if (a.length) pc('  Add-on', adds(a), true)
    }
    if (d.ribeye?.ribeye2) {
      packRibeye(d.ribeye, ' (1)')
      packRibeye(d.ribeye.ribeye2, ' (2)')
    } else if (d.ribeye?.style || d.ribeye?.cut) {
      packRibeye(d.ribeye, '')
    }
    ps('Short Loin')
    const sl = d.shortLoin ?? {}
    // Cuts sent to grind leave the packing list and join the grind bucket;
    // the rest merge row-by-row so an identical row prints once.
    const slPackFields = (s: any): Array<[string, string]> => {
      const out: Array<[string, string]> = []
      if (s?.path === 'bone-in') {
        if (s.tBoneThickness) out.push(['T-Bone / Porterhouse', thick(s.tBoneThickness)])
        out.push(['Filet', BONE_IN_FILET_THICKNESS])
      }
      if (s?.path === 'boneless') {
        if (s.tenderloin?.cut === 'grind') pg('Tenderloin')
        else if (s.tenderloin?.cut === 'filet') out.push(['Filet', '2"'])
        else if (s.tenderloin?.cut) out.push(['Tenderloin', fmt(s.tenderloin.cut)])
        if (s.stripLoin?.cut === 'grind') pg('Strip Loin')
        else if (s.stripLoin?.cut) out.push(['Strip Loin (NY Strip)', withT(s.stripLoin.cut, s.stripLoin.thickness ?? '')])
      }
      return out
    }
    const slPacked = sl.loin2 ? mergeSides(slPackFields(sl), slPackFields(sl.loin2)) : slPackFields(sl)
    slPacked.forEach(([label, value]) => pc(label, value))
    ps('Sirloin')
    if (d.topSirloin?.cut) {
      if (d.topSirloin.cut === 'grind') pg('Top Sirloin')
      else { pc('Top Sirloin', withT(d.topSirloin.cut, d.topSirloin.thickness ?? '')); if (d.topSirloin.addons?.length) pc('  Add-on', adds(d.topSirloin.addons), true) }
    }
    if (d.triTip?.cut) {
      if (d.triTip.cut === 'grind') pg('Tri Tip')
      else { pc('Tri Tip', fmt(d.triTip.cut)); if (d.triTip.addons?.length) pc('  Add-on', adds(d.triTip.addons), true) }
    }
    ps('Flank')
    if (d.skirt?.cut)  { d.skirt.cut  === 'grind' ? pg('Skirt')       : pc('Skirt Steak',  fmt(d.skirt.cut)) }
    if (d.flank?.cut)  { d.flank.cut  === 'grind' ? pg('Flank Steak') : pc('Flank Steak',  fmt(d.flank.cut)) }
    ps('Round')
    const packSirloinTip = (t: { cut?: string; roastCount?: string; thickness?: string; addons?: string[] }, sfx: string) => {
      if (t.cut === 'grind') { pg(`Sirloin Tip${sfx}`); return }
      if (!t.cut) return
      pc(`Sirloin Tip${sfx}`, roastOr(t.cut, t.roastCount, c => withT(c, t.thickness ?? '')))
      if (t.addons?.length) pc('  Add-on', adds(t.addons), true)
    }
    const sameTip = (a: any, b: any) => a?.cut === b?.cut && (a?.roastCount ?? '') === (b?.roastCount ?? '') && (a?.thickness ?? '') === (b?.thickness ?? '')
      && adds(a?.addons ?? []) === adds(b?.addons ?? [])
    if (d.sirloinTip?.tip2 && !sameTip(d.sirloinTip, d.sirloinTip.tip2)) {
      packSirloinTip(d.sirloinTip, ' (1)')
      packSirloinTip(d.sirloinTip.tip2, ' (2)')
    } else if (d.sirloinTip?.cut) {
      packSirloinTip(d.sirloinTip, '')
    }
    // Split rounds get a line per side so each is packed separately
    const packRound = (label: string, r: any, sfx = '') => {
      if (!r?.cut) return
      if (r.cut === 'grind') { pg(`${label}${sfx}`); return }
      pc(`${label}${sfx}`, roundOne(r))
      if (r.addons?.length) pc('  Add-on', adds(r.addons), true)
    }
    const sameRound = (a: any, b: any) => roundOne(a) === roundOne(b) && a?.cut === b?.cut
    if (d.bottomRound?.round2 && !sameRound(d.bottomRound, d.bottomRound.round2)) { packRound('Bottom Round', d.bottomRound, ' (1)'); packRound('Bottom Round', d.bottomRound.round2, ' (2)') }
    else packRound('Bottom Round', d.bottomRound)
    if (d.eyeOfRound?.cut)  { d.eyeOfRound.cut  === 'grind' ? pg('Eye of Round')  : pc('Eye of Round',  withT(d.eyeOfRound.cut,  d.eyeOfRound.thickness  ?? '')) }
    if (d.rumpRoast?.cut)   { d.rumpRoast.cut   === 'grind' ? pg('Rump Roast')    : pc('Rump Roast',    withT(d.rumpRoast.cut,   d.rumpRoast.thickness   ?? '')) }
    if (d.topRound?.round2 && !sameRound(d.topRound, d.topRound.round2)) { packRound('Top Round', d.topRound, ' (1)'); packRound('Top Round', d.topRound.round2, ' (2)') }
    else packRound('Top Round', d.topRound)
    if (wanted(d.roundShank?.marrow)) pc('Round Shank / Marrow', fmt(d.roundShank.marrow))
  }

  if (isPork && !d.grindWhole) {
    const loin = d.loin ?? {}
    ps('Shoulder')
    // A whole hog's two shoulders can be cut differently — pack each one that
    // isn't ground, labelling the sides only when they actually differ.
    const packShoulder = (sh: any, sfx: string) => {
      if (!sh?.cut) return
      if (sh.cut === 'grind') { pg(`Shoulder${sfx}`); return }
      pc(`Shoulder${sfx}`, [
        fmt(sh.cut),
        sh.cut === 'roast'  && sh.roastSize      ? `${sh.roastSize} lb`      : '',
        sh.cut === 'steaks' && sh.steakThickness ? thick(sh.steakThickness)  : '',
      ].filter(Boolean).join(' · '))
      if (sh.addons?.length) pc('  Add-on', adds(sh.addons), true)
    }
    const sh2 = d.shoulder?.shoulder2
    const sameShoulder = sh2 && JSON.stringify(shoulderFields(d.shoulder, fmt, thick)) === JSON.stringify(shoulderFields(sh2, fmt, thick))
    if (sh2 && !sameShoulder) { packShoulder(d.shoulder, ' (1)'); packShoulder(sh2, ' (2)') }
    else packShoulder(d.shoulder, '')
    ps('Loin')
    // A whole hog's two loins can be cut differently, so each side packs on its
    // own line — labelled (1)/(2) only when they actually differ.
    const packLoin = (ln: any, sfx: string) => {
      if (!ln?.cut) return
      if (ln.cut === 'grind') { pg(`Loin${sfx}`); return }
      if (ln.cut === 'bone-in-chops' || ln.cut === 'boneless-chops' || ln.cut === 'smoked-chops') {
        pc(`Chops${sfx}`, [fmt(ln.cut), thick(ln.chopThickness ?? ''), ln.chopPack ? `${ln.chopPack}/pkg` : ''].filter(Boolean).join(' · '))
        if (ln.cut === 'boneless-chops' && ln.babyBack) pc(`Baby Back Ribs${sfx}`, fmt(ln.babyBack))
      } else if (ln.cut === 'loin-roast') {
        pc(`Boneless Loin Roast${sfx}`, fmt(ln.roastSize ?? ''))
      } else {
        // Anything else the wizard offers (e.g. cubed pork) still has to reach
        // the packagers — without this the loin silently left the sheet.
        pc(`Loin${sfx}`, fmt(ln.cut))
      }
      if (ln.tenderloin === 'grind') pg(`Tenderloin${sfx}`)
      else if (ln.tenderloin) pc(`Tenderloin${sfx}`, fmt(ln.tenderloin))
      if (ln.addons?.length) pc('  Add-on', adds(ln.addons), true)
    }
    const loin2 = loin.loin2
    const sameLoin = loin2 && JSON.stringify(loinFields(loin, fmt, thick)) === JSON.stringify(loinFields(loin2, fmt, thick))
    if (loin2 && !sameLoin) { packLoin(loin, ' (1)'); packLoin(loin2, ' (2)') }
    else packLoin(loin, '')
    ps('Belly')
    if (d.belly?.cut === 'grind' && !d.belly?.cut2) pg('Belly')
    else bellyRows(d.belly).forEach(([l, v]) => (v === 'Grind' ? pg(l) : pc(l, v)))
    ps('Ham & Hocks')
    if (d.ham?.style === 'grind' && !d.ham?.style2) pg('Ham')
    else hamRows(d.ham).forEach(([l, v]) => (v === 'Grind' ? pg(l) : pc(l, v)))
    // Hocks always come the way the hams do, so the spec column only repeated
    // the line above it. The packer needs the row and its checkbox, not the
    // wording (Charlie, 2026-07-22). hockStyle is still what decides whether
    // there are hocks at all — a ham sent to grind leaves none.
    if (d.hocks?.cut || hockStyle(d.ham)) pc('Hocks', '')
    ps('Country Style Ribs')
    if (d.spareRibs?.cut) pc('Country Style Ribs', fmt(d.spareRibs.cut))
  }

  if (isLG) {
    ps('Primals')
    if (d.rack?.cut)     { d.rack.cut     === 'grind' ? pg('Rack')     : pc('Rack',     rackDisplay(d.rack.cut)) }
    if (d.loin?.cut) {
      d.loin.cut === 'grind' ? pg('Loin')
        : pc('Loin', [fmt(d.loin.cut), thick(d.loin.chopThickness ?? ''), d.loin.chopPack ? `${d.loin.chopPack}/pkg` : ''].filter(Boolean).join(' · '))
    }
    // Split legs and shoulders get a line per side so each is packed separately
    const packLeg = (cut: string, sfx: string) => {
      if (!cut) return
      if (cut === 'grind') { pg(`Leg${sfx}`); return }
      pc(`Leg${sfx}`, [fmt(cut), cut === 'leg-steaks' ? thick(d.leg.steakThickness ?? '') : '',
        cut === 'leg-steaks' && d.leg.steakPack ? `${d.leg.steakPack}/pkg` : ''].filter(Boolean).join(' · '))
    }
    if (d.leg?.cut2 && d.leg.cut2 !== d.leg.cut) { packLeg(d.leg.cut, ' (1)'); packLeg(d.leg.cut2, ' (2)') }
    else packLeg(d.leg?.cut ?? '', '')
    const packShoulder = (cut: string, sfx: string) => {
      if (!cut) return
      cut === 'grind' ? pg(`Shoulder${sfx}`) : pc(`Shoulder${sfx}`, fmt(cut))
    }
    if (d.shoulder?.cut2 && d.shoulder.cut2 !== d.shoulder.cut) { packShoulder(d.shoulder.cut, ' (1)'); packShoulder(d.shoulder.cut2, ' (2)') }
    else packShoulder(d.shoulder?.cut ?? '', '')
    if (d.shank?.cut)    { d.shank.cut    === 'grind' ? pg('Shank')    : pc('Shank',    fmt(d.shank.cut)) }
    if (d.trim?.style)   { d.trim.style   === 'grind' ? pg('Trim')     : pc('Trim',     lgTrimLabel(d.trim.style, species, d.trim.bagSize)) }
  }

  // Strip section headers that have no cut rows under them
  const activeSectionIdxs = new Set<number>()
  prs.forEach((pr, i) => {
    if (!pr.sectionTitle) {
      for (let j = i - 1; j >= 0; j--) { if (prs[j].sectionTitle) { activeSectionIdxs.add(j); break } }
    }
  })
  const filteredPrs = prs.filter((pr, i) => !pr.sectionTitle || activeSectionIdxs.has(i))

  // Ground/trim section: packaging style & size from the v2 trim step, plus which cuts went to grind
  const trimPrs = isBeef ? beefTrimPackRows(d.trim) : isPork ? porkTrimRows(d.trim, fmt) : []
  if (trimPrs.length || grindFrom.length) {
    filteredPrs.push({ sectionTitle: trimIsBagged(d.trim) ? 'Trim' : isPork ? 'Sausage / Trim' : `Ground ${species}` })
    trimPrs.forEach(([l, v]) => filteredPrs.push({ cut: l, spec: v }))
    // On pork everything sent to grind BECOMES the sausage listed above, so a
    // separate "Ground Pork · From: Hams" row read as though the ham were a
    // second, different product — the opposite of what it means (Charlie, on
    // Kyle Barner's card). Only name the grind sources when there's no sausage
    // for them to go into, so the destination is never lost.
    const namesGrindSources = grindFrom.length > 0 && !(isPork && trimPrs.length > 0)
    if (namesGrindSources) filteredPrs.push({ cut: `Ground ${species}`, spec: `From: ${grindFrom.join(', ')}`, isGrind: true })
  }

  // Smokehouse: what to build from this animal's trim, and the total to hold
  // back before the rest is ground.
  const smokeRows = smokehouseRows(d.smokehouse, fmt)
  if (smokeRows.length) {
    filteredPrs.push({ sectionTitle: 'Smokehouse' })
    // Each product gets a ruled blank for the raw trim weight going in — the
    // number the making charge is billed on, which nothing captured before
    // (Jill, 2026-07-27).
    smokeRows.forEach(([l, v]) => filteredPrs.push({ cut: l, spec: v, writeIn: true }))
    const totalLbs = smokehouseTotalLbs(d.smokehouse)
    if (totalLbs > 0) {
      filteredPrs.push({ cut: 'Trim to save', spec: `${+totalLbs.toFixed(1)} lbs total for the smokehouse`, isGrind: true })
    }
  }

  // Raw weight in, for billing curing and sausage work. Blank by design — the
  // Wt (lbs) column is where it gets written as each batch goes in.
  const weighIn = rawWeighInRows(d, fmt)
  if (weighIn.length) {
    filteredPrs.push({ sectionTitle: 'Raw Weight In — Curing & Sausage' })
    weighIn.forEach(([l, v]) => filteredPrs.push({ cut: l, spec: v, writeIn: true }))
  }

  // ── Split packaging rows into balanced columns (at section boundaries) ────
  // Landscape fits three tables across; splits only ever land where a new
  // section starts so a primal's rows never straddle columns. Sections are
  // atomic and packed greedily left-to-right, always leaving at least one
  // section for each still-empty column — so no column is stranded empty while
  // another overflows onto a second page (the old target-based split could dump
  // the whole tail into one column when a big final section had no boundary
  // after the target row).
  const PACK_COLS = 3
  // Group the flat row list into sections: each carries its title row plus its
  // body rows, and a count of just the body rows (what column height balances on).
  const sections: { rows: typeof filteredPrs; count: number }[] = []
  for (const pr of filteredPrs) {
    if (pr.sectionTitle) sections.push({ rows: [pr], count: 0 })
    else if (sections.length) { const s = sections[sections.length - 1]; s.rows.push(pr); s.count++ }
  }
  const packCols: (typeof filteredPrs)[] = []
  let rowsLeft = filteredPrs.filter(pr => !pr.sectionTitle).length
  let si = 0
  for (let c = 0; c < PACK_COLS; c++) {
    const colsLeft = PACK_COLS - c
    const target = Math.ceil(rowsLeft / colsLeft)
    const col: typeof filteredPrs = []
    let colRows = 0
    while (si < sections.length) {
      const sec = sections[si]
      const sectionsLeft = sections.length - si
      // Keep one section in reserve for each column still to be filled.
      if (col.length && sectionsLeft <= colsLeft - 1) break
      // Column is carrying its share — stop, as long as enough sections remain
      // to fill the rest.
      if (col.length && colRows + sec.count > target && sectionsLeft > colsLeft - 1) break
      col.push(...sec.rows)
      colRows += sec.count
      rowsLeft -= sec.count
      si++
    }
    packCols.push(col)
  }

  // Renders an array of PR rows into a complete packaging table (thead + tbody)
  const buildPackTable = (prs: typeof filteredPrs) => {
    let tbody = ''
    let rowCount = 0
    for (const pr of prs) {
      if (pr.sectionTitle) {
        rowCount = 0
        const c = PRIMAL_COLORS[pr.sectionTitle]
        tbody += `<tr><td colspan="5" style="background:${c?.bar ?? '#351E0E'};color:${c?.text ?? '#F2E8D9'};padding:4px 8px;font-size:16px;letter-spacing:0.12em;text-transform:uppercase;font-weight:bold">${pr.sectionTitle}</td></tr>`
        continue
      }
      const bg  = pr.isGrind ? '#fff8e6' : pr.isAddon ? '#fffbe8' : rowCount % 2 === 0 ? '#fff' : '#faf6f1'
      if (!pr.isAddon) rowCount++
      const fw  = pr.isAddon || pr.isGrind ? 'normal' : '700'
      const fi  = pr.isAddon ? 'italic' : 'normal'
      const pl  = pr.isAddon ? '18px' : '8px'
      const clr = pr.isAddon ? '#8a6200' : '#1A0A04'
      tbody += `<tr style="background:${bg}">
        <td style="padding:6px ${pl} 6px 8px;font-size:22px;font-weight:${fw};font-style:${fi};color:${clr};vertical-align:top">${pr.cut ?? ''}</td>
        <td style="padding:6px 8px;font-size:18px;color:#555;vertical-align:top">${pr.spec ?? ''}</td>
        <td style="padding:6px 4px;width:58px;border-left:1px solid #ddd;text-align:center">${pr.writeIn ? '<span style="color:#bbb;font-size:16px">—</span>' : ' '}</td>
        <td style="padding:6px 4px;width:68px;border-left:1px solid #ddd;text-align:center">${
          // A ruled blank, so the raw weight has an obvious place to land
          pr.writeIn ? '<span style="display:inline-block;width:56px;border-bottom:1.5px solid #1A0A04">&nbsp;</span>' : ' '
        }</td>
        <td style="padding:6px 4px;width:36px;border-left:1px solid #ddd;text-align:center;font-size:20px;color:#999">☐</td>
      </tr>`
    }
    const thStyle = 'padding:6px 8px;text-align:left;color:#F2E8D9;font-size:13px;letter-spacing:0.08em;text-transform:uppercase'
    return `<table style="width:100%;border-collapse:collapse;border:1px solid #ddd">
      <thead><tr style="background:#1A0A04">
        <th style="${thStyle}">Cut</th>
        <th style="${thStyle}">Style / Spec</th>
        <th style="${thStyle};text-align:center;width:48px">Pkgs</th>
        <th style="${thStyle};text-align:center;width:56px">Wt (lbs)</th>
        <th style="${thStyle};text-align:center;width:30px">✓</th>
      </tr></thead>
      <tbody>${tbody}</tbody>
    </table>`
  }

  // ── Assemble HTML ─────────────────────────────────────────────────────────
  const submittedDate = new Date(ci.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

  // The logo (white variant for the dark bar) replaces the "Cowboy Meat Company"
  // wordmark. Absolute origin so it still resolves inside the printed blob doc.
  const assetBase = typeof window !== 'undefined' ? window.location.origin : ''
  const hdr = (subtitle: string) =>
    `<div style="background:#1A0A04;color:#F2E8D9;padding:9px 16px;display:flex;align-items:center;justify-content:space-between;margin-bottom:9px">
       <div style="display:flex;align-items:center;gap:14px"><img src="${assetBase}/cmc-logo-white.png" alt="Cowboy Meat Co" style="height:34px;display:block">
            <span style="font-size:16px;color:#C9A882;letter-spacing:0.05em">— ${subtitle}</span></div>
       <div style="font-size:13px;color:#C9A882">Submitted: ${submittedDate}</div>
     </div>`

  // Several animals came in on this check-in and none of them is assigned to
  // this customer, so the card cannot say which one is hers. Blank tag and
  // weight lines look identical to "not filled in yet", so say it outright —
  // this is the one failure the floor cannot be left to infer.
  const unassignedBand = (carcass: CarcassInfo) =>
    carcass.state !== 'ambiguous' ? '' :
    `<div style="border:3px solid #1A0A04;margin-bottom:8px">
       <div style="background:#1A0A04;color:#F2E8D9;padding:5px 12px;font-size:19px;font-weight:bold;letter-spacing:0.08em">
         ⚠ CARCASS NOT ASSIGNED — DO NOT CUT
       </div>
       <div style="padding:5px 12px;font-size:15px">
         ${carcass.candidates.length} animals came in on this check-in and none is assigned to
         <strong>${d.customerName ?? 'this customer'}</strong>, so this card cannot say which one is hers.
         Tags on this check-in: <strong>${carcass.candidates.map(c => esc(c.tag || '?')).join(', ')}</strong>.
         Assign the carcass on the cutting card, then reprint.
       </div>
     </div>`

  // "Grind the whole animal" overrides every section below it, so it prints as
  // a band across the top rather than a row someone has to find (Jill,
  // 2026-07-27). The primal sections are empty on these cards and drop out.
  const grindBand = d.grindWhole
    ? `<div style="background:#1A0A04;color:#F2E8D9;padding:5px 12px;font-size:19px;font-weight:bold;letter-spacing:0.08em;margin-bottom:8px">
         GRIND THE WHOLE ${species.toUpperCase()} — NO STEAKS, CHOPS OR ROASTS
       </div>`
    : ''

  const infoGrid = (carcass: CarcassInfo) =>
    `<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0;border:1.5px solid #C9A882;margin-bottom:8px">
       <div style="padding:6px 11px;border-right:1px solid #C9A882">
         <div style="font-size:12px;color:#75471B;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:2px">Customer</div>
         <div style="font-size:24px;font-weight:bold">${d.customerName ?? '—'}</div>
         ${d.customerPhone ? `<div style="font-size:16px;color:#555;margin-top:1px">${d.customerPhone}</div>` : ''}
       </div>
       <div style="padding:6px 11px;border-right:1px solid #C9A882">
         <div style="font-size:12px;color:#75471B;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:2px">Animal</div>
         <div style="font-size:24px;font-weight:bold">${species}${d.portion ? ' · ' + fmt(d.portion) : ''}</div>
         <div style="font-size:16px;color:#555;margin-top:1px">Harvest Date: ${d.killDate ?? '—'}</div>
         ${/* One answer for the whole order, so it rides in the header where it
              governs every steak below rather than repeating on each row. */
           d.steakPack ? `<div style="font-size:18px;margin-top:3px">Steaks: <span style="font-weight:bold">${esc(String(d.steakPack))} per pack</span></div>` : ''}
         ${
           // Custom Exempt can never be sold, so it prints loud and inverted;
           // USDA prints as a quieter outline. Unknown gets a line to write on
           // rather than silence, since the floor must not have to assume.
           carcass.killType === 'Custom'
             ? `<div style="margin-top:4px;display:inline-block;background:#1A0A04;color:#F2E8D9;font-size:14px;font-weight:bold;letter-spacing:0.06em;padding:2px 7px">${killTypeLabel(carcass.killType)}</div>`
             : carcass.killType
               ? `<div style="margin-top:4px;display:inline-block;border:1.5px solid #1A0A04;font-size:14px;font-weight:bold;letter-spacing:0.06em;padding:1px 6px">${killTypeLabel(carcass.killType)}</div>`
               : `<div style="font-size:16px;color:#555;margin-top:3px">Inspection: ${wline(120)}</div>`
         }
         ${
           // Over 30 months makes the vertebral column SRM — it has to come out
           // and can't go in the box. Beef only; pork/lamb/goat have no such
           // rule, and an unknown age gets a line rather than a wrong answer.
           !isBeef ? ''
             : carcass.over30 === true
               ? `<div style="margin-top:4px;display:inline-block;background:#1A0A04;color:#F2E8D9;font-size:14px;font-weight:bold;letter-spacing:0.06em;padding:2px 7px">OVER 30 MONTHS — REMOVE VERTEBRAL COLUMN</div>`
               : carcass.over30 === false
                 ? `<div style="margin-top:4px;display:inline-block;border:1.5px solid #1A0A04;font-size:14px;font-weight:bold;letter-spacing:0.06em;padding:1px 6px">UNDER 30 MONTHS</div>`
                 : `<div style="font-size:16px;color:#555;margin-top:3px">Over / Under 30 mo: ${wline(110)}</div>`
         }
       </div>
       <div style="padding:6px 11px">
         <div style="font-size:12px;color:#75471B;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:2px">Producer · Lot / Tag</div>
         <div style="font-size:20px;font-weight:bold;line-height:1.2">${carcass.producer || wline(150)}</div>
         <div style="font-size:18px;font-weight:bold;margin-top:3px">Lot&nbsp;# ${carcass.lot || wline(56)} &nbsp;·&nbsp; Tag&nbsp;# ${carcass.tag || wline(46)}</div>
         <div style="font-size:18px;margin-top:3px">Hanging Wt: <span style="font-weight:bold">${carcass.hcw != null ? `${carcass.hcw} lbs` : wline(70)}</span></div>
       </div>
     </div>`

  return carcasses.map((carcass, ci_) => {
  // "1 of 2" only when there really are several, so a normal single-animal
  // card reads exactly as it always has.
  const ofN  = carcasses.length > 1 ? ` — Animal ${ci_ + 1} of ${carcasses.length}` : ''
  // Only the very last page of the whole document skips the break; in a batch,
  // every earlier card still has to break before the next one starts.
  const last = isLastCard && ci_ === carcasses.length - 1
  return `
<!-- PAGE 1: CUT CARD — 3-column section layout -->
<div class="page pagebreak">
  ${hdr('Cut Card' + ofN)}
  ${unassignedBand(carcass)}
  ${grindBand}
  ${infoGrid(carcass)}
  <div style="column-count:3;column-gap:14px">
    ${cutSections}
  </div>
</div>

<!-- PAGE 2: PACKAGING SHEET — 3-column table layout -->
<div class="page packsheet${last ? '' : ' pagebreak'}">
  ${hdr('Packaging Sheet' + ofN)}
  ${unassignedBand(carcass)}
  ${grindBand}
  <div style="font-size:16px;color:#555;margin-bottom:8px">
    <strong>${d.customerName ?? '—'}</strong>${d.portion ? ' · ' + fmt(d.portion) : ''} · Harvest Date: ${d.killDate ?? '—'}
    <span style="margin-left:14px">Producer: <span style="font-weight:bold">${carcass.producer || wline(110)}</span></span>
    <span style="margin-left:14px">Lot # <span style="font-weight:bold">${carcass.lot || wline(46)}</span> · Tag # <span style="font-weight:bold">${carcass.tag || wline(38)}</span></span>
    <span style="margin-left:14px">Hanging Wt: <span style="font-weight:bold">${carcass.hcw != null ? `${carcass.hcw} lbs` : wline(58)}</span></span>
    ${d.steakPack ? `<span style="margin-left:14px">Steaks: <span style="font-weight:bold">${esc(String(d.steakPack))} per pack</span></span>` : ''}
  </div>
  <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
    ${packCols.map(col => `<div>${col.length ? buildPackTable(col) : ''}</div>`).join('')}
  </div>
  ${d.notes ? `<div style="margin-top:10px;border:1px solid #C9A882;padding:8px"><div style="font-size:12px;color:#75471B;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:4px">Special Notes</div><div style="font-size:18px">${d.notes}</div></div>` : ''}
  <div style="margin-top:auto;padding-top:18px;display:grid;grid-template-columns:1fr 1fr;gap:20px">
    <div style="border-top:1px solid #888;padding-top:5px;font-size:13px;color:#75471B;text-transform:uppercase;letter-spacing:0.08em">Packed by / Date</div>
    ${
      // A hog fills its boxes in stages — a couple of cuts, then sausage, then
      // hams and bacon back from the smokehouse — so the packager circles the
      // running count as it climbs instead of writing one total they don't know
      // yet. Runs to 8 because the big ones go past six (Charlie, 2026-07-24).
      isPork
        ? `<div style="border-top:1px solid #888;padding-top:5px">
             <div style="font-size:13px;color:#75471B;text-transform:uppercase;letter-spacing:0.08em">Box Count — circle as filled</div>
             <div style="display:flex;gap:10px;margin-top:3px">
               ${[1, 2, 3, 4, 5, 6, 7, 8].map(n => `<span style="width:34px;height:34px;line-height:34px;text-align:center;font-size:22px;font-weight:bold">${n}</span>`).join('')}
             </div>
           </div>`
        : `<div style="border-top:1px solid #888;padding-top:5px;font-size:13px;color:#75471B;text-transform:uppercase;letter-spacing:0.08em">Total Boxes</div>`
    }
  </div>
</div>`
}).join('\n')
}

// The document shell every printed card sits in. Landscape matches the wall
// monitors these are headed for, and three columns across beats two tall ones.
function cardDocument(title: string, body: string): string {
  return `<!DOCTYPE html>
<html><head>
  <meta charset="UTF-8">
  <title>${title}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: Arial, sans-serif; color: #1A0A04; margin: 0; padding: 18px; }
    @page { margin: 0.4in; size: letter landscape; }
    /* Letter landscape less 0.4in margins all round. Every page is laid out at
       exactly the printable size so what's measured on screen is what prints —
       otherwise the browser window's width decides the column flow and the fit
       pass below measures a page that never existed. */
    .page { width: 10.2in; }
    /* The packaging sheet fills the sheet so its sign-off line drops to the very
       bottom like a real footer instead of floating right under the tables. Held
       just under the auto-fit LIMIT (7.7in) below so a normal sheet that already
       fits never trips the shrink pass. */
    .packsheet { min-height: 7.6in; display: flex; flex-direction: column; }
    @media screen {
      body { background: #efece7; }
      .page { margin: 0 auto 18px; background: #fff; outline: 1px solid #d8d0c6; }
    }
    /* Big type can push a loaded card past one sheet — keep rows whole when
       content flows across the page break. */
    tr { break-inside: avoid; page-break-inside: avoid; }
    @media print {
      body { padding: 0; background: none; }
      .pagebreak { page-break-after: always; }
      * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    }
  </style>
</head>
<body>

${body}

<script>
(function () {
  // A card that measures taller than the printable area spills onto a second
  // sheet, which splits one animal's instructions across two pieces of paper on
  // the cutting floor. Shrink it just enough to land on one.
  //
  // Only as far as FLOOR, though, and never by clipping: the type is sized to be
  // read across the cutting room, and a card nobody can read from the rail is
  // worse than a card that ran to two pages. Anything still over at the floor is
  // left alone to paginate as before.
  var LIMIT = 7.7 * 96
  var FLOOR = 0.62
  var pages = document.querySelectorAll('.page')
  for (var i = 0; i < pages.length; i++) {
    var page = pages[i]
    var scale = 1
    // Zoom reflows the columns rather than just scaling pixels, so the height
    // after shrinking isn't a straight multiple of the height before it —
    // converge instead of computing one factor.
    for (var pass = 0; pass < 6; pass++) {
      var h = page.getBoundingClientRect().height
      if (h <= LIMIT || scale <= FLOOR) break
      scale = Math.max(FLOOR, scale * (LIMIT / h) * 0.995)
      page.style.zoom = scale
    }
    if (scale < 1) page.setAttribute('data-fit', scale.toFixed(3))
  }
})()
</script>

</body></html>`
}

function openPrintable(html: string) {
  const blob = new Blob([html], { type: 'text/html' })
  const url  = URL.createObjectURL(blob)
  const win  = window.open(url, '_blank')
  if (win) { win.onload = () => { URL.revokeObjectURL(url) } }
}

function printV2CutCard(ci: RawInstruction, carcassArg: CarcassInfo | CarcassInfo[] = EMPTY_CARCASS) {
  const name = ci.data?.customerName ?? '—'
  openPrintable(cardDocument(`Cut Card — ${name}`, v2CardPages(ci, carcassArg)))
}

// A whole batch in one document, so the crew gets a single print job instead of
// opening every card in turn (Jill, 2026-07-21).
function printV2CutCards(items: { ci: RawInstruction; carcasses: CarcassInfo[] }[]) {
  if (!items.length) return
  const body = items
    .map((it, i) => v2CardPages(it.ci, it.carcasses, i === items.length - 1))
    .join('\n')
  openPrintable(cardDocument(`Cut Cards — ${items.length} card${items.length === 1 ? '' : 's'}`, body))
}

// ── Test / preview data ───────────────────────────────────────────────────────

const FAKE_CI: RawInstruction = {
  id: 'test-preview',
  created_at: new Date().toISOString(),
  status: 'pending',
  data: {
    formVersion: 'v2',
    species: 'Beef',
    customerName: 'John Anderson',
    customerPhone: '(406) 555-0123',
    customerEmail: 'john@example.com',
    killDate: '2026-06-02',
    portion: 'whole',
    notes: 'Please call 3 days before pickup. No MSG in any sausage.',
    organs: { heart: 'keep', liver: 'keep', tongue: 'no', oxtail: 'yes' },
    brisket:   { cut: 'packer-half', fat: 'fat-on' },
    shank:     { cut: 'osso-bucco', addons: [] },
    armRoast:  { cut: 'thirds', addons: ['seasoned'], arm2: { cut: 'rancher-steaks', addons: [] } },
    flatIron:  { cut: 'steaks' },
    chuckRoll: { cut: 'chuck-steaks', addons: [], cut2: 'half', addons2: ['seasoned'] },
    shortRibs: { cut: 'flanken' },
    plate:     { cut: 'beef-bacon' },
    ribeye:    { style: 'boneless', cut: 'steaks', thickness: '1', seasoned: false, ribeye2: { style: 'bone-in', cut: 'rib-roast-half', thickness: '', seasoned: true } },
    shortLoin: { path: 'bone-in', tBoneThickness: '1.25', loin2: { path: 'boneless', tenderloin: { cut: 'filet', thickness: '2"' }, stripLoin: { cut: 'ny-strip', thickness: '1' } } },
    topSirloin:{ cut: 'roast', thickness: '', addons: ['seasoned'] },
    triTip:    { cut: 'grind', addons: [] },
    skirt:     { cut: 'cut-half' },
    flank:     { cut: 'keep-whole' },
    sirloinTip:  { mode: 'split', cut: 'roast-half', thickness: '', addons: ['seasoned'], tip2: { cut: 'steaks', thickness: '1', addons: [] } },
    bottomRound: { cut: 'jerky', jerkyFlavor: 'cowboy-ranch' },
    topRound:    { cut: 'cubed-steak' },
    roundShank:  { marrow: 'canoe' },
    trim:        { fatPct: '85/15', pattyPct: 30, patties: { size: '4:1', pkg: '1lb' }, loose: { packSize: '1.5', rollstock: false } },
    specialty: { interest: 'yes', notes: 'Interested in smoked brisket and beef sticks' },
  },
}

// ── Main component ────────────────────────────────────────────────────────────

export default function CuttingInstructionsPage() {
  const [instructions, setInstructions] = useState<RawInstruction[]>([])
  const [appointments, setAppointments] = useState<HarvestAppointment[]>([])
  const [loading, setLoading]           = useState(true)
  const [selected, setSelected]         = useState<RawInstruction | null>(null)
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [filterSpecies, setFilterSpecies] = useState<string>('all')
  // Slaughter (kill) date filter — Jill works a kill day at a time when linking
  // cut sheets to animals (Jill, 2026-07-29). '' = all dates.
  const [filterSlaughter, setFilterSlaughter] = useState<string>('')
  const [showLinkPicker, setShowLinkPicker] = useState(false)
  const [linking, setLinking]           = useState(false)
  // Copy-this-card-onto-another-share flow: which portion the copy is for, and
  // whether one is being made right now.
  const [showCopyPicker, setShowCopyPicker] = useState(false)
  const [copyPortion, setCopyPortion]   = useState('half')
  const [copying, setCopying]           = useState(false)
  // Which carcass each linked card sits on, keyed by instruction id. Loaded in
  // bulk after the list so an unassigned card can be flagged before it prints.
  const [carcassStates, setCarcassStates] = useState<Record<string, CarcassInfo[]>>({})
  const [assigning, setAssigning]       = useState('')
  const [assignError, setAssignError]   = useState('')
  // Cards ticked for a batch print. Separate from `selected`, which drives the
  // detail panel — clicking a row to read it shouldn't add it to the batch.
  const [picked, setPicked]             = useState<Set<string>>(new Set())
  const [printingBatch, setPrintingBatch] = useState(false)

  async function load() {
    setLoading(true)
    const [ciRes, apptRes] = await Promise.all([
      fetch('/api/cutting-instructions'),
      fetch('/api/appointments'),
    ])
    const ci   = await ciRes.json()
    const appt = await apptRes.json()
    const cis    = Array.isArray(ci)   ? ci   : []
    const appts  = Array.isArray(appt) ? appt : []
    setInstructions(cis)
    setAppointments(appts)
    setLoading(false)
    loadCarcassStates(cis, appts)
  }

  // Which animal each linked card actually belongs to, for every card at once.
  // Two calls for the whole page rather than two per card, so the list can warn
  // about cards whose carcass was never assigned without a burst of requests.
  async function loadCarcassStates(cis: RawInstruction[], appts: HarvestAppointment[]) {
    const linkedApptIds = [...new Set(
      appts.filter(a => a.customers?.some(c => c.linked_cutting_instruction_id))
           .map(a => a.id)
    )]
    if (!linkedApptIds.length) { setCarcassStates({}); return }
    try {
      const logsRes = await fetch(`/api/harvest?appointment_ids=${encodeURIComponent(linkedApptIds.join(','))}`)
      const logs    = await logsRes.json()
      const logList = Array.isArray(logs) ? logs : []
      const asgRes  = await fetch(`/api/carcass-assignments?harvest_log_ids=${encodeURIComponent(logList.map((l: any) => l.id).join(','))}`)
      const asgs    = await asgRes.json()
      const asgList = Array.isArray(asgs) ? asgs : []

      const next: Record<string, CarcassInfo[]> = {}
      for (const ciRow of cis) {
        const mine = appts.filter(a => a.customers?.some(c => c.linked_cutting_instruction_id === ciRow.id))
        if (!mine.length) continue
        next[ciRow.id] = mine.map(a => resolveCarcass(
          ciRow.id, a,
          logList.filter((l: any) => l.appointment_id === a.id),
          asgList.filter((x: any) => x.appointment_id === a.id),
          logList,
        ))
      }
      setCarcassStates(next)
    } catch {
      setCarcassStates({})   // never block the page on this
    }
  }

  // Put this card on a specific animal. The assignments API rewrites a whole
  // check-in at once, so keep everyone else's exactly as-is and swap only the
  // rows belonging to this card's customer slot.
  async function assignCarcass(apptId: string, harvestLogId: string) {
    if (!selected) return
    setAssigning(harvestLogId)
    try {
      const appt = appointments.find(a => a.id === apptId)
      const slot = appt?.customers?.find(c => c.linked_cutting_instruction_id === selected.id)
      if (!appt || !slot) return
      const existing = await (await fetch(`/api/carcass-assignments?appointment_id=${encodeURIComponent(apptId)}`)).json()
      const others = (Array.isArray(existing) ? existing : [])
        .filter((a: any) => a.appointment_customer_id !== slot.id)
        .map((a: any) => ({
          harvest_log_id: a.harvest_log_id,
          appointment_customer_id: a.appointment_customer_id,
          customer_name: a.customer_name,
          portion: a.portion,
          linked_cutting_instruction_id: a.linked_cutting_instruction_id,
        }))
      const res = await fetch('/api/carcass-assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appointment_id: apptId,
          assignments: [...others, {
            harvest_log_id: harvestLogId,
            appointment_customer_id: slot.id,
            customer_name: slot.customer_name,
            portion: slot.portion || 'Whole',
            linked_cutting_instruction_id: selected.id,
          }],
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setAssignError(body.error || 'Could not assign that carcass.')
        return
      }
      setAssignError('')
      await loadCarcassStates(instructions, appointments)
    } finally {
      setAssigning('')
    }
  }

  useEffect(() => {
    load()
    // Opening this page marks all submissions as seen — clears the "new
    // submissions" bubble on the dashboard tile.
    try { localStorage.setItem('cutInstrSeenAt', new Date().toISOString()) } catch { /* private browsing */ }
  }, [])

  // Linked to a check-in but not to an animal — these are the cards that print
  // blank tag, blank hanging weight and no inspection marking.
  const needsCarcass = (id: string) => (carcassStates[id] ?? []).some(s => s.state === 'ambiguous')
  const needCarcassCount = instructions.filter(i => i.status !== 'archived' && needsCarcass(i.id)).length

  const filtered = instructions.filter(i => {
    const species = speciesOf(i)
    // Archived cards are hidden everywhere except the "archived" tab
    if (filterStatus === 'needs-carcass') {
      if (i.status === 'archived' || !needsCarcass(i.id)) return false
    } else if (filterStatus === 'archived') {
      if (i.status !== 'archived') return false
    } else if (filterStatus === 'all') {
      if (i.status === 'archived') return false
    } else if (i.status !== filterStatus) {
      return false
    }
    if (filterSpecies !== 'all') {
      // v2 wizard says "Pork", the filter button says "Hog" — treat them as the same animal
      const match = filterSpecies === 'Hog' ? (species === 'Hog' || species === 'Pork') : species === filterSpecies
      if (!match) return false
    }
    if (filterSlaughter) {
      const sd = slaughterDateFor(i, appointments)
      if (filterSlaughter === '__none__' ? !!sd : sd !== filterSlaughter) return false
    }
    return true
  })

  // Slaughter dates present in the active (non-archived) cards, newest first, for
  // the filter dropdown. A card with no scheduled kill date falls under "— none —".
  const slaughterDates = Array.from(new Set(
    instructions
      .filter(i => i.status !== 'archived')
      .map(i => slaughterDateFor(i, appointments))
      .filter((d): d is string => !!d)
  )).sort((a, b) => b.localeCompare(a))
  const anyNoSlaughter = instructions.some(i => i.status !== 'archived' && !slaughterDateFor(i, appointments))

  const pendingCount  = instructions.filter(i => i.status === 'pending').length
  const linkedCount   = instructions.filter(i => i.status === 'linked').length
  const activeCount   = instructions.filter(i => i.status !== 'archived').length

  async function markStatus(ids: string[], status: string) {
    await fetch('/api/cutting-instructions', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, status }),
    })
    load()
    if (selected && ids.includes(selected.id)) {
      setSelected(prev => prev ? { ...prev, status } : null)
    }
  }

  // Archive: soft-hide a card (reversible via the Archived tab → Restore)
  async function archiveSelected() {
    if (!selected) return
    await markStatus([selected.id], 'archived')
    setSelected(null)
  }

  // Delete: permanent hard delete, for junk like test cards
  async function deleteSelected() {
    if (!selected) return
    const who = selected.data?.customerName ?? 'this'
    if (!confirm(`Permanently delete ${who}'s cutting card? This cannot be undone.`)) return
    await fetch(`/api/cutting-instructions?id=${encodeURIComponent(selected.id)}`, { method: 'DELETE' })
    setSelected(null)
    load()
  }

  // cardId defaults to the open card; the copy-for-another-share flow passes
  // the id of the copy it just made instead.
  async function linkToCustomer(apptId: string, customerIdx: number, cardId?: string) {
    if (!selected) return
    const linkId = cardId ?? selected.id
    const appt = appointments.find(a => a.id === apptId)
    if (!appt) return
    // The picker only offers matching animals, but this is the gate that has to
    // hold: a mismatched link puts the wrong cut card on a carcass, and setLinking
    // used to fire before the appointment was even found.
    if (!sameSpecies(appt.species, speciesOf(selected))) {
      alert(`This is a ${speciesOf(selected)} cutting card — it can't be linked to a ${appt.species} appointment.`)
      return
    }
    setLinking(true)
    const customers = appt.customers.map((c, i) =>
      i === customerIdx ? { ...c, linked_cutting_instruction_id: linkId } : c
    )
    const res = await fetch('/api/appointments', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: apptId, customers }),
    })
    // The PATCH resolves customer_id for typed names on save, so read it off
    // the response — the local copy may predate that linking. Carrying it onto
    // the card is what makes it show in the customer's history on /customers.
    const saved = await res.json().catch(() => null)
    const customerId = saved?.customers?.[customerIdx]?.customer_id ?? null
    await fetch('/api/cutting-instructions', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      // Always send it, even as null: the slot this card was just linked to is
      // the answer, and omitting the key would leave a stale customer from an
      // earlier link in place.
      body: JSON.stringify({ ids: [linkId], status: 'linked', customer_id: customerId }),
    })
    // Only the open card's badge changes; a copy isn't what's on screen.
    if (linkId === selected.id) setSelected(prev => prev ? { ...prev, status: 'linked' } : null)
    setLinking(false)
    setShowLinkPicker(false)
    load()
  }

  // Copy this card onto another share the same customer is taking — same cuts,
  // its own row and its own portion. Linking one card to two slots instead
  // prints the wrong portion on the second animal and makes a later edit rewrite
  // both (Charlie, 2026-08-04: Rian Pinkerton's whole + half).
  async function copyToShare(apptId: string, customerIdx: number) {
    if (!selected) return
    setCopying(true)
    try {
      const res = await fetch('/api/cutting-instructions/copy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_id: selected.id, portion: copyPortion }),
      })
      const copy = await res.json().catch(() => null)
      if (!res.ok || !copy?.id) {
        alert(`Could not copy this card: ${copy?.error ?? 'unknown error'}`)
        return
      }
      if (copy.size_class_changed && !window.confirm(
        `This copy changes the share size, not just the label — the answers were given for a ${PORTION_LABELS[selected.data?.portion ?? ''] ?? 'different'} share.\n\n` +
        `The cuts carry over as-is; anything that doesn't suit a ${PORTION_LABELS[copyPortion] ?? copyPortion} needs checking with the customer. Create it anyway?`
      )) {
        await fetch(`/api/cutting-instructions?id=${copy.id}`, { method: 'DELETE' })
        return
      }
      await linkToCustomer(apptId, customerIdx, copy.id)
      setShowCopyPicker(false)
    } finally {
      setCopying(false)
    }
  }

  const selectedSpecies = selected ? speciesOf(selected) : 'Beef'

  // Upcoming appointments that have at least one customer without a linked
  // instruction — and that are the same animal. A hog's instructions on a beef
  // appointment sends the wrong cut card to the rail (Charlie, 2026-07-22).
  const linkableAppts = appointments.filter(a =>
    a.status !== 'Complete' &&
    a.customers?.some(c => !c.linked_cutting_instruction_id) &&
    sameSpecies(a.species, selectedSpecies)
  ).sort((a, b) => a.harvest_date.localeCompare(b.harvest_date))
  const sections = sectionsFor(selectedSpecies)
  const isV2 = selected?.data?.formVersion === 'v2'

  const togglePicked = (id: string) =>
    setPicked(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next })

  // Batch print: one document, in the order shown on screen. Carcass lookups run
  // in parallel because each one is two fetches and a batch of twenty would
  // otherwise crawl.
  async function printPicked() {
    const chosen = filtered.filter(i => picked.has(i.id))
    // Only v2 cards go through the v2 renderer; legacy v1 cards have their own
    // print path and are left out rather than printed wrong.
    const v2 = chosen.filter(i => i.data?.formVersion === 'v2')
    const legacy = chosen.length - v2.length
    if (v2.length === 0) {
      alert('None of the selected cards are the current form version, so there is nothing to batch print. Open them individually instead.')
      return
    }
    setPrintingBatch(true)
    try {
      const appts = await freshAppointments(appointments)
      const items = await Promise.all(v2.map(async ci => ({ ci, carcasses: await carcassInfosFor(ci, appts) })))
      printV2CutCards(items)
      if (legacy) {
        alert(`Printed ${v2.length} card${v2.length === 1 ? '' : 's'}. ${legacy} older-format card${legacy === 1 ? ' was' : 's were'} skipped — open those individually.`)
      }
    } finally {
      setPrintingBatch(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--dark-brown)', display: 'flex', flexDirection: 'column' }}>

      {/* Header */}
      <header style={{ background: 'var(--dark)', borderBottom: '1px solid rgba(166,120,90,0.3)', padding: '0 1.5rem', height: '64px', display: 'flex', alignItems: 'center', gap: '1rem', flexShrink: 0 }}>
        <Link href="/" style={{ color: 'var(--tan)', textDecoration: 'none', fontSize: '0.85rem' }}>← Dashboard</Link>
        <span style={{ color: 'rgba(166,120,90,0.4)' }}>|</span>
        <h1 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, color: 'var(--cream)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>📋 Cutting Instructions</h1>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '1.5rem', fontSize: '0.8rem' }}>
          {pendingCount > 0 && <span style={{ color: '#f0c040' }}>⚠ {pendingCount} pending review</span>}
          {needCarcassCount > 0 && (
            <button onClick={() => setFilterStatus('needs-carcass')}
              title="Linked to a check-in but not to an animal — these print with no tag, no hanging weight and no inspection marking"
              style={{ background: 'rgba(245,158,11,0.16)', border: '1px solid rgba(245,158,11,0.5)', borderRadius: 3, padding: '0.2rem 0.55rem', color: '#f0b429', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer' }}>
              ⚠ {needCarcassCount} need a carcass
            </button>
          )}
          {linkedCount  > 0 && <span style={{ color: '#6dbf6d' }}>✅ {linkedCount} linked</span>}
          <span style={{ color: 'var(--tan)' }}>{activeCount} total</span>
          <a
            href={process.env.NEXT_PUBLIC_CUTTING_FORM_URL ?? 'http://localhost:3003/order'}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              background: 'var(--med-brown)',
              color: 'var(--cream)',
              border: 'none',
              borderRadius: '6px',
              padding: '0.4rem 0.9rem',
              fontWeight: 700,
              fontSize: '0.8rem',
              textDecoration: 'none',
              letterSpacing: '0.03em',
              whiteSpace: 'nowrap',
            }}
          >
            ✏️ New Cutting Card →
          </a>
          <button
            onClick={() => printV2CutCard(FAKE_CI, { ...EMPTY_CARCASS, lot: '26153', tag: '02', producer: 'Test Producer', hcw: 645, killType: 'USDA', state: 'assigned' })}
            style={{ background: 'transparent', color: 'var(--tan)', border: '1px solid rgba(166,120,90,0.4)', borderRadius: '6px', padding: '0.4rem 0.9rem', fontWeight: 600, fontSize: '0.8rem', cursor: 'pointer', whiteSpace: 'nowrap' }}
          >
            🧪 Test Card
          </button>
        </div>
      </header>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* Left panel — list */}
        <div style={{ width: selected ? '420px' : '100%', flexShrink: 0, display: 'flex', flexDirection: 'column', borderRight: '1px solid rgba(166,120,90,0.2)', overflow: 'hidden' }}>

          {/* Filters */}
          <div style={{ padding: '1rem', borderBottom: '1px solid rgba(166,120,90,0.15)', display: 'flex', gap: '0.5rem', flexWrap: 'wrap', background: 'rgba(0,0,0,0.2)' }}>
            <div style={{ display: 'flex', gap: '0', border: '1px solid rgba(166,120,90,0.3)', borderRadius: '3px', overflow: 'hidden' }}>
              {['all','pending','linked','imported','archived'].map(s => (
                <button key={s} onClick={() => setFilterStatus(s)} style={{ ...tabBtn(filterStatus === s), textTransform: 'capitalize' }}>{s}</button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: '0', border: '1px solid rgba(166,120,90,0.3)', borderRadius: '3px', overflow: 'hidden' }}>
              {['all','Beef','Hog','Lamb','Goat'].map(s => (
                <button key={s} onClick={() => setFilterSpecies(s)} style={tabBtn(filterSpecies === s)}>{s}</button>
              ))}
            </div>
            {/* Harvest date — Jill links a harvest day at a time. "Kill" is not
                a word we put in front of anyone (Charlie, 2026-08-04). */}
            <select
              value={filterSlaughter}
              onChange={e => setFilterSlaughter(e.target.value)}
              title="Filter by scheduled harvest date"
              style={{
                background: filterSlaughter ? 'var(--med-brown)' : 'rgba(0,0,0,0.25)',
                color: filterSlaughter ? 'var(--cream)' : 'var(--tan)',
                border: '1px solid rgba(166,120,90,0.3)', borderRadius: 3,
                padding: '0.3rem 0.5rem', fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer', outline: 'none',
              }}
            >
              <option value="">🔪 All harvest dates</option>
              {slaughterDates.map(d => (
                <option key={d} value={d}>
                  {new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                </option>
              ))}
              {anyNoSlaughter && <option value="__none__">— no harvest date —</option>}
            </select>
            <button onClick={load} style={{ ...btnStyle('transparent', 'var(--tan)'), border: '1px solid rgba(166,120,90,0.3)', marginLeft: 'auto' }}>↺</button>
          </div>

          {/* Batch bar — only once something's ticked, so it stays out of the way */}
          {picked.size > 0 && (
            <div style={{ padding: '0.6rem 1rem', borderBottom: '1px solid rgba(166,120,90,0.15)', background: 'rgba(117,71,27,0.25)', display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
              <span style={{ color: 'var(--cream)', fontSize: '0.85rem', fontWeight: 600 }}>
                {picked.size} card{picked.size === 1 ? '' : 's'} selected
              </span>
              <button
                onClick={printPicked}
                disabled={printingBatch}
                style={{ ...btnStyle('var(--tan)', 'var(--dark-brown)'), border: 'none', fontWeight: 700, opacity: printingBatch ? 0.6 : 1, cursor: printingBatch ? 'not-allowed' : 'pointer' }}
              >
                {printingBatch ? 'Preparing…' : `🖨 Print ${picked.size} card${picked.size === 1 ? '' : 's'}`}
              </button>
              <button onClick={() => setPicked(new Set())} style={{ ...btnStyle('transparent', 'var(--tan)'), border: '1px solid rgba(166,120,90,0.3)' }}>Clear</button>
              <span style={{ color: 'var(--light-brown)', fontSize: '0.75rem' }}>
                Prints as one job, in the order shown.
              </span>
            </div>
          )}

          {/* List */}
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {loading ? (
              <p style={{ color: 'var(--tan)', textAlign: 'center', padding: '3rem' }}>Loading…</p>
            ) : filtered.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '4rem', color: 'var(--tan)' }}>
                <div style={{ fontSize: '2rem', marginBottom: '0.75rem' }}>📋</div>
                <p>No cutting instructions found.</p>
                <p style={{ fontSize: '0.8rem', marginTop: '0.5rem', opacity: 0.7 }}>Submissions from cowboymeats.com will appear here.</p>
              </div>
            ) : (
              <>
                {/* Column headers */}
                <div style={{ display: 'grid', gridTemplateColumns: LIST_GRID_COLS, gap: '0.5rem', padding: '0.5rem 1.1rem', borderBottom: '1px solid rgba(166,120,90,0.2)', background: 'var(--dark-brown)', position: 'sticky', top: 0, zIndex: 1 }}>
                  {/* Tick-all for the batch, scoped to what the filters are showing */}
                  <input
                    type="checkbox"
                    checked={filtered.length > 0 && filtered.every(i => picked.has(i.id))}
                    ref={el => { if (el) el.indeterminate = picked.size > 0 && !filtered.every(i => picked.has(i.id)) }}
                    onChange={() => setPicked(prev => prev.size > 0 ? new Set() : new Set(filtered.map(i => i.id)))}
                    title="Select all shown / none"
                    style={{ width: 15, height: 15, accentColor: 'var(--tan)', cursor: 'pointer' }}
                  />
                  {['Customer','Species','Submitted','Slaughter','Status'].map(h => (
                    <div key={h} style={{ fontSize: '0.62rem', color: 'var(--light-brown)', textTransform: 'uppercase', letterSpacing: '0.1em', whiteSpace: 'nowrap' }}>{h}</div>
                  ))}
                </div>
                {filtered.map(ci => {
                  const d         = ci.data ?? {}
                  const name      = d.customerName ?? '—'
                  const species   = speciesOf(ci)
                  const isSel     = selected?.id === ci.id
                  const slaughter = slaughterDateFor(ci, appointments)
                  return (
                    <div key={ci.id} onClick={() => setSelected(isSel ? null : ci)}
                      style={{ display: 'grid', gridTemplateColumns: LIST_GRID_COLS, gap: '0.5rem', alignItems: 'center', padding: '0.7rem 1.1rem', borderBottom: '1px solid rgba(166,120,90,0.1)', cursor: 'pointer', background: isSel ? 'rgba(117,71,27,0.3)' : 'transparent', transition: 'background 0.15s' }}>
                      {/* stopPropagation so ticking for the batch doesn't also
                          open the card in the detail panel */}
                      <input
                        type="checkbox"
                        checked={picked.has(ci.id)}
                        onClick={e => e.stopPropagation()}
                        onChange={() => togglePicked(ci.id)}
                        title="Include in batch print"
                        style={{ width: 15, height: 15, accentColor: 'var(--tan)', cursor: 'pointer' }}
                      />
                      <div style={{ fontWeight: 600, color: 'var(--cream)', fontSize: '0.9rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
                      <div style={{ fontSize: '0.78rem', color: 'var(--tan)' }}>{species}</div>
                      <div style={{ fontSize: '0.78rem', color: 'var(--tan)', whiteSpace: 'nowrap' }}>{fmtShortDate(ci.created_at)}</div>
                      <div style={{ fontSize: '0.78rem', color: slaughter ? 'var(--cream)' : 'rgba(166,120,90,0.5)', whiteSpace: 'nowrap' }}>{fmtShortDate(slaughter)}</div>
                      <div><StatusBadge status={ci.status} needsCarcass={(carcassStates[ci.id] ?? []).some(s => s.state === 'ambiguous')} /></div>
                    </div>
                  )
                })}
              </>
            )}
          </div>
        </div>

        {/* Right panel — detail */}
        {selected && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>

            {/* Detail toolbar */}
            <div style={{ padding: '0.85rem 1.25rem', borderBottom: '1px solid rgba(166,120,90,0.15)', background: 'rgba(0,0,0,0.2)', display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap', flexShrink: 0 }}>
              <div>
                <span style={{ fontWeight: 700, color: 'var(--cream)', fontSize: '1rem' }}>{selected.data?.customerName ?? '—'}</span>
                <span style={{ color: 'var(--tan)', fontSize: '0.82rem', marginLeft: '0.75rem' }}>{selectedSpecies} · submitted {new Date(selected.created_at).toLocaleDateString()}</span>
              </div>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                {/* A linked card can still be linked again: a customer taking
                    more than one animal's worth is linked once per animal, and
                    hiding this button once linked left no way to do it. */}
                {selected.status !== 'archived' && (
                  <button onClick={() => setShowLinkPicker(true)} style={btnStyle('var(--med-brown)')}>
                    {selected.status === 'linked' ? '🔗 Link to another animal' : '🔗 Link to Appointment'}
                  </button>
                )}
                {selected.status === 'pending' && (
                  <button onClick={() => markStatus([selected.id], 'imported')} style={btnStyle('rgba(166,120,90,0.2)', 'var(--tan)')}>✓ Mark Imported</button>
                )}
                <button
                  onClick={() => {
                    // Default the copy to the same portion — the common case is
                    // a second share of the same size.
                    setCopyPortion(selected.data?.portion || 'half')
                    setShowCopyPicker(true)
                  }}
                  style={btnStyle('rgba(166,120,90,0.2)', 'var(--tan)')}
                  title="Same cuts on another share this customer is taking — makes its own card so the portion prints right and a later edit doesn't change both">
                  ⧉ Copy for another share
                </button>
                {isV2 && (
                  <a href={`https://cuttinginstructions.cowboymeats.com/edit/${selected.id}`} target="_blank" rel="noreferrer"
                    style={{ ...btnStyle('rgba(166,120,90,0.2)', 'var(--tan)'), textDecoration: 'none', display: 'inline-block' }}
                    title="Reopen this card in the cutting form with every answer pre-filled — or text this link to the customer">
                    ✏️ Edit
                  </a>
                )}
                <button onClick={async () => isV2 ? printV2CutCard(selected, await carcassInfosFor(selected, await freshAppointments(appointments))) : printCutCard(selected)} style={btnStyle('rgba(166,120,90,0.2)', 'var(--tan)')}>🖨 Print Cut Card</button>
                {selected.status === 'archived' ? (
                  <button onClick={() => markStatus([selected.id], 'pending')} style={btnStyle('rgba(166,120,90,0.2)', 'var(--tan)')}>↩ Restore</button>
                ) : (
                  <button onClick={archiveSelected} style={btnStyle('rgba(166,120,90,0.2)', 'var(--tan)')}>🗄 Archive</button>
                )}
                <button onClick={deleteSelected} style={btnStyle('rgba(150,40,40,0.22)', '#e69a9a')}>🗑 Delete</button>
                <button onClick={() => setSelected(null)} style={btnStyle('transparent', 'var(--tan)')}>✕</button>
              </div>
            </div>

            {/* Linked badge */}
            {selected.status === 'linked' && (() => {
              // Every animal this card is linked to — one line each, so a hog
              // and a half shows both instead of just whichever came first.
              const linkedAppts = appointments.filter(a => a.customers?.some(c => c.linked_cutting_instruction_id === selected.id))
              const states = carcassStates[selected.id] ?? []
              // Linking attaches the card to a slot on a check-in, not to an
              // animal. Green here used to mean "linked" and read as "done",
              // which is exactly how cards reached the floor with no tag, no
              // hanging weight and no inspection marking. Only a card that
              // knows its animal gets to look finished.
              const needsCarcass = states.some(s => s.state === 'ambiguous')
              const tone = needsCarcass
                ? { bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.35)', fg: '#f0b429' }
                : { bg: 'rgba(100,180,100,0.1)', border: 'rgba(100,180,100,0.2)', fg: '#6dbf6d' }
              return linkedAppts.length ? (
                <div style={{ padding: '0.6rem 1.25rem', background: tone.bg, borderBottom: `1px solid ${tone.border}`, fontSize: '0.82rem', color: tone.fg }}>
                  {linkedAppts.map(appt => {
                    const cust  = appt.customers?.find(c => c.linked_cutting_instruction_id === selected.id)
                    const state = states.find(s => s.apptId === appt.id)
                    const when  = new Date(appt.harvest_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
                    return (
                      <div key={appt.id} style={{ marginBottom: '0.2rem' }}>
                        <div>
                          {state?.state === 'ambiguous' ? '⚠' : '✅'} Linked to: <strong>{appt.species}</strong>
                          {state && state.state !== 'ambiguous' && state.tag ? <> <strong>#{state.tag}</strong></> : null}
                          {appt.source ? <> from <strong>{appt.source}</strong></> : null} on <strong>{when}</strong>
                          {cust ? ` — ${cust.customer_name} (${cust.portion})` : ''}
                          {state && state.state !== 'ambiguous' && state.hcw != null
                            ? <> · <strong>{state.hcw} lbs</strong> hanging</>
                            : null}
                        </div>

                        {state?.state === 'unharvested' && (
                          <div style={{ color: 'var(--tan)', fontSize: '0.76rem', marginTop: '0.15rem' }}>
                            Not harvested yet — the carcass gets picked here once the animals are harvested and tagged.
                          </div>
                        )}

                        {/* The whole point: choose the animal from this page,
                            where the cut sheet you are reading is in front of
                            you, instead of hunting for the row on Cut Schedule. */}
                        {state?.state === 'ambiguous' && (
                          <div style={{ marginTop: '0.4rem' }}>
                            <div style={{ color: 'var(--cream)', fontSize: '0.78rem', marginBottom: '0.35rem' }}>
                              {state.candidates.length} animals came in on this check-in — which one is {cust?.customer_name || 'this customer'}&apos;s?
                              <span style={{ color: 'var(--tan)' }}> Until you pick, the card prints with no tag, no hanging weight and no inspection marking.</span>
                            </div>
                            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                              {state.candidates.map(c => {
                                const taken = c.heldBy.length > 0
                                return (
                                  <button key={c.id} onClick={() => assignCarcass(appt.id, c.id)} disabled={!!assigning}
                                    title={taken ? `Already assigned to ${c.heldBy.join(', ')}` : 'Assign this carcass to this card'}
                                    style={{
                                      background: taken ? 'rgba(0,0,0,0.25)' : 'rgba(245,158,11,0.16)',
                                      border: `1px solid ${taken ? 'rgba(166,120,90,0.3)' : 'rgba(245,158,11,0.5)'}`,
                                      borderRadius: 3, padding: '0.3rem 0.6rem', cursor: assigning ? 'wait' : 'pointer',
                                      color: taken ? 'var(--tan)' : '#f0b429', fontSize: '0.78rem', textAlign: 'left',
                                    }}>
                                    {assigning === c.id ? 'Assigning…' : <>
                                      <strong>#{c.tag || '—'}</strong>{c.hcw != null ? ` · ${c.hcw} lb` : ''}
                                      <span style={{ color: 'var(--tan)' }}>{taken ? ` · ${c.heldBy.join(', ')}` : ' · open'}</span>
                                    </>}
                                  </button>
                                )
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                  {assignError && <div style={{ color: '#e08585', marginTop: '0.3rem' }}>{assignError}</div>}
                  {linkedAppts.length > 1 && (
                    <div style={{ color: 'var(--tan)', marginTop: '0.25rem' }}>
                      Printing gives one card per animal, each with its own tag and hanging weight.
                    </div>
                  )}
                </div>
              ) : null
            })()}

            {/* Cut card detail */}
            <div style={{ overflowY: 'auto', flex: 1, padding: '1.25rem' }}>
              {isV2 ? renderV2Detail(selected) : (
                <>
                  {sections.map(section => {
                    const visibleFields = section.fields.filter(([key]) => !isEmpty(selected.data?.[key]))
                    if (visibleFields.length === 0) return null
                    return (
                      <div key={section.label} style={{ marginBottom: '1.5rem' }}>
                        <div style={{ fontSize: '0.7rem', letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--light-brown)', marginBottom: '0.5rem', paddingBottom: '0.4rem', borderBottom: '1px solid rgba(166,120,90,0.15)' }}>
                          {section.label}
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '0.5rem' }}>
                          {visibleFields.map(([key, label]) => (
                            <div key={key} style={{ background: 'rgba(0,0,0,0.25)', borderRadius: '3px', padding: '0.5rem 0.75rem' }}>
                              <div style={{ fontSize: '0.67rem', color: 'var(--light-brown)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '0.2rem' }}>{label}</div>
                              <div style={{ fontSize: '0.88rem', color: 'var(--cream)' }}>{formatValue(selected.data?.[key])}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )
                  })}

                  {/* Specialty orders (v1 only) */}
                  {['bratOrders','sticksOrders','jerkyOrders','summerOrders','salamiOrders','lambBratOrders','goatBratOrders'].map(key => {
                    const orders = selected.data?.[key]
                    if (!orders || orders.length === 0) return null
                    return (
                      <div key={key} style={{ marginBottom: '1.5rem' }}>
                        <div style={{ fontSize: '0.7rem', letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--light-brown)', marginBottom: '0.5rem', paddingBottom: '0.4rem', borderBottom: '1px solid rgba(166,120,90,0.15)' }}>
                          {key.replace('Orders','').replace(/([A-Z])/g,' $1').trim()} Orders
                        </div>
                        {orders.map((o: any, i: number) => (
                          <div key={i} style={{ background: 'rgba(0,0,0,0.25)', borderRadius: '3px', padding: '0.5rem 0.75rem', marginBottom: '0.35rem', fontSize: '0.88rem', color: 'var(--cream)' }}>
                            {o.flavor}{o.addIn ? ` + ${o.addIn}` : ''} — {o.qty} lbs
                          </div>
                        ))}
                      </div>
                    )
                  })}
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Link to appointment modal */}
      {showLinkPicker && selected && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: '1rem' }} onClick={() => setShowLinkPicker(false)}>
          <div style={{ background: 'var(--dark)', border: '1px solid rgba(166,120,90,0.3)', borderRadius: '6px', padding: '1.75rem', width: '100%', maxWidth: '560px', maxHeight: '80vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
            <h2 style={{ margin: '0 0 0.5rem', color: 'var(--cream)', fontSize: '1.05rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Link to Appointment</h2>
            <p style={{ margin: '0 0 1.25rem', fontSize: '0.82rem', color: 'var(--tan)' }}>
              Linking <strong style={{ color: 'var(--cream)' }}>{selected.data?.customerName}</strong>'s {selectedSpecies} instructions to a scheduled animal.
            </p>

            {linkableAppts.length === 0 ? (
              <p style={{ color: 'var(--tan)', textAlign: 'center', padding: '2rem' }}>No upcoming {selectedSpecies.toLowerCase()} appointments need instructions yet.</p>
            ) : (
              linkableAppts.map(a => (
                <div key={a.id} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(166,120,90,0.15)', borderRadius: '4px', padding: '0.85rem 1rem', marginBottom: '0.75rem' }}>
                  <div style={{ fontWeight: 700, color: 'var(--cream)', marginBottom: '0.5rem', fontSize: '0.9rem' }}>
                    {speciesEmblem(a.species)} {a.species} · {new Date(a.harvest_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
                    {a.source && <span style={{ color: 'var(--tan)', fontWeight: 400, marginLeft: '0.5rem' }}>· {a.source}</span>}
                  </div>
                  {a.customers?.filter(c => !c.linked_cutting_instruction_id).map((c, idx) => (
                    <button key={c.id} onClick={() => linkToCustomer(a.id, a.customers.indexOf(c))} disabled={linking}
                      style={{ display: 'block', width: '100%', textAlign: 'left', background: 'rgba(117,71,27,0.25)', border: '1px solid rgba(166,120,90,0.2)', borderRadius: '3px', padding: '0.5rem 0.75rem', marginBottom: '0.35rem', color: 'var(--cream)', cursor: 'pointer', fontSize: '0.85rem' }}>
                      {linking ? 'Linking…' : `→ ${c.customer_name || 'Unnamed customer'} (${c.portion})`}
                    </button>
                  ))}
                </div>
              ))
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1rem' }}>
              <button onClick={() => setShowLinkPicker(false)} style={btnStyle('transparent', 'var(--tan)')}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Copy this card onto another share the same customer is taking */}
      {showCopyPicker && selected && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: '1rem' }} onClick={() => !copying && setShowCopyPicker(false)}>
          <div style={{ background: 'var(--dark)', border: '1px solid rgba(166,120,90,0.3)', borderRadius: '6px', padding: '1.75rem', width: '100%', maxWidth: '560px', maxHeight: '80vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
            <h2 style={{ margin: '0 0 0.5rem', color: 'var(--cream)', fontSize: '1.05rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Copy for another share</h2>
            <p style={{ margin: '0 0 1rem', fontSize: '0.82rem', color: 'var(--tan)', lineHeight: 1.5 }}>
              Makes a second card with <strong style={{ color: 'var(--cream)' }}>{selected.data?.customerName}</strong>&apos;s exact cuts and puts it on
              another animal. Its own card, so the portion prints right on that carcass and editing one share never changes the other.
            </p>

            <label style={{ display: 'block', fontSize: '0.7rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--light-brown)', marginBottom: '0.35rem' }}>
              Portion for the copy
            </label>
            <select
              value={copyPortion}
              onChange={e => setCopyPortion(e.target.value)}
              style={{ width: '100%', background: 'rgba(0,0,0,0.3)', color: 'var(--cream)', border: '1px solid rgba(166,120,90,0.3)', borderRadius: 3, padding: '0.5rem 0.6rem', fontSize: '0.9rem', marginBottom: '1.25rem' }}
            >
              {(selectedSpecies === 'Pork' ? PORK_PORTION_OPTIONS : BEEF_PORTION_OPTIONS).map(p => (
                <option key={p} value={p}>{PORTION_LABELS[p] ?? p}{p === selected.data?.portion ? ' (same as this card)' : ''}</option>
              ))}
            </select>

            {linkableAppts.length === 0 ? (
              <p style={{ color: 'var(--tan)', textAlign: 'center', padding: '2rem' }}>No {selectedSpecies.toLowerCase()} animal has a share waiting for instructions.</p>
            ) : (
              linkableAppts.map(a => (
                <div key={a.id} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(166,120,90,0.15)', borderRadius: '4px', padding: '0.85rem 1rem', marginBottom: '0.75rem' }}>
                  <div style={{ fontWeight: 700, color: 'var(--cream)', marginBottom: '0.5rem', fontSize: '0.9rem' }}>
                    {speciesEmblem(a.species)} {a.species} · {new Date(a.harvest_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
                    {a.source && <span style={{ color: 'var(--tan)', fontWeight: 400, marginLeft: '0.5rem' }}>· {a.source}</span>}
                  </div>
                  {a.customers?.filter(c => !c.linked_cutting_instruction_id).map(c => (
                    <button key={c.id} onClick={() => copyToShare(a.id, a.customers.indexOf(c))} disabled={copying || linking}
                      style={{ display: 'block', width: '100%', textAlign: 'left', background: 'rgba(117,71,27,0.25)', border: '1px solid rgba(166,120,90,0.2)', borderRadius: '3px', padding: '0.5rem 0.75rem', marginBottom: '0.35rem', color: 'var(--cream)', cursor: copying ? 'wait' : 'pointer', fontSize: '0.85rem', opacity: copying ? 0.6 : 1 }}>
                      {copying ? 'Copying…' : `→ ${c.customer_name || 'Unnamed customer'} (${c.portion})`}
                    </button>
                  ))}
                </div>
              ))
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1rem' }}>
              <button onClick={() => setShowCopyPicker(false)} disabled={copying} style={btnStyle('transparent', 'var(--tan)')}>Cancel</button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}

// ── Print cut card ────────────────────────────────────────────────────────────

function printCutCard(ci: RawInstruction) {
  const d       = ci.data ?? {}
  const species = d.species ?? 'Beef'
  const name    = d.customerName ?? '—'

  const row = (label: string, value: any) => {
    const v = formatValue(value)
    if (!v) return ''
    // Same cutting-room readability bump as the v2 card
    return `<tr><td style="padding:4px 8px;color:#75471B;font-size:18px;width:220px;vertical-align:top">${label}</td><td style="padding:4px 8px;font-size:24px;vertical-align:top">${v}</td></tr>`
  }

  const section = (title: string, rows: string) =>
    rows.trim() ? `<h3 style="background:#351E0E;color:#F2E8D9;padding:6px 10px;margin:12px 0 4px;font-size:18px;letter-spacing:0.12em;text-transform:uppercase">${title}</h3><table style="width:100%;border-collapse:collapse">${rows}</table>` : ''

  let body = ''

  if (species === 'Beef') {
    body += section('Customer Info', [
      row('Customer', d.customerName), row('Address', d.mailingAddress),
      row('Contact', `${d.contactPreference}: ${d.contactValue}`),
      row('Beef Source', d.beefSource), row('Delivery Date', d.deliveryDate),
      row('Beef Size', d.beefSize), row('USDA Inspection', d.usadaInspection),
    ].join(''))
    body += section('Cut Preferences', [
      row('Grind Entire', d.grindEntire), row('Steak Thickness', d.steakThickness),
      row('Steaks/Package', d.steaksPerPackage), row('Roast Size', d.roastSize),
      row('Soup Bones', d.soupBones), row('Organs', d.organs),
    ].join(''))
    body += section('Individual Cuts', [
      row('Ribeye', d.ribeye), row('Short Ribs', d.shortRibs), row('Short Loin', d.shortLoin),
      row('Brisket', d.brisket), row('Flat Iron', d.flatIronSteak), row('Arm Roast', d.armRoast),
      row('Chuck Roast', d.chuckRoast), row('Top Round', d.topRound), row('Bottom Round', d.bottomRound),
      row('Tri-Tip', d.tritip), row('Top Sirloin', d.topSirloin), row('Sirloin Tip', d.sirTip),
      row('Flank Steak', d.flankSteak), row('Skirt Steak', d.skirtSteak), row('Stew Meat', d.stewMeat),
    ].join(''))
    body += section('Ground Beef & Specialty', [
      row('Burger Blend', d.burgerBlend), row('Burger Packaging', d.burgerPackaging),
      row('Patties', d.groundBeefPatties), row('Patty Size', d.pattySize),
      row('Beef Sausage', d.beefSausage), row('Breakfast Sausage', d.breakfastSausage),
    ].join(''))
  } else if (species === 'Hog') {
    body += section('Hog Cuts', [
      row('Chops', d.hogChops), row('Country Style Ribs', d.hogSpareRibs), row('Ham 1', d.hogHam),
      row('Ham 2', d.hogHam2), row('Ham Cut', d.hogHamCut), row('Belly', d.hogBelly),
      row('Boston Butt', d.hogBostonButt), row('Shoulder Bacon', d.hogShoulderBacon), row('Hocks', d.hogHocks),
    ].join(''))
    body += section('Sausage', [
      row('Sausage 1', `${d.hogSausage1Type} / ${d.hogSausage1Format}`),
      row('Sausage 2', `${d.hogSausage2Type} / ${d.hogSausage2Format}`),
    ].join(''))
  } else if (species === 'Lamb') {
    body += section('Lamb Cuts', [
      row('Rack', d.lambRack), row('Loin Chops', d.lambLoinChops), row('Leg', d.lambLeg),
      row('Leg Chops', d.lambLegChops), row('Shoulder', d.lambShoulder), row('Shank', d.lambShank),
    ].join(''))
  } else if (species === 'Goat') {
    body += section('Goat Cuts', [
      row('Rack', d.goatRack), row('Loin Chops', d.goatLoinChops), row('Leg', d.goatLeg),
      row('Leg Chops', d.goatLegChops), row('Shoulder', d.goatShoulder), row('Shank', d.goatShank),
    ].join(''))
  }

  if (d.cuttingNotes) body += section('Notes', row('Notes', d.cuttingNotes))

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Cut Card — ${name}</title>
  <style>body{font-family:Arial,sans-serif;color:#1A0A04;max-width:700px;margin:0 auto;padding:20px}
  h1{background:#1A0A04;color:#F2E8D9;padding:12px 16px;margin:0 0 4px;font-size:16px}
  h2{background:#75471B;color:#F2E8D9;padding:8px 16px;margin:0 0 12px;font-size:13px}
  tr:nth-child(even) td{background:#fdf8f2}
  @media print{body{padding:0}}</style></head>
  <body>
  <h1>COWBOY MEAT COMPANY — CUT CARD</h1>
  <h2>${name} · ${species} · ${new Date(ci.created_at).toLocaleDateString()}</h2>
  ${body}
  </body></html>`

  const blob = new Blob([html], { type: 'text/html' })
  const url  = URL.createObjectURL(blob)
  const win  = window.open(url, '_blank')
  if (win) { win.onload = () => { URL.revokeObjectURL(url) } }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// `needsCarcass` demotes a linked card to amber: it is on a check-in but not on
// an animal, so it would print with no tag, no hanging weight and no inspection
// marking. Without this the list shows a green "Linked" and looks finished.
function StatusBadge({ status, needsCarcass }: { status: string; needsCarcass?: boolean }) {
  const colors: Record<string, [string, string]> = {
    pending:  ['rgba(240,192,64,0.2)',  '#f0c040'],
    linked:   ['rgba(109,191,109,0.2)', '#6dbf6d'],
    imported: ['rgba(100,100,100,0.2)', '#aaa'],
    archived: ['rgba(120,120,120,0.15)', '#888'],
  }
  const [bg, fg] = needsCarcass && status === 'linked'
    ? ['rgba(245,158,11,0.18)', '#f0b429']
    : colors[status] ?? ['rgba(166,120,90,0.2)', 'var(--tan)']
  return (
    <span
      title={needsCarcass && status === 'linked' ? 'Linked to the check-in but not to an animal — no tag or hanging weight will print' : undefined}
      style={{ background: bg, color: fg, borderRadius: '3px', padding: '0.2rem 0.55rem', fontSize: '0.72rem', fontWeight: 600, textTransform: 'capitalize', whiteSpace: 'nowrap' }}>
      {status}{needsCarcass && status === 'linked' ? ' ⚠' : ''}
    </span>
  )
}

const tabBtn = (active: boolean): React.CSSProperties => ({
  background:  active ? 'var(--med-brown)' : 'transparent',
  color:       active ? 'var(--cream)'     : 'var(--tan)',
  border:      'none',
  padding:     '0.4rem 0.85rem',
  fontSize:    '0.78rem',
  cursor:      'pointer',
  fontWeight:  active ? 600 : 400,
})

const btnStyle = (bg: string, color = 'var(--cream)'): React.CSSProperties => ({
  background: bg, color, border: 'none', borderRadius: '3px',
  padding: '0.5rem 1rem', fontSize: '0.82rem', fontWeight: 600,
  cursor: 'pointer', whiteSpace: 'nowrap',
})
