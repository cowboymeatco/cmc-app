'use client'
// Who's on the time clock. Add people and carry in their PTO balance as of
// go-live — from then on the balance runs off their punches. PINs: leave it
// blank and they pick their own the first time they tap their name at the
// iPad. Reset PIN sends someone back to that — a forgotten PIN, or a name
// claimed by the wrong person.
// Nobody is deleted (their shifts are payroll records); they're deactivated.

import { useState } from 'react'
import { dateLabel } from '@/lib/dates'
import { annualPtoRate, yearsOfService } from '@/lib/timekeeping'
import { TkEmployee } from '@/lib/timeclock'
import { C, Pill, api, btn, card, h2, td, th } from './shared'

interface Form {
  id?: string; name: string; role: string; hireDate: string; pin: string
  ptoOpeningHours: string; ptoOpeningAsOf: string; qboEmployeeId: string
}

const blank = (today: string): Form => ({ name: '', role: '', hireDate: '', pin: '', ptoOpeningHours: '0', ptoOpeningAsOf: today, qboEmployeeId: '' })
const formOf = (e: TkEmployee): Form => ({
  id: e.id, name: e.name, role: e.role ?? '', hireDate: e.hireDate, pin: '',
  ptoOpeningHours: String(e.ptoOpeningHours), ptoOpeningAsOf: e.ptoOpeningAsOf, qboEmployeeId: e.qboEmployeeId ?? '',
})

