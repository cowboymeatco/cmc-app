'use client'

import { useCallback, useEffect, useState } from 'react'
import type { GameRate } from '@/lib/gameBilling'
import { C, INPUT, LABEL, CARD } from './ui'

// The price list, editable.
//
// This screen exists so a price change is something Jill does in a minute, not
// something that waits for a deploy. Two things make that safe:
//
//   * Rates are STAMPED onto every weighed line at weigh-out, so changing a
//     price here never rewrites a ticket already quoted to a hunter. It only
//     changes what the next one is charged.
//   * Nothing here writes to QuickBooks. The QBO item each rate books against
//     is shown so the two can be kept in step by eye, and any disagreement is
//     called out rather than silently reconciled.

const UNIT_HELP: Record<string, string> = {
  lb: 'per finished pound',
  hr: 'per hour',
  ea: 'flat, per animal',
}

export default function PricingTab() {
  const [rates, setRates]   = useState<GameRate[]>([])
  const [loading, setLoading] = useState(true)
  const [savingKey, setSaving] = useState<string | null>(null)
  const [who, setWho]       = useState('')
  const [err, setErr]       = useState('')

  const load = useCallback(() =>
    fetch('/api/game/rates')
      .then(r => r.json())
      .then(d => setRates(Array.isArray(d) ? d : []))
      .catch(() => setErr('Could not load the price list.'))
      .finally(() => setLoading(false)),
  [])

  useEffect(() => { load() }, [load])

  async function save(key: string, patch: Partial<GameRate>) {
    setSaving(key); setErr('')
    try {
      const res = await fetch('/api/game/rates', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, ...patch, updated_by: who }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Save failed')
      setRates(rs => rs.map(r => (r.key === key ? { ...r, ...json } : r)))
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed')
      load()   // put the row back to whatever the server actually holds
    } finally {
      setSaving(null)
    }
  }

  const products = rates.filter(r => r.bucket === 'product')
  const others   = rates.filter(r => r.bucket === 'other')

  return (
    <div style={{ maxWidth: 1000 }}>
      <div style={{ ...CARD, marginBottom: '1.25rem' }}>
        <div style={{ fontSize: '0.85rem', color: C.cream, fontWeight: 600 }}>
          Wild game price list
        </div>
        <p style={{ fontSize: '0.78rem', color: C.lightBrown, margin: '0.4rem 0 0', lineHeight: 1.6 }}>
          Seeded from the printed Wild&nbsp;Game Processing slip. Editing a price here changes what the
          <em> next</em> animal is quoted — every line already weighed keeps the rate it was weighed at,
          so no hunter&apos;s existing ticket moves under them. Nothing here posts to QuickBooks.
        </p>
        <div style={{ marginTop: '0.75rem', maxWidth: 240 }}>
          <label style={LABEL}>Your initials (stamped on changes)</label>
          <input value={who} onChange={e => setWho(e.target.value)} style={INPUT} placeholder="JB" />
        </div>
      </div>

      {err && <div style={{ color: C.red, fontSize: '0.85rem', marginBottom: '0.75rem' }}>{err}</div>}
      {loading && <div style={{ color: C.lightBrown }}>Loading…</div>}

      <Section title="Product — what the hunter ordered made"
        hint="These total into the slip's Total Product."
        rates={products} savingKey={savingKey} onSave={save} />

      <Section title="Other services, additions & fees"
        hint="These total into the slip's Total Other."
        rates={others} savingKey={savingKey} onSave={save} />
    </div>
  )
}

function Section({ title, hint, rates, savingKey, onSave }: {
  title: string; hint: string; rates: GameRate[]
  savingKey: string | null
  onSave: (key: string, patch: Partial<GameRate>) => void
}) {
  if (!rates.length) return null
  return (
    <div style={{ marginBottom: '1.75rem' }}>
      <div style={{
        fontSize: '0.75rem', color: C.tan, textTransform: 'uppercase', letterSpacing: '0.14em',
        fontWeight: 700, borderBottom: `1px solid ${C.medBrown}`, paddingBottom: '0.35rem',
      }}>{title}</div>
      <div style={{ fontSize: '0.72rem', color: C.lightBrown, margin: '0.4rem 0 0.75rem' }}>{hint}</div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(180px, 1.6fr) 110px 110px minmax(150px, 1.2fr) 70px',
        gap: '0.5rem 0.75rem', alignItems: 'center',
      }}>
        <Head>Service</Head>
        <Head right>Rate</Head>
        <Head right>w/ Cheese</Head>
        <Head>QuickBooks item</Head>
        <Head>Active</Head>

        {rates.map(r => (
          // The key carries the server's values, so a saved change remounts the
          // row with fresh inputs. That is React's own way to reset state from a
          // prop — syncing it back with an effect would fight the user's typing.
          <Row key={`${r.key}:${r.rate}:${r.cheese_rate}`} rate={r}
            saving={savingKey === r.key} onSave={onSave} />
        ))}
      </div>
    </div>
  )
}

