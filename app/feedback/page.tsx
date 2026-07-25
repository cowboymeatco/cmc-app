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

interface Breadcrumb { t: string; kind: string; label: string }
interface FeedbackItem {
  id:          string
  created_at:  string
  type:        'bug' | 'idea'
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

type StatusFilter = 'new' | 'done' | 'dismissed' | 'all'
type TypeFilter   = 'all' | 'bug' | 'idea'

const ANON    = 'Anonymous'
const NO_PAGE = 'unknown page'

/** One vertical filter group in the left rail. */
function FilterGroup({ title, options, value, onChange }: {
  title:    string
  options:  { value: string; label: string; count: number }[]
  value:    string
  onChange: (v: string) => void
}) {
  if (options.length <= 1) return null
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: 10, color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
        {title}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {options.map(o => {
          const active = o.value === value
          return (
            <button
              key={o.value}
              onClick={() => onChange(o.value)}
              title={o.label}
              style={{
                display:        'flex',
                justifyContent: 'space-between',
                alignItems:     'center',
                gap:            8,
                width:          '100%',
                textAlign:      'left',
                padding:        '5px 8px',
                borderRadius:   6,
                border:         'none',
                background:     active ? C.medBrown : 'transparent',
                color:          active ? C.cream : C.tan,
                fontWeight:     active ? 700 : 400,
                fontSize:       13,
                cursor:         'pointer',
                opacity:        o.count === 0 && !active ? 0.4 : 1,
              } as React.CSSProperties}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.label}</span>
              <span style={{ fontSize: 11, color: active ? C.tan : C.lightBrown, flexShrink: 0 }}>{o.count}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export default function FeedbackPage() {
  const [items, setItems]     = useState<FeedbackItem[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ]             = useState('')
  const [statusF, setStatusF] = useState<StatusFilter>('new')
  const [type, setType]       = useState<TypeFilter>('all')
  const [who, setWho]         = useState('all')
  const [page, setPage]       = useState('all')

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

  const needle = q.trim().toLowerCase()
  const matchQ = (i: FeedbackItem) =>
    !needle || [i.description, i.submitter, i.page_url].some(v => v?.toLowerCase().includes(needle))

  // Count with one dimension overridden, so each option shows how many rows it
  // would yield given the *other* filters — an option reading 0 is a dead end.
  const countWith = (over: Partial<{ status: StatusFilter; type: TypeFilter; who: string; page: string }>) => {
    const s = over.status ?? statusF, t = over.type ?? type
    const w = over.who    ?? who,    p = over.page ?? page
    return items.filter(i =>
      (s === 'all' || i.status === s) &&
      (t === 'all' || i.type === t) &&
      (w === 'all' || (i.submitter ?? ANON) === w) &&
      (p === 'all' || (i.page_url ?? NO_PAGE) === p) &&
      matchQ(i)
    ).length
  }

  const filtered = items.filter(i =>
    (statusF === 'all' || i.status === statusF) &&
    (type    === 'all' || i.type   === type) &&
    (who    === 'all' || (i.submitter ?? ANON) === who) &&
    (page   === 'all' || (i.page_url  ?? NO_PAGE) === page) &&
    matchQ(i)
  )

  const newCount = items.filter(i => i.status === 'new').length

  // Submitter / page options come from the data, most-reported first.
  const byFrequency = (key: (i: FeedbackItem) => string) =>
    Array.from(items.reduce((m, i) => {
      const k = key(i)
      return m.set(k, (m.get(k) ?? 0) + 1)
    }, new Map<string, number>()))
      .sort((a, b) => b[1] - a[1])
      .map(([v]) => v)

  const dirty = Boolean(needle) || statusF !== 'new' || type !== 'all' || who !== 'all' || page !== 'all'
  const reset = () => { setQ(''); setStatusF('new'); setType('all'); setWho('all'); setPage('all') }

  // Drop every filter but the search term.
  const matchesAnywhere = items.filter(matchQ).length
  const widen = () => { setStatusF('all'); setType('all'); setWho('all'); setPage('all') }

  return (
    <div style={{ minHeight: '100vh', background: C.dark, padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ maxWidth: 1040, margin: '0 auto' }}>

        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
          <Link href="/" style={{ color: C.tan, fontSize: 13, textDecoration: 'none' }}>← Dashboard</Link>
          <h1 style={{ color: C.cream, fontSize: 22, fontWeight: 700, margin: 0, flex: 1 }}>Crew Feedback</h1>
          <span style={{ color: C.tan, fontSize: 13 }}>
            {newCount} new · {items.length - newCount} resolved
          </span>
        </div>

        <div style={{ position: 'relative', marginBottom: 20 }}>
          <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 14, opacity: 0.7 }}>🔎</span>
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search feedback — words, who reported it, which page…"
            style={{
              width:        '100%',
              background:   C.darkBrown,
              border:       `1px solid ${C.medBrown}`,
              borderRadius: 8,
              color:        C.cream,
              padding:      '10px 36px',
              fontSize:     14,
              outline:      'none',
              fontFamily:   'inherit',
            } as React.CSSProperties}
          />
          {q && (
            <button
              onClick={() => setQ('')}
              title="Clear search"
              style={{
                position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                background: 'none', border: 'none', color: C.tan, cursor: 'pointer', fontSize: 16,
              } as React.CSSProperties}
            >
              ✕
            </button>
          )}
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'flex-start' }}>

          {/* left rail — filters */}
          <aside style={{ flex: '0 1 200px', minWidth: 180, position: 'sticky', top: 24 }}>
            <FilterGroup
              title="Status"
              value={statusF}
              onChange={v => setStatusF(v as StatusFilter)}
              options={(['new', 'done', 'dismissed', 'all'] as const).map(v => ({
                value: v,
                label: v === 'new' ? 'New' : v === 'done' ? '✓ Done' : v === 'dismissed' ? 'Dismissed' : 'All',
                count: countWith({ status: v }),
              }))}
            />
            <FilterGroup
              title="Type"
              value={type}
              onChange={v => setType(v as TypeFilter)}
              options={(['all', 'bug', 'idea'] as const).map(v => ({
                value: v,
                label: v === 'all' ? 'All' : v === 'bug' ? '🐛 Bugs' : '💡 Ideas',
                count: countWith({ type: v }),
              }))}
            />
            <FilterGroup
              title="Reported by"
              value={who}
              onChange={setWho}
              options={[
                { value: 'all', label: 'Everyone', count: countWith({ who: 'all' }) },
                ...byFrequency(i => i.submitter ?? ANON).map(v => ({ value: v, label: v, count: countWith({ who: v }) })),
              ]}
            />
            <FilterGroup
              title="Page"
              value={page}
              onChange={setPage}
              options={[
                { value: 'all', label: 'All pages', count: countWith({ page: 'all' }) },
                ...byFrequency(i => i.page_url ?? NO_PAGE).map(v => ({ value: v, label: v, count: countWith({ page: v }) })),
              ]}
            />
            {dirty && (
              <button
                onClick={reset}
                style={{ background: 'none', border: 'none', color: C.amber, cursor: 'pointer', fontSize: 12, padding: '4px 8px' } as React.CSSProperties}
              >
                Reset filters
              </button>
            )}
          </aside>

          {/* right — the list */}
          <div style={{ flex: '1 1 460px', minWidth: 0 }}>

        {loading && <div style={{ color: C.tan }}>Loading…</div>}

        {!loading && filtered.length === 0 && (
          <div style={{ color: C.tan, textAlign: 'center', marginTop: 60, fontSize: 15 }}>
            {dirty ? 'Nothing matches those filters.' : 'All caught up — no new feedback.'}
            {/* Searching defaults to New only; most hits are usually already resolved. */}
            {needle && matchesAnywhere > 0 && (
              <div style={{ marginTop: 12 }}>
                <button
                  onClick={widen}
                  style={{
                    background: 'transparent', border: `1px solid ${C.amber}`, borderRadius: 6,
                    color: C.amber, padding: '6px 14px', fontSize: 13, cursor: 'pointer',
                  } as React.CSSProperties}
                >
                  Show all {matchesAnywhere} match{matchesAnywhere === 1 ? '' : 'es'} for “{q.trim()}”
                </button>
              </div>
            )}
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

            <Diagnostics item={item} />
          </div>
        ))}

          </div>
        </div>
      </div>
    </div>
  )
}
