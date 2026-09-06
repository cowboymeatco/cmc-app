'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { HarvestAppointment } from '@/lib/types'
import { makeCode39Barcode } from '@/lib/label'

// ── Types ─────────────────────────────────────────────────────────────────────

import { buildPackList, BONE_IN_FILET_THICKNESS, baggedTrimPackRows, loinFields, mergeSides, shoulderFields, EIGHTHS, FMT_OVERRIDES, STEAK_STANDARDS, bagSizeLabel, baggedTrimCutterRows, beefTrimCutterRows, beefTrimPackRows, beefTrimRows, bellyRows, bellyWord, brisketLabel, fracThick, hamCut, hamLine, hamRows, hamStyleWord, hockStyle, isWholeAnimal, lgTrimLabel, porkTrimCutterRows, porkTrimRows, rawWeighIn, ribeyeAdds, roastOr, roastText, sidePair, smokehouseRows, smokehouseTotalLbs, stdThick, trimIsBagged, trimSplitOf, v2fmt } from '@/lib/packList'

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

// ── Multi-head drop-offs ─────────────────────────────────────────────────────
// A cutting card covers ONE animal. Kristin at VML brought three lambs and sent
// one card meaning it to cover all three — and nothing in the app could tell
// that apart from one lamb, one card (2026-08-21). The public form now asks how
// many head and writes the answer to data.headCount, so the office can see the
// shortfall instead of finding out at the saw.
//
// Cards for the same drop-off are separate rows that share the customer, the
// species and the kill date — cards 2..N are started from card 1, so all three
// carry the same answers. Grouping on that and counting against headCount is
// what surfaces "3 declared, 1 on file".
function dropOffKey(ci: RawInstruction): string {
  const d = ci.data ?? {}
  return [
    String(d.customerName ?? '').trim().toLowerCase(),
    speciesKey(ci.data?.species ?? ci.species),
    String(d.killDate ?? ''),
  ].join('|')
}

// Which of the declared head this card is. Cards written before the question
// existed, or where the index somehow outran the count, read as the first —
// never as a number that contradicts the total printed beside it.
function headIndexOf(ci: RawInstruction): number {
  const n = Number(ci.data?.headIndex)
  const total = declaredHead(ci)
  return Number.isFinite(n) && n >= 1 && n <= total ? Math.floor(n) : 1
}

function declaredHead(ci: RawInstruction): number {
  const n = Number(ci.data?.headCount)
  // Every card written before the question existed is a single animal.
  return Number.isFinite(n) && n >= 1 && n <= 99 ? Math.floor(n) : 1
}

// Smokehouse orders the customer pinned to a single animal. These must NOT be
// repeated when one card gets linked to several head — that is the whole point
// of the scope question, and the floor can't know it from the card alone.
function singleHeadSmokehouse(ci: RawInstruction): string[] {
  const sh = ci.data?.smokehouse ?? {}
  const LABELS: Record<string, string> = {
    sticks: 'Snack Sticks', brats: 'Brots', summer: 'Summer / Salami',
    jerky: 'Jerky', hotDogs: 'Hot Dogs',
  }
  return Object.keys(LABELS).filter(k => sh[`${k}Scope`] === 'one').map(k => LABELS[k])
}

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
  // The customer slot this line belongs to. One card can sit on several slots
  // of the SAME check-in — a producer bringing five hogs against one cut spec —
  // and each of those slots is a separate animal with its own carcass.
  slotId: string
  candidates: Candidate[]   // the animals on this check-in, for the picker
}
const EMPTY_CARCASS: CarcassInfo = {
  tag: '', lot: '', producer: '', hcw: null, killType: '', over30: null,
  state: 'unharvested', apptId: '', slotId: '', candidates: [],
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
  // One entry per linked SLOT. A producer running five hogs against a single
  // cut spec links that card five times on one check-in, and each of those is
  // its own animal that has to print its own tag and weight.
  const pairs = appointments.flatMap(a =>
    (a.customers ?? [])
      .filter(c => c.linked_cutting_instruction_id === ci.id)
      .map(c => ({ appt: a, slotId: c.id }))
  )
  if (!pairs.length) return [EMPTY_CARCASS]
  const infos = await Promise.all(pairs.map(x => carcassInfoForAppt(ci, x.appt, x.slotId)))
  // Drop duplicates so two links onto the same animal don't print twice.
  const seen = new Set<string>()
  const out = infos.filter(i => {
    // Only a REAL tag identifies an animal. Keying unassigned lines (blank tag)
    // by lot|producer collapsed every still-unpicked slot into one, so a
    // five-hog spec printed a single card.
    const key = i.tag ? `${i.lot}|${i.tag}|${i.producer}` : `slot:${i.apptId}:${i.slotId}`
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
  // Which slot this line is for. Without it a card sitting on several slots of
  // one check-in resolves to the FIRST slot every time, so the other animals
  // were invisible and every carcass pick overwrote the last (Jill, 2026-08-18).
  slotId?: string,
): CarcassInfo {
  const animals = Array.isArray(logs) ? logs : []
  const rows    = Array.isArray(asgs) ? asgs : []
  const pool    = Array.isArray(allLogs) && allLogs.length ? allLogs : animals
  // Match on the customer slot first. Carcasses are normally assigned at
  // harvest, before the cut sheet has even arrived, so the assignment row's
  // own linked_cutting_instruction_id is empty on exactly the rows that matter
  // most — matching only on it reported assigned animals as unassigned.
  const slot = slotId
    ? appt.customers?.find(c => c.id === slotId)
    : appt.customers?.find(c => c.linked_cutting_instruction_id === ciId)
  // The card-id fallback only holds when this card sits on a single slot here.
  // With several, every slot claims the same row and they all report the same
  // animal.
  const shared = (appt.customers ?? []).filter(c => c.linked_cutting_instruction_id === ciId).length > 1
  const asg  = (slot ? rows.find((a: any) => a.appointment_customer_id === slot.id) : null)
    ?? (shared ? null : rows.find((a: any) => a.linked_cutting_instruction_id === ciId))
    ?? null

  const log = animals.length === 0 ? null
    : asg ? pool.find((l: any) => l.id === asg.harvest_log_id) ?? null
    : (animals.length === 1 && !shared) ? animals[0] : null

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
    slotId: slot?.id ?? '',
    candidates: animals.map((l: any) => ({
      id:  l.id,
      tag: l.carcass_tag ?? '',
      hcw: l.hot_carcass_weight_lbs ?? null,
      heldBy: rows.filter((a: any) => a.harvest_log_id === l.id).map((a: any) => a.customer_name || 'someone'),
    })),
  }
}

async function carcassInfoForAppt(ci: RawInstruction, appt: HarvestAppointment, slotId?: string): Promise<CarcassInfo> {
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
    return resolveCarcass(ci.id, appt, own, rows, [...own, ...extra], slotId)
  } catch {
    return EMPTY_CARCASS
  }
}

