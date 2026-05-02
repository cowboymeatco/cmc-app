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

function sectionsFor(species: string) {
  if (species === 'Hog') return HOG_SECTIONS
  if (species === 'Lamb') return LAMB_SECTIONS
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

  // Upcoming appointments that have at least one customer without a linked instruction
  const linkableAppts = appointments.filter(a =>
    a.status !== 'Complete' &&
    a.customers?.some(c => !c.linked_cutting_instruction_id)
  ).sort((a, b) => a.harvest_date.localeCompare(b.harvest_date))

  const selectedSpecies = selected?.data?.species ?? 'Beef'
  const sections = sectionsFor(selectedSpecies)

  return (
    <div style={{ minHeight: '100vh', background: 'var(--dark-brown)', display: 'flex', flexDirection: 'column' }}>

      {/* Header */}
      <header style={{ background: 'var(--dark)', borderBottom: '1px solid rgba(166,120,90,0.3)', padding: '0 1.5rem', height: '64px', display: 'flex', alignItems: 'center', gap: '1rem', flexShrink: 0 }}>
        <Link href="/" style={{ color: 'var(--tan)', textDecoration: 'none', fontSize: '0.85rem' }}>← Dashboard</Link>
        <span style={{ color: 'rgba(166,120,90,0.4)' }}>|</span>
        <h1 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, color: 'var(--cream)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>📋 Cutting Instructions</h1>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '1.5rem', fontSize: '0.8rem' }}>
          {pendingCount > 0 && <span style={{ color: '#f0c040' }}>⚠ {pendingCount} pending review</span>}
          {linkedCount  > 0 && <span style={{ color: '#6dbf6d' }}>✅ {linkedCount} linked</span>}
          <span style={{ color: 'var(--tan)' }}>{instructions.length} total</span>
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
              {['all','Beef','Hog','Lamb'].map(s => (
                <button key={s} onClick={() => setFilterSpecies(s)} style={tabBtn(filterSpecies === s)}>{s}</button>
              ))}
            </div>
            <button onClick={load} style={{ ...btnStyle('transparent', 'var(--tan)'), border: '1px solid rgba(166,120,90,0.3)', marginLeft: 'auto' }}>↺</button>
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
                <button onClick={() => printCutCard(selected)} style={btnStyle('rgba(166,120,90,0.2)', 'var(--tan)')}>🖨 Print Cut Card</button>
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

              {/* Specialty orders */}
              {['bratOrders','sticksOrders','jerkyOrders','summerOrders','salamiOrders','lambBratOrders'].map(key => {
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
