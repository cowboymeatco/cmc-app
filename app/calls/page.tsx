'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { CALL_CATEGORIES, callCategorySpec, type CallCategory } from '@/lib/callCategories'
import { isoDate, addDaysISO, mondayOfISO, dateLabel } from '@/lib/dates'
import type { Customer } from '@/lib/types'

// Front-desk call log. Two jobs, in this order on the page:
//   1. Log a call in the time it takes to hang up: who, what they asked, one
//      category chip, what we told them. Save, next.
//   2. Count them. The tally at the top shows which questions the phone keeps
//      ringing for, so the answers can go where people find them before they
//      dial — the website, the booking confirmation, a text.

const C = {
  dark:       '#1A0A04',
  darkBrown:  '#351E0E',
  medBrown:   '#75471B',
  lightBrown: '#A6785A',
  tan:        '#C9A882',
  cream:      '#F2E8D9',
  green:      '#4CAF50',
  orange:     '#E8883A',
  red:        '#E53E3E',
}

const SHOP_TZ = 'America/Denver'
const WHO_KEY = 'cmc-calls-who'
const FETCH_DAYS = 90

const INPUT: React.CSSProperties = {
  background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(166,120,90,0.3)',
  borderRadius: 3, padding: '0.5rem 0.75rem', color: C.cream, fontSize: '0.88rem',
  outline: 'none', boxSizing: 'border-box', width: '100%', fontFamily: 'inherit',
}
const LABEL: React.CSSProperties = {
  display: 'block', fontSize: '0.7rem', color: C.lightBrown,
  textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.3rem',
}
const CARD: React.CSSProperties = {
  background: C.darkBrown, border: '1px solid rgba(166,120,90,0.18)', borderRadius: 4, padding: '1rem 1.25rem',
}

