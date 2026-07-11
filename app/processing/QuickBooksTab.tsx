'use client'

import { useEffect, useState, useCallback } from 'react'

// QuickBooks tab: link PLUs to QBO Products & Services (human-confirmed,
// name-suggested) — same pattern as the Clover tab. The QBO catalog is a
// cached snapshot in qbo_items (the app has no QBO OAuth yet); prices shown
// are for reference. Push app -> QuickBooks comes later.

const C = {
  dark:       '#1A0A04',
  medBrown:   '#75471B',
  lightBrown: '#A6785A',
  tan:        '#C9A882',
  cream:      '#F2E8D9',
  green:      '#4CAF50',
  red:        '#E53E3E',
  yellow:     '#D97706',
}
const BTN = (bg: string, color = C.dark): React.CSSProperties => ({
  background: bg, color, border: 'none', borderRadius: 3,
  padding: '0.5rem 1.1rem', fontSize: '0.83rem', fontWeight: 600,
  cursor: 'pointer', letterSpacing: '0.04em',
})
const CARD: React.CSSProperties = {
  background: C.dark, border: '1px solid rgba(166,120,90,0.25)',
  borderRadius: 4, padding: '1rem 1.25rem', marginBottom: '1rem',
}
const TH: React.CSSProperties = {
  textAlign: 'left', fontSize: '0.7rem', color: C.lightBrown, textTransform: 'uppercase',
  letterSpacing: '0.1em', padding: '0.4rem 0.6rem', borderBottom: '1px solid rgba(166,120,90,0.25)',
}
const TD: React.CSSProperties = {
  padding: '0.45rem 0.6rem', fontSize: '0.83rem', color: C.cream,
  borderBottom: '1px solid rgba(166,120,90,0.12)',
}

interface PluLite {
  id: string
  plu_number: string
  item_name: string
  retail_price: number | null
  quickbooks_item_id: string
}
interface QboLite {
  qbo_id: string
  full_name: string
  name: string
  type: string | null
  sales_price: number | null
  active: boolean
}
interface LinksData {
  linked: { plu: PluLite; qbo: QboLite | null }[]
  suggestions: { plu: PluLite; qbo: QboLite; confidence: string }[]
  unmatched: PluLite[]
  unclaimedQbo: QboLite[]
  syncedAt: string | null
}
interface QboStatus {
  configured: boolean
  connected: boolean
  realmId: string | null
  refreshExpiresAt: string | null
}
interface Change {
  key: string
  pluId: string | null
  pluNumber: string
  itemName: string
  qboItemId: string
  qboName: string
  field: 'price' | 'name'
  from: string
  to: string
  sweep: boolean
}

const money = (v: number | null) => (v != null ? `$${v.toFixed(2)}` : '—')
// 'RETAIL SALES:RETAIL CUTS:Beef Trim' -> 'RETAIL SALES : RETAIL CUTS' for the group column
const groupOf = (fullName: string) => fullName.split(':').slice(0, -1).join(' : ') || '—'

