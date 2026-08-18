'use client'
import { useEffect, useState, useCallback, useRef } from 'react'
import Link from 'next/link'
import { CATEGORY_LABEL, ASSET_CATEGORIES, type Asset, type AssetCategory } from '@/lib/assets'

// The plant walk.
//
// One pass through the building with a phone, capturing what is actually
// standing there. It is the bottleneck for three separate things at once — the
// $685k of fixed assets QuickBooks can't name, the teardown procedures that
// exist only in people's heads, and the machines missing from the plant map —
// and all three are closed by the same trip.
//
// So the flow is built for walking, not for data entry:
//
//   * The room is chosen ONCE and stays chosen. You move through a building
//     room by room, not machine by unrelated machine.
//   * Photo first. A picture of the machine and a picture of its nameplate are
//     worth more than fields somebody guesses at while standing up, and the
//     nameplate is the make/model/serial in a form nobody can typo.
//   * No money. Nobody knows what a grinder cost while standing in front of
//     it, and a wrong number is worse than a blank one — cost gets reconciled
//     against the pooled accounts later, at a desk.
//   * Every capture saves immediately. A walk gets interrupted; nothing should
//     depend on reaching the end.

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
const TAP = 56

interface Area { id: string; name: string }
interface AssetRow extends Asset { cleaning_areas?: { id: string; name: string } | null }

