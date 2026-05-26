'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { HarvestAppointment } from '@/lib/types'

// ── Types ─────────────────────────────────────────────────────────────────────

interface RawInstruction {
  id:         string
  created_at: string
  status:     string
  data:       Record<string, any>
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
    ['hogChops','Chops'],['hogSpareRibs','Spare Ribs'],['hogHam','Ham'],['hogHamCut','Ham Cut'],
    ['hogBelly','Belly'],['hogBostonButt','Boston Butt'],['hogShoulderBacon','Shoulder Bacon'],['hogHocks','Hocks'],
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

// ── V2 form helpers ───────────────────────────────────────────────────────────

function v2fmt(val: string): string {
  if (!val) return ''
  return val.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}
function v2thick(v: string): string { return v ? `${v}"` : '' }
function v2withT(cut: string, t: string): string { return [v2fmt(cut), v2thick(t)].filter(Boolean).join(' — ') }
function v2adds(arr: string[]): string { return arr?.length ? arr.map(v2fmt).join(', ') : '' }

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

function renderV2Detail(ci: RawInstruction) {
  const d = ci.data ?? {}
  const isBeef = (d.species ?? '').toLowerCase() === 'beef'
  const isPork = (d.species ?? '').toLowerCase() === 'pork'
  const isLG = (d.species ?? '').toLowerCase() === 'lamb' || (d.species ?? '').toLowerCase() === 'goat'
  return (
    <>
      <V2Section title="Customer Info">
        <V2Field label="Name" value={d.customerName} />
        <V2Field label="Phone" value={d.customerPhone} />
        <V2Field label="Email" value={d.customerEmail} />
        <V2Field label="Kill Date" value={d.killDate} />
        <V2Field label="Portion" value={v2fmt(d.portion)} />
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
          <V2Section title="Chuck">
            <V2Field label="Brisket" value={
              d.brisket?.cut2
                ? `1: ${v2fmt(d.brisket.cut)} / 2: ${v2fmt(d.brisket.cut2)}`
                : v2fmt(d.brisket?.cut)
            } />
            <V2Field label="Shank" value={v2fmt(d.shank?.cut)} />
            <V2Field label="Shank Add-ons" value={v2adds(d.shank?.addons)} addon />
            <V2Field label="Arm Roast" value={v2fmt(d.armRoast?.cut)} />
            <V2Field label="Arm Add-ons" value={v2adds(d.armRoast?.addons)} addon />
            <V2Field label="Flat Iron" value={v2fmt(d.flatIron?.cut)} />
            <V2Field label="Chuck Roll" value={v2fmt(d.chuckRoll?.cut)} />
            <V2Field label="Chuck Roll Add-ons" value={v2adds(d.chuckRoll?.addons)} addon />
          </V2Section>
          <V2Section title="Plate & Short Ribs">
            <V2Field label="Short Ribs" value={v2fmt(d.shortRibs?.cut)} />
            <V2Field label="Short Ribs Add-ons" value={v2adds(d.shortRibs?.addons)} addon />
            <V2Field label="Plate" value={v2fmt(d.plate?.cut)} />
          </V2Section>
          <V2Section title="Ribeye">
            <V2Field label="Style" value={v2fmt(d.ribeye?.style)} />
            <V2Field label="Cut" value={v2withT(d.ribeye?.cut ?? '', d.ribeye?.thickness ?? '')} />
            <V2Field label="Add-ons" value={v2adds(d.ribeye?.addons)} addon />
          </V2Section>
          <V2Section title="Short Loin">
            {d.shortLoin?.path === 'bone-in' && <V2Field label="T-Bone / Porterhouse" value={v2thick(d.shortLoin.tBoneThickness)} />}
            {d.shortLoin?.path === 'boneless' && (
              <>
                <V2Field label="Tenderloin" value={d.shortLoin.tenderloin?.cut === 'filet' ? 'Filet Mignon — 2"' : v2fmt(d.shortLoin.tenderloin?.cut ?? '')} />
                <V2Field label="Strip Loin" value={v2withT(d.shortLoin.stripLoin?.cut ?? '', d.shortLoin.stripLoin?.thickness ?? '')} />
              </>
            )}
          </V2Section>
          <V2Section title="Sirloin">
            <V2Field label="Top Sirloin" value={v2withT(d.topSirloin?.cut ?? '', d.topSirloin?.thickness ?? '')} />
            <V2Field label="Tri Tip" value={v2fmt(d.triTip?.cut)} />
          </V2Section>
          <V2Section title="Flank">
            <V2Field label="Skirt" value={v2fmt(d.skirt?.cut)} />
            <V2Field label="Flank Steak" value={v2fmt(d.flank?.cut)} />
          </V2Section>
          <V2Section title="Round">
            <V2Field label="Sirloin Tip" value={v2withT(d.sirloinTip?.cut ?? '', d.sirloinTip?.thickness ?? '')} />
            <V2Field label="Bottom Round" value={v2withT(d.bottomRound?.cut ?? '', d.bottomRound?.thickness ?? '')} />
            <V2Field label="Bottom Round Add-ons" value={v2adds(d.bottomRound?.addons)} addon />
            <V2Field label="Top Round" value={v2withT(d.topRound?.cut ?? '', d.topRound?.thickness ?? '')} />
            <V2Field label="Top Round Add-ons" value={v2adds(d.topRound?.addons)} addon />
            <V2Field label="Round Shank / Marrow" value={v2fmt(d.roundShank?.marrow)} />
          </V2Section>
        </>
      )}