export default function QuickBooksTab() {
  const [data, setData] = useState<LinksData | null>(null)
  const [status, setStatus] = useState<QboStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null) // pluId being linked
  const [oauthMsg, setOauthMsg] = useState<string | null>(null)

  // manual link picker
  const [pickerFor, setPickerFor] = useState<PluLite | null>(null)
  const [pickerSearch, setPickerSearch] = useState('')

  // push panel
  const [diff, setDiff] = useState<{ changes: Change[]; skipped: string[] } | null>(null)
  const [diffLoading, setDiffLoading] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [pushNames, setPushNames] = useState(false)
  const [includeSweep, setIncludeSweep] = useState(false)
  const [pushing, setPushing] = useState(false)
  const [pushResult, setPushResult] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [linksRes, statusRes] = await Promise.all([fetch('/api/qbo/links'), fetch('/api/qbo/status')])
      const json = await linksRes.json()
      if (!linksRes.ok || json.error) throw new Error(json.error ?? 'Load failed')
      setData(json)
      const st = await statusRes.json()
      if (statusRes.ok && !st.error) setStatus(st)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  // One-time banner after the OAuth redirect lands back on /processing?qbo=…
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const qbo = params.get('qbo')
    if (!qbo) return
    setOauthMsg(qbo === 'connected'
      ? '✓ QuickBooks connected.'
      : `QuickBooks connection failed (${params.get('reason') ?? 'unknown'}) — try again.`)
    window.history.replaceState(null, '', '/processing')
  }, [])

  async function link(plu: PluLite, qboId: string) {
    setBusy(plu.id)
    try {
      const res = await fetch('/api/qbo/links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pluId: plu.id, qboId }),
      })
      const json = await res.json()
      if (!res.ok || json.error) throw new Error(json.error ?? 'Link failed')
      setPickerFor(null)
      setPickerSearch('')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
    setBusy(null)
  }

  async function unlink(plu: PluLite) {
    if (!confirm(`Unlink ${plu.item_name} from QuickBooks?`)) return
    setBusy(plu.id)
    await fetch(`/api/qbo/links?pluId=${plu.id}`, { method: 'DELETE' })
    await load()
    setDiff(null)
    setBusy(null)
  }

  async function refreshCatalog() {
    setRefreshing(true)
    setPushResult(null)
    try {
      const res = await fetch('/api/qbo/refresh', { method: 'POST' })
      const json = await res.json()
      if (!res.ok || json.error) throw new Error(json.error ?? 'Refresh failed')
      setPushResult(`Catalog refreshed from QuickBooks: ${json.total} items (${json.active} active).`)
      await load()
      setDiff(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
    setRefreshing(false)
  }

  async function runDryRun() {
    setDiffLoading(true)
    setPushResult(null)
    try {
      const res = await fetch('/api/qbo/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun: true }),
      })
      const json = await res.json()
      if (!res.ok || json.error) throw new Error(json.error ?? 'Dry run failed')
      setDiff(json)
      // prices default-selected; names wait for their opt-ins
      setSelected(new Set(json.changes.filter((c: Change) => c.field === 'price').map((c: Change) => c.key)))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
    setDiffLoading(false)
  }

  function pushableCount() {
    if (!diff) return 0
    return diff.changes.filter(c =>
      (c.field === 'price' && selected.has(c.key))
      || (c.field === 'name' && pushNames && (!c.sweep || includeSweep) && selected.has(c.key))
    ).length
  }

  async function push() {
    if (!diff) return
    const active = diff.changes.filter(c =>
      (c.field === 'price' && selected.has(c.key))
      || (c.field === 'name' && pushNames && (!c.sweep || includeSweep) && selected.has(c.key)))
    if (active.length === 0) return
    if (!confirm(`Push ${active.length} change(s) to the LIVE QuickBooks catalog?`)) return
    setPushing(true)
    setPushResult(null)
    try {
      const res = await fetch('/api/qbo/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun: false, keys: active.map(c => c.key), pushNames }),
      })
      const json = await res.json()
      if (!res.ok || json.error) throw new Error(json.error ?? 'Push failed')
      setPushResult(`Pushed ${json.pushed} change(s)${json.failed ? `, ${json.failed} FAILED — see push log` : ''}.${json.logWarning ? ` ⚠ ${json.logWarning}` : ''}`)
      await load()
      await runDryRun()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
    setPushing(false)
  }

  if (loading && !data) return <div style={{ color: C.lightBrown, padding: '2rem' }}>Loading QuickBooks catalog…</div>

  const pickerMatches = pickerFor && data
    ? data.unclaimedQbo
        .filter(q => q.full_name.toUpperCase().includes(pickerSearch.toUpperCase()))
        .slice(0, 12)
    : []

  return (
    <div>
      {error && (
        <div style={{ ...CARD, borderColor: C.red, color: C.red, fontSize: '0.85rem' }}>
          {error} <button onClick={() => { setError(null); load() }} style={{ ...BTN('transparent', C.red), border: `1px solid ${C.red}`, marginLeft: '1rem', padding: '0.2rem 0.6rem' }}>Retry</button>
        </div>
      )}

      {/* ── Catalog status ─────────────────────────────────────────── */}
      {data && (
        <div style={{ ...CARD, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ color: C.tan, fontWeight: 700, fontSize: '0.95rem' }}>QuickBooks Products &amp; Services</div>
            <div style={{ color: C.lightBrown, fontSize: '0.78rem' }}>
              Catalog snapshot cached from QuickBooks
              {data.syncedAt ? ` — last refreshed ${new Date(data.syncedAt).toLocaleDateString()}` : ''}.
              Prices shown are QuickBooks&apos; and are reference-only; the app stays the source of truth.
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.4rem' }}>
            <div style={{ color: C.lightBrown, fontSize: '0.78rem', textAlign: 'right' }}>
              {data.linked.length} linked · {data.suggestions.length} suggested · {data.unclaimedQbo.length} unclaimed QBO items
            </div>
            {status && (
              status.connected ? (
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                  <span style={{ color: C.green, fontSize: '0.78rem' }}>✓ Connected to QuickBooks</span>
                  <button onClick={refreshCatalog} disabled={refreshing}
                    style={{ ...BTN(C.tan), padding: '0.3rem 0.8rem', fontSize: '0.74rem' }}>
                    {refreshing ? 'Refreshing…' : '⟳ Refresh Catalog'}
                  </button>
                </span>
              ) : status.configured ? (
                <a href="/api/qbo/oauth/start" style={{ ...BTN(C.green), textDecoration: 'none', padding: '0.35rem 0.9rem', fontSize: '0.78rem' }}>
                  Connect QuickBooks
                </a>
              ) : (
                <span style={{ color: C.lightBrown, fontSize: '0.75rem' }}>Live connection not set up (app keys pending)</span>
              )
            )}
          </div>
        </div>
      )}

      {oauthMsg && (
        <div style={{ ...CARD, color: oauthMsg.startsWith('✓') ? C.green : C.red, fontSize: '0.85rem' }}>{oauthMsg}</div>
      )}

      {/* ── Push panel ─────────────────────────────────────────────── */}
      {status?.connected && (
        <div style={CARD}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem', flexWrap: 'wrap', gap: '0.5rem' }}>
            <div>
              <div style={{ color: C.tan, fontWeight: 700, fontSize: '0.95rem' }}>Push to QuickBooks</div>
              <div style={{ color: C.lightBrown, fontSize: '0.78rem' }}>
                Preview is always a dry run — nothing touches QuickBooks until you hit Push.
              </div>
            </div>
            <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <label style={{ color: C.lightBrown, fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer' }}>
                <input type="checkbox" checked={pushNames} onChange={e => setPushNames(e.target.checked)} />
                also push names (ALL CAPS)
              </label>
              <label style={{ color: C.lightBrown, fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '0.3rem', cursor: pushNames ? 'pointer' : 'not-allowed', opacity: pushNames ? 1 : 0.4 }}>
                <input type="checkbox" disabled={!pushNames} checked={includeSweep} onChange={e => setIncludeSweep(e.target.checked)} />
                include unlinked QB items (full ALL-CAPS sweep)
              </label>
              <button onClick={runDryRun} disabled={diffLoading} style={BTN(C.tan)}>
                {diffLoading ? 'Comparing…' : 'Preview Changes'}
              </button>
            </div>
          </div>

          {pushResult && <div style={{ color: C.green, fontSize: '0.85rem', margin: '0.5rem 0' }}>{pushResult}</div>}

          {diff && (
            <>
              {diff.changes.length === 0 ? (
                <div style={{ color: C.green, fontSize: '0.85rem', padding: '0.5rem 0' }}>✓ QuickBooks matches the app — nothing to push.</div>
              ) : (
                <>
                  <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '0.5rem' }}>
                    <thead><tr>
                      <th style={TH}></th><th style={TH}>PLU</th><th style={TH}>Item</th>
                      <th style={TH}>Field</th><th style={TH}>QuickBooks now</th><th style={TH}>Will become</th>
                    </tr></thead>
                    <tbody>
                      {diff.changes.map(ch => {
                        const inactive = ch.field === 'name' && (!pushNames || (ch.sweep && !includeSweep))
                        return (
                          <tr key={ch.key} style={{ opacity: inactive ? 0.35 : 1 }}>
                            <td style={TD}>
                              <input
                                type="checkbox"
                                disabled={inactive}
                                checked={selected.has(ch.key) && !inactive}
                                onChange={e => setSelected(prev => {
                                  const next = new Set(prev)
                                  if (e.target.checked) next.add(ch.key); else next.delete(ch.key)
                                  return next
                                })}
                              />
                            </td>
                            <td style={{ ...TD, fontFamily: 'monospace', color: C.lightBrown }}>{ch.pluNumber}</td>
                            <td style={TD}>{ch.itemName}{ch.sweep && <span style={{ color: C.lightBrown, fontSize: '0.7rem' }}> (sweep)</span>}</td>
                            <td style={{ ...TD, color: ch.field === 'price' ? C.tan : C.yellow }}>{ch.field}</td>
                            <td style={{ ...TD, color: C.red }}>{ch.from}</td>
                            <td style={{ ...TD, color: C.green }}>{ch.to}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.75rem' }}>
                    <button onClick={push} disabled={pushing || pushableCount() === 0} style={BTN(C.green)}>
                      {pushing ? 'Pushing…' : `Push ${pushableCount()} Change(s) to QuickBooks`}
                    </button>
                  </div>
                </>
              )}
              {diff.skipped.length > 0 && (
                <details style={{ marginTop: '0.6rem' }}>
                  <summary style={{ color: C.lightBrown, fontSize: '0.78rem', cursor: 'pointer' }}>
                    {diff.skipped.length} linked item(s) skipped
                  </summary>
                  <ul style={{ color: C.lightBrown, fontSize: '0.78rem', margin: '0.4rem 0 0 1rem' }}>
                    {diff.skipped.map((s, i) => <li key={i}>{s}</li>)}
                  </ul>
                </details>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Suggested links ────────────────────────────────────────── */}
      {data && data.suggestions.length > 0 && (
        <div style={CARD}>
          <div style={{ color: C.tan, fontWeight: 700, fontSize: '0.95rem', marginBottom: '0.5rem' }}>
            Suggested Links <span style={{ color: C.lightBrown, fontWeight: 400 }}>({data.suggestions.length} exact name matches)</span>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={TH}>PLU</th><th style={TH}>App Item</th><th style={TH}>App Retail</th>
              <th style={TH}>QuickBooks Item</th><th style={TH}>QB Group</th><th style={TH}>QB Price</th><th style={TH}></th>
            </tr></thead>
            <tbody>
              {data.suggestions.map(({ plu, qbo }) => (
                <tr key={plu.id}>
                  <td style={{ ...TD, fontFamily: 'monospace', color: C.lightBrown }}>{plu.plu_number}</td>
                  <td style={TD}>{plu.item_name}</td>
                  <td style={TD}>{money(plu.retail_price)}</td>
                  <td style={TD}>{qbo.name}</td>
                  <td style={{ ...TD, color: C.lightBrown, fontSize: '0.75rem' }}>{groupOf(qbo.full_name)}</td>
                  <td style={TD}>{money(qbo.sales_price)}</td>
                  <td style={{ ...TD, textAlign: 'right' }}>
                    <button onClick={() => link(plu, qbo.qbo_id)} disabled={busy === plu.id}
                      style={{ ...BTN(C.green), padding: '0.3rem 0.8rem', fontSize: '0.76rem' }}>
                      {busy === plu.id ? '…' : 'Link'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Linked items ───────────────────────────────────────────── */}
      {data && (
        <div style={CARD}>
          <div style={{ color: C.tan, fontWeight: 700, fontSize: '0.95rem', marginBottom: '0.5rem' }}>
            Linked <span style={{ color: C.lightBrown, fontWeight: 400 }}>({data.linked.length})</span>
          </div>
          {data.linked.length === 0 ? (
            <div style={{ color: C.lightBrown, fontSize: '0.83rem' }}>No PLUs linked to QuickBooks yet — confirm some suggestions above.</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={TH}>PLU</th><th style={TH}>App Item</th><th style={TH}>App Retail</th>
                <th style={TH}>QuickBooks Item</th><th style={TH}>QB Price</th><th style={TH}></th>
              </tr></thead>
              <tbody>
                {data.linked.map(({ plu, qbo }) => {
                  const drift = qbo?.sales_price != null && plu.retail_price != null
                    && Math.round(plu.retail_price * 100) !== Math.round(qbo.sales_price * 100)
                  return (
                    <tr key={plu.id}>
                      <td style={{ ...TD, fontFamily: 'monospace', color: C.lightBrown }}>{plu.plu_number}</td>
                      <td style={TD}>{plu.item_name}</td>
                      <td style={{ ...TD, color: drift ? C.yellow : C.cream }}>{money(plu.retail_price)}</td>
                      <td style={TD}>
                        {qbo
                          ? <>{qbo.name}{!qbo.active && <span style={{ color: C.yellow, marginLeft: '0.4rem' }}>⚠ inactive in QB</span>}</>
                          : <span style={{ color: C.red }}>⚠ not in QB catalog</span>}
                      </td>
                      <td style={{ ...TD, color: drift ? C.yellow : C.cream }}>{qbo ? money(qbo.sales_price) : '—'}</td>
                      <td style={{ ...TD, textAlign: 'right' }}>
                        <button onClick={() => unlink(plu)} disabled={busy === plu.id}
                          style={{ ...BTN('transparent', C.red), border: `1px solid ${C.red}`, padding: '0.25rem 0.7rem', fontSize: '0.74rem', opacity: 0.75 }}>
                          Unlink
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── Unmatched PLUs (manual linking) ────────────────────────── */}
      {data && data.unmatched.length > 0 && (
        <div style={CARD}>
          <div style={{ color: C.tan, fontWeight: 700, fontSize: '0.95rem', marginBottom: '0.5rem' }}>
            Not in QuickBooks <span style={{ color: C.lightBrown, fontWeight: 400 }}>({data.unmatched.length} PLUs with no name match — link manually or ignore)</span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
            {data.unmatched.map(plu => (
              <button key={plu.id} onClick={() => { setPickerFor(plu); setPickerSearch(plu.item_name.split(' ')[0] ?? '') }}
                style={{
                  background: pickerFor?.id === plu.id ? C.medBrown : 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(166,120,90,0.3)', borderRadius: 3, color: C.cream,
                  padding: '0.25rem 0.6rem', fontSize: '0.75rem', cursor: 'pointer',
                }}>
                {plu.item_name}
              </button>
            ))}
          </div>

          {pickerFor && (
            <div style={{ marginTop: '0.85rem', borderTop: '1px solid rgba(166,120,90,0.2)', paddingTop: '0.75rem' }}>
              <div style={{ color: C.cream, fontSize: '0.85rem', marginBottom: '0.4rem' }}>
                Link <strong>{pickerFor.item_name}</strong> to:
                <button onClick={() => setPickerFor(null)} style={{ background: 'none', border: 'none', color: C.lightBrown, cursor: 'pointer', marginLeft: '0.6rem' }}>cancel</button>
              </div>
              <input
                autoFocus
                value={pickerSearch}
                onChange={e => setPickerSearch(e.target.value)}
                placeholder="Search QuickBooks items…"
                style={{
                  width: '100%', maxWidth: 420, background: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(166,120,90,0.35)', borderRadius: 3,
                  padding: '0.45rem 0.7rem', color: C.cream, fontSize: '0.85rem', outline: 'none',
                }}
              />
              <div style={{ marginTop: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.25rem', maxWidth: 640 }}>
                {pickerMatches.map(q => (
                  <button key={q.qbo_id} onClick={() => link(pickerFor, q.qbo_id)} disabled={busy === pickerFor.id}
                    style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(166,120,90,0.25)',
                      borderRadius: 3, color: C.cream, padding: '0.4rem 0.7rem', fontSize: '0.8rem', cursor: 'pointer',
                    }}>
                    <span>{q.name} <span style={{ color: C.lightBrown, fontSize: '0.72rem' }}>({groupOf(q.full_name)})</span></span>
                    <span style={{ color: C.tan, fontFamily: 'monospace' }}>{money(q.sales_price)}</span>
                  </button>
                ))}
                {pickerMatches.length === 0 && <div style={{ color: C.lightBrown, fontSize: '0.78rem' }}>No unlinked QuickBooks items match.</div>}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
