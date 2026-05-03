'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'

const C = {
  dark:       '#1A0A04',
  darkBrown:  '#351E0E',
  medBrown:   '#75471B',
  lightBrown: '#A6785A',
  tan:        '#C9A882',
  cream:      '#F2E8D9',
}

interface StepDef {
  step:  number
  href:  string
  icon:  string
  title: string
  desc:  string
  when:  string
  color: string
}

const STEPS: StepDef[] = [
  {
    step: 1, href: '/schedule',  icon: '📅', color: '#E8883A',
    title: 'Schedule',
    desc:  'Harvest appointments',
    when:  'When a customer calls to book',
  },
  {
    step: 2, href: '/receiving', icon: '📦', color: '#60A5FA',
    title: 'Receiving',
    desc:  'Live animals & box product',
    when:  'When animals or product arrive',
  },
  {
    step: 3, href: '/harvest',   icon: '🐄', color: '#A78BFA',
    title: 'Harvest',
    desc:  'Kill floor · CCP · Chill log',
    when:  'Kill day — weights & temps',
  },
  {
    step: 4, href: '/processing', icon: '🔪', color: '#4CAF50',
    title: 'Processing',
    desc:  'Cut · Weigh · Label · Box',
    when:  'After chill clearance',
  },
  {
    step: 5, href: '/delivery',  icon: '🚚', color: '#E879A0',
    title: 'Delivery',
    desc:  'Route & deliver',
    when:  'Pickup or delivery day',
  },
]

const CUT_INSTR = {
  href: '/cutting-instructions', icon: '📋', color: '#F59E0B',
  title: 'Cutting Instructions',
  desc:  'Customer cut specs',
  when:  'Collect after booking — before harvest',
}

interface Counts {
  schedule:    number | null   // upcoming non-complete appointments
  receiving:   number | null   // today's receiving logs
  harvest:     number | null   // today's harvest records
  processing:  number | null   // today's processing records
  delivery:    number | null   // today's delivery scans
  cutInstr:    number | null   // appointments missing instructions
}

