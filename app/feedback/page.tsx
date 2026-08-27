'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { FEEDBACK_TYPES, feedbackSpec, type FeedbackType } from '@/lib/feedbackTypes'

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

interface Breadcrumb { t: string; kind: string; label: string }
interface FeedbackItem {
  id:          string
  created_at:  string
  type:        string
  description: string
  submitter:   string | null
  page_url:    string | null
  status:      'new' | 'done' | 'dismissed'
  // diagnostics
  full_url:       string | null
  app_context:    Record<string, unknown> | null
  commit_sha:     string | null
  user_agent:     string | null
  viewport:       string | null
  console_errors: string[] | null
  breadcrumbs:    Breadcrumb[] | null
}

function Diagnostics({ item }: { item: FeedbackItem }) {
  const ctx     = item.app_context && Object.keys(item.app_context).length ? item.app_context : null
  const crumbs  = item.breadcrumbs?.length ? item.breadcrumbs : null
  const errs    = item.console_errors?.length ? item.console_errors : null
  const hasAny  = ctx || crumbs || errs || item.commit_sha || item.full_url || item.viewport || item.user_agent
  if (!hasAny) return null

  const mono: React.CSSProperties = { fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11 }
  const chip: React.CSSProperties = { background: C.dark, border: `1px solid ${C.medBrown}`, borderRadius: 4, padding: '2px 7px', fontSize: 11, color: C.tan }

  return (
    <details style={{ marginTop: 12, borderTop: `1px solid ${C.medBrown}`, paddingTop: 10 }}>
      <summary style={{ cursor: 'pointer', color: C.tan, fontSize: 12, fontWeight: 700, userSelect: 'none' }}>
        🔧 Diagnostics
        {errs && <span style={{ color: C.red, marginLeft: 8 }}>· {errs.length} console error{errs.length === 1 ? '' : 's'}</span>}
      </summary>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
        {/* quick chips */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {item.commit_sha && <span style={chip}>commit {item.commit_sha.slice(0, 7)}</span>}
          {item.viewport   && <span style={chip}>{item.viewport}</span>}
          {ctx && Object.entries(ctx).filter(([, v]) => v != null && v !== '').map(([k, v]) => (
            <span key={k} style={chip}>{k}: <strong style={{ color: C.cream }}>{String(v)}</strong></span>
          ))}
        </div>

        {item.full_url && (
          <div style={{ ...mono, color: C.lightBrown, wordBreak: 'break-all' }}>{item.full_url}</div>
        )}

        {crumbs && (
          <div>
            <div style={{ fontSize: 10, color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Last actions</div>
            <ol style={{ ...mono, color: C.tan, margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
              {crumbs.map((b, i) => (
                <li key={i}><span style={{ color: C.lightBrown }}>[{b.kind}]</span> {b.label}</li>
              ))}
            </ol>
          </div>
        )}

        {errs && (
          <div>
            <div style={{ fontSize: 10, color: C.red, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Console errors</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {errs.map((e, i) => (
                <div key={i} style={{ ...mono, color: '#ffb4a8', background: 'rgba(229,62,62,0.08)', border: '1px solid rgba(229,62,62,0.25)', borderRadius: 4, padding: '4px 7px', wordBreak: 'break-word' }}>{e}</div>
              ))}
            </div>
          </div>
        )}

        {item.user_agent && (
          <div style={{ ...mono, color: C.lightBrown, fontSize: 10, wordBreak: 'break-all' }}>{item.user_agent}</div>
        )}
      </div>
    </details>
  )
}

export default function FeedbackPage() {
  const [items, setItems]     = useState<FeedbackItem[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter]   = useState<'all' | 'new' | FeedbackType>('new')

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
    if (filter === 'new') return i.status === 'new'
    if (filter === 'all') return true
    return i.type === filter
  })

  const newCount = items.filter(i => i.status === 'new').length
  const newByType = items.reduce((m, i) => {
    if (i.status === 'new') m.set(i.type, (m.get(i.type) ?? 0) + 1)
    return m
  }, new Map<string, number>())

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
          {/* One tab per reportable type, off FEEDBACK_TYPES, so a category
              added to the widget can't go missing here — which is how a safety
              report would end up filed among the suggestions. Counts are shown
              for the types that carry something new, so an empty Safety tab
              doesn't read as unread work. */}
          {(['new', ...FEEDBACK_TYPES.map(t => t.key), 'all'] as const).map(f => (
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
              {f === 'new' ? `New (${newCount})`
                : f === 'all' ? 'All'
                : `${feedbackSpec(f).tab}${newByType.get(f) ? ` (${newByType.get(f)})` : ''}`}
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
                    background:   feedbackSpec(item.type).color,
                    color:        '#fff',
                    fontSize:     11,
                    fontWeight:   700,
                    padding:      '2px 8px',
                    borderRadius: 4,
                  }}>
                    {feedbackSpec(item.type).badge}
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

            <Diagnostics item={item} />
          </div>
        ))}
      </div>
    </div>
  )
}
