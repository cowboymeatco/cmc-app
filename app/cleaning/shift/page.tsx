'use client'
import { useEffect, useState, useCallback, useMemo } from 'react'
import { dateLabel } from '@/lib/dates'
import {
  shiftProgress, outOfSpec, itemSourceLabel,
  type CleaningShiftItem, type ItemStatus,
} from '@/lib/cleaning'
import {
  C, TAP, useCrewMember, CrewPicker, CleaningHeader, ProgressBar,
  Banner, BigButton, PhotoButton, inputStyle, cardStyle,
} from '../ui'

// Tonight's list — the screen the cleaning crew actually lives in.
//
// Grouped by area because that's how the plant is walked. Collapsed by default
// except the first unfinished area, so a 40-item list opens as six taps' worth
// of headings rather than a wall.

interface Shift {
  id: string
  shift_date: string
  status: 'open' | 'closed'
  production_seen: string[] | null
  closed_by: string | null
  notes: string | null
}

interface Photo {
  id: string
  shift_item_id: string | null
  url: string
  taken_by: string | null
}

export default function ShiftPage() {
  const { member, setMember } = useCrewMember()
  const [switching, setSwitching] = useState(false)

  const [shift,  setShift]  = useState<Shift | null>(null)
  const [items,  setItems]  = useState<CleaningShiftItem[]>([])
  const [photos, setPhotos] = useState<Photo[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)
  // Null means "nobody has touched the accordion yet", which is what lets the
  // default-open area be derived at render time instead of written by an effect.
  const [openAreas, setOpenAreas] = useState<Set<string> | null>(null)
  const [expanded,  setExpanded]  = useState<string | null>(null)
  const [closing,   setClosing]   = useState(false)

  // Written as a promise chain rather than async/await so every setState sits
  // inside a callback. This runs from an effect on mount, and a setState in the
  // synchronous part of an effect cascades renders. There's no setLoading(true)
  // for the same reason — `loading` already starts true, and a refresh keeps
  // the current list on screen while it re-reads.
  const load = useCallback((refresh = false) => {
    fetch(`/api/cleaning/shift${refresh ? '?refresh=1' : ''}`)
      .then(res => res.json().then(body => ({ ok: res.ok, body })))
      .then(({ ok, body }) => {
        if (!ok) { setError(body?.error ?? 'Could not load tonight’s list.'); return }
        setShift(body.shift)
        setItems(body.items)
        setPhotos(body.photos ?? [])
        setError(null)
      })
      .catch(() => setError('No connection — the list can’t load right now.'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  // Room > Equipment > Process, in the walking order the builder already sorted
  // them into (Charlie, 2026-08-23). A room's own chores — floors, drains,
  // walls — carry no equipment and stay loose at the top of the room rather
  // than being filed under an invented machine; the night crew reads them as
  // "the room itself", which is how the paper checklist has always run.
  const areas = useMemo(() => {
    const map = new Map<string, CleaningShiftItem[]>()
    for (const it of items) {
      if (!map.has(it.area_name)) map.set(it.area_name, [])
      map.get(it.area_name)!.push(it)
    }
    return [...map.entries()].map(([area, list]) => {
      const loose: CleaningShiftItem[] = []
      const byEquip = new Map<string, CleaningShiftItem[]>()
      for (const it of list) {
        if (!it.equipment_name) { loose.push(it); continue }
        if (!byEquip.has(it.equipment_name)) byEquip.set(it.equipment_name, [])
        byEquip.get(it.equipment_name)!.push(it)
      }
      return { area, list, loose, equipment: [...byEquip.entries()] }
    })
  }, [items])

  // Open the first area with work left in it, so the crew lands on something
  // actionable instead of a list of closed headings. Derived rather than stored
  // until somebody actually opens or closes one.
  const visibleAreas = useMemo(() => {
    if (openAreas) return openAreas
    const first = areas.find(g => g.list.some(i => i.status === 'pending'))
    return new Set(first ? [first.area] : [])
  }, [openAreas, areas])

  const progress = shiftProgress(items)
  const photosFor = (itemId: string) => photos.filter(p => p.shift_item_id === itemId)

  async function mark(item: CleaningShiftItem, status: ItemStatus, extra?: Partial<CleaningShiftItem>) {
    if (!member) { setSwitching(true); return }

    // Optimistic: the tap has to feel instant on a bad connection. Rolled back
    // below if the server disagrees.
    const before = items
    setItems(prev => prev.map(i => i.id === item.id
      ? { ...i, status, done_by: status === 'pending' ? null : member.name, ...extra }
      : i))

    try {
      const res = await fetch('/api/cleaning/shift-items', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: item.id, status, by: member.name, by_id: member.id, ...extra,
        }),
      })
      const body = await res.json()
      if (!res.ok) {
        setItems(before)
        setError(body?.error ?? 'That didn’t save.')
        // A photo-gated item opens itself so the camera button is right there
        // rather than behind another tap.
        if (body?.needs_photo) setExpanded(item.id)
        return
      }
      setItems(prev => prev.map(i => (i.id === item.id ? body : i)))
      setError(null)
    } catch {
      setItems(before)
      setError('That didn’t save — check your signal.')
    }
  }

  async function closeShift() {
    if (!member || !shift) return
    const res = await fetch('/api/cleaning/shift', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ shift_id: shift.id, by: member.name }),
    })
    const body = await res.json()
    if (!res.ok) { setError(body?.error ?? 'Could not close the shift.'); return }
    setShift(body)
    setClosing(false)
  }

  if (loading) {
    return <div style={{ padding: 24, color: C.tan }}>Loading tonight’s list…</div>
  }

  if (!member || switching) {
    return (
      <>
        <CleaningHeader title="Cleaning" back="/cleaning" />
        <CrewPicker
          onPick={m => { setMember(m); setSwitching(false) }}
          onCancel={member ? () => setSwitching(false) : undefined}
        />
      </>
    )
  }

  const closed = shift?.status === 'closed'

  return (
    <div style={{ paddingBottom: 100 }}>
      <CleaningHeader
        title={shift ? dateLabel(shift.shift_date) : 'Tonight'}
        back="/cleaning"
        member={member}
        onSwitch={() => setSwitching(true)}
      />

      <div style={{ padding: 16, maxWidth: 720, margin: '0 auto' }}>
        {error && <Banner tone="error">{error}</Banner>}

        {closed && (
          <Banner tone="ok">
            Closed by {shift?.closed_by}. Reopen it from the hub if something else needs doing.
          </Banner>
        )}

        {/* Progress */}
        <div style={{ ...cardStyle, marginBottom: 16 }}>
          <div style={{
            display: 'flex', justifyContent: 'space-between',
            alignItems: 'baseline', marginBottom: 8,
          }}>
            <span style={{ color: C.cream, fontSize: 16, fontWeight: 700 }}>
              {progress.done + progress.na + progress.issue} of {progress.total} done
            </span>
            <span style={{ color: C.tan, fontSize: 13 }}>{progress.pct}%</span>
          </div>
          <ProgressBar pct={progress.pct} tone={progress.issue > 0 ? C.amber : C.green} />
          {shift?.production_seen && shift.production_seen.length > 0 && (
            <div style={{ color: C.lightBrown, fontSize: 12, marginTop: 10 }}>
              Built for: {shift.production_seen.join(' · ')}
            </div>
          )}
          {shift?.production_seen?.length === 0 && (
            <div style={{ color: C.lightBrown, fontSize: 12, marginTop: 10 }}>
              No production logged this day — showing the everyday list only.
            </div>
          )}
        </div>

        {items.length === 0 && (
          <div style={{ ...cardStyle, textAlign: 'center', color: C.tan }}>
            <p style={{ marginBottom: 12 }}>Nothing on tonight&apos;s list.</p>
            <p style={{ fontSize: 13, color: C.lightBrown }}>
              Either the checklist hasn&apos;t been set up yet, or nothing came due.
            </p>
          </div>
        )}

        {/* Areas */}
        {areas.map(({ area, list, loose, equipment }) => {
          const open = visibleAreas.has(area)
          const p    = shiftProgress(list)
          return (
            <div key={area} style={{ marginBottom: 12 }}>
              <button
                onClick={() => setOpenAreas(() => {
                  const next = new Set(visibleAreas)
                  if (next.has(area)) next.delete(area); else next.add(area)
                  return next
                })}
                style={{
                  width: '100%', minHeight: TAP, background: C.dark,
                  border: `1px solid ${C.medBrown}`, borderRadius: 10,
                  color: C.cream, padding: '10px 14px', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left',
                }}
              >
                <span style={{ fontSize: 16, color: C.tan }}>{open ? '▾' : '▸'}</span>
                <span style={{ flex: 1, fontSize: 16, fontWeight: 700 }}>{area}</span>
                <span style={{
                  fontSize: 13,
                  color: p.complete ? C.green : C.tan,
                  whiteSpace: 'nowrap',
                }}>
                  {p.complete ? '✓ done' : `${p.pending} left`}
                </span>
              </button>

              {open && (() => {
                const row = (item: CleaningShiftItem) => (
                  <ItemRow
                    key={item.id}
                    item={item}
                    photos={photosFor(item.id)}
                    shiftId={shift!.id}
                    memberName={member.name}
                    disabled={closed}
                    expanded={expanded === item.id}
                    onToggleExpand={() => setExpanded(expanded === item.id ? null : item.id)}
                    onMark={mark}
                    onPhoto={p => setPhotos(prev => [...prev, p])}
                  />
                )
                return (
                  <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {loose.map(row)}

                    {/* One block per machine, with its own count — a stuffer is
                        stripped, washed and put back as one job, and the crew
                        needs to see whether the whole machine is done, not
                        whether six unrelated lines happen to be ticked. */}
                    {equipment.map(([name, list]) => {
                      const ep = shiftProgress(list)
                      return (
                        <div key={name} style={{
                          border: `1px solid ${C.medBrown}`, borderRadius: 10,
                          padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 8,
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontSize: 14 }}>🔧</span>
                            <span style={{ flex: 1, fontSize: 14, fontWeight: 700, color: C.tan }}>{name}</span>
                            <span style={{ fontSize: 12, color: ep.complete ? C.green : C.tan, whiteSpace: 'nowrap' }}>
                              {ep.complete ? '✓ done' : `${ep.pending} left`}
                            </span>
                          </div>
                          {list.map(row)}
                        </div>
                      )
                    })}
                  </div>
                )
              })()}
            </div>
          )
        })}

        {/* Footer actions */}
        {!closed && items.length > 0 && (
          <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <BigButton
              label="Refresh — pick up anything new"
              tone={C.dark}
              onClick={() => load(true)}
            />
            {closing ? (
              <div style={{ ...cardStyle, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ color: C.cream, fontSize: 15 }}>
                  {progress.pending > 0
                    ? `${progress.pending} item${progress.pending === 1 ? '' : 's'} still unanswered. Close anyway?`
                    : 'Close out the night?'}
                </div>
                <BigButton label="Yes, close the shift" tone={C.green} onClick={closeShift} />
                <BigButton label="Not yet" tone={C.dark} onClick={() => setClosing(false)} />
              </div>
            ) : (
              <BigButton
                label="Close out the night"
                tone={progress.complete ? C.green : C.medBrown}
                onClick={() => setClosing(true)}
              />
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── One checklist item ──────────────────────────────────────────────────

function ItemRow({
  item, photos, shiftId, memberName, disabled, expanded, onToggleExpand, onMark, onPhoto,
}: {
  item: CleaningShiftItem
  photos: Photo[]
  shiftId: string
  memberName: string
  disabled: boolean
  expanded: boolean
  onToggleExpand: () => void
  onMark: (item: CleaningShiftItem, status: ItemStatus, extra?: Partial<CleaningShiftItem>) => void
  onPhoto: (p: Photo) => void
}) {
  const [note,    setNote]    = useState(item.note ?? '')
  const [reading, setReading] = useState(item.value_num?.toString() ?? '')

  const done  = item.status === 'done'
  const na    = item.status === 'na'
  const flag  = item.status === 'issue'
  const spec  = outOfSpec(item)
  const badge = itemSourceLabel(item.source)

  const tone = flag ? C.amber : spec ? C.red : done ? C.green : na ? C.lightBrown : C.medBrown

  return (
    <div style={{
      background:   C.darkBrown,
      border:       `1px solid ${tone}`,
      borderRadius: 10,
      overflow:     'hidden',
    }}>
      <div style={{ display: 'flex', alignItems: 'stretch' }}>
        {/* The check target — deliberately the biggest thing on the row */}
        <button
          onClick={() => !disabled && onMark(item, done ? 'pending' : 'done',
            item.input_type === 'number' && reading !== ''
              ? { value_num: Number(reading) }
              : undefined)}
          disabled={disabled}
          aria-label={done ? `Undo ${item.title}` : `Mark ${item.title} done`}
          style={{
            width:      TAP,
            minHeight:  TAP,
            background: done ? C.green : 'transparent',
            border:     'none',
            borderRight: `1px solid ${C.medBrown}`,
            color:      done ? C.cream : C.medBrown,
            fontSize:   26,
            cursor:     disabled ? 'default' : 'pointer',
            flexShrink: 0,
          }}
        >
          {done ? '✓' : na ? '—' : flag ? '!' : '○'}
        </button>

        <button
          onClick={onToggleExpand}
          style={{
            flex: 1, background: 'none', border: 'none', textAlign: 'left',
            padding: '10px 12px', cursor: 'pointer', minHeight: TAP,
          }}
        >
          <div style={{
            color:          done || na ? C.lightBrown : C.cream,
            fontSize:       16,
            fontWeight:     600,
            textDecoration: done || na ? 'line-through' : 'none',
          }}>
            {item.title}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 3, flexWrap: 'wrap' }}>
            {item.equipment_name && (
              <span style={{ color: C.tan, fontSize: 12 }}>{item.equipment_name}</span>
            )}
            {badge && (
              <span style={{
                color: C.amber, fontSize: 11, border: `1px solid ${C.amber}`,
                borderRadius: 4, padding: '1px 5px',
              }}>
                {badge}
              </span>
            )}
            {item.requires_photo && photos.length === 0 && (
              <span style={{ color: C.amber, fontSize: 11 }}>📷 photo needed</span>
            )}
            {photos.length > 0 && (
              <span style={{ color: C.green, fontSize: 11 }}>📷 {photos.length}</span>
            )}
            {item.done_by && (
              <span style={{ color: C.lightBrown, fontSize: 11 }}>· {item.done_by}</span>
            )}
            {spec && (
              <span style={{ color: C.red, fontSize: 11, fontWeight: 700 }}>OUT OF SPEC</span>
            )}
          </div>
        </button>
      </div>

      {expanded && (
        <div style={{
          borderTop: `1px solid ${C.medBrown}`, padding: 12,
          display: 'flex', flexDirection: 'column', gap: 10,
        }}>
          {item.detail && (
            <div style={{ color: C.tan, fontSize: 14 }}>{item.detail}</div>
          )}

          {item.input_type === 'number' && (
            <div>
              <label style={{ color: C.tan, fontSize: 13, display: 'block', marginBottom: 4 }}>
                {item.input_label ?? 'Reading'}
                {item.input_unit && ` (${item.input_unit})`}
                {(item.input_min !== null || item.input_max !== null) && (
                  <span style={{ color: C.lightBrown }}>
                    {' '}· spec {item.input_min ?? '–'}–{item.input_max ?? '–'}
                  </span>
                )}
              </label>
              <input
                type="number"
                inputMode="decimal"
                value={reading}
                onChange={e => setReading(e.target.value)}
                onBlur={() => reading !== '' && !disabled &&
                  onMark(item, item.status, { value_num: Number(reading) })}
                style={inputStyle}
              />
            </div>
          )}

          <PhotoButton
            label={photos.length ? 'Another photo' : 'Add a photo'}
            disabled={disabled}
            extra={{
              shift_id:      shiftId,
              shift_item_id: item.id,
              taken_by:      memberName,
              kind:          'documentation',
            }}
            onUploaded={(_url, raw) => onPhoto(raw as unknown as Photo)}
          />

          {photos.length > 0 && (
            <div style={{ display: 'flex', gap: 8, overflowX: 'auto' }}>
              {photos.map(p => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={p.id} src={p.url} alt=""
                  style={{
                    width: 84, height: 84, objectFit: 'cover',
                    borderRadius: 8, border: `1px solid ${C.medBrown}`, flexShrink: 0,
                  }}
                />
              ))}
            </div>
          )}

          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            onBlur={() => note !== (item.note ?? '') && !disabled &&
              onMark(item, item.status, { note })}
            placeholder="Note (optional)"
            rows={2}
            style={{ ...inputStyle, resize: 'vertical' }}
          />

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => !disabled && onMark(item, na ? 'pending' : 'na')}
              disabled={disabled}
              style={{
                flex: 1, minHeight: 46, background: na ? C.lightBrown : C.dark,
                border: `1px solid ${C.medBrown}`, borderRadius: 8,
                color: C.cream, fontSize: 14, cursor: disabled ? 'default' : 'pointer',
              }}
            >
              {na ? 'Undo N/A' : "Didn't apply"}
            </button>
            <button
              onClick={() => !disabled && onMark(item, flag ? 'pending' : 'issue')}
              disabled={disabled}
              style={{
                flex: 1, minHeight: 46, background: flag ? C.amber : C.dark,
                border: `1px solid ${flag ? C.amber : C.medBrown}`, borderRadius: 8,
                color: C.cream, fontSize: 14, cursor: disabled ? 'default' : 'pointer',
              }}
            >
              {flag ? 'Unflag' : '⚠ Problem'}
            </button>
          </div>
          <div style={{ color: C.lightBrown, fontSize: 12 }}>
            Flag a problem when you couldn&apos;t finish it — a broken part, no chemical,
            something that needs a second look.
          </div>
        </div>
      )}
    </div>
  )
}
