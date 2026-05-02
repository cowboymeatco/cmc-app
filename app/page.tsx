import Link from 'next/link'

const modules = [
  {
    href:    '/schedule',
    icon:    '📅',
    title:   'Schedule',
    sub:     'Harvest appointments & reminders',
    enabled: true,
  },
  {
    href:    '/receiving',
    icon:    '📦',
    title:   'Receiving',
    sub:     'Live animals & box product',
    enabled: false,
  },
  {
    href:    '/harvest',
    icon:    '🐄',
    title:   'Harvest',
    sub:     'Weights, CCP & chill log',
    enabled: false,
  },
  {
    href:    '/cutting-instructions',
    icon:    '📋',
    title:   'Cutting Instructions',
    sub:     'Manage & review cut sheets',
    enabled: true,
  },
  {
    href:    '/delivery',
    icon:    '🚚',
    title:   'Delivery',
    sub:     'Scan & review deliveries',
    enabled: false,
  },
  {
    href:    '/processing',
    icon:    '🔪',
    title:   'Processing',
    sub:     'Barcode scanner — coming soon',
    enabled: false,
  },
]

export default function Dashboard() {
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  })

  return (
    <div style={{ minHeight: '100vh', background: 'var(--dark-brown)' }}>
      {/* Header */}
      <header style={{ background: 'var(--dark)', borderBottom: '1px solid rgba(166,120,90,0.3)', padding: '0 2rem', height: '72px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontFamily: 'Georgia, serif', fontSize: '1.25rem', fontWeight: 700, color: 'var(--cream)', letterSpacing: '0.08em', textTransform: 'uppercase', margin: 0 }}>
            Cowboy Meat Company
          </h1>
          <p style={{ fontSize: '0.7rem', color: 'var(--light-brown)', letterSpacing: '0.15em', textTransform: 'uppercase', margin: 0 }}>
            Operations Dashboard
          </p>
        </div>
        <span style={{ fontSize: '0.8rem', color: 'var(--tan)' }}>{today}</span>
      </header>

      {/* Tile grid */}
      <main style={{ padding: '2.5rem 2rem', maxWidth: '1100px', margin: '0 auto' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '1.25rem' }}>
          {modules.map((m) =>
            m.enabled ? (
              <Link key={m.href} href={m.href} style={{ textDecoration: 'none' }}>
                <Tile {...m} />
              </Link>
            ) : (
              <Tile key={m.href} {...m} />
            )
          )}
        </div>
      </main>

      {/* Footer */}
      <footer style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: 'var(--dark)', borderTop: '1px solid rgba(166,120,90,0.2)', padding: '0.5rem 2rem', textAlign: 'center', fontSize: '0.72rem', color: 'var(--light-brown)' }}>
        Cowboy Meat Company · 1109 Front St, Forsyth MT · (406) 346-7660 · info@cowboymeats.com
      </footer>
    </div>
  )
}

function Tile({ icon, title, sub, enabled }: { icon: string; title: string; sub: string; enabled: boolean; href: string }) {
  return (
    <div style={{
      background:    enabled ? 'var(--dark)' : 'rgba(26,10,4,0.5)',
      border:        `1px solid ${enabled ? 'rgba(166,120,90,0.35)' : 'rgba(166,120,90,0.12)'}`,
      borderRadius:  '4px',
      padding:       '2rem 1.5rem',
      cursor:        enabled ? 'pointer' : 'default',
      opacity:       enabled ? 1 : 0.5,
      transition:    'background 0.2s, border-color 0.2s',
    }}>
      <div style={{ fontSize: '2.2rem', marginBottom: '1rem' }}>{icon}</div>
      <h2 style={{ fontFamily: 'Georgia, serif', fontSize: '1.1rem', fontWeight: 700, color: 'var(--cream)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 0.4rem' }}>
        {title}
      </h2>
      <p style={{ fontSize: '0.82rem', color: 'var(--tan)', margin: 0 }}>{sub}</p>
    </div>
  )
}
