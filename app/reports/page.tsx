'use client'
// /reports — the in-app reports, on screen.
//
// This page used to be five CSV downloads and a Power BI Desktop walkthrough.
// Charlie (2026-09-09): "Pull the BI setup. I think we can build suitable
// enough things in the app itself." The exports and the walkthrough are gone;
// what's left is the reports people actually open, plus the pipeline view
// that replaced the first thing BI was meant to answer.

import Link from 'next/link'

const C = {
  dark: '#1A0A04', darkBrown: '#351E0E', lightBrown: '#A6785A', tan: '#C9A882', cream: '#F2E8D9',
}

const REPORTS = [
  {
    href: '/pipeline', icon: '📊', color: '#3B82F6', title: 'In the Building',
    desc: 'Every account with animals here, as a timeline — what stage each is in, how long it has been here, and which are closest to going home.',
  },
  {
    href: '/reports/producer-customer', icon: '🔗', color: '#E8883A', title: 'Producer & Customer',
    desc: 'Which animals tie back to which cut customer — the drop-off cases where a business brings the animal and an individual receives it.',
  },
  {
    href: '/reports/value-add', icon: '🌭', color: '#4CAF50', title: 'Value-Add Output',
    desc: 'Who got value-add product — shoulder bacon to brots — by processing date. Sort and filter by date and species.',
  },
]

export default function ReportsPage() {
  return (
    <div style={{ minHeight: '100vh', background: C.darkBrown }}>
      <header style={{ background: C.dark, borderBottom: '1px solid rgba(166,120,90,0.3)', padding: '0 2rem', height: 72, display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <Link href="/" style={{ color: C.lightBrown, textDecoration: 'none', fontSize: '0.82rem' }}>← Dashboard</Link>
        <span style={{ color: 'rgba(166,120,90,0.3)' }}>|</span>
        <div>
          <h1 style={{ fontFamily: 'Georgia, serif', fontSize: '1.1rem', fontWeight: 700, color: C.cream, textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0 }}>Reports</h1>
          <p style={{ fontSize: '0.68rem', color: C.lightBrown, letterSpacing: '0.15em', textTransform: 'uppercase', margin: 0 }}>On screen · filterable</p>
        </div>
      </header>

      <main style={{ padding: '2rem', maxWidth: 900, margin: '0 auto', boxSizing: 'border-box' }}>
        {REPORTS.map(r => (
          <Link key={r.href} href={r.href} style={{ textDecoration: 'none' }}>
            <div style={{ background: C.dark, border: `1px solid ${r.color}55`, borderRadius: 4, padding: '1.1rem 1.25rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '1rem', cursor: 'pointer' }}>
              <span style={{ fontSize: '1.6rem' }}>{r.icon}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: 'Georgia, serif', fontSize: '1rem', fontWeight: 700, color: C.cream, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{r.title}</div>
                <p style={{ fontSize: '0.78rem', color: C.tan, margin: '0.25rem 0 0', lineHeight: 1.5 }}>{r.desc}</p>
              </div>
              <span style={{ color: r.color, fontSize: '0.82rem', fontWeight: 700, whiteSpace: 'nowrap' }}>View →</span>
            </div>
          </Link>
        ))}
      </main>
    </div>
  )
}
