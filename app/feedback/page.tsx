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
  green:      '#4CAF50',
  red:        '#EF4444',
  amber:      '#F59E0B',
}

interface FeedbackItem {
  id:          string
  created_at:  string
  type:        'bug' | 'idea'
  description: string
  submitter:   string | null
  page_url:    string | null
  status:      'new' | 'done' | 'dismissed'
}

export default function FeedbackPage() {
  const [items, setItems]     = useState<FeedbackItem[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter]   = useState<'all' | 'new' | 'bug' | 'idea'>('new')

  useEffect(() => {
    fetch('/api/feedback')
      .then(r => r.json())
      .then(data => { setItems(Array.isArray(data) ? data : []); setLoading(false) })
  }, [])

  async function setStatus(id: string, status: FeedbackItem['status']) {
    await fetch('/api/feedback', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ id, status }),
    })
    setItems(prev => prev.map(i => i.id === id ? { ...i, status } : i))
  }

  const filtered = items.filter(i => {
    if (filter === 'new')  return i.status === 'new'
    if (filter === 'bug')  return i.type === 'bug'
    if (filter === 'idea') return i.type === 'idea'
    return true
  })

  const newCount = items.filter(i => i.status === 'new').length

  return (
    <div style={{ minHeight: '100vh', background: C.dark, padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ maxWidth: 720, margin: '0 auto' }}>

        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
          <Link href="/" style={{ color: C.tan, fontSize: 13, textDecoration: 'none' }}>← Dashboard</Link>
          <h1 style={{ color: C.cream, fontSize: 22, fontWeight: 700, margin: 0, flex: 1 }}>Crew Feedback</h1>
          <span style={{ color: C.tan, fontSize: 13 }}>
            {newCount} new · {items.length - newCount} resolved
          </span>
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
          {(['new', 'bug', 'idea', 'all'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                padding:      '5px 14px',
                borderRadius: 6,
                border:       `1px solid ${filter === f ? C.amber : C.medBrown}`,
                background:   filter === f ? C.medBrown : 'transparent',
                color:        filter === f ? C.cream : C.tan,
                cursor:       'pointer',
                fontSize:     13,
                fontWeight:   filter === f ? 700 : 400,
              } as React.CSSProperties}
            >
              {f === 'new' ? `New (${newCount})` : f === 'bug' ? '🐛 Bugs' : f === 'idea' ? '💡 Ideas' : 'All'}
            </button>
          ))}
        </div>

        {loading && <div style={{ color: C.tan }}>Loading…</div>}

        {!loading && filtered.length === 0 && (
          <div style={{ color: C.tan, textAlign: 'center', marginTop: 60, fontSize: 15 }}>
            {filter === 'new' ? 'All caught up — no new feedback.' : 'Nothing here yet.'}
          </div>
        )}

        {filtered.map(item => (
          <div
            key={item.id}
            style={{
              background:    C.darkBrown,
              border:        `1px solid ${item.status === 'new' ? C.medBrown : '#2a1a0c'}`,
              borderRadius:  10,
              padding:       16,
              marginBottom:  10,
              opacity:       item.status === 'new' ? 1 : 0.55,
            } as React.CSSProperties}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
                  <span style={{
                    background:   item.type === 'bug' ? C.red : C.amber,
                    color:        '#fff',
                    fontSize:     11,
                    fontWeight:   700,
                    padding:      '2px 8px',
                    borderRadius: 4,
                  }}>
                    {item.type === 'bug' ? '🐛 BUG' : '💡 IDEA'}
                  </span>
                  {item.status === 'done'      && <span style={{ fontSize: 11, color: C.green,  fontWeight: 700 }}>✓ DONE</span>}
                  {item.status === 'dismissed' && <span style={{ fontSize: 11, color: C.tan }}>DISMISSED</span>}
                </div>
                <div style={{ color: C.cream, fontSize: 15, marginBottom: 8, lineHeight: 1.5 }}>
                  {item.description}
                </div>
                <div style={{ color: C.lightBrown, fontSize: 12 }}>
                  {[
                    item.submitter,
                    item.page_url,
                    new Date(item.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }),
                  ].filter(Boolean).join(' · ')}
                </div>
              </div>

              {item.status === 'new' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
                  <button
                    onClick={() => setStatus(item.id, 'done')}
                    style={{
                      background:   C.green,
                      border:       'none',
                      borderRadius: 6,
                      color:        '#fff',
                      padding:      '6px 14px',
                      fontSize:     12,
                      fontWeight:   700,
                      cursor:       'pointer',
                    } as React.CSSProperties}
                  >
                    Done
                  </button>
                  <button
                    onClick={() => setStatus(item.id, 'dismissed')}
                    style={{
                      background:   'transparent',
                      border:       `1px solid ${C.medBrown}`,
                      borderRadius: 6,
                      color:        C.tan,
                      padding:      '6px 14px',
                      fontSize:     12,
                      cursor:       'pointer',
                    } as React.CSSProperties}
                  >
                    Dismiss
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
