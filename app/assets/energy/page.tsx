'use client'
import { useEffect, useState, useCallback, useMemo } from 'react'

import Link from 'next/link'
import { isoDate, isoDateTime } from '@/lib/dates'
import {
  summarize, totals, rateOn, demandCost, hoursMetered, isShortWindow,
  dollars, kwhFmt, wattsFmt, windowFmt,
  ENERGY_METHODS, METHOD_LABEL, METHOD_HINT, SHORT_WINDOW_HOURS,
  type EnergyAsset, type EnergyReading, type EnergyRate, type EnergyMethod, type AssetEnergy,
} from '@/lib/energy'

// The equipment energy log.
//
// A meter goes on a machine, stays a week, and comes off with a kWh number.
// This page turns that into what the machine costs per month and lines the
// machines up by cost, so the question "what's the walk-in costing us" has a
// number instead of a feeling.
//
// The rate at the top comes off the utility bill — the whole bill divided by
// its kWh — because that's the only rate that includes the riders and taxes
// we actually pay. Without one the page still shows kWh and watts, but it
// asks for a bill rather than inventing a price.

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
const TAP = 48
const SHOP_TZ = 'America/Denver'

interface Payload {
  assets:   EnergyAsset[]
  readings: EnergyReading[]
  rates:    EnergyRate[]
}

