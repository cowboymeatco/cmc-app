'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'

// The price list — the app's master copy of every chargeable rate
// (Charlie, 2026-11-11: "App has to be master"). Billing prices charges from
// here; QuickBooks follows through the push panel at the bottom, which shows
// every difference and sends only what a person ticks and approves.
// See docs/invoicing-spec.md.

const C = {
  dark: '#1A0A04', medBrown: '#75471B', lightBrown: '#A6785A', tan: '#C9A882',
  cream: '#F2E8D9', green: '#4CAF50', red: '#E53E3E', yellow: '#D97706',
}
const CARD: React.CSSProperties = { background: C.dark, border: '1px solid rgba(166,120,90,0.25)', borderRadius: 4, padding: '1rem 1.25rem', marginBottom: '1rem' }
const TH: React.CSSProperties = { textAlign: 'left', fontSize: '0.7rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.1em', padding: '0.4rem 0.6rem', borderBottom: '1px solid rgba(166,120,90,0.25)' }
const TD: React.CSSProperties = { padding: '0.45rem 0.6rem', fontSize: '0.83rem', color: C.cream, borderBottom: '1px solid rgba(166,120,90,0.12)' }
const BTN = (bg: string, color = C.dark): React.CSSProperties => ({ background: bg, color, border: 'none', borderRadius: 3, padding: '0.45rem 1rem', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer' })
const INPUT: React.CSSProperties = { background: '#2a160b', color: C.cream, border: '1px solid rgba(166,120,90,0.4)', borderRadius: 3, padding: '0.35rem 0.5rem', fontSize: '0.83rem' }

interface Row {
  key: string; label: string; category: string; species: string | null; rate: number; unit: string
  qbo_item_id: string | null; qbo_item_name: string | null; auto: boolean; active: boolean
  updated_at: string; updated_by: string | null
}
interface Deal { id: string; qbo_customer_id: string; customer_name: string; price_key: string; rate: number; note: string | null }
interface PushChange { key: string; label: string; kind: 'link' | 'create' | 'price'; qboName: string; from: string; to: string }
interface QboCustomer { qbo_id: string; display_name: string }

const CATEGORY_LABEL: Record<string, string> = {
  processing: 'Kill & processing', curing: 'Curing', sausage: 'Sausage & patties (per finished lb)',
  smokehouse: 'Smokehouse (per raw lb in)', fee: 'Fees', cmc_animal: 'Our animals — all-in price', wild_game: 'Wild game',
}
const UNIT: Record<string, string> = {
  lb_hcw: '/ lb hanging', lb_in: '/ raw lb in', lb_out: '/ finished lb', lb_cured: '/ cured lb', lb: '/ lb',
  head: '/ head', flat: 'flat', day: '/ day', month: '/ month', hour: '/ hour', pkg: '/ pkg',
}
const money = (n: number) => `$${n.toFixed(n % 1 && Math.round(n * 100) !== n * 100 ? 4 : 2)}`

export default function PriceBookPage() {
  const [rows, setRows] = useState<Row[]>([])
  const [deals, setDeals] = useState<Deal[]>([])
  const [err, setErr] = useState('')
  const [who, setWho] = useState('')
  const [edit, setEdit] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState('')
  const [push, setPush] = useState<{ changes: PushChange[]; notes: string[] } | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [pushResult, setPushResult] = useState('')
  const [dealKey, setDealKey] = useState('')
  const [dealRate, setDealRate] = useState('')
  const [dealNote, setDealNote] = useState('')
  const [custSearch, setCustSearch] = useState('')
  const [custResults, setCustResults] = useState<QboCustomer[]>([])
  const [dealCust, setDealCust] = useState<QboCustomer | null>(null)

  useEffect(() => { try { if (who) localStorage.setItem('cmc_approver', who) } catch {} }, [who])

  const load = useCallback(async () => {
    const res = await fetch('/api/price-book')
    const json = await res.json()
    if (json.error) { setErr(json.error); return }
    setRows(json.rows); setDeals(json.deals); setErr('')
    // Remembered signer, per browser (a convenience only).
    try { const saved = localStorage.getItem('cmc_approver'); if (saved) setWho(w => w || saved) } catch {}
  }, [])
  useEffect(() => { const t = setTimeout(load, 0); return () => clearTimeout(t) }, [load])

  useEffect(() => {
    if (!custSearch.trim()) return
    const t = setTimeout(async () => {
      const res = await fetch(`/api/qbo/customers?search=${encodeURIComponent(custSearch)}`)
      const json = await res.json()
      setCustResults(json.results ?? [])
    }, 250)
    return () => clearTimeout(t)
  }, [custSearch])

  const grouped = useMemo(() => {
    const g = new Map<string, Row[]>()
    for (const r of rows) g.set(r.category, [...(g.get(r.category) ?? []), r])
    return [...g.entries()]
  }, [rows])
  const labelOf = (key: string) => rows.find(r => r.key === key)?.label ?? key

  async function post(url: string, body: Record<string, unknown>) {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const json = await res.json()
    if (!res.ok || json.error) throw new Error(json.error ?? `HTTP ${res.status}`)
    return json
  }
  const needWho = () => { if (!who.trim()) { setErr('Type your name at the top first — every change is signed.'); return true } return false }

  async function saveRate(key: string) {
    if (needWho()) return
    setBusy(key)
    try {
      await post('/api/price-book', { action: 'update', key, rate: Number(edit[key]), changedBy: who })
      setEdit(e => { const n = { ...e }; delete n[key]; return n })
      setPush(null)
      await load()
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setBusy('') }
  }

  async function toggleActive(r: Row) {
    if (needWho()) return
    setBusy(r.key)
    try { await post('/api/price-book', { action: 'update', key: r.key, active: !r.active, changedBy: who }); await load() }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setBusy('') }
  }

  async function addDeal() {
    if (needWho()) return
    if (!dealCust || !dealKey || dealRate === '') { setErr('Pick the customer, the charge and the rate'); return }
    setBusy('deal')
    try {
      await post('/api/price-book', { action: 'add_deal', qbo_customer_id: dealCust.qbo_id, customer_name: dealCust.display_name, price_key: dealKey, rate: Number(dealRate), note: dealNote, changedBy: who })
      setDealCust(null); setCustSearch(''); setDealRate(''); setDealNote('')
      await load()
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setBusy('') }
  }

  async function removeDeal(id: string) {
    if (needWho()) return
    setBusy(id)
    try { await post('/api/price-book', { action: 'remove_deal', id, changedBy: who }); await load() }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setBusy('') }
  }

  async function checkQbo() {
    setBusy('push'); setPushResult('')
    try {
      const json = await post('/api/price-book/push', { dryRun: true })
      setPush(json); setPicked(new Set())
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setBusy('') }
  }

  async function sendQbo() {
    if (needWho()) return
    if (!picked.size) return
    if (!confirm(`Send ${picked.size} change${picked.size === 1 ? '' : 's'} to QuickBooks, approved by ${who}?`)) return
    setBusy('push')
    try {
      const json = await post('/api/price-book/push', { dryRun: false, keys: [...picked], approvedBy: who })
      const errs = (json.results ?? []).filter((r: { status: string }) => r.status === 'error')
        .map((r: { label: string; error: string }) => `${r.label}: ${r.error}`)
      setPushResult(`Sent ${json.done}, failed ${json.failed}.${json.cacheWarning ? ' ' + json.cacheWarning : ''}${errs.length ? '\n' + errs.join('\n') : ''}`)
      await load(); await checkQbo()
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setBusy('') }
  }

  return (
    <div style={{ minHeight: '100vh', background: '#120703', color: C.cream, padding: '1.25rem 1rem', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1rem' }}>
          <div>
            <Link href="/billing" style={{ color: C.lightBrown, textDecoration: 'none', fontSize: '0.82rem' }}>← Billing</Link>
            <h1 style={{ margin: '0.25rem 0 0', fontSize: '1.4rem' }}>Price list</h1>
            <div style={{ fontSize: '0.8rem', color: C.tan }}>The master price list. Billing prices every charge from here; QuickBooks follows when you push.</div>
          </div>
          <label style={{ fontSize: '0.8rem', color: C.tan }}>
            Your name&nbsp;
            <input value={who} onChange={e => setWho(e.target.value)} placeholder="who is changing prices" style={INPUT} />
          </label>
        </div>

        {err && <div style={{ ...CARD, borderColor: C.red, color: C.red, whiteSpace: 'pre-wrap' }}>{err} <button onClick={() => setErr('')} style={{ ...BTN('transparent', C.red), padding: '0 0.5rem' }}>✕</button></div>}

        {grouped.map(([cat, rs]) => (
          <div key={cat} style={CARD}>
            <div style={{ fontWeight: 700, marginBottom: '0.5rem' }}>{CATEGORY_LABEL[cat] ?? cat}</div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={TH}>Charge</th><th style={TH}>Rate</th><th style={TH}>QuickBooks item</th><th style={TH}>How it&apos;s billed</th><th style={TH}></th></tr></thead>
                <tbody>
                  {rs.map(r => {
                    const editing = edit[r.key] !== undefined
                    const deal = deals.filter(d => d.price_key === r.key)
                    return (
                      <tr key={r.key} style={{ opacity: r.active ? 1 : 0.45 }}>
                        <td style={TD}>
                          {r.label}{r.species ? <span style={{ color: C.lightBrown }}> · {r.species}</span> : null}
                          {deal.length > 0 && <div style={{ fontSize: '0.72rem', color: C.yellow }}>{deal.length} customer deal{deal.length === 1 ? '' : 's'}</div>}
                        </td>
                        <td style={{ ...TD, whiteSpace: 'nowrap' }}>
                          {editing ? (
                            <>
                              $<input autoFocus value={edit[r.key]} onChange={e => setEdit(x => ({ ...x, [r.key]: e.target.value }))}
                                onKeyDown={e => { if (e.key === 'Enter') saveRate(r.key); if (e.key === 'Escape') setEdit(x => { const n = { ...x }; delete n[r.key]; return n }) }}
                                style={{ ...INPUT, width: 80 }} inputMode="decimal" />
                              <button disabled={busy === r.key} onClick={() => saveRate(r.key)} style={{ ...BTN(C.green), marginLeft: 6, padding: '0.3rem 0.6rem' }}>Save</button>
                            </>
                          ) : (
                            <button onClick={() => setEdit(x => ({ ...x, [r.key]: String(r.rate) }))} title="Change rate"
                              style={{ background: 'none', border: 'none', color: C.cream, fontFamily: 'monospace', fontSize: '0.9rem', cursor: 'pointer', padding: 0 }}>
                              {money(r.rate)} <span style={{ color: C.lightBrown, fontFamily: 'system-ui', fontSize: '0.75rem' }}>{UNIT[r.unit] ?? r.unit}</span>
                            </button>
                          )}
                        </td>
                        <td style={{ ...TD, fontSize: '0.75rem', color: r.qbo_item_id ? C.tan : C.yellow }}>
                          {r.qbo_item_id ? `${r.qbo_item_name ?? ''} #${r.qbo_item_id}` : 'not linked — push below'}
                        </td>
                        <td style={{ ...TD, fontSize: '0.75rem', color: C.lightBrown }}>{r.auto ? 'automatic' : 'office adds by hand'}</td>
                        <td style={{ ...TD, textAlign: 'right' }}>
                          <button disabled={busy === r.key} onClick={() => toggleActive(r)} style={{ ...BTN('transparent', C.lightBrown), padding: '0.2rem 0.4rem', fontSize: '0.72rem' }}>
                            {r.active ? 'switch off' : 'switch on'}
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ))}

        <div style={CARD}>
          <div style={{ fontWeight: 700, marginBottom: '0.25rem' }}>Customer deals</div>
          <div style={{ fontSize: '0.78rem', color: C.tan, marginBottom: '0.6rem' }}>A standing price for one QuickBooks customer. It replaces the list rate on their charges; a rate on the animal&apos;s cut card still wins over it.</div>
          {deals.length > 0 && (
            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '0.75rem' }}>
              <thead><tr><th style={TH}>Customer</th><th style={TH}>Charge</th><th style={TH}>Their rate</th><th style={TH}>List rate</th><th style={TH}>Note</th><th style={TH}></th></tr></thead>
              <tbody>{deals.map(d => (
                <tr key={d.id}>
                  <td style={TD}>{d.customer_name}</td><td style={TD}>{labelOf(d.price_key)}</td>
                  <td style={{ ...TD, fontFamily: 'monospace' }}>{money(d.rate)}</td>
                  <td style={{ ...TD, fontFamily: 'monospace', color: C.lightBrown }}>{money(rows.find(r => r.key === d.price_key)?.rate ?? 0)}</td>
                  <td style={{ ...TD, fontSize: '0.75rem', color: C.tan }}>{d.note}</td>
                  <td style={{ ...TD, textAlign: 'right' }}><button disabled={busy === d.id} onClick={() => removeDeal(d.id)} style={{ ...BTN('transparent', C.red), padding: '0.2rem 0.4rem', fontSize: '0.72rem' }}>remove</button></td>
                </tr>
              ))}</tbody>
            </table>
          )}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'flex-start' }}>
            <div style={{ position: 'relative' }}>
              {dealCust ? (
                <button onClick={() => setDealCust(null)} style={{ ...INPUT, cursor: 'pointer' }}>{dealCust.display_name} ✕</button>
              ) : (
                <input value={custSearch} onChange={e => setCustSearch(e.target.value)} placeholder="QuickBooks customer…" style={{ ...INPUT, width: 220 }} />
              )}
              {!dealCust && custSearch.trim() && custResults.length > 0 && (
                <div style={{ position: 'absolute', zIndex: 5, background: C.dark, border: '1px solid rgba(166,120,90,0.4)', width: 260, maxHeight: 220, overflowY: 'auto' }}>
                  {custResults.map(c => (
                    <div key={c.qbo_id} onClick={() => { setDealCust(c); setCustResults([]) }} style={{ padding: '0.35rem 0.5rem', cursor: 'pointer', fontSize: '0.8rem' }}>{c.display_name}</div>
                  ))}
                </div>
              )}
            </div>
            <select value={dealKey} onChange={e => setDealKey(e.target.value)} style={INPUT}>
              <option value="">Charge…</option>
              {rows.filter(r => r.active).map(r => <option key={r.key} value={r.key}>{r.label}{r.species ? ` (${r.species})` : ''} — {money(r.rate)}</option>)}
            </select>
            <span>$<input value={dealRate} onChange={e => setDealRate(e.target.value)} placeholder="rate" inputMode="decimal" style={{ ...INPUT, width: 80 }} /></span>
            <input value={dealNote} onChange={e => setDealNote(e.target.value)} placeholder="note (why)" style={{ ...INPUT, width: 200 }} />
            <button disabled={busy === 'deal'} onClick={addDeal} style={BTN(C.tan)}>Add deal</button>
          </div>
        </div>

        <div style={CARD}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
            <div>
              <div style={{ fontWeight: 700 }}>QuickBooks</div>
              <div style={{ fontSize: '0.78rem', color: C.tan }}>Compare the price list with QuickBooks. Nothing is sent until you tick it and approve.</div>
            </div>
            <button disabled={busy === 'push'} onClick={checkQbo} style={BTN(C.tan)}>{busy === 'push' ? 'Working…' : 'Check QuickBooks'}</button>
          </div>
          {push && (
            <div style={{ marginTop: '0.75rem' }}>
              {push.changes.length === 0 ? <div style={{ color: C.green, fontSize: '0.85rem' }}>QuickBooks matches the price list.</div> : (
                <>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr>
                      <th style={TH}><input type="checkbox" checked={picked.size === push.changes.length} onChange={e => setPicked(e.target.checked ? new Set(push.changes.map(c => c.key)) : new Set())} /></th>
                      <th style={TH}>Charge</th><th style={TH}>What happens</th><th style={TH}>Now</th><th style={TH}>After</th>
                    </tr></thead>
                    <tbody>{push.changes.map(c => (
                      <tr key={c.key}>
                        <td style={TD}><input type="checkbox" checked={picked.has(c.key)} onChange={e => setPicked(p => { const n = new Set(p); if (e.target.checked) n.add(c.key); else n.delete(c.key); return n })} /></td>
                        <td style={TD}>{c.label}</td>
                        <td style={{ ...TD, color: c.kind === 'create' ? C.yellow : C.tan, fontSize: '0.78rem' }}>
                          {c.kind === 'link' ? 'link to existing item' : c.kind === 'create' ? 'create item in QuickBooks' : 'change item price'}
                        </td>
                        <td style={{ ...TD, fontSize: '0.78rem', color: C.lightBrown }}>{c.from}</td>
                        <td style={{ ...TD, fontSize: '0.78rem' }}>{c.to}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                  <button disabled={busy === 'push' || !picked.size} onClick={sendQbo} style={{ ...BTN(C.green), marginTop: '0.75rem' }}>
                    Send {picked.size || ''} to QuickBooks
                  </button>
                </>
              )}
              {push.notes.length > 0 && (
                <ul style={{ fontSize: '0.75rem', color: C.lightBrown, marginTop: '0.75rem' }}>{push.notes.map(n => <li key={n}>{n}</li>)}</ul>
              )}
            </div>
          )}
          {pushResult && <div style={{ marginTop: '0.6rem', fontSize: '0.8rem', whiteSpace: 'pre-wrap' }}>{pushResult}</div>}
        </div>
      </div>
    </div>
  )
}
