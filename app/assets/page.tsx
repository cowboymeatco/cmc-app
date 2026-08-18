'use client'
import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { isoDate } from '@/lib/dates'
import {
  bookValue, serviceDueInDays, money,
  CATEGORY_LABEL, STATUS_LABEL,
  type Asset, type AssetCategory, type AssetStatus, type Coverage,
} from '@/lib/assets'

// The asset register.
//
// One row per physical thing, carrying what it cost, where it lives, whether
// it's running, and when it was last serviced. The same record the cleaning
// module hangs teardown procedures on.
//
// The panel at the top is the point of the page: it compares what the register
// can name against the fixed-asset balances in QuickBooks, so the gap is a
// number rather than a feeling.

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
  blue:       '#60A5FA',
}

interface AssetRow extends Asset {
  cleaning_areas?: { id: string; name: string } | null
}

interface Payload {
  assets: AssetRow[]
  coverage: Coverage | null
  books_available: boolean
}

export default function AssetRegister() {
  const [data,  setData]  = useState<Payload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const today = isoDate()

  const load = useCallback(() => {
    fetch('/api/assets')
      .then(r => r.json().then(b => ({ ok: r.ok, b })))
      .then(({ ok, b }) => { if (!ok) setError(b?.error ?? 'Could not load the register.'); else setData(b) })
      .catch(() => setError('No connection.'))
  }, [])

  useEffect(() => { load() }, [load])

  if (error) return <Shell><Banner tone="error">{error}</Banner></Shell>
  if (!data) return <Shell><p style={{ color: C.tan }}>Loading…</p></Shell>

  const cov = data.coverage

  return (
    <Shell>
      {/* What the books say vs what we can name */}
      {cov && (
        <div style={card}>
          <div style={{ color: C.cream, fontSize: 17, fontWeight: 700, marginBottom: 4 }}>
            What we can account for
          </div>
          <div style={{ color: C.tan, fontSize: 13, marginBottom: 14 }}>
            Register against the fixed-asset accounts in QuickBooks
          </div>

          <div style={{ height: 12, background: C.dark, borderRadius: 6, overflow: 'hidden', marginBottom: 10 }}>
            <div style={{
              width: `${Math.min(100, cov.pct)}%`, height: '100%',
              background: cov.pct < 50 ? C.amber : C.green, transition: 'width .3s',
            }} />
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20 }}>
            <Figure label="Named here"        value={money(cov.registerNamed)} tone={C.green} />
            <Figure label="Not accounted for" value={money(cov.unaccounted)}   tone={C.amber} />
            <Figure label="On the books"      value={money(cov.booksGross)}    tone={C.cream} />
            <Figure label="Covered"           value={`${cov.pct}%`}            tone={C.blue} />
          </div>

          {cov.unaccounted > 0 && (
            <div style={{
              marginTop: 14, paddingTop: 12, borderTop: `1px solid ${C.medBrown}`,
              color: C.tan, fontSize: 13, lineHeight: 1.6,
            }}>
              {money(cov.unaccounted)}{' '}of fixed assets sits in pooled QuickBooks accounts
              with no individual item behind it. QuickBooks can say what it&apos;s worth in
              total but not what it <em>is</em>.
              {/* Said plainly, because the bar does not move during a walk and
                  that would otherwise read as the walk having achieved
                  nothing. */}
              <div style={{ marginTop: 8 }}>
                Closing it is two jobs: <strong style={{ color: C.cream }}>walk the plant</strong> to
                get the list of what exists, then <strong style={{ color: C.cream }}>assign value</strong> out
                of the pooled accounts. Only the second moves this bar.
              </div>
              {cov.awaitingCost > 0 && (
                <div style={{ marginTop: 8, color: C.amber }}>
                  {cov.awaitingCost} captured{' '}
                  {cov.awaitingCost === 1 ? 'asset is' : 'assets are'} waiting for a value.
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {!data.books_available && (
        <Banner tone="warn">
          Couldn&apos;t reach QuickBooks, so this is the register on its own — it can&apos;t
          tell you what it&apos;s missing right now.
        </Banner>
      )}

      {/* The walk is the way the gap above actually closes, so it's the
          primary action on this page rather than a link in a menu. */}
      <Link href="/assets/walk" style={{ textDecoration: 'none' }}>
        <div style={{
          marginTop: 16, minHeight: 56, borderRadius: 10, background: C.medBrown,
          color: C.cream, display: 'flex', alignItems: 'center', justifyContent: 'center',
          gap: 8, fontSize: 16, fontWeight: 700,
        }}>
          🚶 Start a plant walk
        </div>
      </Link>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', margin: '22px 0 10px' }}>
        <span style={{ color: C.cream, fontSize: 16, fontWeight: 700 }}>
          {data.assets.length} asset{data.assets.length === 1 ? '' : 's'}
        </span>
        <Link href="/cleaning/map" style={{ color: C.amber, fontSize: 13 }}>See them on the map ›</Link>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {data.assets.map(a => {
          const book = bookValue(a, today)
          const due  = serviceDueInDays(a, today)
          return (
            <div key={a.id} style={{ ...card, borderColor: a.status === 'down' ? C.red : C.medBrown }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: C.cream, fontSize: 16, fontWeight: 700 }}>{a.name}</div>
                  <div style={{ color: C.tan, fontSize: 12, marginTop: 2 }}>
                    {[a.make, a.model, a.serial_number && `s/n ${a.serial_number}`]
                      .filter(Boolean).join(' · ') || CATEGORY_LABEL[a.category as AssetCategory]}
                  </div>

                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                    {/* A room is what connects an asset to a cleaning list, so
                        its absence is called out rather than left blank. */}
                    {a.cleaning_areas?.name
                      ? <Chip tone={C.tan}>{a.cleaning_areas.name}</Chip>
                      : <Chip tone={C.amber}>no room set</Chip>}
                    {a.status !== 'in_service' && (
                      <Chip tone={a.status === 'down' ? C.red : C.lightBrown}>
                        {STATUS_LABEL[a.status as AssetStatus]}
                      </Chip>
                    )}
                    {a.qbo_account_name && <Chip tone={C.blue}>itemised in QuickBooks</Chip>}
                    {due !== null && (
                      <Chip tone={due < 0 ? C.red : due < 14 ? C.amber : C.lightBrown}>
                        {due < 0 ? `service ${-due}d overdue` : `service in ${due}d`}
                      </Chip>
                    )}
                  </div>
                </div>

                <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <div style={{ color: C.cream, fontSize: 16, fontWeight: 700 }}>
                    {money(a.purchase_cost)}
                  </div>
                  <div style={{ color: C.lightBrown, fontSize: 11 }}>cost</div>
                  {book !== null && (
                    <>
                      <div style={{ color: C.tan, fontSize: 13, marginTop: 6 }}>{money(book)}</div>
                      {/* Labelled as ours, because QuickBooks holds only one
                          pooled depreciation account and cannot produce this. */}
                      <div style={{ color: C.lightBrown, fontSize: 11 }}>our estimate</div>
                    </>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {data.assets.length === 0 && (
        <div style={{ ...card, textAlign: 'center', color: C.tan }}>
          Nothing in the register yet.
        </div>
      )}
    </Shell>
  )
}

// ── bits ────────────────────────────────────────────────────────────────

const card: React.CSSProperties = {
  background: C.darkBrown, border: `1px solid ${C.medBrown}`,
  borderRadius: 12, padding: 16,
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ paddingBottom: 60 }}>
      <header style={{
        background: C.dark, borderBottom: `1px solid ${C.medBrown}`,
        padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12,
        position: 'sticky', top: 0, zIndex: 50,
      }}>
        <Link href="/" style={{ color: C.tan, fontSize: 26, textDecoration: 'none', lineHeight: 1, padding: '4px 8px 8px 0' }}>‹</Link>
        <h1 style={{ color: C.cream, fontSize: 18, fontWeight: 700, margin: 0 }}>Assets</h1>
      </header>
      <div style={{ padding: 16, maxWidth: 860, margin: '0 auto' }}>{children}</div>
    </div>
  )
}

function Figure({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div>
      <div style={{ color: tone, fontSize: 20, fontWeight: 700 }}>{value}</div>
      <div style={{ color: C.lightBrown, fontSize: 12 }}>{label}</div>
    </div>
  )
}

function Chip({ children, tone }: { children: React.ReactNode; tone: string }) {
  return (
    <span style={{
      fontSize: 11, color: tone, border: `1px solid ${tone}`,
      borderRadius: 4, padding: '1px 6px', whiteSpace: 'nowrap',
    }}>
      {children}
    </span>
  )
}

function Banner({ tone, children }: { tone: 'error' | 'warn'; children: React.ReactNode }) {
  const color = tone === 'error' ? C.red : C.amber
  return (
    <div style={{
      background: `${color}22`, border: `1px solid ${color}`, borderRadius: 8,
      padding: '10px 14px', color: C.cream, fontSize: 14, marginBottom: 14,
    }}>
      {children}
    </div>
  )
}
