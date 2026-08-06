'use client'
import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import type { Customer, CuttingInstruction } from '@/lib/types'

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

const INPUT: React.CSSProperties = {
  background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(166,120,90,0.3)',
  borderRadius: 3, padding: '0.5rem 0.75rem', color: C.cream, fontSize: '0.88rem',
  outline: 'none', boxSizing: 'border-box', width: '100%', fontFamily: 'inherit',
}
const LABEL: React.CSSProperties = {
  display: 'block', fontSize: '0.7rem', color: C.lightBrown,
  textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.3rem',
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label style={LABEL}>{label}</label>{children}</div>
}

function btn(bg: string, color = C.dark): React.CSSProperties {
  return { background: bg, color, border: 'none', borderRadius: 3, padding: '0.45rem 1rem', fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer' }
}

const CONTACTS = ['Phone Call', 'Text Message', 'Email']

// A record's role decides which tab(s) it shows on. Missing/legacy = customer.
type Tab = 'producer' | 'customer'
function onTab(c: Customer, tab: Tab) {
  const role = c.role === 'producer' || c.role === 'both' || c.role === 'customer' ? c.role : 'customer'
  return role === 'both' || role === tab
}

function blankCustomer(role: string = 'customer'): Partial<Customer> {
  return { name: '', ranch_name: '', phone: '', email: '', preferred_contact: 'Phone Call', notes: '', role }
}

// ── Customer form modal ───────────────────────────────────────────────────────
function CustomerModal({
  initial, onSave, onClose,
}: {
  initial: Partial<Customer>
  onSave: (c: Partial<Customer>) => Promise<void>
  onClose: () => void
}) {
  const [form, setForm] = useState<Partial<Customer>>(initial)
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    if (!form.name?.trim()) return
    setSaving(true)
    await onSave(form)
    setSaving(false)
  }

  const set = (k: keyof Customer, v: string) => setForm(f => ({ ...f, [k]: v }))

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: '1rem' }}>
      <div style={{ background: C.darkBrown, border: '1px solid rgba(166,120,90,0.3)', borderRadius: 6, padding: '1.75rem', width: '100%', maxWidth: 520 }}>
        <h2 style={{ fontFamily: 'Georgia, serif', color: C.cream, fontSize: '1.1rem', margin: '0 0 1.25rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          {form.id ? 'Edit Customer' : 'New Customer'}
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.85rem', marginBottom: '0.85rem' }}>
          <Field label="Full name *">
            <input style={INPUT} value={form.name ?? ''} onChange={e => set('name', e.target.value)} placeholder="John Smith" />
          </Field>
          <Field label="Ranch / Business name">
            <input style={INPUT} value={form.ranch_name ?? ''} onChange={e => set('ranch_name', e.target.value)} placeholder="Rocking H Ranch" />
          </Field>
          <Field label="Phone">
            <input style={INPUT} value={form.phone ?? ''} onChange={e => set('phone', e.target.value)} placeholder="(406) 555-1234" type="tel" />
          </Field>
          <Field label="Email">
            <input style={INPUT} value={form.email ?? ''} onChange={e => set('email', e.target.value)} placeholder="you@example.com" type="email" />
          </Field>
          <Field label="Preferred contact">
            <select style={INPUT} value={form.preferred_contact ?? 'Phone Call'} onChange={e => set('preferred_contact', e.target.value)}>
              {CONTACTS.map(c => <option key={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Role">
            <select style={INPUT} value={form.role ?? 'customer'} onChange={e => set('role', e.target.value)}>
              <option value="producer">🐄 Producer</option>
              <option value="customer">🛒 Customer</option>
              <option value="both">↕ Both</option>
            </select>
          </Field>
        </div>
        <Field label="Notes">
          <textarea rows={2} style={{ ...INPUT, resize: 'vertical' }} value={form.notes ?? ''} onChange={e => set('notes', e.target.value)} placeholder="Any standing preferences, special instructions, etc." />
        </Field>
        <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '1.25rem' }}>
          <button style={btn('transparent', C.tan)} onClick={onClose}>Cancel</button>
          <button style={btn(C.orange)} onClick={handleSave} disabled={saving || !form.name?.trim()}>
            {saving ? 'Saving…' : 'Save Customer'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Customer detail panel ─────────────────────────────────────────────────────
function CustomerDetail({
  customer, onEdit, onClose,
}: {
  customer: Customer
  onEdit: () => void
  onClose: () => void
}) {
  const [cutInstrs, setCutInstrs] = useState<CuttingInstruction[]>([])
  const [animals,   setAnimals]   = useState<{ id: string; harvest_date: string; species: string; head_count: number; status: string; animal_description: string }[]>([])
  const [loading, setLoading]     = useState(true)

  useEffect(() => {
    fetch(`/api/customers?id=${customer.id}`)
      .then(r => r.json())
      .then(d => { setCutInstrs(d.cutting_instructions ?? []); setAnimals(d.appointments ?? []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [customer.id])

  const role = customer.role === 'producer' || customer.role === 'both' ? customer.role : 'customer'
  const showAnimals = role === 'producer' || role === 'both'
  const showCuts    = role === 'customer' || role === 'both'

  return (
    <div style={{ background: C.darkBrown, border: '1px solid rgba(166,120,90,0.25)', borderRadius: 6, padding: '1.5rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
        <div>
          <h2 style={{ fontFamily: 'Georgia, serif', color: C.cream, fontSize: '1.15rem', margin: '0 0 0.2rem' }}>
            {customer.name}
            <span style={{ marginLeft: '0.55rem', fontSize: '0.7rem', fontWeight: 600, padding: '2px 9px', borderRadius: 99, background: 'rgba(166,120,90,0.18)', color: C.tan, verticalAlign: 'middle' }}>
              {role === 'both' ? '↕ Both' : role === 'producer' ? '🐄 Producer' : '🛒 Customer'}
            </span>
          </h2>
          {customer.ranch_name && (
            <div style={{ color: C.tan, fontSize: '0.85rem' }}>{customer.ranch_name}</div>
          )}
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button style={btn('rgba(166,120,90,0.2)', C.tan)} onClick={onEdit}>Edit</button>
          <button style={btn('transparent', C.lightBrown)} onClick={onClose}>✕</button>
        </div>
      </div>

      {/* Contact info */}
      <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', marginBottom: '1.25rem', fontSize: '0.85rem' }}>
        {customer.phone && (
          <span style={{ color: C.cream }}>
            <span style={{ color: C.lightBrown, marginRight: '0.4rem' }}>📞</span>
            <a href={`tel:${customer.phone}`} style={{ color: C.cream, textDecoration: 'none' }}>{customer.phone}</a>
          </span>
        )}
        {customer.email && (
          <span style={{ color: C.cream }}>
            <span style={{ color: C.lightBrown, marginRight: '0.4rem' }}>✉</span>
            <a href={`mailto:${customer.email}`} style={{ color: C.cream, textDecoration: 'none' }}>{customer.email}</a>
          </span>
        )}
        {customer.preferred_contact && (
          <span style={{ color: C.lightBrown, fontSize: '0.78rem' }}>Prefers: {customer.preferred_contact}</span>
        )}
      </div>

      {customer.notes && (
        <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 3, padding: '0.6rem 0.85rem', fontSize: '0.83rem', color: C.tan, marginBottom: '1.25rem', fontStyle: 'italic' }}>
          {customer.notes}
        </div>
      )}

      {/* Live animals — the producer side of the record */}
      {showAnimals && (
        <div style={{ marginBottom: '1.25rem' }}>
          <div style={{ fontSize: '0.72rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.6rem' }}>
            Live Animals ({loading ? '…' : animals.length})
          </div>
          {loading ? (
            <p style={{ color: C.lightBrown, fontSize: '0.82rem' }}>Loading…</p>
          ) : animals.length === 0 ? (
            <p style={{ color: C.lightBrown, fontSize: '0.82rem', fontStyle: 'italic' }}>
              No animals on the schedule yet.{' '}
              <Link href="/schedule" style={{ color: C.orange }}>Book one →</Link>
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', maxHeight: 300, overflowY: 'auto' }}>
              {animals.map(a => (
                <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(166,120,90,0.15)', borderRadius: 3, padding: '0.55rem 0.85rem', fontSize: '0.83rem' }}>
                  <span style={{ color: C.cream, flex: 1 }}>
                    {a.species}{a.head_count > 1 ? ` ×${a.head_count}` : ''}
                    {a.animal_description && (
                      <span style={{ color: C.lightBrown, marginLeft: '0.4rem' }}>· {a.animal_description}</span>
                    )}
                  </span>
                  <span style={{ color: C.lightBrown, fontSize: '0.75rem' }}>
                    {new Date(a.harvest_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </span>
                  <span style={{ fontSize: '0.72rem', fontWeight: 600, padding: '1px 8px', borderRadius: 99, background: 'rgba(0,0,0,0.3)', color: C.tan }}>
                    {a.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Cutting instructions — the buyer side of the record */}
      {showCuts && (
      <div>
        <div style={{ fontSize: '0.72rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.6rem' }}>
          Cutting Instructions ({loading ? '…' : cutInstrs.length})
        </div>
        {loading ? (
          <p style={{ color: C.lightBrown, fontSize: '0.82rem' }}>Loading…</p>
        ) : cutInstrs.length === 0 ? (
          <p style={{ color: C.lightBrown, fontSize: '0.82rem', fontStyle: 'italic' }}>
            No cutting instructions on file yet.{' '}
            <Link href="/cutting-instructions" style={{ color: C.orange }}>Create one →</Link>
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            {cutInstrs.map(ci => (
              <div key={ci.id} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(166,120,90,0.15)', borderRadius: 3, padding: '0.55rem 0.85rem', fontSize: '0.83rem' }}>
                <span style={{ color: C.cream, flex: 1 }}>
                  {ci.species} cut sheet
                  {ci.customer_name && ci.customer_name !== customer.name && (
                    <span style={{ color: C.lightBrown, marginLeft: '0.4rem' }}>· {ci.customer_name}</span>
                  )}
                  {/* Reached this record through the phone/email on the form, not
                      through the account — say so, or it reads as a stray sheet. */}
                  {ci.customer_id && ci.customer_id !== customer.id && (
                    <span style={{ color: C.lightBrown, marginLeft: '0.4rem', fontStyle: 'italic', fontSize: '0.78rem' }}>
                      · submitted by them
                    </span>
                  )}
                </span>
                <span style={{ color: C.lightBrown, fontSize: '0.75rem' }}>
                  {new Date(ci.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </span>
                {(() => {
                  // [label, text color, bg, border] per status; anything unknown reads as Pending
                  const badge: Record<string, [string, string, string, string]> = {
                    imported: ['On file',  C.green,    'rgba(76,175,80,0.15)',   'rgba(76,175,80,0.3)'],
                    linked:   ['Linked',   '#2DD4BF',  'rgba(45,212,191,0.12)',  'rgba(45,212,191,0.3)'],
                    archived: ['Archived', '#9CA3AF',  'rgba(156,163,175,0.12)', 'rgba(156,163,175,0.3)'],
                  }
                  const [label, color, bg, border] = badge[ci.status] ?? ['Pending', '#F59E0B', 'rgba(245,158,11,0.15)', 'rgba(245,158,11,0.3)']
                  return (
                    <span style={{ fontSize: '0.72rem', fontWeight: 600, padding: '1px 8px', borderRadius: 99, background: bg, color, border: `1px solid ${border}` }}>
                      {label}
                    </span>
                  )
                })()}
              </div>
            ))}
          </div>
        )}
      </div>
      )}

      <div style={{ marginTop: '1rem', paddingTop: '0.75rem', borderTop: '1px solid rgba(166,120,90,0.12)', fontSize: '0.72rem', color: 'rgba(166,120,90,0.5)' }}>
        Customer since {new Date(customer.created_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
        {' · '}ID: {customer.id.slice(0, 8)}…
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function CustomersPage() {
  const [customers,  setCustomers]  = useState<Customer[]>([])
  const [loading,    setLoading]    = useState(true)
  const [search,     setSearch]     = useState('')
  const [tab,        setTab]        = useState<Tab>('producer')
  const [selected,   setSelected]   = useState<Customer | null>(null)
  const [showModal,  setShowModal]  = useState(false)
  const [editTarget, setEditTarget] = useState<Partial<Customer>>(blankCustomer())

  const load = useCallback(async (q = '') => {
    setLoading(true)
    const url = q ? `/api/customers?search=${encodeURIComponent(q)}` : '/api/customers'
    const data = await fetch(url).then(r => r.json()).catch(() => [])
    setCustomers(Array.isArray(data) ? data : [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  // Debounced search
  useEffect(() => {
    const t = setTimeout(() => load(search), 280)
    return () => clearTimeout(t)
  }, [search, load])

  async function handleSave(form: Partial<Customer>) {
    if (form.id) {
      await fetch('/api/customers', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
    } else {
      await fetch('/api/customers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
    }
    setShowModal(false)
    setEditTarget(blankCustomer())
    load(search)
  }

  function openNew() {
    // New records default to the role of the tab you're standing on.
    setEditTarget(blankCustomer(tab))
    setShowModal(true)
  }

  function openEdit(c: Customer) {
    setEditTarget({ ...c })
    setShowModal(true)
    setSelected(null)
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--dark-brown)', paddingBottom: '4rem' }}>

      <header style={{ background: 'var(--dark)', borderBottom: '1px solid rgba(166,120,90,0.3)', padding: '0 1.5rem', height: '64px', display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <Link href="/" style={{ color: 'var(--tan)', textDecoration: 'none', fontSize: '0.85rem' }}>← Dashboard</Link>
        <span style={{ color: 'rgba(166,120,90,0.4)' }}>|</span>
        <h1 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, color: 'var(--cream)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          👥 Customers
        </h1>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <span style={{ fontSize: '0.8rem', color: C.lightBrown }}>
            {loading ? '…' : `${customers.length} customer${customers.length !== 1 ? 's' : ''}`}
          </span>
          <button style={btn(C.orange)} onClick={openNew}>+ New Customer</button>
        </div>
      </header>

      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '1.5rem' }}>

        {/* Producer / Customer tabs — 'both' records show on each */}
        <div style={{ display: 'flex', gap: 0, marginBottom: '1rem', border: '1px solid rgba(166,120,90,0.3)', borderRadius: 4, overflow: 'hidden', width: 'fit-content' }}>
          {(['producer', 'customer'] as const).map(t => {
            const count = customers.filter(c => onTab(c, t)).length
            const active = tab === t
            return (
              <button
                key={t}
                onClick={() => { setTab(t); setSelected(null) }}
                style={{
                  background: active ? C.medBrown : 'transparent',
                  color: active ? C.cream : C.tan,
                  border: 'none', padding: '0.55rem 1.4rem', fontSize: '0.85rem',
                  fontWeight: active ? 700 : 400, cursor: 'pointer',
                  borderLeft: t === 'customer' ? '1px solid rgba(166,120,90,0.3)' : 'none',
                }}
              >
                {t === 'producer' ? '🐄 Producers' : '🛒 Customers'} ({loading ? '…' : count})
              </button>
            )
          })}
        </div>

        {/* Search */}
        <div style={{ marginBottom: '1.25rem', position: 'relative' }}>
          <span style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: C.lightBrown, pointerEvents: 'none' }}>🔍</span>
          <input
            style={{ ...INPUT, paddingLeft: '2.25rem', fontSize: '0.92rem' }}
            placeholder="Search by name, ranch, phone, or email…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: selected ? '1fr 380px' : '1fr', gap: '1.25rem', alignItems: 'start' }}>

          {/* Customer list */}
          <div style={{ background: C.dark, border: '1px solid rgba(166,120,90,0.2)', borderRadius: 6, overflow: 'hidden' }}>
            {/* Table header */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px 160px 80px', gap: 0, background: 'rgba(0,0,0,0.3)', borderBottom: '1px solid rgba(166,120,90,0.15)', padding: '0.6rem 1rem', fontSize: '0.7rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
              <span>Name / Ranch</span>
              <span>Phone</span>
              <span>Email</span>
              <span style={{ textAlign: 'right' }}>Cut Sheets</span>
            </div>

            {loading ? (
              <div style={{ padding: '2.5rem', textAlign: 'center', color: C.lightBrown, fontSize: '0.88rem' }}>Loading…</div>
            ) : customers.filter(c => onTab(c, tab)).length === 0 ? (
              <div style={{ padding: '2.5rem', textAlign: 'center', color: C.lightBrown, fontSize: '0.88rem' }}>
                {search
                  ? `No ${tab}s match "${search}"`
                  : `No ${tab}s yet — add your first one.`}
              </div>
            ) : (
              customers.filter(c => onTab(c, tab)).map(c => {
                const isSelected = selected?.id === c.id
                return (
                  <div
                    key={c.id}
                    onClick={() => setSelected(isSelected ? null : c)}
                    style={{
                      display: 'grid', gridTemplateColumns: '1fr 160px 160px 80px',
                      padding: '0.75rem 1rem',
                      borderBottom: '1px solid rgba(166,120,90,0.1)',
                      background: isSelected ? 'rgba(232,136,58,0.08)' : 'transparent',
                      cursor: 'pointer',
                      transition: 'background 0.15s',
                      borderLeft: isSelected ? `3px solid ${C.orange}` : '3px solid transparent',
                    }}
                  >
                    <div>
                      <div style={{ color: C.cream, fontWeight: 600, fontSize: '0.88rem' }}>
                        {c.name}
                        {c.role === 'both' && (
                          <span title="Shows on both tabs" style={{ marginLeft: '0.45rem', fontSize: '0.68rem', color: C.lightBrown, fontWeight: 400 }}>↕ both</span>
                        )}
                      </div>
                      {c.ranch_name && <div style={{ color: C.lightBrown, fontSize: '0.76rem', marginTop: '0.1rem' }}>{c.ranch_name}</div>}
                    </div>
                    <div style={{ color: C.tan, fontSize: '0.83rem', alignSelf: 'center' }}>{c.phone || <span style={{ color: 'rgba(166,120,90,0.4)' }}>—</span>}</div>
                    <div style={{ color: C.tan, fontSize: '0.83rem', alignSelf: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.email || <span style={{ color: 'rgba(166,120,90,0.4)' }}>—</span>}</div>
                    <div style={{ textAlign: 'right', alignSelf: 'center' }}>
                      {c.cut_sheet_count
                        ? <span style={{ fontSize: '0.8rem', color: C.green, fontWeight: 600 }}>📋 {c.cut_sheet_count}</span>
                        : <span style={{ fontSize: '0.75rem', color: 'rgba(166,120,90,0.4)' }}>—</span>}
                    </div>
                  </div>
                )
              })
            )}
          </div>

          {/* Detail panel */}
          {selected && (
            <CustomerDetail
              customer={selected}
              onEdit={() => openEdit(selected)}
              onClose={() => setSelected(null)}
            />
          )}
        </div>

        {customers.length === 0 && !loading && !search && (
          <div style={{ marginTop: '2rem', background: 'rgba(232,136,58,0.06)', border: '1px solid rgba(232,136,58,0.2)', borderRadius: 6, padding: '1.5rem', textAlign: 'center' }}>
            <p style={{ color: C.tan, fontSize: '0.9rem', margin: '0 0 1rem' }}>
              Customers added here will show up as autocomplete suggestions when you create appointments in the schedule. Build your customer list over time and link cutting instructions to each person.
            </p>
            <button style={btn(C.orange)} onClick={openNew}>Add Your First Customer</button>
          </div>
        )}
      </div>

      {showModal && (
        <CustomerModal
          initial={editTarget}
          onSave={handleSave}
          onClose={() => { setShowModal(false); setEditTarget(blankCustomer()) }}
        />
      )}
    </div>
  )
}
