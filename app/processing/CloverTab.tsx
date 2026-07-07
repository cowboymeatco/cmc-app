'use client'

import { useEffect, useState, useCallback } from 'react'

// Clover sync tab: link PLUs to Clover items (human-confirmed, name-suggested),
// then push app prices/names -> Clover. App is the master; Clover pull only
// seeds retail_price once at link time.

const C = {
  dark:       '#1A0A04',
  medBrown:   '#75471B',
  lightBrown: '#A6785A',
  tan:        '#C9A882',
  cream:      '#F2E8D9',
  green:      '#4CAF50',
  red:        '#E53E3E',
  yellow:     '#D97706',
  blue:       '#3B82F6',
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
  is_retail: boolean
  clover_item_id: string
}
interface CloverLite { id: string; name: string; price: number; priceType: string }
interface LinksData {
  linked: { plu: PluLite; clover: CloverLite | null }[]
  suggestions: { plu: PluLite; clover: CloverLite; confidence: string }[]
  unmatched: PluLite[]
  unclaimedClover: CloverLite[]
}
interface Change {
  key: string
  pluId: string; pluNumber: string; itemName: string
  cloverItemId: string; cloverName: string
  field: 'price' | 'name' | 'code'; from: string; to: string
}

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`

export default function CloverTab() {
  const [data, setData] = useState<LinksData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null) // pluId being linked
  const [seedPrice, setSeedPrice] = useState(true)

  // manual link picker
  const [pickerFor, setPickerFor] = useState<PluLite | null>(null)
  const [pickerSearch, setPickerSearch] = useState('')

  // push panel
  const [diff, setDiff] = useState<{ changes: Change[]; skipped: string[] } | null>(null)
  const [diffLoading, setDiffLoading] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [pushNames, setPushNames] = useState(false)
  const [pushing, setPushing] = useState(false)
  const [pushResult, setPushResult] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/clover/links')
      const json = await res.json()
      if (!res.ok || json.error) throw new Error(json.error ?? 'Load failed')
      setData(json)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function link(plu: PluLite, cloverItemId: string) {
    setBusy(plu.id)
    try {
      const res = await fetch('/api/clover/links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pluId: plu.id, cloverItemId, seedPrice }),
      })
      const json = await res.json()
      if (!res.ok || json.error) throw new Error(json.error ?? 'Link failed')
      setPickerFor(null)
      setPickerSearch('')
      await load()
      setDiff(null) // stale after a link
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
    setBusy(null)
  }

  async function unlink(plu: PluLite) {
    if (!confirm(`Unlink ${plu.item_name} from Clover?`)) return
    setBusy(plu.id)
    await fetch(`/api/clover/links?pluId=${plu.id}`, { method: 'DELETE' })
    await load()
    setDiff(null)
    setBusy(null)
  }

  async function runDryRun() {
    setDiffLoading(true)
    setPushResult(null)
    try {
      const res = await fetch('/api/clover/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun: true }),
      })
      const json = await res.json()
      if (!res.ok || json.error) throw new Error(json.error ?? 'Dry run failed')
      setDiff(json)
      // price + code changes default-selected; names stay behind their opt-in
      setSelected(new Set(json.changes.filter((c: Change) => c.field !== 'name').map((c: Change) => c.key)))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
    setDiffLoading(false)
  }

  async function push() {
    if (!diff) return
    const count = diff.changes.filter(c => selected.has(c.key) && (c.field !== 'name' || pushNames)).length
    if (count === 0) return
    if (!confirm(`Push ${count} change(s) to the LIVE Clover register?`)) return
    setPushing(true)
    setPushResult(null)
    try {
      const res = await fetch('/api/clover/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun: false, keys: [...selected], pushNames }),
      })
      const json = await res.json()
      if (!res.ok || json.error) throw new Error(json.error ?? 'Push failed')
      setPushResult(`Pushed ${json.pushed} change(s)${json.failed ? `, ${json.failed} FAILED — see push log` : ''}.${json.logWarning ? ` ⚠ ${json.logWarning}` : ''}`)
      await runDryRun()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
    setPushing(false)
  }

  if (loading && !data) return <div style={{ color: C.lightBrown, padding: '2rem' }}>Loading Clover catalog…</div>

  const pickerMatches = pickerFor && data
    ? data.unclaimedClover
        .filter(c => c.name.toUpperCase().includes(pickerSearch.toUpperCase()))
        .slice(0, 12)
    : []

  return (
    <div>
      {error && (
        <div style={{ ...CARD, borderColor: C.red, color: C.red, fontSize: '0.85rem' }}>
          {error} <button onClick={() => { setError(null); load() }} style={{ ...BTN('transparent', C.red), border: `1px solid ${C.red}`, marginLeft: '1rem', padding: '0.2rem 0.6rem' }}>Retry</button>
        </div>
      )}

      {/* ── Push panel ─────────────────────────────────────────────── */}
      <div style={CARD}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
          <div>
            <div style={{ color: C.tan, fontWeight: 700, fontSize: '0.95rem' }}>Push to Clover</div>
            <div style={{ color: C.lightBrown, fontSize: '0.78rem' }}>
              Preview is always a dry run — nothing touches the register until you hit Push.
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
            <label style={{ color: C.lightBrown, fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer' }}>
              <input type="checkbox" checked={pushNames} onChange={e => setPushNames(e.target.checked)} />
              also push names (ALL CAPS)
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
              <div style={{ color: C.green, fontSize: '0.85rem', padding: '0.5rem 0' }}>✓ Clover matches the app — nothing to push.</div>
            ) : (
              <>
                <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '0.5rem' }}>
                  <thead><tr>
                    <th style={TH}></th><th style={TH}>PLU</th><th style={TH}>Item</th>
                    <th style={TH}>Field</th><th style={TH}>Clover now</th><th style={TH}>Will become</th>
                  </tr></thead>
                  <tbody>
                    {diff.changes.map(ch => {
                      const inactive = ch.field === 'name' && !pushNames
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
                          <td style={TD}>{ch.itemName}</td>
                          <td style={{ ...TD, color: ch.field === 'price' ? C.tan : ch.field === 'code' ? C.blue : C.yellow }}>
                            {ch.field === 'code' && ch.to === '' ? 'code (clear stale)' : ch.field}
                          </td>
                          <td style={{ ...TD, color: C.red, fontFamily: ch.field === 'code' ? 'monospace' : undefined }}>{ch.from}</td>
                          <td style={{ ...TD, color: C.green, fontFamily: ch.field === 'code' ? 'monospace' : undefined }}>{ch.to === '' ? '(cleared)' : ch.to}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.75rem' }}>
                  <button onClick={push} disabled={pushing} style={BTN(C.green)}>
                    {pushing ? 'Pushing…' : `Push ${diff.changes.filter(c => selected.has(c.key) && (c.field !== 'name' || pushNames)).length} Change(s) to Clover`}
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

      {/* ── Suggested links ────────────────────────────────────────── */}
      {data && data.suggestions.length > 0 && (
        <div style={CARD}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <div style={{ color: C.tan, fontWeight: 700, fontSize: '0.95rem' }}>
              Suggested Links <span style={{ color: C.lightBrown, fontWeight: 400 }}>({data.suggestions.length} exact name matches)</span>
            </div>
            <label style={{ color: C.lightBrown, fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer' }}>
              <input type="checkbox" checked={seedPrice} onChange={e => setSeedPrice(e.target.checked)} />
              copy Clover price into app when app has none
            </label>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={TH}>PLU</th><th style={TH}>App Item</th><th style={TH}>App Retail</th>
              <th style={TH}>Clover Item</th><th style={TH}>Clover Price</th><th style={TH}></th>
            </tr></thead>
            <tbody>
              {data.suggestions.map(({ plu, clover }) => (
                <tr key={plu.id}>
                  <td style={{ ...TD, fontFamily: 'monospace', color: C.lightBrown }}>{plu.plu_number}</td>
                  <td style={TD}>{plu.item_name}</td>
                  <td style={TD}>{plu.retail_price != null ? `$${plu.retail_price.toFixed(2)}` : '—'}</td>
                  <td style={TD}>{clover.name}</td>
                  <td style={TD}>{dollars(clover.price)}</td>
                  <td style={{ ...TD, textAlign: 'right' }}>
                    <button onClick={() => link(plu, clover.id)} disabled={busy === plu.id}
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
            <div style={{ color: C.lightBrown, fontSize: '0.83rem' }}>No PLUs linked to Clover yet — confirm some suggestions above.</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={TH}>PLU</th><th style={TH}>App Item</th><th style={TH}>App Retail</th>
                <th style={TH}>Clover Item</th><th style={TH}>Clover Price</th><th style={TH}></th>
              </tr></thead>
              <tbody>
                {data.linked.map(({ plu, clover }) => {
                  const drift = clover && plu.retail_price != null && Math.round(plu.retail_price * 100) !== clover.price
                  return (
                    <tr key={plu.id}>
                      <td style={{ ...TD, fontFamily: 'monospace', color: C.lightBrown }}>{plu.plu_number}</td>
                      <td style={TD}>{plu.item_name}</td>
                      <td style={{ ...TD, color: drift ? C.yellow : C.cream }}>{plu.retail_price != null ? `$${plu.retail_price.toFixed(2)}` : '—'}</td>
                      <td style={TD}>{clover ? clover.name : <span style={{ color: C.red }}>⚠ deleted in Clover</span>}</td>
                      <td style={{ ...TD, color: drift ? C.yellow : C.cream }}>{clover ? dollars(clover.price) : '—'}</td>
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
            Not in Clover <span style={{ color: C.lightBrown, fontWeight: 400 }}>({data.unmatched.length} PLUs with no name match — link manually or ignore)</span>
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
                placeholder="Search Clover items…"
                style={{
                  width: '100%', maxWidth: 420, background: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(166,120,90,0.35)', borderRadius: 3,
                  padding: '0.45rem 0.7rem', color: C.cream, fontSize: '0.85rem', outline: 'none',
                }}
              />
              <div style={{ marginTop: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.25rem', maxWidth: 560 }}>
                {pickerMatches.map(c => (
                  <button key={c.id} onClick={() => link(pickerFor, c.id)} disabled={busy === pickerFor.id}
                    style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(166,120,90,0.25)',
                      borderRadius: 3, color: C.cream, padding: '0.4rem 0.7rem', fontSize: '0.8rem', cursor: 'pointer',
                    }}>
                    <span>{c.name}</span>
                    <span style={{ color: C.tan, fontFamily: 'monospace' }}>{dollars(c.price)}</span>
                  </button>
                ))}
                {pickerMatches.length === 0 && <div style={{ color: C.lightBrown, fontSize: '0.78rem' }}>No unlinked Clover items match.</div>}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