export default function PlantWalk() {
  const [areas,  setAreas]  = useState<Area[]>([])
  const [assets, setAssets] = useState<AssetRow[]>([])
  const [areaId, setAreaId] = useState<string | null>(null)
  const [error,  setError]  = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  // Promise chain rather than async/await so every setState sits inside a
  // callback — this runs from an effect, and setState in the synchronous part
  // of one cascades renders.
  const load = useCallback(() => {
    Promise.all([
      fetch('/api/cleaning/areas').then(r => r.json()),
      fetch('/api/assets').then(r => r.json()),
    ])
      .then(([aRes, asRes]) => {
        setAreas(Array.isArray(aRes) ? aRes.map((a: Area) => ({ id: a.id, name: a.name })) : [])
        setAssets(asRes?.assets ?? [])
      })
      .catch(() => setError('Could not load. Check your signal.'))
      .finally(() => setLoaded(true))
  }, [])

  useEffect(() => { load() }, [load])

  const area = areas.find(a => a.id === areaId) ?? null
  const inRoom    = assets.filter(a => a.area_id === areaId)
  // The six seeded from QuickBooks have no room. Offering them for claiming is
  // what stops the walk creating a second "Band Saw" alongside the one the
  // books already know cost $20,000.
  const unplaced  = assets.filter(a => !a.area_id)

  if (!loaded) return <Shell><p style={{ color: C.tan }}>Loading…</p></Shell>

  if (!area) {
    return (
      <Shell>
        {error && <Banner tone="error">{error}</Banner>}
        <p style={{ color: C.tan, fontSize: 14, lineHeight: 1.6, marginBottom: 18 }}>
          Walk one room at a time. Photograph each machine and its nameplate, give it a
          name, move on. Cost and service schedules come later — this trip is about what
          is actually standing there.
        </p>

        <div style={{ color: C.tan, fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>
          Which room are you in?
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {areas.map(a => {
            const n = assets.filter(x => x.area_id === a.id).length
            return (
              <button
                key={a.id}
                onClick={() => setAreaId(a.id)}
                style={{
                  minHeight: TAP, background: C.darkBrown, border: `2px solid ${C.medBrown}`,
                  borderRadius: 10, color: C.cream, fontSize: 17, fontWeight: 600,
                  textAlign: 'left', padding: '0 18px', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 10,
                }}
              >
                <span style={{ flex: 1 }}>{a.name}</span>
                <span style={{ color: n ? C.green : C.lightBrown, fontSize: 13 }}>
                  {n ? `${n} captured` : 'none yet'}
                </span>
              </button>
            )
          })}
        </div>

        {unplaced.length > 0 && (
          <div style={{ marginTop: 22, color: C.lightBrown, fontSize: 13, lineHeight: 1.6 }}>
            {unplaced.length} asset{unplaced.length === 1 ? '' : 's'} from QuickBooks
            {unplaced.length === 1 ? ' has' : ' have'} no room yet. Pick the room
            {unplaced.length === 1 ? " it's" : " they're"} in and you can claim
            {unplaced.length === 1 ? ' it' : ' them'} there instead of entering it twice.
          </div>
        )}
      </Shell>
    )
  }

  return (
    <RoomWalk
      area={area}
      inRoom={inRoom}
      unplaced={unplaced}
      onChangeRoom={() => setAreaId(null)}
      onChanged={load}
      onError={setError}
      error={error}
    />
  )
}

// ── Walking one room ────────────────────────────────────────────────────

function RoomWalk({ area, inRoom, unplaced, onChangeRoom, onChanged, onError, error }: {
  area: Area
  inRoom: AssetRow[]
  unplaced: AssetRow[]
  onChangeRoom: () => void
  onChanged: () => void
  onError: (e: string | null) => void
  error: string | null
}) {
  const [name,   setName]   = useState('')
  const [make,   setMake]   = useState('')
  const [model,  setModel]  = useState('')
  const [serial, setSerial] = useState('')
  const [category, setCategory] = useState<AssetCategory>('equipment')
  const [photo,  setPhoto]  = useState<string | null>(null)
  const [plate,  setPlate]  = useState<string | null>(null)
  const [details, setDetails] = useState(false)
  const [saving, setSaving] = useState(false)
  const [justSaved, setJustSaved] = useState<string | null>(null)
  const nameRef = useRef<HTMLInputElement | null>(null)

  function reset() {
    setName(''); setMake(''); setModel(''); setSerial('')
    setCategory('equipment'); setPhoto(null); setPlate(null); setDetails(false)
  }

  async function save() {
    if (!name.trim()) return
    setSaving(true)
    onError(null)
    try {
      const res = await fetch('/api/assets', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(), make: make.trim() || undefined, model: model.trim() || undefined,
          serial_number: serial.trim() || undefined,
          category, area_id: area.id, photo_url: photo,
          // The nameplate shot is kept as a note rather than thrown away when
          // nobody typed the numbers off it — it is the source for filling
          // make/model/serial in later without walking back out there.
          notes: plate ? `Nameplate photo: ${plate}` : undefined,
          // Buildings and vehicles aren't on anyone's nightly list.
          cleanable: category === 'equipment' || category === 'fixture',
        }),
      })
      const body = await res.json()
      if (!res.ok) { onError(body?.error ?? "Couldn't save that."); return }
      setJustSaved(name.trim())
      setTimeout(() => setJustSaved(null), 2200)
      reset()
      onChanged()
      // Straight back to the name field so the next machine is one tap away.
      setTimeout(() => nameRef.current?.focus(), 50)
    } catch {
      onError("Didn't save — check your signal. Nothing was lost, try again.")
    } finally {
      setSaving(false)
    }
  }

  async function claim(asset: AssetRow) {
    onError(null)
    const res = await fetch('/api/assets', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ id: asset.id, area_id: area.id }),
    })
    if (!res.ok) { onError("Couldn't put that in this room."); return }
    onChanged()
  }

  return (
    <Shell>
      {error && <Banner tone="error">{error}</Banner>}

      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: 14, gap: 10,
      }}>
        <div>
          <div style={{ color: C.cream, fontSize: 20, fontWeight: 700 }}>{area.name}</div>
          <div style={{ color: C.tan, fontSize: 13 }}>
            {inRoom.length} captured here
          </div>
        </div>
        <button
          onClick={onChangeRoom}
          style={{
            minHeight: 44, padding: '0 14px', background: C.dark,
            border: `1px solid ${C.medBrown}`, borderRadius: 8,
            color: C.tan, fontSize: 14, cursor: 'pointer', whiteSpace: 'nowrap',
          }}
        >
          Change room
        </button>
      </div>

      {justSaved && <Banner tone="ok">✓ Saved {justSaved}</Banner>}

      {/* Claim anything QuickBooks already knows about */}
      {unplaced.length > 0 && (
        <div style={{ ...card, marginBottom: 16 }}>
          <div style={{ color: C.tan, fontSize: 13, lineHeight: 1.5, marginBottom: 10 }}>
            Already in QuickBooks with no room set. If one of these is in front of you,
            tap it rather than entering it again — it keeps the cost attached.
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {unplaced.map(a => (
              <button
                key={a.id}
                onClick={() => claim(a)}
                style={{
                  minHeight: 44, padding: '0 12px', background: C.dark,
                  border: `1px solid ${C.blue}`, borderRadius: 8,
                  color: C.blue, fontSize: 14, cursor: 'pointer',
                }}
              >
                + {a.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Capture */}
      <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', gap: 10 }}>
          <Camera label="Machine" got={!!photo} onUploaded={setPhoto} />
          <Camera label="Nameplate" got={!!plate} onUploaded={setPlate} />
        </div>

        <input
          ref={nameRef}
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="What is it? e.g. Grinder"
          style={input}
        />

        {!details ? (
          <button
            onClick={() => setDetails(true)}
            style={{
              background: 'none', border: 'none', color: C.lightBrown,
              fontSize: 13, cursor: 'pointer', textAlign: 'left', padding: 0, minHeight: 32,
            }}
          >
            + make, model, serial, type
          </button>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={make}  onChange={e => setMake(e.target.value)}  placeholder="Make"  style={input} />
              <input value={model} onChange={e => setModel(e.target.value)} placeholder="Model" style={input} />
            </div>
            <input value={serial} onChange={e => setSerial(e.target.value)} placeholder="Serial number" style={input} />
            <select
              value={category}
              onChange={e => setCategory(e.target.value as AssetCategory)}
              style={input}
            >
              {ASSET_CATEGORIES.map(c => (
                <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>
              ))}
            </select>
            <div style={{ color: C.lightBrown, fontSize: 12 }}>
              Leave anything blank you can&apos;t read — the nameplate photo keeps it
              recoverable without walking back out here.
            </div>
          </>
        )}

        <button
          onClick={save}
          disabled={!name.trim() || saving}
          style={{
            width: '100%', minHeight: TAP, borderRadius: 10,
            background: !name.trim() || saving ? C.darkBrown : C.green,
            border: `1px solid ${!name.trim() || saving ? C.medBrown : C.green}`,
            color: C.cream, fontSize: 17, fontWeight: 700,
            cursor: !name.trim() || saving ? 'default' : 'pointer',
            opacity: !name.trim() ? 0.5 : 1,
          }}
        >
          {saving ? 'Saving…' : 'Save & next'}
        </button>
      </div>

      {/* What's already in this room */}
      {inRoom.length > 0 && (
        <>
          <div style={{
            color: C.tan, fontSize: 13, fontWeight: 700, textTransform: 'uppercase',
            letterSpacing: 0.5, margin: '22px 0 10px',
          }}>
            In {area.name}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {inRoom.map(a => (
              <div key={a.id} style={{ ...card, padding: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
                {a.photo_url
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={a.photo_url} alt="" style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 6, flexShrink: 0 }} />
                  : <div style={{ width: 48, height: 48, borderRadius: 6, background: C.dark, flexShrink: 0 }} />}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: C.cream, fontSize: 15, fontWeight: 600 }}>{a.name}</div>
                  <div style={{ color: C.tan, fontSize: 12 }}>
                    {[a.make, a.model].filter(Boolean).join(' · ') || CATEGORY_LABEL[a.category]}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </Shell>
  )
}

// ── bits ────────────────────────────────────────────────────────────────

const card: React.CSSProperties = {
  background: C.darkBrown, border: `1px solid ${C.medBrown}`, borderRadius: 12, padding: 16,
}
const input: React.CSSProperties = {
  width: '100%', minHeight: 48, background: C.dark, border: `1px solid ${C.medBrown}`,
  borderRadius: 8, color: C.cream, padding: '10px 12px',
  fontSize: 16,   // 16 or iOS zooms the page on focus, which ruins a one-handed walk
  fontFamily: 'inherit', outline: 'none',
}

function Camera({ label, got, onUploaded }: {
  label: string; got: boolean; onUploaded: (url: string) => void
}) {
  const [busy, setBusy] = useState(false)
  const [err,  setErr]  = useState(false)

  async function upload(file: File) {
    setBusy(true); setErr(false)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('kind', 'reference')   // permanent, not per-shift
      const res  = await fetch('/api/cleaning/photo', { method: 'POST', body: fd })
      const body = await res.json()
      if (!res.ok) { setErr(true); return }
      onUploaded(body.url)
    } catch { setErr(true) } finally { setBusy(false) }
  }

  return (
    <label style={{
      flex: 1, minHeight: 64, borderRadius: 8, cursor: busy ? 'default' : 'pointer',
      background: got ? `${C.green}22` : C.dark,
      border: `1px ${got ? 'solid' : 'dashed'} ${err ? C.red : got ? C.green : C.medBrown}`,
      color: err ? C.red : got ? C.green : C.tan,
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', gap: 2, fontSize: 13,
    }}>
      <span style={{ fontSize: 20 }}>{got ? '✓' : '📷'}</span>
      {busy ? 'Uploading…' : err ? 'Failed — retry' : label}
      <input
        type="file" accept="image/*" capture="environment"
        disabled={busy} style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = '' }}
      />
    </label>
  )
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
        <h1 style={{ color: C.cream, fontSize: 18, fontWeight: 700, margin: 0 }}>Plant walk</h1>
      </header>
      <div style={{ padding: 16, maxWidth: 620, margin: '0 auto' }}>{children}</div>
    </div>
  )
}

function Banner({ tone, children }: { tone: 'error' | 'ok'; children: React.ReactNode }) {
  const color = tone === 'error' ? C.red : C.green
  return (
    <div style={{
      background: `${color}22`, border: `1px solid ${color}`, borderRadius: 8,
      padding: '10px 14px', color: C.cream, fontSize: 14, marginBottom: 14,
    }}>
      {children}
    </div>
  )
}
