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

interface ModuleDef {
  href:  string
  icon:  string
  title: string
  desc:  string
  when:  string
  color: string
  count: number | null
}

export default function Dashboard() {
  const today    = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
  const todayISO = new Date().toISOString().slice(0, 10)

  const [schedule,   setSchedule]   = useState<number | null>(null)
  const [receiving,  setReceiving]  = useState<number | null>(null)
  const [harvest,    setHarvest]    = useState<number | null>(null)
  const [processing, setProcessing] = useState<number | null>(null)
  const [delivery,   setDelivery]   = useState<number | null>(null)
  const [cutInstr,   setCutInstr]   = useState<number | null>(null)
  const [orders,     setOrders]     = useState<number | null>(null)
  const [valueAdd,   setValueAdd]   = useState<number | null>(null)

  useEffect(() => {
    Promise.allSettled([
      fetch('/api/appointments').then(r => r.json()),
      fetch(`/api/processing/records?date=${todayISO}`).then(r => r.json()),
      fetch(`/api/delivery?date=${todayISO}`).then(r => r.json()),
      fetch('/api/orders').then(r => r.json()),
      fetch('/api/value-add').then(r => r.json()),
    ]).then(([apptRes, procRes, delivRes, ordersRes, vaRes]) => {
      const appts  = apptRes.status    === 'fulfilled' && Array.isArray(apptRes.value)    ? apptRes.value    : []
      const procs  = procRes.status    === 'fulfilled' && Array.isArray(procRes.value)    ? procRes.value    : []
      const deliv  = delivRes.status   === 'fulfilled' && Array.isArray(delivRes.value)   ? delivRes.value   : []
      const ords   = ordersRes.status  === 'fulfilled' && Array.isArray(ordersRes.value)  ? ordersRes.value  : []
      const vaJobs = vaRes.status      === 'fulfilled' && Array.isArray(vaRes.value)      ? vaRes.value      : []

      type Appt  = { status: string; harvest_date: string; customers?: { linked_cutting_instruction_id: string }[] }
      type Order = { status: string }
      type VAJob = { status: string }

      const upcoming      = appts.filter((a: Appt) => a.status !== 'Complete').length
      const todayHarvest  = appts.filter((a: Appt) => a.harvest_date === todayISO && a.status !== 'Complete').length
      const missingCut    = appts.filter((a: Appt) =>
        a.status !== 'Complete' && a.customers?.some(c => !c.linked_cutting_instruction_id)
      ).length

      setSchedule(upcoming)
      setReceiving(todayHarvest)
      setHarvest(todayHarvest)
      setProcessing(procs.length)
      setDelivery(deliv.length)
      setCutInstr(missingCut)
      setOrders(ords.filter((o: Order) => o.status !== 'fulfilled').length)
      setValueAdd(vaJobs.filter((j: VAJob) => j.status !== 'complete').length)
    })
  }, [todayISO])

  const modules: ModuleDef[] = [
    // Row 1 — Booking & Kill day
    {
      href: '/schedule',  icon: '📅', color: '#E8883A',
      title: 'Schedule',
      desc:  'Harvest appointments',
      when:  'When a customer calls to book',
      count: schedule,
    },
    {
      href: '/cutting-instructions', icon: '📋', color: '#F59E0B',
      title: 'Cutting Instructions',
      desc:  'Customer cut specs',
      when:  'Collect after booking — before harvest',
      count: cutInstr,
    },
    {
      href: '/receiving', icon: '📦', color: '#60A5FA',
      title: 'Receiving',
      desc:  'Live animals & box product',
      when:  'When animals or product arrive',
      count: receiving,
    },
    {
      href: '/harvest',   icon: '🐄', color: '#A78BFA',
      title: 'Harvest',
      desc:  'Kill floor · CCP · Chill log',
      when:  'Kill day — weights & temps',
      count: harvest,
    },
    // Row 2 — Processing & Fulfillment
    {
      href: '/orders',    icon: '🛒', color: '#06B6D4',
      title: 'Retail Orders',
      desc:  'Customer call-in & walk-in orders',
      when:  'When a customer orders meat to fill',
      count: orders,
    },
    {
      href: '/processing', icon: '🔪', color: '#4CAF50',
      title: 'Processing',
      desc:  'Cut · Weigh · Label · Box',
      when:  'After chill clearance',
      count: processing,
    },
    {
      href: '/value-add', icon: '🔥', color: '#F97316',
      title: 'Value Add',
      desc:  'Smokehouse · Patties · Sausage',
      when:  'Custom processing or shelf stock jobs',
      count: valueAdd,
    },
    {
      href: '/delivery',  icon: '🚚', color: '#E879A0',
      title: 'Delivery',
      desc:  'Route & deliver',
      when:  'Pickup or delivery day',
      count: delivery,
    },
  ]

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

      <main style={{ flex: 1, padding: '2rem 2rem 5rem', maxWidth: '1400px', width: '100%', margin: '0 auto', boxSizing: 'border-box' }}>

        {/* Module grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem' }}>
          {modules.map(mod => (
            <Link key={mod.href} href={mod.href} style={{ textDecoration: 'none' }}>
              <ModuleCard mod={mod} />
            </Link>
          ))}
        </div>

        {/* Secondary links */}
        <div style={{ marginTop: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <Link href="/scanner" style={{ textDecoration: 'none' }}>
            <div style={{
              background: 'var(--dark)', border: '1px solid rgba(166,120,90,0.18)',
              borderLeft: '3px solid #4CAF50',
              borderRadius: 4, padding: '0.75rem 1.25rem',
              display: 'flex', alignItems: 'center', gap: '0.75rem',
              cursor: 'pointer',
            }}>
              <span style={{ fontSize: '1.1rem' }}>🔍</span>
              <div>
                <span style={{ color: C.cream, fontWeight: 600, fontSize: '0.88rem' }}>Processing Scanner</span>
                <span style={{ color: C.lightBrown, fontSize: '0.78rem', marginLeft: '0.75rem' }}>Full-screen barcode scanning for the cutting floor</span>
              </div>
              <span style={{ marginLeft: 'auto', color: C.lightBrown, fontSize: '0.8rem' }}>Open ›</span>
            </div>
          </Link>

          <Link href="/haccp" style={{ textDecoration: 'none' }}>
            <div style={{
              background: 'var(--dark)', border: '1px solid rgba(166,120,90,0.18)',
              borderLeft: '3px solid #F59E0B',
              borderRadius: 4, padding: '0.75rem 1.25rem',
              display: 'flex', alignItems: 'center', gap: '0.75rem',
              cursor: 'pointer',
            }}>
              <span style={{ fontSize: '1.1rem' }}>📋</span>
              <div>
                <span style={{ color: C.cream, fontWeight: 600, fontSize: '0.88rem' }}>HACCP Compliance</span>
                <span style={{ color: C.lightBrown, fontSize: '0.78rem', marginLeft: '0.75rem' }}>Forms 2, 5, 6b · Kill day reports for your inspector packet</span>
              </div>
              <span style={{ marginLeft: 'auto', color: C.lightBrown, fontSize: '0.8rem' }}>Open ›</span>
            </div>
          </Link>
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

// ── Module card ───────────────────────────────────────────────────────────────
function ModuleCard({ mod }: { mod: ModuleDef }) {
  const hasActivity = mod.count !== null && mod.count > 0
  return (
    <div style={{
      background: 'var(--dark)',
      border: '1px solid rgba(166,120,90,0.18)',
      borderLeft: `4px solid ${mod.color}`,
      borderRadius: 4,
      padding: '1.1rem 1.25rem',
      cursor: 'pointer',
      height: '100%',
      boxSizing: 'border-box',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '0.6rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <span style={{ fontSize: '1.4rem', lineHeight: 1 }}>{mod.icon}</span>
          <span style={{
            fontFamily: 'Georgia, serif', fontSize: '1rem', fontWeight: 700,
            color: C.cream, textTransform: 'uppercase', letterSpacing: '0.05em',
          }}>
            {mod.title}
          </span>
        </div>
        {/* Count badge */}
        {mod.count !== null && (
          <div style={{
            background: hasActivity ? `${mod.color}22` : 'rgba(255,255,255,0.04)',
            border: `1px solid ${hasActivity ? mod.color + '55' : 'rgba(166,120,90,0.2)'}`,
            borderRadius: 99, padding: '2px 10px',
            fontSize: '0.72rem', fontWeight: 700,
            color: hasActivity ? mod.color : 'rgba(166,120,90,0.4)',
            flexShrink: 0, alignSelf: 'flex-start',
          }}>
            {hasActivity ? mod.count : '—'}
          </div>
        )}
      </div>

      <div style={{ fontSize: '0.78rem', color: C.tan, marginBottom: '0.35rem' }}>
        {mod.desc}
      </div>
      <div style={{ fontSize: '0.7rem', color: C.lightBrown, fontStyle: 'italic' }}>
        {mod.when}
      </div>
    </div>
  )
}