function Head({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <div style={{
      fontSize: '0.66rem', color: C.lightBrown, textTransform: 'uppercase',
      letterSpacing: '0.1em', textAlign: right ? 'right' : 'left',
    }}>{children}</div>
  )
}

function Row({ rate, saving, onSave }: {
  rate: GameRate; saving: boolean; onSave: (key: string, patch: Partial<GameRate>) => void
}) {
  const [value, setValue]   = useState(String(rate.rate))
  const [cheese, setCheese] = useState(rate.cheese_rate == null ? '' : String(rate.cheese_rate))

  const commitRate = () => {
    const n = Number(value)
    if (!Number.isFinite(n) || n < 0) { setValue(String(rate.rate)); return }
    if (n !== Number(rate.rate)) onSave(rate.key, { rate: n })
  }
  const commitCheese = () => {
    // Blank means "this product has no cheese version" — a different thing
    // from "cheese is free" — so it is stored as null, not zero.
    if (cheese.trim() === '') {
      if (rate.cheese_rate != null) onSave(rate.key, { cheese_rate: null })
      return
    }
    const n = Number(cheese)
    if (!Number.isFinite(n) || n < 0) { setCheese(rate.cheese_rate == null ? '' : String(rate.cheese_rate)); return }
    if (n !== Number(rate.cheese_rate)) onSave(rate.key, { cheese_rate: n })
  }

  const dim = !rate.active
  const mismatch = /MISMATCH/i.test(rate.note)

  return (
    <>
      <div style={{ opacity: dim ? 0.45 : 1 }}>
        <div style={{ fontSize: '0.85rem', color: C.cream }}>{rate.label}</div>
        <div style={{ fontSize: '0.68rem', color: C.lightBrown }}>
          {UNIT_HELP[rate.unit] ?? rate.unit}
          {saving && <span style={{ color: C.green }}> · saving…</span>}
        </div>
        {rate.note && (
          <div style={{
            fontSize: '0.68rem', marginTop: '0.2rem', lineHeight: 1.45,
            color: mismatch ? C.yellow : C.lightBrown,
          }}>
            {mismatch ? '⚠ ' : ''}{rate.note}
          </div>
        )}
      </div>

      <div style={{ opacity: dim ? 0.45 : 1 }}>
        <input
          value={value} onChange={e => setValue(e.target.value)}
          onBlur={commitRate}
          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
          inputMode="decimal"
          aria-label={`${rate.label} rate`}
          style={{ ...INPUT, textAlign: 'right', padding: '0.4rem 0.5rem' }}
        />
      </div>

      <div style={{ opacity: dim ? 0.45 : 1 }}>
        {rate.cheese_rate == null && !/brotwurst|summer|sticks/.test(rate.key) ? (
          <div style={{ fontSize: '0.75rem', color: C.lightBrown, textAlign: 'right' }}>—</div>
        ) : (
          <input
            value={cheese} onChange={e => setCheese(e.target.value)}
            onBlur={commitCheese}
            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
            inputMode="decimal" placeholder="—"
            aria-label={`${rate.label} with cheese rate`}
            style={{ ...INPUT, textAlign: 'right', padding: '0.4rem 0.5rem' }}
          />
        )}
      </div>

      <div style={{ fontSize: '0.72rem', color: rate.qbo_item_name ? C.lightBrown : C.yellow, opacity: dim ? 0.45 : 1 }}>
        {rate.qbo_item_name ?? 'no QuickBooks item'}
      </div>

      <div>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', fontSize: '0.75rem', color: C.tan }}>
          <input
            type="checkbox" checked={rate.active}
            onChange={() => onSave(rate.key, { active: !rate.active })}
            aria-label={`${rate.label} offered`}
            style={{ width: 15, height: 15, accentColor: C.green, cursor: 'pointer' }}
          />
          {rate.active ? 'on' : 'off'}
        </label>
      </div>

      <div style={{
        gridColumn: '1 / -1', height: 1, background: 'rgba(166,120,90,0.15)', margin: '0.15rem 0',
      }} />
    </>
  )
}