function Field({ label, children, style }: { label: string; children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={style}><label style={LABEL}>{label}</label>{children}</div>
}

function btn(bg: string, color = C.dark): React.CSSProperties {
  return { background: bg, color, border: 'none', borderRadius: 3, padding: '0.45rem 1rem', fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer' }
}

interface CallRow {
  id:           string
  created_at:   string
  called_at:    string
  taken_by:     string
  caller_name:  string | null
  caller_phone: string | null
  customer_id:  string | null
  category:     string
  question:     string
  answer:       string | null
  customers:    { name: string; ranch_name: string | null } | null
}

/** <input type="datetime-local"> wants the browser's local wall time, not an
 * ISO instant (same as /value-add and /delivery). It has to be the browser's
 * clock, not the shop's: new Date(value) reads it back on the browser's clock,
 * so building it on the shop clock saved a call hours off on any device that
 * isn't set to Mountain Time. */
function toLocalInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

/** "Mon, Oct 27 · 9:42 AM" on the shop clock. */
function whenLabel(iso: string): string {
  const d = new Date(iso)
  const day  = d.toLocaleDateString('en-US', { timeZone: SHOP_TZ, weekday: 'short', month: 'short', day: 'numeric' })
  const time = d.toLocaleTimeString('en-US', { timeZone: SHOP_TZ, hour: 'numeric', minute: '2-digit' })
  return `${day} · ${time}`
}

function Badge({ category }: { category: string }) {
  const spec = callCategorySpec(category)
  return (
    <span style={{
      display: 'inline-block', background: `${spec.color}22`, border: `1px solid ${spec.color}66`, color: spec.color,
      borderRadius: 3, padding: '1px 7px', fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.04em', whiteSpace: 'nowrap',
    }}>{spec.label}</span>
  )
}

function CategoryChips({ value, onChange, size = 'md' }: { value: CallCategory | ''; onChange: (c: CallCategory) => void; size?: 'md' | 'sm' }) {
  const pad = size === 'sm' ? '0.25rem 0.6rem' : '0.4rem 0.8rem'
  const fs  = size === 'sm' ? '0.74rem' : '0.82rem'
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {CALL_CATEGORIES.map(c => {
        const on = c.key === value
        return (
          <button
            key={c.key}
            type="button"
            onClick={() => onChange(c.key)}
            title={c.hint}
            style={{
              background: on ? c.color : 'rgba(255,255,255,0.05)',
              color: on ? C.dark : C.tan,
              border: `1px solid ${on ? c.color : 'rgba(166,120,90,0.3)'}`,
              borderRadius: 3, padding: pad, fontSize: fs, fontWeight: on ? 700 : 500, cursor: 'pointer',
            }}
          >{c.label}</button>
        )
      })}
    </div>
  )
}

// ── Entry form ──────────────────────────────────────────────────────────────

interface Draft {
  taken_by:     string
  called_at:    string        // datetime-local wall time on the browser's clock
  // Untouched, the server stamps now() itself — exact on every device. Only an
  // edited value (back-dating a call logged after the rush) is sent.
  called_at_touched: boolean
  caller_name:  string
  caller_phone: string
  customer_id:  string | null
  customer_label: string      // "Name · Ranch" for the linked chip
  category:     CallCategory | ''
  question:     string
  answer:       string
}

function freshDraft(taken_by: string): Draft {
  return {
    taken_by, called_at: toLocalInput(new Date()), called_at_touched: false, caller_name: '', caller_phone: '',
    customer_id: null, customer_label: '', category: '', question: '', answer: '',
  }
}

function LogCallForm({ onSaved }: { onSaved: (row: CallRow) => void }) {
  const [d, setD]           = useState<Draft>(() => freshDraft(''))
  const [saving, setSaving] = useState(false)
  const [err, setErr]       = useState<string | null>(null)
  const [savedMsg, setSavedMsg] = useState<string | null>(null)

  // Customer autocomplete on the caller name, same as the schedule form.
  const [suggestions, setSuggestions] = useState<Customer[]>([])
  const [open, setOpen]     = useState(false)
  const wrapRef  = useRef<HTMLDivElement>(null)
  const nameRef  = useRef<HTMLInputElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- restoring the remembered name after mount; reading it during render would mismatch the server HTML
    try { setD(prev => ({ ...prev, taken_by: localStorage.getItem(WHO_KEY) ?? '' })) } catch { /* private mode */ }
  }, [])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const set = <K extends keyof Draft>(k: K) => (v: Draft[K]) => setD(prev => ({ ...prev, [k]: v }))

  function handleName(val: string) {
    // Typing clears a link: the name no longer matches the record it pointed at.
    setD(prev => ({ ...prev, caller_name: val, customer_id: null, customer_label: '' }))
    if (timerRef.current) clearTimeout(timerRef.current)
    if (val.trim().length < 2) { setSuggestions([]); setOpen(false); return }
    timerRef.current = setTimeout(async () => {
      const data = await fetch(`/api/customers?search=${encodeURIComponent(val)}`).then(r => r.json()).catch(() => [])
      setSuggestions(Array.isArray(data) ? data.slice(0, 6) : [])
      setOpen(true)
    }, 220)
  }

  function pick(c: Customer) {
    setD(prev => ({
      ...prev,
      caller_name:    c.name,
      caller_phone:   prev.caller_phone || c.phone || '',
      customer_id:    c.id,
      customer_label: [c.name, c.ranch_name].filter(Boolean).join(' · '),
    }))
    setOpen(false)
    setSuggestions([])
  }

  const canSave = d.taken_by.trim() && d.category && d.question.trim() && !saving

  async function save() {
    if (!canSave) return
    setSaving(true); setErr(null); setSavedMsg(null)
    try { localStorage.setItem(WHO_KEY, d.taken_by.trim()) } catch { /* private mode */ }
    const res = await fetch('/api/calls', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        taken_by:     d.taken_by,
        // datetime-local is wall time; store a real instant (see /delivery).
        called_at:    d.called_at_touched && d.called_at ? new Date(d.called_at).toISOString() : null,
        caller_name:  d.caller_name,
        caller_phone: d.caller_phone,
        customer_id:  d.customer_id,
        category:     d.category,
        question:     d.question,
        answer:       d.answer,
      }),
    })
    const data = await res.json().catch(() => ({}))
    setSaving(false)
    if (!res.ok) { setErr(data.error ?? `Save failed (${res.status})`); return }
    onSaved(data as CallRow)
    const who = d.taken_by
    setD(freshDraft(who))
    setSavedMsg(`Logged${d.caller_name.trim() ? ` — ${d.caller_name.trim()}` : ''} · ${callCategorySpec(d.category).label}`)
    nameRef.current?.focus()
  }

  function onKey(e: React.KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); save() }
  }

  const catSpec = d.category ? callCategorySpec(d.category) : null

  return (
    <div style={CARD} onKeyDown={onKey}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: '0.9rem' }}>
        <h2 style={{ color: C.cream, fontSize: '1rem', fontWeight: 700, margin: 0 }}>Log a call</h2>
        <span style={{ color: C.lightBrown, fontSize: '0.75rem' }}>Ctrl+Enter saves</span>
        {savedMsg && <span style={{ color: C.green, fontSize: '0.78rem', marginLeft: 'auto' }}>✓ {savedMsg}</span>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '0.75rem' }}>
        <Field label="Taken by">
          <input style={INPUT} value={d.taken_by} onChange={e => set('taken_by')(e.target.value)} placeholder="Your name" />
        </Field>
        <Field label="When">
          <input type="datetime-local" style={INPUT} value={d.called_at} onChange={e => setD(prev => ({ ...prev, called_at: e.target.value, called_at_touched: true }))} />
        </Field>
        <Field label="Caller">
          <div ref={wrapRef} style={{ position: 'relative' }}>
            <input
              ref={nameRef}
              style={INPUT}
              value={d.caller_name}
              onChange={e => handleName(e.target.value)}
              onFocus={() => { if (suggestions.length) setOpen(true) }}
              placeholder="Name (matches customers as you type)"
              autoComplete="off"
            />
            {d.customer_id && (
              <span style={{ position: 'absolute', right: '0.5rem', top: '50%', transform: 'translateY(-50%)', fontSize: '0.7rem', color: C.green, pointerEvents: 'none' }}>✓ linked</span>
            )}
            {open && suggestions.length > 0 && (
              <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100, background: '#2A1408', border: '1px solid rgba(166,120,90,0.4)', borderRadius: '0 0 4px 4px', boxShadow: '0 4px 16px rgba(0,0,0,0.5)', maxHeight: 220, overflowY: 'auto' }}>
                {suggestions.map(c => (
                  <div
                    key={c.id}
                    onMouseDown={() => pick(c)}
                    style={{ padding: '0.5rem 0.85rem', cursor: 'pointer', borderBottom: '1px solid rgba(166,120,90,0.1)' }}
                  >
                    <div style={{ color: C.cream, fontSize: '0.85rem', fontWeight: 600 }}>{c.name}</div>
                    <div style={{ color: C.lightBrown, fontSize: '0.75rem' }}>{[c.ranch_name, c.phone, c.email].filter(Boolean).join(' · ')}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Field>
        <Field label="Phone">
          <input style={INPUT} value={d.caller_phone} onChange={e => set('caller_phone')(e.target.value)} placeholder="Number they called from" inputMode="tel" />
        </Field>
      </div>

      <Field label="What was it about?" style={{ marginBottom: '0.75rem' }}>
        <CategoryChips value={d.category} onChange={set('category')} />
        {catSpec && <div style={{ color: C.lightBrown, fontSize: '0.75rem', marginTop: 6 }}>{catSpec.hint}</div>}
      </Field>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '0.75rem', marginBottom: '0.75rem' }}>
        <Field label="What they asked">
          <textarea style={{ ...INPUT, minHeight: 72, resize: 'vertical' }} value={d.question} onChange={e => set('question')(e.target.value)} placeholder="In their words, near enough" />
        </Field>
        <Field label="What we told them">
          <textarea style={{ ...INPUT, minHeight: 72, resize: 'vertical' }} value={d.answer} onChange={e => set('answer')(e.target.value)} placeholder="Optional" />
        </Field>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button type="button" onClick={save} disabled={!canSave} style={{ ...btn(C.orange), opacity: canSave ? 1 : 0.45, cursor: canSave ? 'pointer' : 'default' }}>
          {saving ? 'Saving…' : 'Save call'}
        </button>
        {!d.taken_by.trim() && <span style={{ color: C.lightBrown, fontSize: '0.78rem' }}>Put your name in once; it sticks on this device.</span>}
        {err && <span style={{ color: C.red, fontSize: '0.8rem' }}>{err}</span>}
      </div>
    </div>
  )
}