export default function Dashboard() {
  const today    = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
  const todayISO = new Date().toISOString().slice(0, 10)

  const [counts, setCounts] = useState<Counts>({
    schedule: null, receiving: null, harvest: null,
    processing: null, delivery: null, cutInstr: null,
  })

  useEffect(() => {
    // Fetch all counts in parallel, silently ignore failures
    Promise.allSettled([
      fetch('/api/appointments').then(r => r.json()),
      fetch(`/api/processing/records?date=${todayISO}`).then(r => r.json()),
      fetch(`/api/delivery?date=${todayISO}`).then(r => r.json()),
    ]).then(([apptRes, procRes, delivRes]) => {
      const appts = apptRes.status === 'fulfilled' && Array.isArray(apptRes.value) ? apptRes.value : []
      const procs = procRes.status  === 'fulfilled' && Array.isArray(procRes.value)  ? procRes.value  : []
      const deliv = delivRes.status === 'fulfilled' && Array.isArray(delivRes.value) ? delivRes.value : []

      const upcoming   = appts.filter((a: { status: string; harvest_date: string }) => a.status !== 'Complete').length
      const missingCut = appts.filter((a: { status: string; customers?: { linked_cutting_instruction_id: string }[] }) =>
        a.status !== 'Complete' && a.customers?.some((c: { linked_cutting_instruction_id: string }) => !c.linked_cutting_instruction_id)
      ).length
      const todayHarvest = appts.filter((a: { status: string; harvest_date: string }) =>
        a.harvest_date === todayISO && a.status !== 'Complete'
      ).length

      setCounts({
        schedule:   upcoming,
        receiving:  todayHarvest,
        harvest:    todayHarvest,
        processing: procs.length,
        delivery:   deliv.length,
        cutInstr:   missingCut,
      })
    })
  }, [todayISO])

  const stepCounts: Record<number, number | null> = {
    1: counts.schedule,
    2: counts.receiving,
    3: counts.harvest,
    4: counts.processing,
    5: counts.delivery,
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--dark-brown)', display: 'flex', flexDirection: 'column' }}>

      {/* Header */}
      <header style={{
        background: 'var(--dark)', borderBottom: '1px solid rgba(166,120,90,0.3)',
        padding: '0 2rem', height: '72px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexShrink: 0,
      }}>
        <div>
          <h1 style={{ fontFamily: 'Georgia, serif', fontSize: '1.25rem', fontWeight: 700, color: 'var(--cream)', letterSpacing: '0.08em', textTransform: 'uppercase', margin: 0 }}>
            Cowboy Meat Company
          </h1>
          <p style={{ fontSize: '0.68rem', color: 'var(--light-brown)', letterSpacing: '0.15em', textTransform: 'uppercase', margin: 0 }}>
            Operations Dashboard
          </p>
        </div>
        <span style={{ fontSize: '0.8rem', color: 'var(--tan)' }}>{today}</span>
      </header>

      <main style={{ flex: 1, padding: '2rem 2rem 5rem', maxWidth: '1300px', width: '100%', margin: '0 auto', boxSizing: 'border-box' }}>

        {/* Section label */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
          <span style={{ fontSize: '0.68rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.18em', fontWeight: 600 }}>
            Production Workflow
          </span>
          <div style={{ flex: 1, height: '1px', background: 'rgba(166,120,90,0.2)' }} />
          <span style={{ fontSize: '0.68rem', color: 'rgba(166,120,90,0.4)', letterSpacing: '0.1em' }}>
            Follow steps in order ›
          </span>
        </div>

        {/* Main process flow */}
        <div style={{ display: 'flex', alignItems: 'stretch', gap: 0, marginBottom: '1rem', overflowX: 'auto', paddingBottom: '0.5rem' }}>
          {STEPS.map((step, i) => (
            <div key={step.step} style={{ display: 'flex', alignItems: 'center', flex: i === STEPS.length - 1 ? '1' : undefined, minWidth: 0 }}>
              <Link href={step.href} style={{ textDecoration: 'none', flex: 1, minWidth: 145 }}>
                <StepCard step={step} count={stepCounts[step.step]} />
              </Link>
              {i < STEPS.length - 1 && (
                <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '0 0.35rem' }}>
                  <div style={{ fontSize: '1.4rem', color: 'rgba(166,120,90,0.45)', lineHeight: 1, userSelect: 'none' }}>›</div>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Cutting instructions branch — aligns under step 4 (Processing) */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 0 }}>
          {/* Spacer: 3 step cards + 3 arrows to get to step 4 position */}
          <SpacerCells count={3} />

          {/* Branch connector */}
          <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '0 0.35rem', paddingTop: 0 }}>
            <div style={{ width: 1, height: 18, background: 'rgba(245,158,11,0.4)' }} />
            <div style={{ fontSize: '0.7rem', color: 'rgba(245,158,11,0.5)', lineHeight: 1 }}>↑</div>
          </div>

          {/* Cutting instructions card */}
          <div style={{ minWidth: 145, flex: 1 }}>
            <Link href={CUT_INSTR.href} style={{ textDecoration: 'none' }}>
              <SupportCard step={CUT_INSTR} count={counts.cutInstr} />
            </Link>
          </div>

          {/* Right spacer to fill remaining space */}
          <div style={{ flex: 1, minWidth: 0 }} />
        </div>

        {/* Divider */}
        <div style={{ height: '1px', background: 'rgba(166,120,90,0.12)', margin: '2rem 0 1.5rem' }} />

        {/* Quick-access secondary bar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}>
          <span style={{ fontSize: '0.68rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.18em', fontWeight: 600 }}>
            Quick Access
          </span>
          <div style={{ flex: 1, height: '1px', background: 'rgba(166,120,90,0.2)' }} />
        </div>

        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          {[
            { href: '/schedule',            icon: '📅', label: 'Schedule'            },
            { href: '/receiving',           icon: '📦', label: 'Receiving'           },
            { href: '/harvest',             icon: '🐄', label: 'Harvest'             },
            { href: '/cutting-instructions',icon: '📋', label: 'Cutting Instructions'},
            { href: '/processing',          icon: '🔪', label: 'Processing'          },
            { href: '/scanner',             icon: '🔍', label: 'Floor Scanner'       },
            { href: '/delivery',            icon: '🚚', label: 'Delivery'            },
          ].map(q => (
            <Link key={q.href} href={q.href} style={{ textDecoration: 'none' }}>
              <div style={{
                background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(166,120,90,0.2)',
                borderRadius: 4, padding: '0.55rem 1rem', display: 'flex', alignItems: 'center',
                gap: '0.5rem', cursor: 'pointer', transition: 'background 0.15s',
              }}>
                <span style={{ fontSize: '1.05rem' }}>{q.icon}</span>
                <span style={{ fontSize: '0.82rem', color: C.tan, fontWeight: 500 }}>{q.label}</span>
              </div>
            </Link>
          ))}
        </div>

      </main>

      {/* Footer */}
      <footer style={{
        position: 'fixed', bottom: 0, left: 0, right: 0,
        background: 'var(--dark)', borderTop: '1px solid rgba(166,120,90,0.2)',
        padding: '0.5rem 2rem', textAlign: 'center',
        fontSize: '0.72rem', color: 'var(--light-brown)',
      }}>
        Cowboy Meat Company · 1109 Front St, Forsyth MT · (406) 346-7660 · info@cowboymeats.com
      </footer>
    </div>
  )
}