      {isPork && (
        <>
          <V2Section title="Shoulder">
            <V2Field label="Cut" value={v2fmt(d.shoulder?.cut)} />
            {d.shoulder?.cut === 'roast' && <V2Field label="Roast Size" value={d.shoulder.roastSize ? `${d.shoulder.roastSize} lb` : ''} />}
            {d.shoulder?.cut === 'steaks' && <V2Field label="Thickness" value={v2thick(d.shoulder.steakThickness)} />}
            <V2Field label="Add-ons" value={v2adds(d.shoulder?.addons)} addon />
          </V2Section>
          <V2Section title="Loin">
            <V2Field label="Cut" value={v2fmt(d.loin?.cut)} />
            {(d.loin?.cut === 'bone-in-chops' || d.loin?.cut === 'boneless-chops') && (
              <>
                <V2Field label="Chop Thickness" value={v2thick(d.loin?.chopThickness)} />
                <V2Field label="Per Pack" value={d.loin?.chopPack} />
              </>
            )}
            {d.loin?.cut === 'boneless-chops' && <V2Field label="Baby Back Ribs" value={v2fmt(d.loin?.babyBack ?? '')} />}
            {d.loin?.cut === 'loin-roast' && <V2Field label="Roast Size" value={v2fmt(d.loin?.roastSize ?? '')} />}
            <V2Field label="Tenderloin" value={v2fmt(d.loin?.tenderloin)} />
            <V2Field label="Add-ons" value={v2adds(d.loin?.addons)} addon />
          </V2Section>
          <V2Section title="Belly">
            <V2Field label="Cut" value={v2fmt(d.belly?.cut)} />
          </V2Section>
          <V2Section title="Ham">
            <V2Field label="Style" value={v2fmt(d.ham?.style)} />
            {d.ham?.style !== 'grind' && <V2Field label="Cut" value={v2fmt(d.ham?.cut ?? '')} />}
          </V2Section>
          <V2Section title="Hocks & Spare Ribs">
            <V2Field label="Hocks" value={v2fmt(d.hocks?.cut)} />
            <V2Field label="Spare Ribs" value={v2fmt(d.spareRibs?.cut)} />
          </V2Section>
        </>
      )}

      {isLG && (
        <V2Section title="Primals">
          <V2Field label="Rack" value={v2fmt(d.rack?.cut)} />
          <V2Field label="Loin" value={v2fmt(d.loin?.cut)} />
          <V2Field label="Leg" value={v2fmt(d.leg?.cut)} />
          <V2Field label="Shoulder" value={v2fmt(d.shoulder?.cut)} />
          <V2Field label="Shank" value={v2fmt(d.shank?.cut)} />
        </V2Section>
      )}

      {d.specialty?.interest && (
        <V2Section title="Specialty Items">
          <V2Field label="Interested" value={d.specialty.interest === 'yes' ? 'Yes — crew will call' : 'No thanks'} />
          <V2Field label="Notes" value={d.specialty.notes} />
        </V2Section>
      )}
    </>
  )
}