// ── Tally ───────────────────────────────────────────────────────────────────

type Window = 'week' | '4w' | '90d'
const WINDOWS: { key: Window; label: string }[] = [
  { key: 'week', label: 'This week' },
  { key: '4w',   label: 'Last 4 weeks' },
  { key: '90d',  label: 'Last 90 days' },
]

function Tally({ rows }: { rows: CallRow[] }) {
  const [win, setWin] = useState<Window>('4w')
  const today = isoDate()

  // Business dates on the shop clock, so a 7 PM Mountain call counts today,
  // not tomorrow (UTC).
  const dated = useMemo(() => rows.map(r => ({ r, day: isoDate(new Date(r.called_at)) })), [rows])

  const since = win === 'week' ? mondayOfISO(today) : win === '4w' ? addDaysISO(today, -27) : addDaysISO(today, -(FETCH_DAYS - 1))
  const inWin = dated.filter(x => x.day >= since)
  const total = inWin.length

  const counts = CALL_CATEGORIES.map(c => ({ spec: c, n: inWin.filter(x => x.r.category === c.key).length }))
    .sort((a, b) => b.n - a.n)
  const max = counts[0]?.n ?? 0

  // Calls per week for the last 8 weeks, Monday-anchored, oldest first.
  const weeks = useMemo(() => {
    const thisMon = mondayOfISO(today)
    return Array.from({ length: 8 }, (_, i) => {
      const mon = addDaysISO(thisMon, -7 * (7 - i))
      const end = addDaysISO(mon, 6)
      return { mon, n: dated.filter(x => x.day >= mon && x.day <= end).length }
    })
  }, [dated, today])
  const weekMax = Math.max(1, ...weeks.map(w => w.n))

  return (
    <div style={CARD}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: '0.9rem', flexWrap: 'wrap' }}>
        <h2 style={{ color: C.cream, fontSize: '1rem', fontWeight: 700, margin: 0 }}>What the phone rings for</h2>
        <span style={{ color: C.tan, fontSize: '0.8rem' }}>{total} call{total === 1 ? '' : 's'}</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
          {WINDOWS.map(w => (
            <button key={w.key} type="button" onClick={() => setWin(w.key)} style={{
              background: win === w.key ? C.medBrown : 'transparent', color: win === w.key ? C.cream : C.tan,
              border: `1px solid ${win === w.key ? C.medBrown : 'rgba(166,120,90,0.3)'}`, borderRadius: 3,
              padding: '0.25rem 0.6rem', fontSize: '0.74rem', cursor: 'pointer',
            }}>{w.label}</button>
          ))}
        </div>
      </div>

      {total === 0 ? (
        <div style={{ color: C.lightBrown, fontSize: '0.85rem' }}>No calls logged in this window yet.</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(170px, auto) 1fr auto auto', gap: '0.35rem 0.75rem', alignItems: 'center' }}>
          {counts.map(({ spec, n }) => (
            <div key={spec.key} style={{ display: 'contents' }}>
              <span style={{ color: n ? C.cream : C.lightBrown, fontSize: '0.84rem' }}>{spec.label}</span>
              <div style={{ background: 'rgba(255,255,255,0.05)', borderRadius: 2, height: 14, overflow: 'hidden' }}>
                <div style={{ width: `${max ? (n / max) * 100 : 0}%`, height: '100%', background: spec.color, transition: 'width 0.3s' }} />
              </div>
              <span style={{ color: C.cream, fontSize: '0.84rem', fontWeight: 700, textAlign: 'right', minWidth: 28 }}>{n}</span>
              <span style={{ color: C.lightBrown, fontSize: '0.76rem', textAlign: 'right', minWidth: 36 }}>{total ? Math.round((n / total) * 100) : 0}%</span>
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: '1rem', borderTop: '1px solid rgba(166,120,90,0.18)', paddingTop: '0.75rem' }}>
        <div style={{ ...LABEL, marginBottom: '0.5rem' }}>Calls per week · last 8 weeks</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 6, alignItems: 'end', height: 64 }}>
          {weeks.map(w => (
            <div key={w.mon} title={`Week of ${dateLabel(w.mon, { month: 'short', day: 'numeric' })}: ${w.n}`} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%' }}>
              <span style={{ color: C.tan, fontSize: '0.7rem', marginBottom: 2 }}>{w.n || ''}</span>
              <div style={{ width: '100%', height: `${Math.max(2, (w.n / weekMax) * 44)}px`, background: w.n ? C.medBrown : 'rgba(255,255,255,0.05)', borderRadius: 2 }} />
            </div>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 6, marginTop: 4 }}>
          {weeks.map(w => (
            <span key={w.mon} style={{ color: C.lightBrown, fontSize: '0.66rem', textAlign: 'center' }}>{dateLabel(w.mon, { month: 'numeric', day: 'numeric' })}</span>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── List ────────────────────────────────────────────────────────────────────

function CallItem({ row, onChange, onDelete }: { row: CallRow; onChange: (r: CallRow) => void; onDelete: (id: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [e, setE] = useState({ category: row.category as CallCategory, question: row.question, answer: row.answer ?? '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr]   = useState<string | null>(null)

  async function save() {
    setBusy(true); setErr(null)
    const res = await fetch('/api/calls', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: row.id, ...e }),
    })
    const data = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { setErr(data.error ?? 'Save failed'); return }
    onChange(data as CallRow)
    setEditing(false)
  }

  async function del() {
    if (!confirm('Delete this call from the log?')) return
    setBusy(true)
    const res = await fetch(`/api/calls?id=${encodeURIComponent(row.id)}`, { method: 'DELETE' })
    setBusy(false)
    if (res.ok) onDelete(row.id)
  }

  const who = row.caller_name || row.customers?.name || 'Unknown caller'
  const sub = [row.customers?.ranch_name, row.caller_phone].filter(Boolean).join(' · ')

  return (
    <div style={{ padding: '0.7rem 0', borderBottom: '1px solid rgba(166,120,90,0.12)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ color: C.lightBrown, fontSize: '0.74rem', minWidth: 150 }}>{whenLabel(row.called_at)}</span>
        <Badge category={row.category} />
        <span style={{ color: C.cream, fontSize: '0.88rem', fontWeight: 600 }}>{who}</span>
        {sub && <span style={{ color: C.lightBrown, fontSize: '0.76rem' }}>{sub}</span>}
        <span style={{ marginLeft: 'auto', color: C.lightBrown, fontSize: '0.72rem' }}>taken by {row.taken_by}</span>
        {!editing && (
          <button type="button" onClick={() => setEditing(true)} style={{ background: 'none', border: 'none', color: C.tan, fontSize: '0.74rem', cursor: 'pointer', padding: 0 }}>edit</button>
        )}
      </div>

      {editing ? (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <CategoryChips size="sm" value={e.category} onChange={c => setE(p => ({ ...p, category: c }))} />
          <textarea style={{ ...INPUT, minHeight: 56, resize: 'vertical' }} value={e.question} onChange={ev => setE(p => ({ ...p, question: ev.target.value }))} />
          <textarea style={{ ...INPUT, minHeight: 44, resize: 'vertical' }} value={e.answer} onChange={ev => setE(p => ({ ...p, answer: ev.target.value }))} placeholder="What we told them" />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button type="button" onClick={save} disabled={busy} style={btn(C.orange)}>Save</button>
            <button type="button" onClick={() => { setEditing(false); setE({ category: row.category as CallCategory, question: row.question, answer: row.answer ?? '' }) }} style={btn('rgba(255,255,255,0.08)', C.cream)}>Cancel</button>
            <button type="button" onClick={del} disabled={busy} style={{ ...btn('transparent', C.red), marginLeft: 'auto', border: `1px solid ${C.red}55` }}>Delete</button>
            {err && <span style={{ color: C.red, fontSize: '0.78rem' }}>{err}</span>}
          </div>
        </div>
      ) : (
        <div style={{ marginTop: 4, paddingLeft: 0 }}>
          <div style={{ color: C.cream, fontSize: '0.86rem', whiteSpace: 'pre-wrap' }}>{row.question}</div>
          {row.answer && <div style={{ color: C.tan, fontSize: '0.8rem', marginTop: 2, whiteSpace: 'pre-wrap' }}>↳ {row.answer}</div>}
        </div>
      )}
    </div>
  )
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function CallsPage() {
  const [rows, setRows]       = useState<CallRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [filter, setFilter]   = useState<CallCategory | 'all'>('all')
  const [q, setQ]             = useState('')

  useEffect(() => {
    let cancelled = false
    fetch(`/api/calls?days=${FETCH_DAYS}`)
      .then(async res => {
        const data = await res.json().catch(() => null)
        if (cancelled) return
        if (!res.ok || !Array.isArray(data)) {
          setLoadErr(data?.error ?? 'Could not load the call log')
          setRows([])
        } else {
          setRows(data as CallRow[])
        }
        setLoading(false)
      })
      .catch(() => { if (!cancelled) { setLoadErr('Could not load the call log'); setLoading(false) } })
    return () => { cancelled = true }
  }, [])

  const needle = q.trim().toLowerCase()
  const shown = rows.filter(r => {
    if (filter !== 'all' && r.category !== filter) return false
    if (!needle) return true
    return [r.caller_name, r.caller_phone, r.customers?.name, r.customers?.ranch_name, r.question, r.answer, r.taken_by]
      .some(v => v && v.toLowerCase().includes(needle))
  })

  const today = isoDate()
  const thisWeek = rows.filter(r => isoDate(new Date(r.called_at)) >= mondayOfISO(today)).length

  return (
    <div style={{ minHeight: '100vh', background: C.dark, padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ maxWidth: 960, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '1rem' }}>

        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <Link href="/" style={{ color: C.tan, fontSize: 13, textDecoration: 'none' }}>← Dashboard</Link>
          <h1 style={{ color: C.cream, fontSize: 22, fontWeight: 700, margin: 0, flex: 1 }}>Call Log</h1>
          <span style={{ color: C.tan, fontSize: 13 }}>{thisWeek} this week · {rows.length} in {FETCH_DAYS} days</span>
        </div>

        <LogCallForm onSaved={row => setRows(prev => [row, ...prev].sort((a, b) => b.called_at.localeCompare(a.called_at)))} />

        <Tally rows={rows} />

        <div style={CARD}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: '0.75rem', flexWrap: 'wrap' }}>
            <h2 style={{ color: C.cream, fontSize: '1rem', fontWeight: 700, margin: 0 }}>Recent calls</h2>
            <span style={{ color: C.tan, fontSize: '0.8rem' }}>{shown.length} shown</span>
            <input
              style={{ ...INPUT, width: 260, marginLeft: 'auto', padding: '0.35rem 0.6rem', fontSize: '0.82rem' }}
              value={q} onChange={e => setQ(e.target.value)} placeholder="Search caller, question, answer…"
            />
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: '0.5rem' }}>
            <button type="button" onClick={() => setFilter('all')} style={{
              background: filter === 'all' ? C.medBrown : 'rgba(255,255,255,0.05)', color: filter === 'all' ? C.cream : C.tan,
              border: `1px solid ${filter === 'all' ? C.medBrown : 'rgba(166,120,90,0.3)'}`, borderRadius: 3, padding: '0.25rem 0.6rem', fontSize: '0.74rem', cursor: 'pointer',
            }}>All</button>
            {CALL_CATEGORIES.map(c => {
              const on = filter === c.key
              const n = rows.filter(r => r.category === c.key).length
              return (
                <button key={c.key} type="button" onClick={() => setFilter(on ? 'all' : c.key)} style={{
                  background: on ? c.color : 'rgba(255,255,255,0.05)', color: on ? C.dark : C.tan,
                  border: `1px solid ${on ? c.color : 'rgba(166,120,90,0.3)'}`, borderRadius: 3, padding: '0.25rem 0.6rem', fontSize: '0.74rem', cursor: 'pointer',
                }}>{c.label} <span style={{ opacity: 0.7 }}>{n}</span></button>
              )
            })}
          </div>

          {loading ? (
            <div style={{ color: C.lightBrown, fontSize: '0.85rem', padding: '0.5rem 0' }}>Loading…</div>
          ) : loadErr ? (
            <div style={{ color: C.red, fontSize: '0.85rem', padding: '0.5rem 0' }}>{loadErr}</div>
          ) : shown.length === 0 ? (
            <div style={{ color: C.lightBrown, fontSize: '0.85rem', padding: '0.5rem 0' }}>
              {rows.length === 0 ? 'Nothing logged yet. The next call that comes in goes in the form above.' : 'No calls match.'}
            </div>
          ) : (
            shown.map(r => (
              <CallItem
                key={r.id}
                row={r}
                onChange={u => setRows(prev => prev.map(x => x.id === u.id ? u : x))}
                onDelete={id => setRows(prev => prev.filter(x => x.id !== id))}
              />
            ))
          )}
        </div>
      </div>
    </div>
  )
}