// ── Invisible spacer to align support nodes under specific step positions ─────
function SpacerCells({ count }: { count: number }) {
  // Each "cell" = step card (flex: 1, minWidth: 145) + arrow (shrink-0, ~40px)
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{ flex: 1, minWidth: 145 }} />
          <div style={{ flexShrink: 0, width: 30 }} />
        </div>
      ))}
    </>
  )
}

// ── Main step card ─────────────────────────────────────────────────────────────
function StepCard({ step, count }: { step: StepDef; count: number | null }) {
  const hasActivity = count !== null && count > 0
  return (
    <div style={{
      background: 'var(--dark)', border: '1px solid rgba(166,120,90,0.22)',
      borderTop: `3px solid ${step.color}`,
      borderRadius: 4, padding: '1.1rem 1rem 1rem',
      position: 'relative', height: '100%', boxSizing: 'border-box',
      transition: 'border-color 0.15s, background 0.15s',
      cursor: 'pointer',
    }}>
      {/* Step number badge */}
      <div style={{
        position: 'absolute', top: 10, right: 10,
        width: 20, height: 20, borderRadius: '50%',
        background: `${step.color}22`, border: `1px solid ${step.color}66`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '0.65rem', fontWeight: 700, color: step.color,
      }}>
        {step.step}
      </div>

      {/* Activity dot */}
      {hasActivity && (
        <div style={{
          position: 'absolute', top: 10, left: 10,
          width: 8, height: 8, borderRadius: '50%',
          background: step.color, boxShadow: `0 0 6px ${step.color}`,
        }} />
      )}

      {/* Icon */}
      <div style={{ fontSize: '1.9rem', marginBottom: '0.65rem', lineHeight: 1 }}>{step.icon}</div>

      {/* Title */}
      <div style={{
        fontFamily: 'Georgia, serif', fontSize: '0.95rem', fontWeight: 700,
        color: C.cream, textTransform: 'uppercase', letterSpacing: '0.06em',
        marginBottom: '0.3rem',
      }}>
        {step.title}
      </div>

      {/* Desc */}
      <div style={{ fontSize: '0.75rem', color: C.tan, marginBottom: '0.5rem', lineHeight: 1.3 }}>
        {step.desc}
      </div>

      {/* When */}
      <div style={{ fontSize: '0.68rem', color: C.lightBrown, lineHeight: 1.3, fontStyle: 'italic' }}>
        {step.when}
      </div>

      {/* Activity count */}
      {count !== null && (
        <div style={{ marginTop: '0.65rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: hasActivity ? step.color : 'rgba(166,120,90,0.3)', flexShrink: 0 }} />
          <span style={{ fontSize: '0.68rem', color: hasActivity ? step.color : 'rgba(166,120,90,0.4)', fontWeight: hasActivity ? 700 : 400 }}>
            {count > 0 ? `${count} active` : 'No activity today'}
          </span>
        </div>
      )}
    </div>
  )
}

// ── Support card (Cutting Instructions) ──────────────────────────────────────
function SupportCard({ step, count }: { step: typeof CUT_INSTR; count: number | null }) {
  const needsAttention = count !== null && count > 0
  return (
    <div style={{
      background: 'var(--dark)', border: `1px dashed ${needsAttention ? step.color : 'rgba(245,158,11,0.25)'}`,
      borderRadius: 4, padding: '0.85rem 1rem',
      position: 'relative', boxSizing: 'border-box',
      cursor: 'pointer',
    }}>
      {/* Feeds-into label */}
      <div style={{
        position: 'absolute', top: -10, left: '50%', transform: 'translateX(-50%)',
        background: C.darkBrown, padding: '0 6px',
        fontSize: '0.6rem', color: 'rgba(245,158,11,0.6)', letterSpacing: '0.08em', whiteSpace: 'nowrap',
      }}>
        feeds into Processing ↑
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
        <span style={{ fontSize: '1.3rem' }}>{step.icon}</span>
        <div>
          <div style={{ fontSize: '0.8rem', fontWeight: 700, color: C.cream, letterSpacing: '0.05em' }}>{step.title}</div>
          <div style={{ fontSize: '0.68rem', color: C.tan, marginTop: '0.1rem' }}>{step.when}</div>
        </div>
        {needsAttention && (
          <div style={{
            marginLeft: 'auto', background: `${step.color}22`,
            border: `1px solid ${step.color}66`, borderRadius: 99,
            padding: '2px 8px', fontSize: '0.7rem', fontWeight: 700, color: step.color,
          }}>
            {count} missing
          </div>
        )}
      </div>
    </div>
  )
}