// Scheduled harvest date, and whether anything has actually confirmed it.
//
// A linked appointment carries the plant's own harvest date — that's fact. The
// v2 form date is whatever the customer typed when they filled the sheet in,
// and it is regularly wrong: eight cards filed the week of 2026-08-03 said
// "Sat Aug 1" for animals harvested that Monday (Charlie, 2026-08-07). Both are
// worth showing — Jill uses the customer's date to find the right animal — but
// only one is worth reading as the harvest date, so callers get told which.
function harvestDateFor(
  ci: RawInstruction,
  appointments: HarvestAppointment[],
): { date: string | null; scheduled: boolean } {
  const appt = appointments.find(a => a.customers?.some(c => c.linked_cutting_instruction_id === ci.id))
  if (appt?.harvest_date) return { date: appt.harvest_date, scheduled: true }
  const kd = ci.data?.killDate
  if (kd && kd !== 'Unknown') return { date: kd, scheduled: false }
  return { date: null, scheduled: false }
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

function lgLegSteaks(leg?: { cut?: string; cut2?: string | null } | null): boolean {
  return leg?.cut === 'leg-steaks' || leg?.cut2 === 'leg-steaks'
}

function v2thick(v: string): string { return fracThick(v) }
function v2withT(cut: string, t: string): string { return [v2fmt(cut), v2thick(t)].filter(Boolean).join(' — ') }
function v2adds(arr: string[]): string { return arr?.length ? arr.map(v2fmt).join(', ') : '' }
// A round sent to jerky carries its flavor; split rounds show both sides. A
// round taken as roasts carries a count, per side like the arm and the tip.
function v2roundOne(r: any, perHalf = false): string {
  return r?.cut === 'jerky'
    ? `Jerky${r.jerkyFlavor ? ` — ${v2fmt(r.jerkyFlavor)}` : ''}`
    : roastOr(r?.cut, r?.roastCount, c => v2withT(c, r?.thickness ?? ''), perHalf)
}
function v2roundVal(r: any, whole = false): string {
  return r?.round2 ? sidePair(v2roundOne(r), v2roundOne(r.round2)) : v2roundOne(r, whole)
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
          <V2Section title="Rib">
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
                <V2Field label="Rib 1 Add-ons" value={v2adds(ribeyeAdds(d.ribeye))} addon />
                <V2Field label="Rib 2 Add-ons" value={v2adds(ribeyeAdds(d.ribeye.ribeye2))} addon />
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
            <V2Field label="Bottom Round" value={v2roundVal(d.bottomRound, isWholeAnimal(d.portion))} />
            <V2Field label="Bottom Round Add-ons" value={v2adds(d.bottomRound?.addons)} addon />
            {d.bottomRound?.round2 && <V2Field label="Bottom Round 2 Add-ons" value={v2adds(d.bottomRound.round2.addons)} addon />}
            <V2Field label="Top Round" value={v2roundVal(d.topRound, isWholeAnimal(d.portion))} />
            <V2Field label="Top Round Add-ons" value={v2adds(d.topRound?.addons)} addon />
            {d.topRound?.round2 && <V2Field label="Top Round 2 Add-ons" value={v2adds(d.topRound.round2.addons)} addon />}
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

      {smokehouseRows(d.smokehouse, v2fmt, d).length > 0 && (
        <V2Section title="Smokehouse">
          {smokehouseRows(d.smokehouse, v2fmt, d).map(([label, value], i) => (
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
function v2CardPages(ci: RawInstruction, appointments: HarvestAppointment[], carcassArg: CarcassInfo | CarcassInfo[] = EMPTY_CARCASS, isLastCard = true): string {
  const carcassList = (Array.isArray(carcassArg) ? carcassArg : [carcassArg])
  const carcasses   = carcassList.length ? carcassList : [EMPTY_CARCASS]
  const d = ci.data ?? {}
  // Prefer the plant's own harvest date over whatever the customer typed on
  // the intake form — see harvestDateFor for why the two disagree.
  const harvestDate = harvestDateFor(ci, appointments).date ?? d.killDate ?? '—'
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
  // A round sent to jerky carries its flavor; split rounds print both sides. A
  // round taken as roasts carries a count like the arm and the tip do, and that
  // count is per side — but a split round already prints each side on its own,
  // so only the unsplit case doubles for a whole beef.
  const roundOne = (r: any, perHalf = false) => r?.cut === 'jerky'
    ? `Jerky${r.jerkyFlavor ? ` — ${fmt(r.jerkyFlavor)}` : ''}`
    : roastOr(r?.cut, r?.roastCount, c => withT(c, r?.thickness ?? ''), perHalf)
  const roundVal = (r: any) => r?.round2
    ? sidePair(roundOne(r), roundOne(r.round2))
    : roundOne(r, wholeAnimal)
  // Split rounds can be seasoned on one side and not the other, so each side
  // gets its own add-on line rather than one merged list.
  const roundAddonRows = (r: any) => r?.round2
    ? [
        r.addons?.length        ? row('  Add-ons (1)', adds(r.addons), true)        : '',
        r.round2.addons?.length ? row('  Add-ons (2)', adds(r.round2.addons), true) : '',
      ].join('')
    : (r?.addons?.length ? row('  Add-ons', adds(r.addons), true) : '')

  // Primal color coding for the cutting table (Chris): chuck green,
  // rib & plate yellow, rest of the beef red
  const PRIMAL_COLORS: Record<string, { bar: string; text: string; tint: string }> = {
    'Chuck':              { bar: '#2e7d32', text: '#ffffff', tint: '#edf5ee' },
    'Plate & Short Ribs': { bar: '#f2c200', text: '#4a3800', tint: '#fdf8e0' },
    'Rib':                { bar: '#f2c200', text: '#4a3800', tint: '#fdf8e0' },
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
    return `<div class="sec" style="break-inside:avoid;margin-top:6px">
           <div class="sechdr" style="background:${c?.bar ?? '#351E0E'};color:${c?.text ?? '#F2E8D9'};padding:4px 10px;font-size:18px;letter-spacing:0.12em;text-transform:uppercase;font-weight:bold">${title}</div>
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
    cutSections += sec('Rib', (d.ribeye?.ribeye2
      ? [
          row('Rib (1)', ribeyeLine(d.ribeye)),
          ribeyeAdds(d.ribeye).length ? row('  Add-ons (1)', adds(ribeyeAdds(d.ribeye)), true) : '',
          row('Rib (2)', ribeyeLine(d.ribeye.ribeye2)),
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
      roundAddonRows(d.bottomRound),
      d.eyeOfRound?.cut ? row('Eye of Round', withT(d.eyeOfRound.cut, d.eyeOfRound.thickness ?? '')) : '',
      d.rumpRoast?.cut  ? row('Rump Roast',   withT(d.rumpRoast.cut,  d.rumpRoast.thickness  ?? '')) : '',
      row('Top Round', roundVal(d.topRound)),
      roundAddonRows(d.topRound),
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
    const smokeCardRows = smokehouseRows(d.smokehouse, fmt, d)
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

  // The packaging sheet is the same list the scanner checks off as packages
  // come over the scale, so it is built in one place for both.
  const filteredPrs = buildPackList(d, species)

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
        tbody += `<tr class="sechdr-row"><td colspan="5" style="background:${c?.bar ?? '#351E0E'};color:${c?.text ?? '#F2E8D9'};padding:4px 8px;font-size:16px;letter-spacing:0.12em;text-transform:uppercase;font-weight:bold">${pr.sectionTitle}</td></tr>`
        continue
      }
      const bg  = pr.isGrind ? '#fff8e6' : pr.isAddon ? '#fffbe8' : rowCount % 2 === 0 ? '#fff' : '#faf6f1'
      if (!pr.isAddon) rowCount++
      const fw  = pr.isAddon || pr.isGrind ? 'normal' : '700'
      const fi  = pr.isAddon ? 'italic' : 'normal'
      const pl  = pr.isAddon ? '18px' : '8px'
      const clr = pr.isAddon ? '#8a6200' : '#1A0A04'
      tbody += `<tr style="background:${bg}">
        <td class="pkcut" style="padding:6px ${pl} 6px 8px;font-weight:${fw};font-style:${fi};color:${clr};vertical-align:top"><div class="pkline"><span>${pr.cut ?? ''}</span><span class="pkspec-in">${pr.spec ?? ''}</span></div></td>
        <td class="pkspec" style="padding:6px 8px;color:#555;vertical-align:top">${pr.spec ?? ''}</td>
        <td class="pknum" style="padding:6px 4px;width:58px;border-left:1px solid #ddd;text-align:center">${pr.writeIn ? '<span style="color:#bbb;font-size:16px">—</span>' : ' '}</td>
        <td class="pkwt" style="padding:6px 4px;width:68px;border-left:1px solid #ddd;text-align:center">${
          // A ruled blank, so the raw weight has an obvious place to land
          pr.writeIn ? '<span class="pkrule" style="display:inline-block;width:56px;border-bottom:1.5px solid #1A0A04">&nbsp;</span>' : ' '
        }</td>
        <td class="pkchk" style="padding:6px 4px;width:36px;border-left:1px solid #ddd;text-align:center;font-size:20px;color:#999">☐</td>
      </tr>`
    }
    const thStyle = 'padding:6px 8px;text-align:left;color:#F2E8D9;font-size:13px;letter-spacing:0.08em;text-transform:uppercase'
    return `<table style="width:100%;border-collapse:collapse;border:1px solid #ddd">
      <thead><tr style="background:#1A0A04">
        <th class="pkcut" style="${thStyle}">Cut<span class="pkspec-in"> / Style</span></th>
        <th class="pkspec" style="${thStyle}">Style / Spec</th>
        <th class="pknum" style="${thStyle};text-align:center;width:48px">Pkgs</th>
        <th class="pkwt" style="${thStyle};text-align:center;width:56px">Wt (lbs)</th>
        <th class="pkchk" style="${thStyle};text-align:center;width:30px">✓</th>
      </tr></thead>
      <tbody>${tbody}</tbody>
    </table>`
  }

  // ── Assemble HTML ─────────────────────────────────────────────────────────
  const submittedDate = new Date(ci.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

  // The logo (white variant for the dark bar) replaces the "Cowboy Meat Company"
  // wordmark. Absolute origin so it still resolves inside the printed blob doc.
  const assetBase = typeof window !== 'undefined' ? window.location.origin : ''
  const hdr = (subtitle: string, badge = '') =>
    `<div style="background:#1A0A04;color:#F2E8D9;padding:9px 16px;display:flex;align-items:center;justify-content:space-between;margin-bottom:9px">
       <div style="display:flex;align-items:center;gap:14px"><img src="${assetBase}/cmc-logo-white.png" alt="Cowboy Meat Co" style="height:34px;display:block">
            <span style="font-size:16px;color:#C9A882;letter-spacing:0.05em">— ${subtitle}</span></div>
       ${badge}
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

  // A business account carries two names and the customer picked which one
  // headlines (it's the customer_name everything joins on). The other prints
  // small so the floor can still recognize "87 Rentals" as Michael's hog.
  const secondaryName = d.businessName
    ? (d.cardName === 'business'
        ? (d.contactName ? `c/o ${d.contactName}` : '')
        : String(d.businessName))
    : ''

  const infoGrid = (carcass: CarcassInfo) =>
    `<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0;border:1.5px solid #C9A882;margin-bottom:8px">
       <div style="padding:6px 11px;border-right:1px solid #C9A882">
         <div style="font-size:12px;color:#75471B;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:2px">Customer</div>
         <div style="font-size:24px;font-weight:bold">${d.customerName ?? '—'}</div>
         ${secondaryName ? `<div style="font-size:16px;font-weight:bold;color:#555;margin-top:1px">${secondaryName}</div>` : ''}
         ${d.customerPhone ? `<div style="font-size:16px;color:#555;margin-top:1px">${d.customerPhone}</div>` : ''}
       </div>
       <div style="padding:6px 11px;border-right:1px solid #C9A882">
         <div style="font-size:12px;color:#75471B;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:2px">Animal</div>
         <div style="font-size:24px;font-weight:bold">${species}${d.portion ? ' · ' + fmt(d.portion) : ''}</div>
         <div style="font-size:16px;color:#555;margin-top:1px">Harvest Date: ${harvestDate}</div>
         ${/* This card is ONE animal out of several the customer dropped off.
              It prints because a smokehouse order can be pinned to a single
              head, and the crew has to know this is a multi-head job before
              they read a "one animal only" line further down. */
           declaredHead(ci) > 1
             ? `<div style="font-size:16px;margin-top:2px;font-weight:bold">Animal ${headIndexOf(ci)} of ${declaredHead(ci)} this drop-off</div>`
             : ''}
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

  // The packager boxes and labels the meat, so whether it can ever be sold has
  // to be on their sheet too (Charlie, 2026-08-07) — page 1's badge lives in the
  // cut-card info grid, which page 2 doesn't print. Colours flip against the
  // dark header bar: Custom Exempt fills, USDA outlines. An unknown kill type
  // says so rather than printing nothing, which would read as saleable.
  const inspectionBadge = (carcass: CarcassInfo) =>
    carcass.killType === 'Custom'
      ? `<div style="background:#F2E8D9;color:#1A0A04;font-size:15px;font-weight:bold;letter-spacing:0.06em;padding:3px 10px">${killTypeLabel(carcass.killType)}</div>`
      : carcass.killType
        ? `<div style="border:1.5px solid #C9A882;font-size:15px;font-weight:bold;letter-spacing:0.06em;padding:2px 9px">${killTypeLabel(carcass.killType)}</div>`
        : `<div style="border:1.5px dashed #C9A882;color:#C9A882;font-size:15px;font-weight:bold;letter-spacing:0.06em;padding:2px 9px">INSPECTION NOT RECORDED</div>`

  // The card's barcode — Code 39 of the instruction id's first 8 hex chars.
  // Page 2 has carried it since 2026-08-27; page 1 gets it too because the CUT
  // CARD is what's in reach when hams and bacons get seal-tagged, and scanning
  // it opens the session under the office's spelling AND ties the cure seals
  // to this exact sheet — one instruction, one animal (Charlie, 2026-09-01).
  const ciBarcode = makeCode39Barcode(`CI-${String(ci.id).replace(/-/g, '').slice(0, 8).toUpperCase()}`)

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
  ${hdr('Cut Card' + ofN, `<div style="background:#F2E8D9;padding:4px 10px 2px;text-align:center">
       <div style="width:150px;margin:0 auto">${ciBarcode}</div>
       <div style="font-size:9px;color:#75471B;letter-spacing:0.05em;margin-top:1px">SCAN AT SCANNER — OPENS THIS ANIMAL&rsquo;S SESSION</div>
     </div>`)}
  ${unassignedBand(carcass)}
  ${grindBand}
  ${infoGrid(carcass)}
  <div class="cutcols" style="column-count:3;column-gap:14px">
    ${cutSections}
  </div>
</div>

<!-- PAGE 2: PACKAGING SHEET — 3-column table layout -->
<div class="page packsheet${last ? '' : ' pagebreak'}">
  ${hdr('Packaging Sheet' + ofN, inspectionBadge(carcass))}
  ${unassignedBand(carcass)}
  ${grindBand}
  ${/* Scanning this at the packing scanner opens the customer's session under
       this exact name — no typing, and the slip in hand is the check that the
       right session is open (Charlie, 2026-08-27). Same code as page 1's. */''}
  ${/* The name is what the packager matches the sheet to the rail and the box
       by, so it headlines at the size page 1 gives it, with the animal beside
       it and everything else on one line underneath. The barcode sits at the
       end of the same row: the sheet is a flex column, so a float would not
       take, and a barcode of its own line left a dead band beside it. */''}
  <div style="display:flex;align-items:flex-start;gap:14px;margin-bottom:8px;line-height:1.15">
    <div style="flex:1;min-width:0">
      <div style="font-size:30px;font-weight:bold">${d.customerName ?? '—'}${secondaryName ? ` <span style="font-size:18px;font-weight:normal;color:#666">(${secondaryName})</span>` : ''}
        <span style="font-size:22px;font-weight:bold;color:#75471B;margin-left:12px;white-space:nowrap">${species}${d.portion ? ' · ' + fmt(d.portion) : ''}</span></div>
      <div style="font-size:16px;color:#555;margin-top:5px;display:flex;flex-wrap:wrap;column-gap:12px;row-gap:2px">
        <span style="white-space:nowrap">Harvested <span style="font-weight:bold;color:#1A0A04">${harvestDate}</span></span>
        <span style="white-space:nowrap">Producer: <span style="font-weight:bold;color:#1A0A04">${carcass.producer || wline(110)}</span></span>
        <span style="white-space:nowrap">Lot # <span style="font-weight:bold;color:#1A0A04">${carcass.lot || wline(46)}</span> · Tag # <span style="font-weight:bold;color:#1A0A04">${carcass.tag || wline(38)}</span></span>
        <span style="white-space:nowrap">Hanging Wt: <span style="font-weight:bold;color:#1A0A04">${carcass.hcw != null ? `${carcass.hcw} lbs` : wline(58)}</span></span>
        ${d.steakPack ? `<span style="white-space:nowrap">Steaks: <span style="font-weight:bold;color:#1A0A04">${esc(String(d.steakPack))} per pack</span></span>` : ''}
      </div>
    </div>
    <div class="slipcode" style="flex:none;width:160px;text-align:center">
      ${ciBarcode}
      <div style="font-size:10px;color:#75471B;letter-spacing:0.06em;margin-top:2px">SCAN TO OPEN PACKING SESSION</div>
    </div>
  </div>
  <div class="packgrid" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
    ${packCols.map(col => `<div class="packcol">${col.length ? buildPackTable(col) : ''}</div>`).join('')}
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
    /* The packing-slip barcode: preserveAspectRatio="none" on the SVG exists so
       the bars can be stretched taller without widening — a squat barcode is a
       hard target for the gun. */
    .slipcode svg { height: 44px !important; }
    /* Packaging-sheet type. A light sheet — a hog, a lamb, a half of beef —
       leaves most of the page empty at three columns while the cut names wrap
       onto three lines. The fit pass below tries two columns first, at bigger
       type and with wider write-in boxes; three columns are for the sheets
       that need them (a whole beef). Half a page is still not enough for a
       name AND its spec side by side at that size — the table splits the
       width between them and both wrap — so in the wide tier the spec folds
       into the name's cell: beside the name when the pair fits on one line,
       under it when it doesn't. */
    .pkcut  { font-size: 22px; }
    .pkspec { font-size: 18px; }
    .pkspec-in { display: none; }
    .wide .pkcut  { font-size: 26px; }
    .wide td.pkspec, .wide th.pkspec { display: none; }
    .wide .pkline { display: flex; flex-wrap: wrap; align-items: baseline; column-gap: 12px; }
    .wide td .pkspec-in { display: inline; font-size: 19px; font-weight: normal; font-style: normal; color: #555; }
    .wide th .pkspec-in { display: inline; }
    .wide .pkcut { padding-top: 7px !important; padding-bottom: 7px !important; }
    .wide td.pknum, .wide th.pknum { width: 66px !important; }
    .wide td.pkwt,  .wide th.pkwt  { width: 86px !important; }
    .wide .pkrule { width: 72px !important; }
    .wide td.pkchk { font-size: 24px !important; }
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
  var LIMIT  = 7.7 * 96   // letter landscape less the 0.4in margins
  var FLOOR  = 0.62
  var NCOLS  = 3

  // ── Deal the rows into the three columns by measured height ───────────────
  // A section is atomic in a CSS column layout, so one long primal pins its
  // column to its own height while the other two sit half empty and the card
  // spills onto a second sheet with page left over (Charlie, 2026-08-18). The
  // packaging sheet had the same problem from the other end: it split on row
  // COUNT at build time, and rows are not the same height. So measure what
  // actually rendered and re-deal it, splitting a long section across columns
  // where it has to and repeating its header as "(cont.)".
  function pack(groups, target, overhead, atomic, ncols) {
    ncols = ncols || NCOLS
    var cols = [[]], h = overhead
    for (var gi = 0; gi < groups.length; gi++) {
      var g = groups[gi], i = 0, first = true
      while (true) {
        // A header with nothing under it is a wasted line at the foot of a
        // column — break before it, not after it.
        var need = g.hdrH + (i < g.rows.length ? g.rows[i].h : 0)
        if (atomic) for (var n = i + 1; n < g.rows.length; n++) need += g.rows[n].h
        if (cols[cols.length - 1].length && h + need > target && cols.length < ncols) { cols.push([]); h = overhead }
        var chunk = { g: g, rows: [], cont: !first }
        h += g.hdrH
        while (i < g.rows.length) {
          var rh = g.rows[i].h
          if (!atomic && chunk.rows.length && h + rh > target && cols.length < ncols) break
          chunk.rows.push(g.rows[i]); h += rh; i++
        }
        cols[cols.length - 1].push(chunk)
        first = false
        if (i >= g.rows.length) break
        cols.push([]); h = overhead     // section continues in the next column
      }
    }
    return cols
  }

  function colHeights(cols, overhead) {
    var out = []
    for (var c = 0; c < cols.length; c++) {
      var h = overhead
      for (var k = 0; k < cols[c].length; k++) {
        h += cols[c][k].g.hdrH
        for (var r = 0; r < cols[c][k].rows.length; r++) h += cols[c][k].rows[r].h
      }
      out.push(h)
    }
    return out
  }

  // The shortest three columns the card will fit into — binary search on the
  // column height, so a light card keeps its short columns instead of being
  // stretched down the page to fill the budget.
  function colMax(cols, overhead) { return Math.max.apply(null, colHeights(cols, overhead)) }
  function search(groups, budget, overhead, total, atomic, ncols) {
    var lo = 0, hi = total, best = null
    for (var it = 0; it < 24; it++) {
      var mid  = (lo + hi) / 2
      var cols = pack(groups, mid, overhead, atomic, ncols)
      var mx   = colMax(cols, overhead)
      if (mx <= mid + 0.5 && mx <= budget) { best = cols; hi = mid } else lo = mid
    }
    return best
  }
  function bestPacking(groups, budget, overhead, ncols) {
    ncols = ncols || NCOLS
    var total = overhead
    for (var i = 0; i < groups.length; i++) {
      total += groups[i].hdrH
      for (var j = 0; j < groups[i].rows.length; j++) total += groups[i].rows[j].h
    }
    // A primal the packer works down in one go would rather not be cut in
    // half, so breaking one has to buy back real page — an inch of column, the
    // difference between a sheet that fits and a sheet that gets shrunk to fit.
    // Short of that the sections stay whole, even if a column ends up short.
    var whole = search(groups, budget, overhead, total, true, ncols)
    var split = search(groups, budget, overhead, total, false, ncols)
    if (whole && (!split || colMax(whole, overhead) <= colMax(split, overhead) + 96)) return whole
    // Genuinely more than one sheet holds: balance it anyway, then let the
    // shrink pass below decide.
    return split || pack(groups, total / ncols, overhead, false, ncols)
  }

  // "(cont.)" is added on the way out, never carried back in — so a second
  // pass over an already-packed page cannot stack up "(cont.) (cont.)", and
  // two halves of one section landing back in the same column merge into a
  // single header again.
  var CONT = ' (cont.)'
  function baseTitle(t) {
    var v = String(t == null ? '' : t).trim()
    return v.slice(-CONT.length) === CONT ? v.slice(0, -CONT.length) : v
  }
  function pushGroup(groups, g) {
    var prev = groups[groups.length - 1]
    if (prev && prev.title && prev.title === g.title) { prev.rows = prev.rows.concat(g.rows); return }
    groups.push(g)
  }

  // Page 1 — the cut card. Sections are div > header + table inside .cutcols.
  function cutCardPass(page, box) {
    var secs = box.querySelectorAll('.sec')
    if (!secs.length) return
    var groups = []
    for (var i = 0; i < secs.length; i++) {
      var sec = secs[i], tbl = sec.querySelector('table'), hdr = sec.querySelector('.sechdr')
      if (!tbl || !hdr) continue
      var rows = [], sum = 0
      for (var j = 0; j < tbl.rows.length; j++) {
        var rh = tbl.rows[j].getBoundingClientRect().height
        rows.push({ el: tbl.rows[j], h: rh }); sum += rh
      }
      // Everything in the section that is not a row: header bar, borders, and
      // the 6px gap above it.
      pushGroup(groups, {
        title: baseTitle(hdr.textContent), hdrH: sec.getBoundingClientRect().height - sum + 6,
        rows: rows, sec: sec, tbl: tbl, hdr: hdr,
      })
    }
    if (!groups.length) return
    var budget = LIMIT - (box.getBoundingClientRect().top - page.getBoundingClientRect().top) - 2
    var cols   = bestPacking(groups, budget, 0)
    var wrap   = document.createElement('div')
    wrap.style.cssText = 'display:grid;grid-template-columns:repeat(' + NCOLS + ',1fr);gap:0 14px;align-items:start'
    for (var c = 0; c < cols.length; c++) {
      var cd = document.createElement('div')
      for (var k = 0; k < cols[c].length; k++) {
        var ch  = cols[c][k]
        var sc  = ch.g.sec.cloneNode(false)
        var hd  = ch.g.hdr.cloneNode(false)
        hd.textContent = ch.g.title + (ch.cont ? CONT : '')
        var tb2 = ch.g.tbl.cloneNode(false)
        var tb  = document.createElement('tbody')
        for (var r = 0; r < ch.rows.length; r++) tb.appendChild(ch.rows[r].el)
        tb2.appendChild(tb); sc.appendChild(hd); sc.appendChild(tb2); cd.appendChild(sc)
      }
      wrap.appendChild(cd)
    }
    box.textContent = ''
    box.style.columnCount = 'auto'
    box.appendChild(wrap)
  }

  // Page 2 — the packaging sheet. One table per column, section titles are
  // full-width rows inside the body.
  function packSheetPass(page, box, ncols) {
    ncols = ncols || NCOLS
    var cols0 = box.querySelectorAll('.packcol')
    var groups = [], tpl = null, thead = null, overhead = 0
    for (var c = 0; c < cols0.length; c++) {
      var tbl = cols0[c].querySelector('table')
      if (!tbl || !tbl.tBodies.length) continue
      if (!tpl) {
        tpl = tbl; thead = tbl.tHead
        overhead = (thead ? thead.getBoundingClientRect().height : 0) + 2
      }
      var rows = tbl.tBodies[0].rows
      for (var j = 0; j < rows.length; j++) {
        var r = rows[j], h = r.getBoundingClientRect().height
        if ((r.className || '').indexOf('sechdr-row') >= 0) {
          pushGroup(groups, { title: baseTitle(r.cells[0].textContent), hdrH: h, hdrRow: r, rows: [] })
        } else {
          if (!groups.length) pushGroup(groups, { title: '', hdrH: 0, hdrRow: null, rows: [] })
          groups[groups.length - 1].rows.push({ el: r, h: h })
        }
      }
    }
    if (!tpl || !groups.length) return
    // The sheet stretches to the full page so its sign-off line sits at the
    // bottom — drop that while measuring or every card looks full already.
    var minH = page.style.minHeight
    page.style.minHeight = '0'
    var pr = page.getBoundingClientRect(), br = box.getBoundingClientRect()
    var above  = br.top - pr.top
    var below  = pr.height - above - br.height          // notes + sign-off footer
    var budget = LIMIT - above - below - 2
    var cols   = bestPacking(groups, budget, overhead, ncols)
    var made   = []
    for (var ci = 0; ci < cols.length; ci++) {
      var cd = document.createElement('div')
      cd.className = 'packcol'
      if (cols[ci].length) {
        var t = tpl.cloneNode(false)
        if (thead) t.appendChild(thead.cloneNode(true))
        var tb = document.createElement('tbody')
        for (var k = 0; k < cols[ci].length; k++) {
          var ch = cols[ci][k]
          if (ch.g.hdrRow) {
            var hr = ch.g.hdrRow.cloneNode(true)
            hr.cells[0].textContent = ch.g.title + (ch.cont ? CONT : '')
            tb.appendChild(hr)
          }
          for (var r2 = 0; r2 < ch.rows.length; r2++) tb.appendChild(ch.rows[r2].el)
        }
        t.appendChild(tb); cd.appendChild(t)
      }
      made.push(cd)
    }
    box.textContent = ''
    box.style.gridTemplateColumns = 'repeat(' + ncols + ',1fr)'
    for (var m = 0; m < made.length; m++) box.appendChild(made[m])
    page.style.minHeight = minH
  }

  // Re-deal, then keep whichever layout actually measured shortest. A table
  // sizes its own columns to the rows it happens to be holding, so the row
  // heights measured in one layout are only an estimate of the next one — a
  // re-deal can land taller than what it replaced, and this is what stops that
  // from ever reaching the paper.
  function snap(box) { return { dom: box.cloneNode(true), css: box.style.cssText, h: box.getBoundingClientRect().height } }
  function restore(box, s) {
    box.textContent = ''
    box.style.cssText = s.css
    var dom = s.dom.cloneNode(true)
    while (dom.firstChild) box.appendChild(dom.firstChild)
  }
  // fresh: the layout in the box was dealt to a different column count, so it
  // is no baseline — the first pass at this count is.
  function dealPasses(page, box, isPack, ncols, fresh) {
    var best = fresh ? null : snap(box)
    for (var pass = 0; pass < 3; pass++) {
      if (isPack) packSheetPass(page, box, ncols); else cutCardPass(page, box)
      var h = box.getBoundingClientRect().height
      if (best && h >= best.h - 0.5) break
      best = snap(box)
    }
    if (box.getBoundingClientRect().height > best.h + 0.5) restore(box, best)
  }
  function repack(page) {
    var box = null, built = null
    try {
      box = page.querySelector('.packgrid') || page.querySelector('.cutcols')
      if (!box) return
      var isPack = (box.className || '').indexOf('packgrid') >= 0
      if (!isPack) { dealPasses(page, box, false, NCOLS); return }
      // The packaging sheet: two wide columns with the bigger type whenever
      // that still fits the page, three narrow ones only when it doesn't. The
      // rows measured in the built three-column layout are only an estimate
      // of the two-column one, so the pass is repeated on its own result.
      built = snap(box)
      page.classList.add('wide')
      dealPasses(page, box, true, 2, true)
      if (page.getBoundingClientRect().height <= LIMIT) return
      page.classList.remove('wide')
      restore(box, built)
      built = null
      dealPasses(page, box, true, NCOLS)
    } catch (e) {
      // A card that prints its old, taller layout beats one that prints
      // nothing, so any failure in here leaves the page as it was built.
      page.classList.remove('wide')
      if (box && built) restore(box, built)
      page.setAttribute('data-fit-error', String(e && e.message || e))
    }
  }

  // ── Then shrink, only if it still does not fit ────────────────────────────
  // Only as far as FLOOR, and never by clipping: the type is sized to be read
  // across the cutting room, and a card nobody can read from the rail is worse
  // than a card that ran to two pages.
  var pages = document.querySelectorAll('.page')
  for (var p = 0; p < pages.length; p++) {
    var page = pages[p]
    var scale = 1
    repack(page)
    // Zoom reflows the columns rather than just scaling pixels, so the height
    // after shrinking is not a straight multiple of the height before it —
    // converge instead of computing one factor, re-dealing the rows each time
    // because smaller type takes fewer lines.
    for (var pass = 0; pass < 6; pass++) {
      var h = page.getBoundingClientRect().height
      if (h <= LIMIT || scale <= FLOOR) break
      scale = Math.max(FLOOR, scale * (LIMIT / h) * 0.995)
      page.style.zoom = scale
      repack(page)
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

function printV2CutCard(ci: RawInstruction, appointments: HarvestAppointment[], carcassArg: CarcassInfo | CarcassInfo[] = EMPTY_CARCASS) {
  const name = ci.data?.customerName ?? '—'
  openPrintable(cardDocument(`Cut Card — ${name}`, v2CardPages(ci, appointments, carcassArg)))
}

// A whole batch in one document, so the crew gets a single print job instead of
// opening every card in turn (Jill, 2026-07-21).
function printV2CutCards(items: { ci: RawInstruction; carcasses: CarcassInfo[] }[], appointments: HarvestAppointment[]) {
  if (!items.length) return
  const body = items
    .map((it, i) => v2CardPages(it.ci, appointments, it.carcasses, i === items.length - 1))
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
    shortRibs: { cut: 'keep-half' },
    plate:     { cut: 'beef-bacon' },
    ribeye:    { style: 'boneless', cut: 'steaks', thickness: '1', seasoned: false, ribeye2: { style: 'bone-in', cut: 'rib-roast-half', thickness: '', seasoned: true } },
    shortLoin: { path: 'bone-in', tBoneThickness: '1.25', loin2: { path: 'boneless', tenderloin: { cut: 'filet', thickness: '2"' }, stripLoin: { cut: 'ny-strip', thickness: '1' } } },
    topSirloin:{ cut: 'roast', thickness: '', addons: ['seasoned'] },
    triTip:    { cut: 'grind', addons: [] },
    skirt:     { cut: 'cut-half' },
    flank:     { cut: 'keep-whole' },
    sirloinTip:  { mode: 'split', cut: 'roast-half', thickness: '', addons: ['seasoned'], tip2: { cut: 'steaks', thickness: '1', addons: [] } },
    bottomRound: { cut: 'jerky', jerkyFlavor: 'cowboy-ranch' },
    topRound:    { cut: 'roasts', roastCount: '3', addons: ['seasoned'] },
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
  // Harvest (kill) date filter — Jill works a kill day at a time when linking
  // cut sheets to animals (Jill, 2026-07-29). '' = all dates.
  const [filterHarvest, setFilterHarvest] = useState<string>('')
  // Free-text search across the card (Charlie, 2026-08-11). 141 cards is already
  // more than the status/species/date chips can narrow to one row, and the thing
  // you know is usually a name, a phone number or a carcass tag.
  const [search, setSearch] = useState('')
  const [showLinkPicker, setShowLinkPicker] = useState(false)
  const [linking, setLinking]           = useState(false)
  // Carcasses hanging on each appointment in the link picker, keyed by
  // appointment id. A producer with several animals booked reads as the same
  // line repeated — the hanging weight is what tells them apart (Jill,
  // 2026-08-06). Loaded when the picker opens; an unharvested booking has none.
  const [pickerCarcasses, setPickerCarcasses] = useState<Record<string, { tag: string; earTag: string; lbs: number | null }[]>>({})
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
  const [unlinking, setUnlinking]       = useState('')
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
        next[ciRow.id] = mine.flatMap(a =>
          (a.customers ?? [])
            .filter(c => c.linked_cutting_instruction_id === ciRow.id)
            .map(c => resolveCarcass(
              ciRow.id, a,
              logList.filter((l: any) => l.appointment_id === a.id),
              asgList.filter((x: any) => x.appointment_id === a.id),
              logList,
              c.id,
            ))
        )
      }
      setCarcassStates(next)
    } catch {
      setCarcassStates({})   // never block the page on this
    }
  }

  // Put this card on a specific animal. The assignments API rewrites a whole
  // check-in at once, so keep everyone else's exactly as-is and swap only the
  // rows belonging to this card's customer slot.
  // slotId names WHICH of the check-in's customer slots this carcass is for.
  // Resolving it by card id instead picked the first linked slot every time, so
  // a card on five hog slots wrote all five picks against slot one — and since
  // `others` drops the existing row for that same slot, each pick silently
  // deleted the one before it. Jill assigned 187#, 186# and 180# and kept only
  // 180# (Jill, 2026-08-18).
  async function assignCarcass(apptId: string, harvestLogId: string, slotId?: string) {
    if (!selected) return
    setAssigning(`${slotId ?? ''}|${harvestLogId}`)
    try {
      const appt = appointments.find(a => a.id === apptId)
      const slot = slotId
        ? appt?.customers?.find(c => c.id === slotId)
        : appt?.customers?.find(c => c.linked_cutting_instruction_id === selected.id)
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

  // Take this card back off one animal. "Link to another animal" ADDS a link
  // rather than moving it, so before this the only way to undo a mis-link was
  // to delete the card — which throws away the customer's answers
  // (Charlie, 2026-08-18).
  async function unlinkFromAppointment(apptId: string, slotId?: string) {
    if (!selected) return
    const appt = appointments.find(a => a.id === apptId)
    const slot = slotId
      ? appt?.customers?.find(c => c.id === slotId)
      : appt?.customers?.find(c => c.linked_cutting_instruction_id === selected.id)
    const who  = slot?.customer_name || selected.data?.customerName || 'This card'
    if (!window.confirm(
      `Take ${who}'s cut card off this ${appt?.species ?? 'animal'}?\n\n` +
      `The card is kept — it goes back to the unlinked list so you can put it on the right animal. The carcass assignment for this slot is cleared too.`
    )) return
    setUnlinking(slotId ?? apptId)
    try {
      const res = await fetch('/api/cutting-instructions/unlink', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: selected.id, appointment_id: apptId, appointment_customer_id: slotId }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setAssignError(body.error || 'Could not unlink that card.')
        return
      }
      setAssignError('')
      // The route rolls the card back to pending once no animal holds it.
      if (body.status) setSelected(prev => prev ? { ...prev, status: body.status } : null)
      await load()
    } finally {
      setUnlinking('')
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

  // Everything about a card you might have in hand when you go looking for it:
  // who it's for, how to reach them, the animal, the producer who brought it and
  // the tag on the carcass it sits on. Digits are matched separately so a phone
  // typed as 4065551234 still finds one stored as (406) 555-1234.
  function haystack(ci: RawInstruction): string {
    const d = ci.data ?? {}
    const carcasses = carcassStates[ci.id] ?? []
    const producers = appointments
      .filter(a => a.customers?.some(c => c.linked_cutting_instruction_id === ci.id))
      .map(a => a.source)
    return [
      // Both halves of a business account: the office searches "Michael
      // Williams" and has to find the card headlined "87 Rentals".
      d.customerName, d.businessName, d.contactName,
      d.customerPhone, (d.customerPhone ?? '').replace(/\D/g, ''),
      d.customerEmail, d.notes, speciesOf(ci), ci.status,
      ...producers,
      ...carcasses.flatMap(c => [c.tag, c.lot, c.producer]),
    ].filter(Boolean).join(' ').toLowerCase()
  }

  // Every word has to match, so "pinkerton hog" narrows rather than widens.
  const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean)

  // How many cards are on file for each drop-off, counted over every loaded
  // card rather than the filtered view — a species or status chip that hides
  // card 2 must not make card 1 look like a shortfall.
  const cardsPerDropOff = new Map<string, number>()
  for (const i of instructions) {
    if (i.status === 'archived') continue
    const k = dropOffKey(i)
    cardsPerDropOff.set(k, (cardsPerDropOff.get(k) ?? 0) + 1)
  }
  // null when the count is satisfied — the common case is one head, one card.
  const headShortfall = (ci: RawInstruction): { declared: number; onFile: number } | null => {
    const declared = declaredHead(ci)
    if (declared <= 1) return null
    const onFile = cardsPerDropOff.get(dropOffKey(ci)) ?? 1
    return onFile < declared ? { declared, onFile } : null
  }

  const filtered = instructions.filter(i => {
    const species = speciesOf(i)
    if (terms.length) {
      const hay = haystack(i)
      if (!terms.every(t => hay.includes(t))) return false
    }
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
    if (filterHarvest) {
      const sd = harvestDateFor(i, appointments).date
      if (filterHarvest === '__none__' ? !!sd : sd !== filterHarvest) return false
    }
    return true
  })

  // Cards the search matches that the status/species/date chips are hiding.
  const elsewhereCount = terms.length
    ? instructions.filter(i => terms.every(t => haystack(i).includes(t))).length - filtered.length
    : 0

  // Harvest dates present in the active (non-archived) cards, newest first, for
  // the filter dropdown. A card with no scheduled kill date falls under "— none —".
  const activeHarvest = instructions
    .filter(i => i.status !== 'archived')
    .map(i => harvestDateFor(i, appointments))
  const harvestDates = Array.from(new Set(
    activeHarvest.map(s => s.date).filter((d): d is string => !!d)
  )).sort((a, b) => b.localeCompare(a))
  // A date nothing is linked to is a date only customers have vouched for —
  // the dropdown says so rather than offering it as a harvest day.
  const scheduledDates = new Set(activeHarvest.filter(s => s.scheduled).map(s => s.date))
  const anyNoHarvest = activeHarvest.some(s => !s.date)

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

  // Appointments that have at least one customer without a linked
  // instruction — and that are the same animal. A hog's instructions on a beef
  // appointment sends the wrong cut card to the rail (Charlie, 2026-07-22).
  // Completed appointments still belong here: a card can come in after the
  // animal is already processed (e.g. a grinder bull), so only NoShow/Declined
  // — appointments with no real animal behind them — get excluded (Jill,
  // 2026-08-19: couldn't find a bull killed two weeks earlier).
  // Nothing booked before we started linking cut cards will ever get one, and
  // those bookings buried the live ones in the picker (Jill, 2026-08-20: "can we
  // remove the appointments before we started linking cut cards"). The cutoff is
  // READ FROM THE DATA rather than hardcoded — the oldest booking that actually
  // carries a link — so it can't hide an appointment anyone has ever linked, and
  // it moves on its own instead of rotting into a stale constant.
  const linkingEraStart = appointments.reduce((earliest, a) => {
    if (!a.harvest_date) return earliest
    if (!a.customers?.some(c => c.linked_cutting_instruction_id)) return earliest
    return !earliest || a.harvest_date < earliest ? a.harvest_date : earliest
  }, '')

  const linkableAppts = appointments.filter(a =>
    a.status !== 'NoShow' && a.status !== 'Declined' &&
    // No link has ever been made yet — don't filter anything out on day one.
    (!linkingEraStart || a.harvest_date >= linkingEraStart) &&
    a.customers?.some(c => !c.linked_cutting_instruction_id) &&
    sameSpecies(a.species, selectedSpecies)
  ).sort((a, b) => a.harvest_date.localeCompare(b.harvest_date))
  const linkableIds = linkableAppts.map(a => a.id).join(',')

  // Weights for the picker, fetched only while it's open — the list is short
  // and this keeps the page load free of a call nobody needs until they link.
  useEffect(() => {
    if ((!showLinkPicker && !showCopyPicker) || !linkableIds) return
    let cancelled = false
    ;(async () => {
      try {
        const res  = await fetch(`/api/harvest?appointment_ids=${encodeURIComponent(linkableIds)}`)
        const data = await res.json()
        if (cancelled || !Array.isArray(data)) return
        const next: Record<string, { tag: string; earTag: string; lbs: number | null }[]> = {}
        for (const l of data) {
          const halves = (l.half_1_weight_lbs ?? 0) + (l.half_2_weight_lbs ?? 0)
          const lbs = l.hot_carcass_weight_lbs ?? (halves > 0 ? halves : null)
          ;(next[l.appointment_id] ??= []).push({ tag: l.carcass_tag ?? '', earTag: l.ear_tag ?? '', lbs: lbs == null ? null : Number(lbs) })
        }
        setPickerCarcasses(next)
      } catch { /* weights are a nicety here — linking still works without them */ }
    })()
    return () => { cancelled = true }
  }, [showLinkPicker, showCopyPicker, linkableIds])

  // Hanging weight beside the producer's name in both animal pickers, so two
  // bookings from the same ranch aren't the same line twice (Jill, 2026-08-06).
  // Only weighed carcasses show — a booking not yet killed says nothing rather
  // than implying a zero.
  function hangingNote(apptId: string) {
    const weighed = (pickerCarcasses[apptId] ?? []).filter(c => c.lbs != null)
    if (!weighed.length) return null
    return (
      <span style={{ color: '#7CAFDD', fontWeight: 400, marginLeft: '0.5rem', fontSize: '0.82rem' }}>
        {/* Label first — trailing it after a list of two animals read as though
            only the last one was hanging. */}
        · hanging: {weighed.map(c => `${c.tag ? `#${c.tag} ` : ''}${c.lbs} lbs`).join(', ')}
      </span>
    )
  }

  // Producer customer names are often hand-typed with the animal's ear tag as
  // a suffix ("VML-Vermillion Ranch 626H") so staff can eyeball which carcass
  // is whose. That suffix is typed once at booking; the real ear tag is typed
  // again, separately, at receiving — nothing keeps the two in sync, and a
  // slip either time reads as fine until someone compares them by eye
  // (Charlie, 2026-08-18 — "VML-Vermillion Ranch 626G" vs ear tag 626H).
  function embeddedEarTag(name: string): string | null {
    const m = name.trim().match(/(\d{2,4}[A-Za-z])$/)
    return m ? m[1].toUpperCase() : null
  }

  // Null when there's nothing to check against yet (no tag in the name, or
  // this appointment's animals haven't been ear-tagged at receiving) — silence
  // beats a false alarm on a booking that's still ahead of the harvest floor.
  function earTagMismatch(apptId: string, customerName: string): string | null {
    const named = embeddedEarTag(customerName)
    if (!named) return null
    const tagged = (pickerCarcasses[apptId] ?? []).filter(c => c.earTag)
    if (!tagged.length) return null
    return tagged.some(c => c.earTag.toUpperCase() === named) ? null : named
  }

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
      printV2CutCards(items, appts)
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
            onClick={() => printV2CutCard(FAKE_CI, [], { ...EMPTY_CARCASS, lot: '26153', tag: '02', producer: 'Test Producer', hcw: 645, killType: 'USDA', state: 'assigned' })}
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
              value={filterHarvest}
              onChange={e => setFilterHarvest(e.target.value)}
              title="Filter by scheduled harvest date"
              style={{
                background: filterHarvest ? 'var(--med-brown)' : 'rgba(0,0,0,0.25)',
                color: filterHarvest ? 'var(--cream)' : 'var(--tan)',
                border: '1px solid rgba(166,120,90,0.3)', borderRadius: 3,
                padding: '0.3rem 0.5rem', fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer', outline: 'none',
              }}
            >
              <option value="">🔪 All harvest dates</option>
              {harvestDates.map(d => (
                <option key={d} value={d}>
                  {scheduledDates.has(d) ? '' : '~ '}
                  {new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                  {scheduledDates.has(d) ? '' : ' (customer’s date)'}
                </option>
              ))}
              {anyNoHarvest && <option value="__none__">— no harvest date —</option>}
            </select>
            <div style={{ position: 'relative', flex: '1 1 220px', minWidth: 180 }}>
              <span style={{ position: 'absolute', left: '0.5rem', top: '50%', transform: 'translateY(-50%)', fontSize: '0.8rem', pointerEvents: 'none', opacity: 0.7 }}>🔍</span>
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                onKeyDown={e => { if (e.key === 'Escape') setSearch('') }}
                placeholder="Search name, phone, producer, tag…"
                style={{
                  width: '100%', boxSizing: 'border-box',
                  background: 'rgba(0,0,0,0.25)', color: 'var(--cream)',
                  border: `1px solid ${search ? 'var(--tan)' : 'rgba(166,120,90,0.3)'}`,
                  borderRadius: 3, padding: '0.3rem 1.7rem 0.3rem 1.8rem',
                  fontSize: '0.82rem', outline: 'none',
                }}
              />
              {search && (
                <button onClick={() => setSearch('')} title="Clear search"
                  style={{ position: 'absolute', right: '0.35rem', top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', color: 'var(--tan)', fontSize: '0.9rem', cursor: 'pointer', lineHeight: 1, padding: '0 0.2rem' }}>×</button>
              )}
            </div>
            <button onClick={load} style={{ ...btnStyle('transparent', 'var(--tan)'), border: '1px solid rgba(166,120,90,0.3)' }}>↺</button>
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
                {/* A search that hits nothing here but does hit elsewhere means
                    the tabs are hiding it, not that the card doesn't exist. */}
                {terms.length > 0 && elsewhereCount > 0 ? (
                  <p style={{ fontSize: '0.8rem', marginTop: '0.5rem' }}>
                    {elsewhereCount} match{elsewhereCount === 1 ? 'es' : ''} outside these filters —{' '}
                    <button onClick={() => { setFilterStatus('all'); setFilterSpecies('all'); setFilterHarvest('') }}
                      style={{ background: 'none', border: 'none', color: 'var(--cream)', textDecoration: 'underline', cursor: 'pointer', font: 'inherit', padding: 0 }}>
                      clear the filters
                    </button>.
                  </p>
                ) : (
                  <p style={{ fontSize: '0.8rem', marginTop: '0.5rem', opacity: 0.7 }}>Submissions from cowboymeats.com will appear here.</p>
                )}
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
                  {['Customer','Species','Submitted','Harvest','Status'].map(h => (
                    <div key={h} style={{ fontSize: '0.62rem', color: 'var(--light-brown)', textTransform: 'uppercase', letterSpacing: '0.1em', whiteSpace: 'nowrap' }}>{h}</div>
                  ))}
                </div>
                {filtered.map(ci => {
                  const d         = ci.data ?? {}
                  const name      = d.customerName ?? '—'
                  const species   = speciesOf(ci)
                  const isSel     = selected?.id === ci.id
                  const harvest = harvestDateFor(ci, appointments)
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
                      <div style={{ fontWeight: 600, color: 'var(--cream)', fontSize: '0.9rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {name}
                        {(() => {
                          const short = headShortfall(ci)
                          if (!short) return null
                          return (
                            <span
                              title={`This customer said they were bringing ${short.declared} head, and only ${short.onFile} cutting card${short.onFile === 1 ? ' is' : 's are'} on file. One card covers one animal — check whether the rest are coming before this is cut.`}
                              style={{ marginLeft: '0.4rem', fontSize: '0.68rem', fontWeight: 700, padding: '0.05rem 0.35rem', borderRadius: 4, background: 'rgba(200,120,20,0.28)', color: '#f0b866', whiteSpace: 'nowrap' }}>
                              ⚠ {short.onFile}/{short.declared} head
                            </span>
                          )
                        })()}
                      </div>
                      <div style={{ fontSize: '0.78rem', color: 'var(--tan)' }}>{species}</div>
                      <div style={{ fontSize: '0.78rem', color: 'var(--tan)', whiteSpace: 'nowrap' }}>{fmtShortDate(ci.created_at)}</div>
                      {/* An unconfirmed date is dimmed and prefixed "~" so it
                          can't be read as the day the animal was killed. */}
                      <div
                        title={harvest.date && !harvest.scheduled
                          ? 'The date the customer wrote on their own form. This card is not linked to a harvest appointment yet, so nothing has confirmed it.'
                          : undefined}
                        style={{
                          fontSize: '0.78rem', whiteSpace: 'nowrap',
                          color: !harvest.date ? 'rgba(166,120,90,0.5)' : harvest.scheduled ? 'var(--cream)' : 'var(--tan)',
                          fontStyle: harvest.date && !harvest.scheduled ? 'italic' : undefined,
                        }}>
                        {harvest.date && !harvest.scheduled ? '~' : ''}{fmtShortDate(harvest.date)}
                      </div>
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
                <button onClick={async () => { const appts = await freshAppointments(appointments); return isV2 ? printV2CutCard(selected, appts, await carcassInfosFor(selected, appts)) : printCutCard(selected) }} style={btnStyle('rgba(166,120,90,0.2)', 'var(--tan)')}>🖨 Print Cut Card</button>
                {selected.status === 'archived' ? (
                  <button onClick={() => markStatus([selected.id], 'pending')} style={btnStyle('rgba(166,120,90,0.2)', 'var(--tan)')}>↩ Restore</button>
                ) : (
                  <button onClick={archiveSelected} style={btnStyle('rgba(166,120,90,0.2)', 'var(--tan)')}>🗄 Archive</button>
                )}
                <button onClick={deleteSelected} style={btnStyle('rgba(150,40,40,0.22)', '#e69a9a')}>🗑 Delete</button>
                <button onClick={() => setSelected(null)} style={btnStyle('transparent', 'var(--tan)')}>✕</button>
              </div>
            </div>

            {/* Multi-head warnings. These sit above everything else in the
                detail panel because both of them change what the floor should
                do, and both are invisible on the printed card. */}
            {(() => {
              const short = headShortfall(selected)
              const pinned = singleHeadSmokehouse(selected)
              const declared = declaredHead(selected)
              if (!short && !pinned.length) return null
              return (
                <div style={{ padding: '0.75rem 1.25rem', borderBottom: '1px solid rgba(166,120,90,0.15)', background: 'rgba(200,120,20,0.12)', display: 'flex', flexDirection: 'column', gap: '0.45rem', flexShrink: 0 }}>
                  {short && (
                    <div style={{ fontSize: '0.82rem', color: '#f0b866' }}>
                      ⚠ <strong>{short.declared} head declared, {short.onFile} card{short.onFile === 1 ? '' : 's'} on file.</strong>{' '}
                      A cutting card covers one animal. Check whether the rest are
                      coming before anything gets cut &mdash; or copy this one for
                      each remaining animal.
                    </div>
                  )}
                  {pinned.length > 0 && (
                    <div style={{ fontSize: '0.82rem', color: '#f0b866' }}>
                      🔒 <strong>{pinned.join(', ')} {pinned.length === 1 ? 'is' : 'are'} for ONE animal only</strong>{' '}
                      out of {declared}. If you link this card to more than one head,
                      do not repeat that order &mdash; the customer asked for it off a
                      single animal.
                    </div>
                  )}
                </div>
              )
            })()}

            {/* Linked badge */}
            {selected.status === 'linked' && (() => {
              // Every animal this card is linked to — one line each, so a hog
              // and a half shows both instead of just whichever came first.
              // Keyed on the SLOT: a producer running several head against one
              // cut spec links the same card once per animal on a single
              // check-in, and one line per check-in hid all but the first.
              const linkedAppts = appointments.flatMap(a =>
                (a.customers ?? [])
                  .filter(c => c.linked_cutting_instruction_id === selected.id)
                  .map(c => ({ appt: a, cust: c }))
              )
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
                  {linkedAppts.map(({ appt, cust }) => {
                    const state = states.find(s => s.slotId === cust.id) ?? states.find(s => s.apptId === appt.id && !s.slotId)
                    const when  = new Date(appt.harvest_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
                    return (
                      <div key={`${appt.id}:${cust.id}`} style={{ marginBottom: '0.2rem' }}>
                        <div>
                          {state?.state === 'ambiguous' ? '⚠' : '✅'} Linked to: <strong>{appt.species}</strong>
                          {state && state.state !== 'ambiguous' && state.tag ? <> <strong>#{state.tag}</strong></> : null}
                          {appt.source ? <> from <strong>{appt.source}</strong></> : null} on <strong>{when}</strong>
                          {` — ${cust.customer_name || 'unnamed slot'} (${cust.portion})`}
                          {state && state.state !== 'ambiguous' && state.hcw != null
                            ? <> · <strong>{state.hcw} lbs</strong> hanging</>
                            : null}
                        </div>

                        <button
                          onClick={() => unlinkFromAppointment(appt.id, cust.id)}
                          disabled={unlinking === cust.id}
                          title="Take this card off this animal. The card is kept and goes back to the unlinked list — use this to undo a mis-link instead of deleting the card."
                          style={{ background: 'none', border: 'none', color: 'var(--tan)', textDecoration: 'underline', cursor: 'pointer', fontSize: '0.74rem', padding: '0.1rem 0' }}>
                          {unlinking === cust.id ? 'Unlinking…' : '🔓 Unlink from this animal'}
                        </button>

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
                              {state.candidates.length} animals came in on this check-in — which one is {cust.customer_name || 'this customer'}&apos;s?
                              <span style={{ color: 'var(--tan)' }}> Until you pick, the card prints with no tag, no hanging weight and no inspection marking.</span>
                            </div>
                            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                              {state.candidates.map(c => {
                                const taken = c.heldBy.length > 0
                                return (
                                  <button key={c.id} onClick={() => assignCarcass(appt.id, c.id, cust.id)} disabled={!!assigning}
                                    title={taken ? `Already assigned to ${c.heldBy.join(', ')}` : 'Assign this carcass to this card'}
                                    style={{
                                      background: taken ? 'rgba(0,0,0,0.25)' : 'rgba(245,158,11,0.16)',
                                      border: `1px solid ${taken ? 'rgba(166,120,90,0.3)' : 'rgba(245,158,11,0.5)'}`,
                                      borderRadius: 3, padding: '0.3rem 0.6rem', cursor: assigning ? 'wait' : 'pointer',
                                      color: taken ? 'var(--tan)' : '#f0b429', fontSize: '0.78rem', textAlign: 'left',
                                    }}>
                                    {assigning === `${cust.id}|${c.id}` ? 'Assigning…' : <>
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
              <p style={{ color: 'var(--tan)', textAlign: 'center', padding: '2rem' }}>No {selectedSpecies.toLowerCase()} appointments need instructions yet.</p>
            ) : (
              linkableAppts.map(a => (
                <div key={a.id} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(166,120,90,0.15)', borderRadius: '4px', padding: '0.85rem 1rem', marginBottom: '0.75rem' }}>
                  <div style={{ fontWeight: 700, color: 'var(--cream)', marginBottom: '0.5rem', fontSize: '0.9rem' }}>
                    {speciesEmblem(a.species)} {a.species} · {new Date(a.harvest_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
                    {a.source && <span style={{ color: 'var(--tan)', fontWeight: 400, marginLeft: '0.5rem' }}>· {a.source}</span>}
                    {hangingNote(a.id)}
                  </div>
                  {a.customers?.filter(c => !c.linked_cutting_instruction_id).map((c, idx) => {
                    const mismatch = earTagMismatch(a.id, c.customer_name || '')
                    return (
                      <div key={c.id}>
                        <button onClick={() => linkToCustomer(a.id, a.customers.indexOf(c))} disabled={linking}
                          style={{ display: 'block', width: '100%', textAlign: 'left', background: 'rgba(117,71,27,0.25)', border: '1px solid rgba(166,120,90,0.2)', borderRadius: '3px', padding: '0.5rem 0.75rem', marginBottom: mismatch ? '0.15rem' : '0.35rem', color: 'var(--cream)', cursor: 'pointer', fontSize: '0.85rem' }}>
                          {linking ? 'Linking…' : `→ ${c.customer_name || 'Unnamed customer'} (${c.portion})`}
                        </button>
                        {mismatch && (
                          <div style={{ color: '#E8883A', fontSize: '0.72rem', marginBottom: '0.35rem', paddingLeft: '0.25rem' }}>
                            ⚠ Name says {mismatch}, but no carcass on this appointment was ear-tagged {mismatch} at receiving — check before linking.
                          </div>
                        )}
                      </div>
                    )
                  })}
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
                    {hangingNote(a.id)}
                  </div>
                  {a.customers?.filter(c => !c.linked_cutting_instruction_id).map(c => {
                    const mismatch = earTagMismatch(a.id, c.customer_name || '')
                    return (
                      <div key={c.id}>
                        <button onClick={() => copyToShare(a.id, a.customers.indexOf(c))} disabled={copying || linking}
                          style={{ display: 'block', width: '100%', textAlign: 'left', background: 'rgba(117,71,27,0.25)', border: '1px solid rgba(166,120,90,0.2)', borderRadius: '3px', padding: '0.5rem 0.75rem', marginBottom: mismatch ? '0.15rem' : '0.35rem', color: 'var(--cream)', cursor: copying ? 'wait' : 'pointer', fontSize: '0.85rem', opacity: copying ? 0.6 : 1 }}>
                          {copying ? 'Copying…' : `→ ${c.customer_name || 'Unnamed customer'} (${c.portion})`}
                        </button>
                        {mismatch && (
                          <div style={{ color: '#E8883A', fontSize: '0.72rem', marginBottom: '0.35rem', paddingLeft: '0.25rem' }}>
                            ⚠ Name says {mismatch}, but no carcass on this appointment was ear-tagged {mismatch} at receiving — check before linking.
                          </div>
                        )}
                      </div>
                    )
                  })}
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