export function EmployeesTab({ employees, today, reload }: { employees: TkEmployee[]; today: string; reload: () => Promise<void> }) {
  const [form, setForm] = useState<Form | null>(null)
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)
  const [showInactive, setShowInactive] = useState(false)

  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm(f => f && ({ ...f, [k]: e.target.value }))
  const input: React.CSSProperties = { background: C.dark, color: C.cream, border: `1px solid ${C.medBrown}`, borderRadius: 4, padding: '0.45rem', fontSize: '0.9rem' }

  const save = async () => {
    if (!form) return
    setSaving(true); setErr('')
    try {
      const body = {
        id: form.id, name: form.name, role: form.role, hireDate: form.hireDate,
        ptoOpeningHours: Number(form.ptoOpeningHours || 0), ptoOpeningAsOf: form.ptoOpeningAsOf, qboEmployeeId: form.qboEmployeeId,
        ...(form.pin ? { pin: form.pin } : {}),
      }
      await api('/api/timekeeping/employees', { method: form.id ? 'PATCH' : 'POST', body: JSON.stringify(body) })
      setForm(null)
      await reload()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const resetPin = async (e: TkEmployee) => {
    if (!confirm(`Reset ${e.name}'s PIN? Their old PIN stops working. Next time they tap their name at the iPad they pick a new one. This also lifts a lockout from too many wrong PINs.`)) return
    try { await api('/api/timekeeping/employees', { method: 'PATCH', body: JSON.stringify({ id: e.id, resetPin: true }) }); await reload() }
    catch (x) { setErr((x as Error).message) }
  }

  const setActive = async (e: TkEmployee, active: boolean) => {
    if (!active && !confirm(`Deactivate ${e.name}? Their PIN stops working. Their hours stay on record.`)) return
    try { await api('/api/timekeeping/employees', { method: 'PATCH', body: JSON.stringify({ id: e.id, active }) }); await reload() }
    catch (x) { setErr((x as Error).message) }
  }

  const list = employees.filter(e => showInactive || e.active)

  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '0.6rem' }}>
        <h2 style={{ ...h2, margin: 0 }}>Employees</h2>
        <span style={{ flex: 1 }} />
        <label style={{ color: C.tan, fontSize: '0.8rem' }}>
          <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} /> show inactive
        </label>
        {!form && <button style={btn(C.green)} onClick={() => { setForm(blank(today)); setErr('') }}>+ Add employee</button>}
      </div>

      {form && (
        <div style={{ background: C.darkBrown, border: `1px solid ${C.medBrown}`, borderRadius: 4, padding: '0.8rem', marginBottom: '0.8rem' }}>
          <div style={{ color: C.cream, fontWeight: 700, marginBottom: 8 }}>{form.id ? `Edit ${form.name}` : 'New employee'}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.6rem', color: C.tan, fontSize: '0.82rem' }}>
            <label>Name<br /><input value={form.name} onChange={set('name')} style={{ ...input, width: '100%' }} /></label>
            <label>Role<br /><input value={form.role} onChange={set('role')} placeholder="Cutter, Wrap & Pack…" style={{ ...input, width: '100%' }} /></label>
            <label>Hire date<br /><input type="date" value={form.hireDate} onChange={set('hireDate')} style={{ ...input, width: '100%' }} /></label>
            <label>{form.id ? 'Set their PIN (blank = keep)' : 'PIN (optional — blank = they pick their own)'}<br />
              <input value={form.pin} onChange={e => setForm(f => f && ({ ...f, pin: e.target.value.replace(/\D/g, '').slice(0, 4) }))}
                inputMode="numeric" autoComplete="off" placeholder="••••" style={{ ...input, width: '100%', letterSpacing: '0.3em' }} />
            </label>
            <label>PTO balance at go-live (hours)<br /><input type="number" step="0.01" value={form.ptoOpeningHours} onChange={set('ptoOpeningHours')} style={{ ...input, width: '100%' }} /></label>
            <label>…as of<br /><input type="date" value={form.ptoOpeningAsOf} onChange={set('ptoOpeningAsOf')} style={{ ...input, width: '100%' }} /></label>
            <label>QuickBooks employee ID (optional)<br /><input value={form.qboEmployeeId} onChange={set('qboEmployeeId')} style={{ ...input, width: '100%' }} /></label>
          </div>
          <div style={{ color: C.lightBrown, fontSize: '0.75rem', marginTop: 8, lineHeight: 1.5 }}>
            PTO balance at go-live: their current balance from QuickBooks on the &ldquo;as of&rdquo; date. From that date on, the balance runs off their punches here —
            shifts before it don&apos;t earn again. Leave the PIN blank and they&apos;ll pick their own the first time they tap their name at the iPad. Check the PIN column after: it shows when each person picked theirs — Reset PIN if a name was claimed by the wrong person.
          </div>
          {err && <div style={{ color: C.red, fontSize: '0.85rem', marginTop: 6 }}>{err}</div>}
          <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
            <button style={btn(C.green)} disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</button>
            <button style={{ ...btn('transparent'), border: `1px solid ${C.medBrown}`, color: C.tan }} onClick={() => { setForm(null); setErr('') }}>Cancel</button>
          </div>
        </div>
      )}
      {!form && err && <div style={{ color: C.red, fontSize: '0.85rem', marginBottom: 6 }}>{err}</div>}

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>
            <th style={th}>Name</th><th style={th}>Role</th><th style={th}>Hired</th><th style={th}>PTO rate</th>
            <th style={th}>Opening PTO</th><th style={th}>PIN</th><th style={th}>QuickBooks</th><th style={th} />
          </tr></thead>
          <tbody>
            {list.length === 0 && <tr><td style={td} colSpan={8}>No one yet. Add your crew to start testing.</td></tr>}
            {list.map(e => {
              const years = yearsOfService(e.hireDate, today)
              return (
                <tr key={e.id} style={{ opacity: e.active ? 1 : 0.5 }}>
                  <td style={td}>{e.name}{!e.active && <> <Pill color={C.lightBrown}>inactive</Pill></>}</td>
                  <td style={td}>{e.role ?? '—'}</td>
                  <td style={td}>{dateLabel(e.hireDate, { month: 'short', day: 'numeric', year: 'numeric' })}<div style={{ color: C.lightBrown, fontSize: '0.72rem' }}>{years} yr</div></td>
                  <td style={td}>{annualPtoRate(years)} h / 2080</td>
                  <td style={{ ...td, fontVariantNumeric: 'tabular-nums' }}>{e.ptoOpeningHours.toFixed(2)} h<div style={{ color: C.lightBrown, fontSize: '0.72rem' }}>as of {dateLabel(e.ptoOpeningAsOf, { month: 'numeric', day: 'numeric', year: '2-digit' })}</div></td>
                  <td style={td}>
                    {!e.hasPin ? <Pill color={C.amber}>not set up</Pill> : <Pill color={C.green}>{e.pinSetAt ? 'their own' : 'set by manager'}</Pill>}
                    {e.pinSetAt && <div style={{ color: C.lightBrown, fontSize: '0.72rem' }}>since {dateLabel(e.pinSetAt.slice(0, 10), { month: 'numeric', day: 'numeric' })}</div>}
                  </td>
                  <td style={{ ...td, fontSize: '0.78rem', color: C.tan }}>{e.qboEmployeeId ?? '—'}</td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>
                    <button style={btn(C.medBrown)} onClick={() => { setForm(formOf(e)); setErr('') }}>Edit</button>{' '}
                    {e.active && e.hasPin && <><button style={btn(C.medBrown)} onClick={() => resetPin(e)}>Reset PIN</button>{' '}</>}
                    {e.active
                      ? <button style={{ ...btn('transparent'), border: `1px solid ${C.red}`, color: C.red }} onClick={() => setActive(e, false)}>Deactivate</button>
                      : <button style={btn(C.green)} onClick={() => setActive(e, true)}>Reactivate</button>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