/** "Sep 26, 7:30 AM" on the shop clock, whatever device is reading this. */
function when(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    timeZone: SHOP_TZ, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

/** Local datetime-local string for `hoursAgo` hours before now, on the shop clock. */
function shopDateTimeAgo(hoursAgo: number): string {
  return isoDateTime(new Date(Date.now() - hoursAgo * 3_600_000))
}

export default function EnergyLog() {
  const [data,    setData]    = useState<Payload | null>(null)
  const [error,   setError]   = useState<string | null>(null)
  const [open,    setOpen]    = useState<string | null>(null)   // expanded asset
  const [adding,  setAdding]  = useState(false)
  const [rateOpen, setRateOpen] = useState(false)
  const today = isoDate()

  const load = useCallback(() => {
    fetch('/api/energy')
      .then(r => r.json().then(b => ({ ok: r.ok, b })))
      .then(({ ok, b }) => { if (!ok) setError(b?.error ?? 'Could not load the energy log.'); else setData(b) })
      .catch(() => setError('No connection.'))
  }, [])

  useEffect(() => { load() }, [load])

  const rate = useMemo(() => data ? rateOn(data.rates, today) : null, [data, today])
  const rows = useMemo<AssetEnergy[]>(() => {
    if (!data) return []
    const all = summarize(data.assets, data.readings, rate)
    // Costliest first; the ones nobody has metered yet sit underneath so the
    // list reads as "what we know" then "what we don't".
    return all.sort((a, b) =>
      (b.monthlyKwh ?? -1) - (a.monthlyKwh ?? -1) || a.asset.name.localeCompare(b.asset.name))
  }, [data, rate])
  const sum = useMemo(() => totals(rows, rate), [rows, rate])

  if (error) return <Shell><Banner tone="error">{error}</Banner></Shell>
  if (!data)  return <Shell><p style={{ color: C.tan }}>Loading…</p></Shell>

  const metered   = rows.filter(r => r.latest)
  const unmetered = rows.filter(r => !r.latest)

  return (
    <Shell>
      {/* ── What a kWh costs ─────────────────────────────────────────── */}
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
          <div>
            <div style={{ color: C.cream, fontSize: 17, fontWeight: 700 }}>
              {rate ? `${(rate.rate_per_kwh * 100).toFixed(1)}¢ per kWh` : 'No rate on file'}
            </div>
            <div style={{ color: C.tan, fontSize: 13, marginTop: 2 }}>
              {rate
                ? <>
                    {rate.utility ? `${rate.utility} · ` : ''}from {rate.effective_on}
                    {rate.demand_per_kw != null && ` · ${dollars(rate.demand_per_kw)}/kW demand`}
                    {rate.source && <div style={{ color: C.lightBrown, fontSize: 12 }}>{rate.source}</div>}
                  </>
                : 'Take a recent bill: total due ÷ total kWh. That blended number is what a kWh really costs us.'}
            </div>
          </div>
          <button onClick={() => setRateOpen(o => !o)} style={{ ...btn, background: 'transparent', border: `1px solid ${C.medBrown}`, color: C.tan }}>
            {rateOpen ? 'Cancel' : rate ? 'Update' : 'Set rate'}
          </button>
        </div>
        {rateOpen && <RateForm onSaved={() => { setRateOpen(false); load() }} />}
        {data.rates.length > 1 && (
          <details style={{ marginTop: 10 }}>
            <summary style={{ color: C.lightBrown, fontSize: 12, cursor: 'pointer' }}>Earlier rates</summary>
            {data.rates.slice(1).map(r => (
              <div key={r.id} style={{ color: C.tan, fontSize: 12, marginTop: 4 }}>
                {r.effective_on} · {(r.rate_per_kwh * 100).toFixed(1)}¢/kWh
                {r.demand_per_kw != null && ` · ${dollars(r.demand_per_kw)}/kW`}
                {r.source && ` · ${r.source}`}
              </div>
            ))}
          </details>
        )}
      </div>

      {/* ── Totals ───────────────────────────────────────────────────── */}
      <div style={{ ...card, marginTop: 12 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20 }}>
          <Figure label="per month, metered" value={sum.monthlyCost != null ? dollars(sum.monthlyCost) : '—'} tone={C.green} />
          <Figure label="kWh per month"      value={kwhFmt(sum.monthlyKwh).replace(' kWh', '')} tone={C.cream} />
          <Figure label="metered"            value={`${sum.metered} of ${rows.length}`} tone={C.blue} />
        </div>
        {sum.metered > 0 && !rate && (
          <div style={{ color: C.amber, fontSize: 13, marginTop: 10 }}>
            kWh is known; dollars need a rate. Set one above from a bill.
          </div>
        )}
        {sum.unmetered > 0 && (
          <div style={{ color: C.tan, fontSize: 13, marginTop: 10, lineHeight: 1.5 }}>
            {sum.unmetered} machine{sum.unmetered === 1 ? ' has' : 's have'} never been metered.
            A meter left on for a week beats a nameplate guess: compressors and smokers run
            at a fraction of their plate.
          </div>
        )}
      </div>

      {/* ── File a reading ───────────────────────────────────────────── */}
      {adding
        ? <ReadingForm assets={data.assets} onDone={() => { setAdding(false); load() }} onCancel={() => setAdding(false)} />
        : (
          <button onClick={() => setAdding(true)} style={{
            ...btn, width: '100%', marginTop: 16, minHeight: 56, fontSize: 16,
            background: C.medBrown, color: C.cream,
          }}>
            ⚡ Log a meter reading
          </button>
        )}

      {/* ── Metered ──────────────────────────────────────────────────── */}
      {metered.length > 0 && (
        <>
          <SectionHead>{metered.length} metered · costliest first</SectionHead>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {metered.map(r => (
              <AssetCard key={r.asset.id} row={r} rate={rate}
                open={open === r.asset.id} onToggle={() => setOpen(o => o === r.asset.id ? null : r.asset.id)}
                onChanged={load} />
            ))}
          </div>
        </>
      )}

      {/* ── Not yet ──────────────────────────────────────────────────── */}
      {unmetered.length > 0 && (
        <>
          <SectionHead>{unmetered.length} not metered yet</SectionHead>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {unmetered.map(r => (
              <div key={r.asset.id} style={{ ...card, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ color: C.cream, fontSize: 14 }}>{r.asset.name}</span>
                  {r.asset.cleaning_areas?.name && (
                    <span style={{ color: C.lightBrown, fontSize: 12, marginLeft: 8 }}>{r.asset.cleaning_areas.name}</span>
                  )}
                </div>
                {r.asset.rated_watts != null && (
                  <span style={{ color: C.lightBrown, fontSize: 12, whiteSpace: 'nowrap' }}>{wattsFmt(r.asset.rated_watts)} plate</span>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {rows.length === 0 && (
        <div style={{ ...card, textAlign: 'center', color: C.tan, marginTop: 16 }}>
          Nothing in the asset register yet. Log a reading and name the machine; it&apos;ll be added.
        </div>
      )}
    </Shell>
  )
}

// ── One machine ─────────────────────────────────────────────────────────

function AssetCard({ row, rate, open, onToggle, onChanged }: {
  row: AssetEnergy; rate: EnergyRate | null; open: boolean; onToggle: () => void; onChanged: () => void
}) {
  const { asset, latest } = row
  const [plate, setPlate] = useState<string>(asset.rated_watts?.toString() ?? '')
  const [busy,  setBusy]  = useState(false)
  const [err,   setErr]   = useState<string | null>(null)

  const demand = demandCost(row.peakKw, rate)
  const over   = row.ofNameplate != null && row.ofNameplate > 1.1
  const short  = latest ? isShortWindow(latest) : false

  const savePlate = () => {
    setBusy(true); setErr(null)
    fetch('/api/energy', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ asset_id: asset.id, rated_watts: plate === '' ? null : plate }),
    })
      .then(r => r.json().then(b => ({ ok: r.ok, b })))
      .then(({ ok, b }) => { if (!ok) setErr(b?.error ?? 'Could not save.'); else onChanged() })
      .catch(() => setErr('No connection.'))
      .finally(() => setBusy(false))
  }

  const remove = (r: EnergyReading) => {
    if (!confirm(`Remove the ${kwhFmt(r.kwh)} reading ending ${when(r.ended_at)}?`)) return
    fetch(`/api/energy?id=${r.id}`, { method: 'DELETE' })
      .then(r => r.json().then(b => ({ ok: r.ok, b })))
      .then(({ ok, b }) => { if (!ok) setErr(b?.error ?? 'Could not remove.'); else onChanged() })
      .catch(() => setErr('No connection.'))
  }

  return (
    <div style={{ ...card, borderColor: over ? C.amber : C.medBrown }}>
      <div onClick={onToggle} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', cursor: 'pointer' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: C.cream, fontSize: 16, fontWeight: 700 }}>{asset.name}</div>
          <div style={{ color: C.tan, fontSize: 12, marginTop: 2 }}>
            {[asset.cleaning_areas?.name, asset.make, asset.model].filter(Boolean).join(' · ')}
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
            <Chip tone={C.lightBrown}>{wattsFmt(row.avgWatts)} avg</Chip>
            {latest && <Chip tone={C.lightBrown}>{METHOD_LABEL[latest.method]} · {windowFmt(hoursMetered(latest))}</Chip>}
            {row.peakKw != null && <Chip tone={C.blue}>{row.peakKw} kW peak</Chip>}
            {row.ofNameplate != null && (
              <Chip tone={over ? C.amber : C.green}>{Math.round(row.ofNameplate * 100)}% of plate</Chip>
            )}
            {short && <Chip tone={C.amber}>short read</Chip>}
          </div>
        </div>
        <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
          <div style={{ color: C.cream, fontSize: 18, fontWeight: 700 }}>
            {row.monthlyCost != null ? dollars(row.monthlyCost) : kwhFmt(row.monthlyKwh)}
          </div>
          <div style={{ color: C.lightBrown, fontSize: 11 }}>per month</div>
          {row.monthlyCost != null && (
            <div style={{ color: C.tan, fontSize: 12, marginTop: 4 }}>{kwhFmt(row.monthlyKwh)}</div>
          )}
          {demand != null && (
            <div style={{ color: C.lightBrown, fontSize: 11, marginTop: 2 }}>+ up to {dollars(demand)} demand</div>
          )}
        </div>
      </div>

      {open && (
        <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${C.medBrown}` }}>
          {over && (
            <div style={{ color: C.amber, fontSize: 13, lineHeight: 1.5, marginBottom: 10 }}>
              Drawing more than its nameplate on average. For refrigeration that usually means
              dirty condenser coils, a door gasket that doesn&apos;t seal, or a compressor on its way out.
            </div>
          )}
          {short && (
            <div style={{ color: C.tan, fontSize: 13, lineHeight: 1.5, marginBottom: 10 }}>
              This read covers under {SHORT_WINDOW_HOURS / 24} days. Anything that cycles needs about a week on the meter
              before the monthly figure means much.
            </div>
          )}

          {/* Nameplate */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
            <label style={{ color: C.tan, fontSize: 13, whiteSpace: 'nowrap' }}>Nameplate watts</label>
            <input type="number" inputMode="decimal" value={plate} onChange={e => setPlate(e.target.value)}
              placeholder="e.g. 1500" style={{ ...input, width: 120 }} />
            <button onClick={savePlate} disabled={busy} style={{ ...btn, background: C.medBrown, color: C.cream }}>Save</button>
          </div>
          {err && <Banner tone="error">{err}</Banner>}

          {/* History */}
          <div style={{ color: C.lightBrown, fontSize: 12, marginBottom: 6 }}>Readings, newest first</div>
          {row.readings.map(r => (
            <div key={r.id} style={{
              display: 'flex', gap: 10, alignItems: 'center', padding: '8px 0',
              borderTop: `1px solid ${C.dark}`, fontSize: 13,
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: C.cream }}>
                  {kwhFmt(r.kwh)} over {windowFmt(hoursMetered(r))}
                  <span style={{ color: C.lightBrown }}> · {wattsFmt((r.kwh / hoursMetered(r)) * 1000)} avg</span>
                </div>
                <div style={{ color: C.tan, fontSize: 12 }}>
                  {when(r.started_at)} → {when(r.ended_at)} · {METHOD_LABEL[r.method]}
                  {r.peak_kw != null && ` · ${r.peak_kw} kW peak`}
                  {r.recorded_by && ` · ${r.recorded_by}`}
                </div>
                {r.notes && <div style={{ color: C.lightBrown, fontSize: 12, marginTop: 2 }}>{r.notes}</div>}
              </div>
              <button onClick={() => remove(r)} title="Remove this reading"
                style={{ ...btn, background: 'transparent', color: C.red, border: `1px solid ${C.red}55`, padding: '4px 10px', minHeight: 32 }}>
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Forms ───────────────────────────────────────────────────────────────

function ReadingForm({ assets, onDone, onCancel }: {
  assets: EnergyAsset[]; onDone: () => void; onCancel: () => void
}) {
  const [assetId,  setAssetId]  = useState('')
  const [newName,  setNewName]  = useState('')
  const [method,   setMethod]   = useState<EnergyMethod>('plug_meter')
  // Default window: the last seven days. Plug-in meters usually go on for
  // about a week; whoever reads it fixes the start if they remember otherwise.
  const [start,    setStart]    = useState(() => shopDateTimeAgo(7 * 24))
  const [end,      setEnd]      = useState(() => shopDateTimeAgo(0))
  const [kwh,      setKwh]      = useState('')
  const [peak,     setPeak]     = useState('')
  const [plate,    setPlate]    = useState('')
  // Remember who's reading meters on this phone, same as the cleaning pages
  // remember the crew member. Read lazily: this form only mounts after a tap,
  // so it is never server-rendered and there is no hydration to disagree.
  const [by,       setBy]       = useState(() => {
    try { return localStorage.getItem('energyRecordedBy') ?? '' } catch { return '' }
  })
  const [notes,    setNotes]    = useState('')
  const [busy,     setBusy]     = useState(false)
  const [err,      setErr]      = useState<string | null>(null)

  // Picking a machine pre-fills its nameplate so a wrong one gets noticed.
  const pick = (id: string) => {
    setAssetId(id)
    setPlate(assets.find(a => a.id === id)?.rated_watts?.toString() ?? '')
  }

  const submit = () => {
    setBusy(true); setErr(null)
    try { localStorage.setItem('energyRecordedBy', by) } catch { /* private browsing */ }
    fetch('/api/energy', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        asset_id: assetId === 'new' ? null : assetId,
        new_asset_name: assetId === 'new' ? newName : null,
        method,
        // datetime-local is wall-clock on this device; shop phones and the
        // office PC are on Mountain Time, so this lands as the right instant.
        started_at: new Date(start).toISOString(),
        ended_at:   new Date(end).toISOString(),
        kwh, peak_kw: peak, rated_watts: plate, recorded_by: by, notes,
      }),
    })
      .then(r => r.json().then(b => ({ ok: r.ok, b })))
      .then(({ ok, b }) => { if (!ok) setErr(b?.error ?? 'Could not save.'); else onDone() })
      .catch(() => setErr('No connection.'))
      .finally(() => setBusy(false))
  }

  const canSave = (assetId && assetId !== 'new') || (assetId === 'new' && newName.trim())

  return (
    <div style={{ ...card, marginTop: 16 }}>
      <div style={{ color: C.cream, fontSize: 16, fontWeight: 700, marginBottom: 12 }}>Log a meter reading</div>

      <Field label="Machine">
        <select value={assetId} onChange={e => pick(e.target.value)} style={input}>
          <option value="">Pick one…</option>
          {assets.map(a => (
            <option key={a.id} value={a.id}>
              {a.name}{a.cleaning_areas?.name ? ` — ${a.cleaning_areas.name}` : ''}
            </option>
          ))}
          <option value="new">+ Not in the list (add it)</option>
        </select>
      </Field>
      {assetId === 'new' && (
        <Field label="Name it">
          <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g. Walk-in Cooler compressor" style={input} />
        </Field>
      )}

      <Field label="How it was measured">
        <select value={method} onChange={e => setMethod(e.target.value as EnergyMethod)} style={input}>
          {ENERGY_METHODS.map(m => <option key={m} value={m}>{METHOD_LABEL[m]}</option>)}
        </select>
        <div style={{ color: C.lightBrown, fontSize: 12, marginTop: 4, lineHeight: 1.4 }}>{METHOD_HINT[method]}</div>
      </Field>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Field label="Meter went on">
          <input type="datetime-local" value={start} onChange={e => setStart(e.target.value)} style={input} />
        </Field>
        <Field label="Read at">
          <input type="datetime-local" value={end} onChange={e => setEnd(e.target.value)} style={input} />
        </Field>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Field label="kWh on the meter">
          <input type="number" inputMode="decimal" step="0.01" min="0" value={kwh} onChange={e => setKwh(e.target.value)} placeholder="0.00" style={input} />
        </Field>
        <Field label="Peak kW (if shown)">
          <input type="number" inputMode="decimal" step="0.01" min="0" value={peak} onChange={e => setPeak(e.target.value)} placeholder="optional" style={input} />
        </Field>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Field label="Nameplate watts">
          <input type="number" inputMode="decimal" min="0" value={plate} onChange={e => setPlate(e.target.value)} placeholder="off the plate, optional" style={input} />
        </Field>
        <Field label="Read by">
          <input value={by} onChange={e => setBy(e.target.value)} placeholder="your name" style={input} />
        </Field>
      </div>

      <Field label="Notes">
        <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. coils cleaned the day before" style={input} />
      </Field>

      {err && <Banner tone="error">{err}</Banner>}

      <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
        <button onClick={submit} disabled={busy || !canSave || !kwh}
          style={{ ...btn, flex: 1, background: canSave && kwh ? C.green : C.medBrown, color: C.dark }}>
          {busy ? 'Saving…' : 'Save reading'}
        </button>
        <button onClick={onCancel} style={{ ...btn, background: 'transparent', border: `1px solid ${C.medBrown}`, color: C.tan }}>Cancel</button>
      </div>
    </div>
  )
}

function RateForm({ onSaved }: { onSaved: () => void }) {
  // Entered as the two numbers on the bill rather than the quotient, because
  // that's what somebody has in front of them, and the division is the part
  // people get wrong.
  const [billTotal, setBillTotal] = useState('')
  const [billKwh,   setBillKwh]   = useState('')
  const [demand,    setDemand]    = useState('')
  const [effective, setEffective] = useState(() => isoDate())
  const [utility,   setUtility]   = useState('')
  const [busy,      setBusy]      = useState(false)
  const [err,       setErr]       = useState<string | null>(null)

  const total = parseFloat(billTotal.replace(/[$,\s]/g, ''))
  const used  = parseFloat(billKwh.replace(/[,\s]/g, ''))
  const rate  = Number.isFinite(total) && Number.isFinite(used) && used > 0 ? total / used : null

  const submit = () => {
    if (rate == null) return
    setBusy(true); setErr(null)
    fetch('/api/energy/rates', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        effective_on: effective,
        rate_per_kwh: rate,
        demand_per_kw: demand,
        utility,
        source: `Bill: ${dollars(total)} / ${used.toLocaleString('en-US')} kWh`,
      }),
    })
      .then(r => r.json().then(b => ({ ok: r.ok, b })))
      .then(({ ok, b }) => { if (!ok) setErr(b?.error ?? 'Could not save.'); else onSaved() })
      .catch(() => setErr('No connection.'))
      .finally(() => setBusy(false))
  }

  return (
    <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${C.medBrown}` }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Field label="Bill total ($)">
          <input inputMode="decimal" value={billTotal} onChange={e => setBillTotal(e.target.value)} placeholder="2,140.00" style={input} />
        </Field>
        <Field label="kWh on the bill">
          <input inputMode="decimal" value={billKwh} onChange={e => setBillKwh(e.target.value)} placeholder="17,300" style={input} />
        </Field>
        <Field label="Demand charge ($/kW)">
          <input inputMode="decimal" value={demand} onChange={e => setDemand(e.target.value)} placeholder="optional" style={input} />
        </Field>
        <Field label="Applies from">
          <input type="date" value={effective} onChange={e => setEffective(e.target.value)} style={input} />
        </Field>
      </div>
      <Field label="Utility">
        <input value={utility} onChange={e => setUtility(e.target.value)} placeholder="e.g. NorthWestern Energy" style={input} />
      </Field>
      <div style={{ color: rate != null ? C.cream : C.lightBrown, fontSize: 14, margin: '4px 0 10px' }}>
        {rate != null ? `= ${(rate * 100).toFixed(2)}¢ per kWh` : 'Enter both numbers to get the rate.'}
      </div>
      {err && <Banner tone="error">{err}</Banner>}
      <button onClick={submit} disabled={busy || rate == null}
        style={{ ...btn, width: '100%', background: rate != null ? C.green : C.medBrown, color: C.dark }}>
        {busy ? 'Saving…' : 'Save rate'}
      </button>
    </div>
  )
}

// ── bits ────────────────────────────────────────────────────────────────

const card: React.CSSProperties = {
  background: C.darkBrown, border: `1px solid ${C.medBrown}`,
  borderRadius: 12, padding: 16,
}

const input: React.CSSProperties = {
  width: '100%', minHeight: TAP, padding: '8px 10px', fontSize: 15,
  background: C.dark, color: C.cream, border: `1px solid ${C.medBrown}`, borderRadius: 8,
}

const btn: React.CSSProperties = {
  minHeight: TAP, padding: '8px 16px', fontSize: 14, fontWeight: 700,
  border: 'none', borderRadius: 10, cursor: 'pointer',
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ paddingBottom: 60 }}>
      <header style={{
        background: C.dark, borderBottom: `1px solid ${C.medBrown}`,
        padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12,
        position: 'sticky', top: 0, zIndex: 50,
      }}>
        <Link href="/assets" style={{ color: C.tan, fontSize: 26, textDecoration: 'none', lineHeight: 1, padding: '4px 8px 8px 0' }}>‹</Link>
        <h1 style={{ color: C.cream, fontSize: 18, fontWeight: 700, margin: 0 }}>Energy</h1>
        <span style={{ color: C.lightBrown, fontSize: 13, marginLeft: 'auto' }}>what each machine costs to run</span>
      </header>
      <div style={{ padding: 16, maxWidth: 860, margin: '0 auto' }}>{children}</div>
    </div>
  )
}

function SectionHead({ children }: { children: React.ReactNode }) {
  return <div style={{ color: C.cream, fontSize: 16, fontWeight: 700, margin: '22px 0 10px' }}>{children}</div>
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block', marginBottom: 10 }}>
      <div style={{ color: C.tan, fontSize: 12, marginBottom: 4 }}>{label}</div>
      {children}
    </label>
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