function printV2CutCard(ci: RawInstruction) {
  const d = ci.data ?? {}
  const species = d.species ?? 'Beef'
  const name = d.customerName ?? '—'
  const isBeef = species.toLowerCase() === 'beef'
  const isPork = species.toLowerCase() === 'pork'
  const isLG   = species.toLowerCase() === 'lamb' || species.toLowerCase() === 'goat'

  const fmt   = (v: string) => v ? v.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : ''
  const thick = (v: string) => v ? `${v}"` : ''
  const withT = (cut: string, t: string) => [fmt(cut), thick(t)].filter(Boolean).join(' — ')
  const adds  = (arr: string[]) => arr?.length ? arr.map(fmt).join(', ') : ''

  // ── Page 1: Cut Card ──────────────────────────────────────────────────────
  // Compact rows + sections wrapped in break-inside:avoid for 2-column CSS layout
  const row = (label: string, value: any, addon = false): string => {
    const v = value != null ? String(value) : ''
    if (!v.trim()) return ''
    const lc = addon ? '#8a6200' : '#75471B'
    const fi = addon ? 'italic'  : 'normal'
    return `<tr style="${addon ? 'background:#fffbe8' : ''}">
      <td style="padding:4px 8px;color:${lc};font-size:10px;width:110px;vertical-align:top">${label}</td>
      <td style="padding:4px 8px;font-size:12px;font-weight:600;font-style:${fi};vertical-align:top;border-left:1px solid #eee">${v}</td>
    </tr>`
  }
  // Each section is a single div with break-inside:avoid so CSS columns won't split it mid-section
  const sec = (title: string, rows: string): string =>
    rows.trim()
      ? `<div style="break-inside:avoid;margin-top:8px">
           <div style="background:#351E0E;color:#F2E8D9;padding:5px 10px;font-size:10px;letter-spacing:0.12em;text-transform:uppercase;font-weight:bold">${title}</div>
           <table style="width:100%;border-collapse:collapse;border:1px solid #e0d5c8">${rows}</table>
         </div>`
      : ''

  let cutSections = ''

  if (d.organs) {
    cutSections += sec('Organs', [
      row('Heart', fmt(d.organs.heart)),
      row('Liver', fmt(d.organs.liver)),
      isBeef ? row('Tongue', fmt(d.organs.tongue)) : '',
      isBeef ? row('Oxtail', fmt(d.organs.oxtail)) : '',
    ].join(''))
  }

  if (isBeef) {
    cutSections += sec('Chuck', [
      row('Brisket', d.brisket?.cut2 ? `1: ${fmt(d.brisket.cut)} / 2: ${fmt(d.brisket.cut2)}` : fmt(d.brisket?.cut)),
      d.brisket?.fat ? row('  Brisket Fat', fmt(d.brisket.fat)) : '',
      row('Shank', fmt(d.shank?.cut)),
      d.shank?.addons?.length ? row('  Add-ons', adds(d.shank.addons), true) : '',
      row('Arm Roast', fmt(d.armRoast?.cut)),
      d.armRoast?.addons?.length ? row('  Add-ons', adds(d.armRoast.addons), true) : '',
      row('Flat Iron', fmt(d.flatIron?.cut)),
      row('Chuck Roll', fmt(d.chuckRoll?.cut)),
      d.chuckRoll?.addons?.length ? row('  Add-ons', adds(d.chuckRoll.addons), true) : '',
    ].join(''))
    cutSections += sec('Plate & Short Ribs', [
      row('Short Ribs', fmt(d.shortRibs?.cut)),
      d.shortRibs?.addons?.length ? row('  Add-ons', adds(d.shortRibs.addons), true) : '',
      row('Plate', fmt(d.plate?.cut)),
    ].join(''))
    cutSections += sec('Ribeye', [
      row('Style', fmt(d.ribeye?.style)),
      row('Cut', withT(d.ribeye?.cut ?? '', d.ribeye?.thickness ?? '')),
      d.ribeye?.addons?.length ? row('  Add-ons', adds(d.ribeye.addons), true) : '',
    ].join(''))
    const sl = d.shortLoin ?? {}
    cutSections += sec('Short Loin', sl.path === 'bone-in' ? [
      row('T-Bone / Porterhouse', thick(sl.tBoneThickness)),
    ].join('') : sl.path === 'boneless' ? [
      row('Tenderloin', sl.tenderloin?.cut === 'filet' ? 'Filet Mignon — 2"' : fmt(sl.tenderloin?.cut ?? '')),
      row('Strip Loin', withT(sl.stripLoin?.cut ?? '', sl.stripLoin?.thickness ?? '')),
    ].join('') : '')
    cutSections += sec('Sirloin', [
      row('Top Sirloin', withT(d.topSirloin?.cut ?? '', d.topSirloin?.thickness ?? '')),
      row('Tri Tip', fmt(d.triTip?.cut)),
    ].join(''))
    cutSections += sec('Flank', [
      row('Skirt', fmt(d.skirt?.cut)),
      row('Flank Steak', fmt(d.flank?.cut)),
    ].join(''))
    cutSections += sec('Round', [
      row('Sirloin Tip', withT(d.sirloinTip?.cut ?? '', d.sirloinTip?.thickness ?? '')),
      row('Bottom Round', withT(d.bottomRound?.cut ?? '', d.bottomRound?.thickness ?? '')),
      d.bottomRound?.addons?.length ? row('  Add-ons', adds(d.bottomRound.addons), true) : '',
      d.eyeOfRound?.cut ? row('Eye of Round', withT(d.eyeOfRound.cut, d.eyeOfRound.thickness ?? '')) : '',
      d.rumpRoast?.cut  ? row('Rump Roast',   withT(d.rumpRoast.cut,  d.rumpRoast.thickness  ?? '')) : '',
      row('Top Round', withT(d.topRound?.cut ?? '', d.topRound?.thickness ?? '')),
      d.topRound?.addons?.length ? row('  Add-ons', adds(d.topRound.addons), true) : '',
      row('Round Shank / Marrow', fmt(d.roundShank?.marrow)),
    ].join(''))
  }

  if (isPork) {
    const loin = d.loin ?? {}
    cutSections += sec('Shoulder', [
      row('Cut', fmt(d.shoulder?.cut)),
      d.shoulder?.cut === 'roast'  && d.shoulder?.roastSize    ? row('Roast Size', `${d.shoulder.roastSize} lb`) : '',
      d.shoulder?.cut === 'steaks' && d.shoulder?.steakThickness ? row('Thickness', thick(d.shoulder.steakThickness)) : '',
      d.shoulder?.addons?.length ? row('  Add-ons', adds(d.shoulder.addons), true) : '',
    ].join(''))
    cutSections += sec('Loin', [
      row('Cut', fmt(loin.cut)),
      (loin.cut === 'bone-in-chops' || loin.cut === 'boneless-chops') ? row('Chop Thickness', thick(loin.chopThickness ?? '')) : '',
      (loin.cut === 'bone-in-chops' || loin.cut === 'boneless-chops') ? row('Per Pack', loin.chopPack) : '',
      loin.cut === 'boneless-chops' ? row('Baby Back Ribs', fmt(loin.babyBack ?? '')) : '',
      loin.cut === 'loin-roast' ? row('Roast Size', fmt(loin.roastSize ?? '')) : '',
      row('Tenderloin', fmt(loin.tenderloin)),
      loin.addons?.length ? row('  Add-ons', adds(loin.addons), true) : '',
    ].join(''))
    cutSections += sec('Belly', [row('Cut', fmt(d.belly?.cut))].join(''))
    cutSections += sec('Ham', [
      row('Style', fmt(d.ham?.style)),
      d.ham?.style !== 'grind' ? row('Cut', fmt(d.ham?.cut ?? '')) : '',
    ].join(''))
    cutSections += sec('Hocks & Spare Ribs', [
      row('Hocks', fmt(d.hocks?.cut)),
      row('Spare Ribs', fmt(d.spareRibs?.cut)),
    ].join(''))
  }

  if (isLG) {
    cutSections += sec('Primals', [
      row('Rack',     fmt(d.rack?.cut)),
      row('Loin',     fmt(d.loin?.cut)),
      row('Leg',      fmt(d.leg?.cut)),
      row('Shoulder', fmt(d.shoulder?.cut)),
      row('Shank',    fmt(d.shank?.cut)),
    ].join(''))
  }

  if (d.specialty?.interest) {
    cutSections += sec('Specialty Items', [
      row('Interested', d.specialty.interest === 'yes' ? 'Yes — crew will call' : 'No thanks'),
      d.specialty.notes ? row('Notes', d.specialty.notes) : '',
    ].join(''))
  }
  if (d.notes) cutSections += sec('Special Notes', row('Notes', d.notes))

  // ── Page 2: Packaging Sheet ───────────────────────────────────────────────
  type PR = { sectionTitle?: string; cut?: string; spec?: string; isGrind?: boolean; isAddon?: boolean }
  const prs: PR[] = []
  const grindFrom: string[] = []

  const ps  = (title: string)                          => prs.push({ sectionTitle: title })
  const pc  = (cut: string, spec: string, isAddon = false) => prs.push({ cut, spec, isAddon })
  const pg  = (src: string)                            => grindFrom.push(src)

  // organs
  if (d.organs) {
    const orgPacks: string[] = []
    if (d.organs.heart && d.organs.heart !== 'no') orgPacks.push(`Heart · ${fmt(d.organs.heart)}`)
    if (d.organs.liver && d.organs.liver !== 'no') orgPacks.push(`Liver · ${fmt(d.organs.liver)}`)
    if (isBeef && d.organs.tongue && d.organs.tongue !== 'no') orgPacks.push(`Tongue · ${fmt(d.organs.tongue)}`)
    if (isBeef && d.organs.oxtail && d.organs.oxtail !== 'no') orgPacks.push(`Oxtail · ${fmt(d.organs.oxtail)}`)
    if (orgPacks.length) { ps('Organs'); orgPacks.forEach(o => pc(o, '')) }
  }

  if (isBeef) {
    ps('Chuck')
    if (d.brisket?.cut) {
      if (d.brisket.cut === 'grind') { pg('Brisket') }
      else {
        const bSpec = (d.brisket.cut2 ? `1: ${fmt(d.brisket.cut)} / 2: ${fmt(d.brisket.cut2)}` : fmt(d.brisket.cut))
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
    if (d.armRoast?.cut) {
      if (d.armRoast.cut === 'grind') pg('Arm Roast')
      else { pc('Arm Roast', fmt(d.armRoast.cut)); if (d.armRoast.addons?.length) pc('  Add-on', adds(d.armRoast.addons), true) }
    }
    if (d.flatIron?.cut) { d.flatIron.cut === 'grind' ? pg('Flat Iron') : pc('Flat Iron', fmt(d.flatIron.cut)) }
    if (d.chuckRoll?.cut) {
      if (d.chuckRoll.cut === 'grind') pg('Chuck Roll')
      else { pc('Chuck Roll', fmt(d.chuckRoll.cut)); if (d.chuckRoll.addons?.length) pc('  Add-on', adds(d.chuckRoll.addons), true) }
    }
    ps('Plate & Short Ribs')
    if (d.shortRibs?.cut) {
      if (d.shortRibs.cut === 'grind') pg('Short Ribs')
      else { pc('Short Ribs', fmt(d.shortRibs.cut)); if (d.shortRibs.addons?.length) pc('  Add-on', adds(d.shortRibs.addons), true) }
    }
    if (d.plate?.cut) { d.plate.cut === 'grind' ? pg('Plate') : pc('Plate / Beef Bacon', fmt(d.plate.cut)) }
    ps('Ribeye')
    if (d.ribeye?.cut) {
      if (d.ribeye.cut === 'grind') pg('Ribeye')
      else {
        pc('Ribeye', [fmt(d.ribeye.style), withT(d.ribeye.cut, d.ribeye.thickness ?? '')].filter(Boolean).join(' · '))
        if (d.ribeye.addons?.length) pc('  Add-on', adds(d.ribeye.addons), true)
      }
    }
    ps('Short Loin')
    const sl = d.shortLoin ?? {}
    if (sl.path === 'bone-in' && sl.tBoneThickness) pc('T-Bone / Porterhouse', thick(sl.tBoneThickness))
    if (sl.path === 'boneless') {
      if (sl.tenderloin?.cut === 'grind') pg('Tenderloin')
      else if (sl.tenderloin?.cut) pc('Tenderloin', sl.tenderloin.cut === 'filet' ? 'Filet Mignon — 2"' : fmt(sl.tenderloin.cut))
      if (sl.stripLoin?.cut === 'grind') pg('Strip Loin')
      else if (sl.stripLoin?.cut) pc('Strip Loin (NY Strip)', withT(sl.stripLoin.cut, sl.stripLoin.thickness ?? ''))
    }
    ps('Sirloin')
    if (d.topSirloin?.cut) { d.topSirloin.cut === 'grind' ? pg('Top Sirloin') : pc('Top Sirloin', withT(d.topSirloin.cut, d.topSirloin.thickness ?? '')) }
    if (d.triTip?.cut)     { d.triTip.cut    === 'grind' ? pg('Tri Tip')     : pc('Tri Tip',     fmt(d.triTip.cut)) }
    ps('Flank')
    if (d.skirt?.cut)  { d.skirt.cut  === 'grind' ? pg('Skirt')       : pc('Skirt Steak',  fmt(d.skirt.cut)) }
    if (d.flank?.cut)  { d.flank.cut  === 'grind' ? pg('Flank Steak') : pc('Flank Steak',  fmt(d.flank.cut)) }
    ps('Round')
    if (d.sirloinTip?.cut)  { d.sirloinTip.cut  === 'grind' ? pg('Sirloin Tip')  : pc('Sirloin Tip',  withT(d.sirloinTip.cut,  d.sirloinTip.thickness  ?? '')) }
    if (d.bottomRound?.cut) {
      if (d.bottomRound.cut === 'grind') pg('Bottom Round')
      else { pc('Bottom Round', withT(d.bottomRound.cut, d.bottomRound.thickness ?? '')); if (d.bottomRound.addons?.length) pc('  Add-on', adds(d.bottomRound.addons), true) }
    }
    if (d.eyeOfRound?.cut)  { d.eyeOfRound.cut  === 'grind' ? pg('Eye of Round')  : pc('Eye of Round',  withT(d.eyeOfRound.cut,  d.eyeOfRound.thickness  ?? '')) }
    if (d.rumpRoast?.cut)   { d.rumpRoast.cut   === 'grind' ? pg('Rump Roast')    : pc('Rump Roast',    withT(d.rumpRoast.cut,   d.rumpRoast.thickness   ?? '')) }
    if (d.topRound?.cut) {
      if (d.topRound.cut === 'grind') pg('Top Round')
      else { pc('Top Round', withT(d.topRound.cut, d.topRound.thickness ?? '')); if (d.topRound.addons?.length) pc('  Add-on', adds(d.topRound.addons), true) }
    }
    if (d.roundShank?.marrow) pc('Round Shank / Marrow', fmt(d.roundShank.marrow))
  }

  if (isPork) {
    const loin = d.loin ?? {}
    ps('Shoulder')
    if (d.shoulder?.cut) {
      if (d.shoulder.cut === 'grind') pg('Shoulder')
      else {
        const sSpec = [
          fmt(d.shoulder.cut),
          d.shoulder.cut === 'roast'  && d.shoulder.roastSize    ? `${d.shoulder.roastSize} lb`    : '',
          d.shoulder.cut === 'steaks' && d.shoulder.steakThickness ? thick(d.shoulder.steakThickness) : '',
        ].filter(Boolean).join(' · ')
        pc('Shoulder', sSpec)
        if (d.shoulder.addons?.length) pc('  Add-on', adds(d.shoulder.addons), true)
      }
    }
    ps('Loin')
    if (loin.cut === 'grind') { pg('Loin') }
    else if (loin.cut) {
      if (loin.cut === 'bone-in-chops' || loin.cut === 'boneless-chops') {
        pc('Chops', [fmt(loin.cut), thick(loin.chopThickness ?? ''), loin.chopPack ? `${loin.chopPack}/pkg` : ''].filter(Boolean).join(' · '))
        if (loin.cut === 'boneless-chops' && loin.babyBack) pc('Baby Back Ribs', fmt(loin.babyBack))
      } else if (loin.cut === 'loin-roast') {
        pc('Loin Roast', fmt(loin.roastSize ?? ''))
      }
      if (loin.tenderloin === 'grind') pg('Tenderloin')
      else if (loin.tenderloin) pc('Tenderloin', fmt(loin.tenderloin))
      if (loin.addons?.length) pc('  Add-on', adds(loin.addons), true)
    }
    ps('Belly')
    if (d.belly?.cut) { d.belly.cut === 'grind' ? pg('Belly') : pc('Belly / Bacon', fmt(d.belly.cut)) }
    ps('Ham')
    if (d.ham?.style) {
      if (d.ham.style === 'grind') pg('Ham')
      else pc('Ham', [fmt(d.ham.style), d.ham.cut ? fmt(d.ham.cut) : ''].filter(Boolean).join(' · '))
    }
    ps('Hocks & Spare Ribs')
    if (d.hocks?.cut)    pc('Hocks',      fmt(d.hocks.cut))
    if (d.spareRibs?.cut) pc('Spare Ribs', fmt(d.spareRibs.cut))
  }

  if (isLG) {
    ps('Primals')
    if (d.rack?.cut)     { d.rack.cut     === 'grind' ? pg('Rack')     : pc('Rack',     fmt(d.rack.cut)) }
    if (d.loin?.cut)     { d.loin.cut     === 'grind' ? pg('Loin')     : pc('Loin',     fmt(d.loin.cut)) }
    if (d.leg?.cut)      { d.leg.cut      === 'grind' ? pg('Leg')      : pc('Leg',      fmt(d.leg.cut)) }
    if (d.shoulder?.cut) { d.shoulder.cut === 'grind' ? pg('Shoulder') : pc('Shoulder', fmt(d.shoulder.cut)) }
    if (d.shank?.cut)    { d.shank.cut    === 'grind' ? pg('Shank')    : pc('Shank',    fmt(d.shank.cut)) }
  }

  // Strip section headers that have no cut rows under them
  const activeSectionIdxs = new Set<number>()
  prs.forEach((pr, i) => {
    if (!pr.sectionTitle) {
      for (let j = i - 1; j >= 0; j--) { if (prs[j].sectionTitle) { activeSectionIdxs.add(j); break } }
    }
  })
  const filteredPrs = prs.filter((pr, i) => !pr.sectionTitle || activeSectionIdxs.has(i))

  if (grindFrom.length) filteredPrs.push({ cut: `Ground ${species}`, spec: `From: ${grindFrom.join(', ')}`, isGrind: true })

  // ── Split packaging rows into two balanced columns ────────────────────────
  const nonSectionCount = filteredPrs.filter(pr => !pr.sectionTitle).length
  const halfTarget = Math.ceil(nonSectionCount / 2)
  let seenRows = 0
  let splitIdx = filteredPrs.length
  for (let i = 0; i < filteredPrs.length; i++) {
    if (!filteredPrs[i].sectionTitle) seenRows++
    // Split at the next section boundary after hitting the halfway mark
    if (seenRows >= halfTarget && i + 1 < filteredPrs.length && filteredPrs[i + 1].sectionTitle) {
      splitIdx = i + 1
      break
    }
  }
  const leftPrs  = filteredPrs.slice(0, splitIdx)
  const rightPrs = filteredPrs.slice(splitIdx)

  // Renders an array of PR rows into a complete packaging table (thead + tbody)
  const buildPackTable = (prs: typeof filteredPrs) => {
    let tbody = ''
    let rowCount = 0
    for (const pr of prs) {
      if (pr.sectionTitle) {
        rowCount = 0
        tbody += `<tr><td colspan="5" style="background:#351E0E;color:#F2E8D9;padding:4px 8px;font-size:9px;letter-spacing:0.12em;text-transform:uppercase;font-weight:bold">${pr.sectionTitle}</td></tr>`
        continue
      }
      const bg  = pr.isGrind ? '#fff8e6' : pr.isAddon ? '#fffbe8' : rowCount % 2 === 0 ? '#fff' : '#faf6f1'
      if (!pr.isAddon) rowCount++
      const fw  = pr.isAddon || pr.isGrind ? 'normal' : '700'
      const fi  = pr.isAddon ? 'italic' : 'normal'
      const pl  = pr.isAddon ? '18px' : '8px'
      const clr = pr.isAddon ? '#8a6200' : '#1A0A04'
      tbody += `<tr style="background:${bg}">
        <td style="padding:5px ${pl} 5px 8px;font-size:12px;font-weight:${fw};font-style:${fi};color:${clr};vertical-align:top">${pr.cut ?? ''}</td>
        <td style="padding:5px 8px;font-size:11px;color:#555;vertical-align:top">${pr.spec ?? ''}</td>
        <td style="padding:5px 4px;width:48px;border-left:1px solid #ddd;text-align:center"> </td>
        <td style="padding:5px 4px;width:56px;border-left:1px solid #ddd;text-align:center"> </td>
        <td style="padding:5px 4px;width:30px;border-left:1px solid #ddd;text-align:center;font-size:14px;color:#999">☐</td>
      </tr>`
    }
    const thStyle = 'padding:6px 8px;text-align:left;color:#F2E8D9;font-size:10px;letter-spacing:0.08em;text-transform:uppercase'
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

  const hdr = (subtitle: string) =>
    `<div style="background:#1A0A04;color:#F2E8D9;padding:12px 18px;display:flex;align-items:baseline;justify-content:space-between;margin-bottom:12px">
       <div><span style="font-size:18px;font-weight:bold;letter-spacing:0.1em;text-transform:uppercase">Cowboy Meat Company</span>
            <span style="font-size:12px;color:#C9A882;margin-left:12px;letter-spacing:0.05em">— ${subtitle}</span></div>
       <div style="font-size:10px;color:#C9A882">Submitted: ${submittedDate}</div>
     </div>`

  const infoGrid =
    `<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0;border:1.5px solid #C9A882;margin-bottom:10px">
       <div style="padding:7px 12px;border-right:1px solid #C9A882">
         <div style="font-size:8px;color:#75471B;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:2px">Customer</div>
         <div style="font-size:16px;font-weight:bold">${d.customerName ?? '—'}</div>
         ${d.customerPhone ? `<div style="font-size:11px;color:#555;margin-top:1px">${d.customerPhone}</div>` : ''}
       </div>
       <div style="padding:7px 12px;border-right:1px solid #C9A882">
         <div style="font-size:8px;color:#75471B;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:2px">Animal</div>
         <div style="font-size:16px;font-weight:bold">${species}${d.portion ? ' · ' + fmt(d.portion) : ''}</div>
         <div style="font-size:11px;color:#555;margin-top:1px">Kill Date: ${d.killDate ?? '—'}</div>
       </div>
       <div style="padding:7px 12px">
         <div style="font-size:8px;color:#75471B;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:2px">Lot / Tag #</div>
         <div style="font-size:16px;font-weight:bold;border-bottom:2px solid #1A0A04;min-height:24px;padding-bottom:2px">&nbsp;</div>
       </div>
     </div>`

  const html = `<!DOCTYPE html>
<html><head>
  <meta charset="UTF-8">
  <title>Cut Card — ${name}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: Arial, sans-serif; color: #1A0A04; margin: 0; padding: 18px; }
    @page { margin: 0.4in; size: letter portrait; }
    @media print {
      body { padding: 0; }
      .pagebreak { page-break-after: always; }
      * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    }
  </style>
</head>
<body>

<!-- PAGE 1: CUT CARD — 2-column section layout -->
<div class="pagebreak">
  ${hdr('Cut Card')}
  ${infoGrid}
  <div style="column-count:2;column-gap:16px">
    ${cutSections}
  </div>
</div>

<!-- PAGE 2: PACKAGING SHEET — 2-column table layout -->
<div>
  ${hdr('Packaging Sheet')}
  <div style="font-size:11px;color:#555;margin-bottom:8px">
    <strong>${d.customerName ?? '—'}</strong>${d.portion ? ' · ' + fmt(d.portion) : ''} · Kill Date: ${d.killDate ?? '—'}
    <span style="margin-left:14px">Lot / Tag: <span style="display:inline-block;width:110px;border-bottom:1px solid #888">&nbsp;</span></span>
  </div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
    <div>${buildPackTable(leftPrs)}</div>
    <div>${buildPackTable(rightPrs)}</div>
  </div>
  ${d.notes ? `<div style="margin-top:10px;border:1px solid #C9A882;padding:8px"><div style="font-size:8px;color:#75471B;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:4px">Special Notes</div><div style="font-size:12px">${d.notes}</div></div>` : ''}
  <div style="margin-top:18px;display:grid;grid-template-columns:1fr 1fr;gap:20px">
    <div style="border-top:1px solid #888;padding-top:5px;font-size:10px;color:#75471B;text-transform:uppercase;letter-spacing:0.08em">Packed by / Date</div>
    <div style="border-top:1px solid #888;padding-top:5px;font-size:10px;color:#75471B;text-transform:uppercase;letter-spacing:0.08em">Total Boxes</div>
  </div>
</div>

</body></html>`

  const blob = new Blob([html], { type: 'text/html' })
  const url  = URL.createObjectURL(blob)
  const win  = window.open(url, '_blank')
  if (win) { win.onload = () => { URL.revokeObjectURL(url) } }
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
    armRoast:  { cut: 'cut-in-thirds' },
    flatIron:  { cut: 'steaks' },
    chuckRoll: { cut: 'chuck-steaks', addons: ['philly-style'] },
    shortRibs: { cut: 'short-ribs', addons: ['flanken'] },
    plate:     { cut: 'beef-bacon' },
    ribeye:    { style: 'boneless', cut: 'steaks', thickness: '1', addons: [] },
    shortLoin: { path: 'bone-in', tBoneThickness: '1.25' },
    topSirloin:{ cut: 'steaks', thickness: '0.75' },
    triTip:    { cut: 'grind' },
    skirt:     { cut: 'cut-in-half' },
    flank:     { cut: 'keep-whole' },
    sirloinTip:  { cut: 'steaks', thickness: '1' },
    bottomRound: { cut: 'steaks', thickness: '0.75', addons: ['jerky'] },
    topRound:    { cut: 'cubed-steak' },
    roundShank:  { marrow: 'canoe' },
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
  const [showLinkPicker, setShowLinkPicker] = useState(false)
  const [linking, setLinking]           = useState(false)
  const [showCreate, setShowCreate]     = useState(false)
  const [createSpecies, setCreateSpecies] = useState('Beef')
  const [createFields, setCreateFields] = useState<Record<string, string>>({})
  const [creating, setCreating]         = useState(false)

  async function load() {
    setLoading(true)
    const [ciRes, apptRes] = await Promise.all([
      fetch('/api/cutting-instructions'),
      fetch('/api/appointments'),
    ])
    const ci   = await ciRes.json()
    const appt = await apptRes.json()
    setInstructions(Array.isArray(ci)   ? ci   : [])
    setAppointments(Array.isArray(appt) ? appt : [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const filtered = instructions.filter(i => {
    const species = i.data?.species ?? ''
    if (filterStatus  !== 'all' && i.status  !== filterStatus)  return false
    if (filterSpecies !== 'all' && species    !== filterSpecies) return false
    return true
  })

  const pendingCount = instructions.filter(i => i.status === 'pending').length
  const linkedCount  = instructions.filter(i => i.status === 'linked').length

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

  async function linkToCustomer(apptId: string, customerIdx: number) {
    if (!selected) return
    setLinking(true)
    const appt = appointments.find(a => a.id === apptId)
    if (!appt) return
    const customers = appt.customers.map((c, i) =>
      i === customerIdx ? { ...c, linked_cutting_instruction_id: selected.id } : c
    )
    await fetch('/api/appointments', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: apptId, customers }),
    })
    await markStatus([selected.id], 'linked')
    setLinking(false)
    setShowLinkPicker(false)
    load()
  }

  async function handleCreate() {
    setCreating(true)
    await fetch('/api/cutting-instructions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...createFields, species: createSpecies }),
    })
    setCreating(false)
    setShowCreate(false)
    setCreateFields({})
    load()
  }

  // Upcoming appointments that have at least one customer without a linked instruction
  const linkableAppts = appointments.filter(a =>
    a.status !== 'Complete' &&
    a.customers?.some(c => !c.linked_cutting_instruction_id)
  ).sort((a, b) => a.harvest_date.localeCompare(b.harvest_date))

  const selectedSpecies = selected?.data?.species ?? 'Beef'
  const sections = sectionsFor(selectedSpecies)
  const isV2 = selected?.data?.formVersion === 'v2'

  return (
    <div style={{ minHeight: '100vh', background: 'var(--dark-brown)', display: 'flex', flexDirection: 'column' }}>

      {/* Header */}
      <header style={{ background: 'var(--dark)', borderBottom: '1px solid rgba(166,120,90,0.3)', padding: '0 1.5rem', height: '64px', display: 'flex', alignItems: 'center', gap: '1rem', flexShrink: 0 }}>
        <Link href="/" style={{ color: 'var(--tan)', textDecoration: 'none', fontSize: '0.85rem' }}>← Dashboard</Link>
        <span style={{ color: 'rgba(166,120,90,0.4)' }}>|</span>
        <h1 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, color: 'var(--cream)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>📋 Cutting Instructions</h1>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '1.5rem', fontSize: '0.8rem' }}>
          {pendingCount > 0 && <span style={{ color: '#f0c040' }}>⚠ {pendingCount} pending review</span>}
          {linkedCount  > 0 && <span style={{ color: '#6dbf6d' }}>✅ {linkedCount} linked</span>}
          <span style={{ color: 'var(--tan)' }}>{instructions.length} total</span>
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
            onClick={() => printV2CutCard(FAKE_CI)}
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
              {['all','pending','linked','imported'].map(s => (
                <button key={s} onClick={() => setFilterStatus(s)} style={{ ...tabBtn(filterStatus === s), textTransform: 'capitalize' }}>{s}</button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: '0', border: '1px solid rgba(166,120,90,0.3)', borderRadius: '3px', overflow: 'hidden' }}>
              {['all','Beef','Hog','Lamb','Goat'].map(s => (
                <button key={s} onClick={() => setFilterSpecies(s)} style={tabBtn(filterSpecies === s)}>{s}</button>
              ))}
            </div>
            <button onClick={load} style={{ ...btnStyle('transparent', 'var(--tan)'), border: '1px solid rgba(166,120,90,0.3)', marginLeft: 'auto' }}>↺</button>
            <button onClick={() => { setCreateFields({}); setCreateSpecies('Beef'); setShowCreate(true) }} style={{ ...btnStyle('var(--med-brown)', 'var(--cream)'), border: 'none', fontWeight: 700, letterSpacing: '0.04em' }}>+ New</button>
          </div>

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
              filtered.map(ci => {
                const d       = ci.data ?? {}
                const name    = d.customerName ?? '—'
                const species = d.species ?? '—'
                const isSel   = selected?.id === ci.id
                return (
                  <div key={ci.id} onClick={() => setSelected(isSel ? null : ci)}
                    style={{ padding: '0.9rem 1.1rem', borderBottom: '1px solid rgba(166,120,90,0.1)', cursor: 'pointer', background: isSel ? 'rgba(117,71,27,0.3)' : 'transparent', transition: 'background 0.15s', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, color: 'var(--cream)', fontSize: '0.9rem', marginBottom: '0.2rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--tan)' }}>
                        {species} · {new Date(ci.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        {d.deliveryDate && d.deliveryDate !== 'Unknown' && ` · Delivery ${d.deliveryDate}`}
                      </div>
                    </div>
                    <StatusBadge status={ci.status} />
                  </div>
                )
              })
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
                {selected.status !== 'linked' && (
                  <button onClick={() => setShowLinkPicker(true)} style={btnStyle('var(--med-brown)')}>🔗 Link to Appointment</button>
                )}
                {selected.status === 'pending' && (
                  <button onClick={() => markStatus([selected.id], 'imported')} style={btnStyle('rgba(166,120,90,0.2)', 'var(--tan)')}>✓ Mark Imported</button>
                )}
                <button onClick={() => isV2 ? printV2CutCard(selected) : printCutCard(selected)} style={btnStyle('rgba(166,120,90,0.2)', 'var(--tan)')}>🖨 Print Cut Card</button>
                <button onClick={() => setSelected(null)} style={btnStyle('transparent', 'var(--tan)')}>✕</button>
              </div>
            </div>

            {/* Linked badge */}
            {selected.status === 'linked' && (() => {
              const linkedAppt = appointments.find(a => a.customers?.some(c => c.linked_cutting_instruction_id === selected.id))
              const linkedCust = linkedAppt?.customers?.find(c => c.linked_cutting_instruction_id === selected.id)
              return linkedAppt ? (
                <div style={{ padding: '0.6rem 1.25rem', background: 'rgba(100,180,100,0.1)', borderBottom: '1px solid rgba(100,180,100,0.2)', fontSize: '0.82rem', color: '#6dbf6d' }}>
                  ✅ Linked to: <strong>{linkedAppt.species}</strong> harvest on <strong>{new Date(linkedAppt.harvest_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</strong>{linkedCust ? ` — ${linkedCust.customer_name} (${linkedCust.portion})` : ''}
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
              <p style={{ color: 'var(--tan)', textAlign: 'center', padding: '2rem' }}>No upcoming appointments need instructions yet.</p>
            ) : (
              linkableAppts.map(a => (
                <div key={a.id} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(166,120,90,0.15)', borderRadius: '4px', padding: '0.85rem 1rem', marginBottom: '0.75rem' }}>
                  <div style={{ fontWeight: 700, color: 'var(--cream)', marginBottom: '0.5rem', fontSize: '0.9rem' }}>
                    🐄 {a.species} · {new Date(a.harvest_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
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

      {/* ── Create New Instruction Modal ──────────────────────────────────── */}
      {showCreate && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 200, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '2rem 1rem', overflowY: 'auto' }}>
          <div style={{ background: 'var(--dark)', border: '1px solid rgba(166,120,90,0.3)', borderRadius: 5, padding: '1.75rem 2rem', width: '100%', maxWidth: '680px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <h2 style={{ margin: 0, color: 'var(--cream)', fontSize: '1rem', textTransform: 'uppercase', letterSpacing: '0.1em' }}>New Cutting Instruction</h2>
              <button onClick={() => setShowCreate(false)} style={{ background: 'transparent', border: 'none', color: 'var(--tan)', fontSize: '1.2rem', cursor: 'pointer', lineHeight: 1 }}>✕</button>
            </div>

            {/* Species picker */}
            <div style={{ marginBottom: '1.25rem' }}>
              <div style={{ fontSize: '0.7rem', color: 'var(--light-brown)', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '0.4rem' }}>Species</div>
              <div style={{ display: 'flex', gap: 0, border: '1px solid rgba(166,120,90,0.3)', borderRadius: 3, overflow: 'hidden', width: 'fit-content' }}>
                {['Beef','Hog','Lamb','Goat'].map(s => (
                  <button key={s} onClick={() => { setCreateSpecies(s); setCreateFields({}) }}
                    style={{ ...tabBtn(createSpecies === s), padding: '0.45rem 1rem' }}>{s}</button>
                ))}
              </div>
            </div>

            {/* Fields by section */}
            {sectionsFor(createSpecies).map(sec => (
              <div key={sec.label} style={{ marginBottom: '1.25rem' }}>
                <div style={{ fontSize: '0.68rem', color: 'var(--light-brown)', textTransform: 'uppercase', letterSpacing: '0.14em', marginBottom: '0.6rem', paddingBottom: '0.3rem', borderBottom: '1px solid rgba(166,120,90,0.15)' }}>
                  {sec.label}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem 1rem' }}>
                  {sec.fields.map(([key, label]) => (
                    <div key={key}>
                      <label style={{ display: 'block', fontSize: '0.7rem', color: 'var(--tan)', marginBottom: '0.2rem' }}>{label}</label>
                      <input
                        style={{ width: '100%', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(166,120,90,0.3)', borderRadius: 3, padding: '0.4rem 0.65rem', color: 'var(--cream)', fontSize: '0.85rem', boxSizing: 'border-box' as const, outline: 'none' }}
                        value={createFields[key] ?? ''}
                        onChange={e => setCreateFields(p => ({ ...p, [key]: e.target.value }))}
                        placeholder=""
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}

            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '1rem', borderTop: '1px solid rgba(166,120,90,0.2)', paddingTop: '1rem' }}>
              <button onClick={() => setShowCreate(false)} style={{ ...btnStyle('transparent', 'var(--tan)'), border: '1px solid rgba(166,120,90,0.3)' }}>Cancel</button>
              <button onClick={handleCreate} disabled={creating || !createFields.customerName}
                style={{ ...btnStyle(creating || !createFields.customerName ? 'rgba(166,120,90,0.2)' : 'var(--med-brown)'), opacity: creating ? 0.7 : 1 }}>
                {creating ? 'Saving…' : '✓ Create Instruction'}
              </button>
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
    return `<tr><td style="padding:4px 8px;color:#75471B;font-size:11px;width:160px;vertical-align:top">${label}</td><td style="padding:4px 8px;font-size:12px;vertical-align:top">${v}</td></tr>`
  }

  const section = (title: string, rows: string) =>
    rows.trim() ? `<h3 style="background:#351E0E;color:#F2E8D9;padding:6px 10px;margin:12px 0 4px;font-size:11px;letter-spacing:0.12em;text-transform:uppercase">${title}</h3><table style="width:100%;border-collapse:collapse">${rows}</table>` : ''

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
      row('Chops', d.hogChops), row('Spare Ribs', d.hogSpareRibs), row('Ham', d.hogHam),
      row('Ham Cut', d.hogHamCut), row('Belly', d.hogBelly), row('Boston Butt', d.hogBostonButt),
      row('Shoulder Bacon', d.hogShoulderBacon), row('Hocks', d.hogHocks),
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

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, [string, string]> = {
    pending:  ['rgba(240,192,64,0.2)',  '#f0c040'],
    linked:   ['rgba(109,191,109,0.2)', '#6dbf6d'],
    imported: ['rgba(100,100,100,0.2)', '#aaa'],
  }
  const [bg, fg] = colors[status] ?? ['rgba(166,120,90,0.2)', 'var(--tan)']
  return (
    <span style={{ background: bg, color: fg, borderRadius: '3px', padding: '0.2rem 0.55rem', fontSize: '0.72rem', fontWeight: 600, textTransform: 'capitalize', whiteSpace: 'nowrap' }}>
      {status}
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
