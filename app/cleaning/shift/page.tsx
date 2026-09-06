'use client'
import { useEffect, useState, useCallback, useMemo } from 'react'
import { dateLabel, addDaysISO } from '@/lib/dates'
import {
  shiftProgress, outOfSpec, itemSourceLabel, p1Complete,
  hardStopFor, shopTime, fmtShopTime, fmtSpan, breakPlan, fmtClock,
  PRIORITIES, PRIORITY_LABEL, PRIORITY_BLURB,
  type CleaningShiftItem, type ItemStatus, type Priority, type BreakSlot,
} from '@/lib/cleaning'
import {
  C, TAP, useCrewMember, CrewPicker, CleaningHeader, ProgressBar,
  Banner, BigButton, PhotoButton, inputStyle, cardStyle, type CrewMember,
} from '../ui'

// Tonight's list — the screen the cleaning crew actually lives in.
//
// The list is a forcing function. P1 is what the plant can't open without and
// it has to be finished inside the shift; P2 and P3 are visible overflow. So
// the screen is tiered P1 → P2 → P3, the clock is always in view, and the
// hard stop at 1:30 AM turns the close button into the biggest thing on the
// page. Nothing is blocked at the hard stop — they may be finishing one — but
// the record shows what the clock said.

interface Shift {
  id: string
  shift_date: string
  status: 'open' | 'closed'
  production_seen: string[] | null
  started_at: string | null
  started_by: string | null
  closed_at: string | null
  closed_by: string | null
  notes: string | null
  p1_complete_at: string | null
  crew_ids: string[]
  area_assignments: Record<string, string>
  preop_time: string
}

interface Crew { id: string; name: string }

interface Photo {
  id: string
  shift_item_id: string | null
  url: string
  taken_by: string | null
}

interface Payload { shift: Shift | null; items: CleaningShiftItem[]; photos: Photo[]; crew: Crew[]; date?: string }

/** The clock, re-read every half minute. Only ever rendered after load, so
 *  the server never paints a time the browser then disagrees with. */
function useNow(everyMs = 30_000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs)
    return () => clearInterval(t)
  }, [everyMs])
  return now
}

const firstName = (name: string) => name.split(' ')[0]

const PRIORITY_TONE: Record<Priority, string> = { 1: C.red, 2: C.amber, 3: C.blue }

export default function ShiftPage() {
  const { member, setMember } = useCrewMember()
  const [switching, setSwitching] = useState(false)

  const [shift,  setShift]  = useState<Shift | null>(null)
  const [items,  setItems]  = useState<CleaningShiftItem[]>([])
  const [photos, setPhotos] = useState<Photo[]>([])
  const [crew,   setCrew]   = useState<Crew[]>([])
  const [dateISO, setDateISO] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  // Null means "nobody has touched the accordion yet", which is what lets the
  // default-open tier and area be derived at render time instead of written
  // by an effect.
  const [openTiers, setOpenTiers] = useState<Set<Priority> | null>(null)
  const [openAreas, setOpenAreas] = useState<Set<string> | null>(null)
  const [expanded,  setExpanded]  = useState<string | null>(null)
  const [closing,   setClosing]   = useState(false)
  const [reopening, setReopening] = useState(false)
  const [mineOnly,  setMineOnly]  = useState<boolean | null>(null)
  const [splitOpen, setSplitOpen] = useState(false)

  const now = useNow()

  const apply = useCallback((body: Payload) => {
    setShift(body.shift)
    setItems(body.items ?? [])
    setPhotos(body.photos ?? [])
    setCrew(body.crew ?? [])
    if (body.date) setDateISO(body.date)
  }, [])

  // Written as a promise chain rather than async/await so every setState sits
  // inside a callback. This runs from an effect on mount, and a setState in the
  // synchronous part of an effect cascades renders.
  const load = useCallback((refresh = false) => {
    fetch(`/api/cleaning/shift${refresh ? '?refresh=1' : ''}`)
      .then(res => res.json().then(body => ({ ok: res.ok, body })))
      .then(({ ok, body }) => {
        if (!ok) { setError(body?.error ?? 'Could not load tonight’s list.'); return }
        apply(body)
        setError(null)
      })
      .catch(() => setError('No connection — the list can’t load right now.'))
      .finally(() => setLoading(false))
  }, [apply])

  useEffect(() => { load() }, [load])

  // ── Derived ───────────────────────────────────────────────────────────

  const assigneeOf = useCallback((item: CleaningShiftItem): Crew | null => {
    const id = shift?.area_assignments?.[item.area_name]
    return id ? crew.find(c => c.id === id) ?? null : null
  }, [shift, crew])

  // "My items" is the default on a two-person night: the phone in your hand
  // should show your half of the plant. Shared rooms show for everyone.
  const showMine = mineOnly ?? (crew.length > 1)
  const isMine = useCallback((item: CleaningShiftItem) => {
    if (!showMine || !member) return true
    const a = assigneeOf(item)
    return !a || a.id === member.id
  }, [showMine, member, assigneeOf])

  const p1Done = p1Complete(items)

  // Room > Equipment > Process inside each tier, in the walking order the
  // builder already sorted them into. A room's own chores carry no equipment
  // and stay loose at the top of the room.
  const tiers = useMemo(() => PRIORITIES.map(p => {
    const all  = items.filter(i => i.priority === p)
    const list = all.filter(isMine)
    const map  = new Map<string, CleaningShiftItem[]>()
    for (const it of list) {
      if (!map.has(it.area_name)) map.set(it.area_name, [])
      map.get(it.area_name)!.push(it)
    }
    const areas = [...map.entries()].map(([area, rows]) => {
      const loose: CleaningShiftItem[] = []
      const byEquip = new Map<string, CleaningShiftItem[]>()
      for (const it of rows) {
        if (!it.equipment_name) { loose.push(it); continue }
        if (!byEquip.has(it.equipment_name)) byEquip.set(it.equipment_name, [])
        byEquip.get(it.equipment_name)!.push(it)
      }
      return { area, rows, loose, equipment: [...byEquip.entries()] }
    })
    return { p, all, list, areas, progress: shiftProgress(all), mineProgress: shiftProgress(list) }
  }), [items, isMine])

  // P1 open until it's finished; then it folds away and P2/P3 open up. That
  // is the whole "P1 first" rule expressed as what the thumb lands on.
  const visibleTiers = useMemo(() => {
    if (openTiers) return openTiers
    return new Set<Priority>(p1Done ? [2, 3] : [1])
  }, [openTiers, p1Done])

  const visibleAreas = useMemo(() => {
    if (openAreas) return openAreas
    const open = new Set<string>()
    for (const t of tiers) {
      const first = t.areas.find(a => a.rows.some(i => i.status === 'pending'))
      if (first) open.add(`${t.p}:${first.area}`)
    }
    return open
  }, [openAreas, tiers])

  const photosFor = (itemId: string) => photos.filter(p => p.shift_item_id === itemId)

  // ── Writes ────────────────────────────────────────────────────────────

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
      const { p1_complete_at, ...row } = body as CleaningShiftItem & { p1_complete_at?: string | null }
      setItems(prev => prev.map(i => (i.id === item.id ? row : i)))
      // The server stamps P1-complete on the shift; mirror it so the banner
      // shows the recorded time, not the phone's.
      if (p1_complete_at !== undefined) {
        setShift(s => s ? { ...s, p1_complete_at } : s)
      }
      setError(null)
    } catch {
      setItems(before)
      setError('That didn’t save — check your signal.')
    }
  }

  async function post(body: Record<string, unknown>): Promise<unknown> {
    const res  = await fetch('/api/cleaning/shift', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    })
    const data = await res.json()
    if (!res.ok) { setError(data?.error ?? 'That didn’t save.'); return null }
    setError(null)
    return data
  }

  async function startShift(crewIds: string[]) {
    if (!member) return
    setLoading(true)
    const data = await post({ action: 'start', by: member.name, by_id: member.id, crew_ids: crewIds })
    if (data) apply(data as unknown as Payload)
    setLoading(false)
  }

  async function closeShift() {
    if (!member || !shift) return
    const data = await post({ shift_id: shift.id, by: member.name })
    if (!data) return
    const { crew: c, ...s } = data as Shift & { crew: Crew[] }
    setShift(s)
    setCrew(c ?? crew)
    setItems(prev => prev.map(i =>
      i.status === 'pending' && i.priority !== 1 ? { ...i, status: 'rolled' } : i))
    setClosing(false)
  }

  async function reopenShift() {
    if (!shift) return
    const data = await post({ shift_id: shift.id, action: 'reopen' })
    if (!data) return
    const { crew: c, ...s } = data as Shift & { crew: Crew[] }
    setShift(s)
    setCrew(c ?? crew)
    setItems(prev => prev.map(i => i.status === 'rolled' ? { ...i, status: 'pending' } : i))
    setReopening(false)
  }

  async function updateShift(patch: { crew_ids?: string[]; area_assignments?: Record<string, string> }) {
    if (!shift) return
    const data = await post({ shift_id: shift.id, action: 'update', ...patch })
    if (!data) return
    const { crew: c, ...s } = data as Shift & { crew: Crew[] }
    setShift(s)
    setCrew(c ?? crew)
  }

  // ── Render ────────────────────────────────────────────────────────────

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

  if (!shift) {
    return (
      <div style={{ paddingBottom: 60 }}>
        <CleaningHeader
          title={dateISO ? dateLabel(dateISO) : 'Tonight'}
          back="/cleaning"
          member={member}
          onSwitch={() => setSwitching(true)}
        />
        <div style={{ padding: 16, maxWidth: 720, margin: '0 auto' }}>
          {error && <Banner tone="error">{error}</Banner>}
          <StartShift member={member} onStart={startShift} />
        </div>
      </div>
    )
  }

  const closed   = shift.status === 'closed'
  const hardStop = hardStopFor(shift.shift_date)
  const started  = shift.started_at ? new Date(shift.started_at).getTime() : null
  const over     = !closed && now >= hardStop.getTime()
  const p1       = tiers[0]
  const p1Pending  = p1.all.filter(i => i.status === 'pending').length
  const rollable   = items.filter(i => i.status === 'pending' && i.priority !== 1).length
  const rolledNow  = items.filter(i => i.status === 'rolled').length

  return (
    <div style={{ paddingBottom: over ? 200 : 100 }}>
      <CleaningHeader
        title={dateLabel(shift.shift_date)}
        back="/cleaning"
        member={member}
        onSwitch={() => setSwitching(true)}
      />

      {/* ── Sticky shift clock ─────────────────────────────────────────── */}
      <div style={{
        position: 'sticky', top: 57, zIndex: 40,
        background: C.dark, borderBottom: `1px solid ${C.medBrown}`,
        padding: '8px 16px 10px',
      }}>
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
          <div style={{
            display: 'flex', flexWrap: 'wrap', gap: '4px 10px', alignItems: 'baseline',
            color: C.tan, fontSize: 13, marginBottom: 6,
          }}>
            <span>Started <b style={{ color: C.cream }}>{fmtShopTime(shift.started_at)}</b></span>
            {started !== null && !closed && <span>· {fmtSpan(now - started)} elapsed</span>}
            {closed
              ? <span>· Closed <b style={{ color: C.cream }}>{fmtShopTime(shift.closed_at)}</b></span>
              : <span>· Hard stop <b style={{ color: over ? C.red : C.cream }}>{fmtShopTime(hardStop)}</b></span>}
            {!closed && (
              <span style={{ color: over ? C.red : C.tan, fontWeight: over ? 700 : 400 }}>
                · {over ? `${fmtSpan(now - hardStop.getTime())} over` : `${fmtSpan(hardStop.getTime() - now)} left`}
              </span>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ color: PRIORITY_TONE[1], fontSize: 13, fontWeight: 800, whiteSpace: 'nowrap' }}>
              P1 {p1.progress.done + p1.progress.na}/{p1.progress.total}
            </span>
            <div style={{ flex: 1 }}>
              <ProgressBar pct={p1.progress.pct} tone={p1Done ? C.green : PRIORITY_TONE[1]} />
            </div>
            {crew.length > 1 && (
              <button
                onClick={() => setMineOnly(!showMine)}
                style={{
                  background: showMine ? C.medBrown : 'transparent',
                  border: `1px solid ${C.medBrown}`, borderRadius: 14,
                  color: C.cream, fontSize: 12, padding: '4px 10px', cursor: 'pointer', whiteSpace: 'nowrap',
                }}
              >
                {showMine ? 'My items' : 'Everyone'}
              </button>
            )}
          </div>

          <BreakStrip shiftDate={shift.shift_date} crew={crew} now={now} />
        </div>
      </div>

      <div style={{ padding: 16, maxWidth: 720, margin: '0 auto' }}>
        {error && <Banner tone="error">{error}</Banner>}

        {closed && (
          <Banner tone="ok">
            Closed by {shift.closed_by === 'system' ? 'the 3:00 AM clock' : shift.closed_by}
            {rolledNow > 0 && <> — {rolledNow} item{rolledNow === 1 ? '' : 's'} rolled to the morning list</>}.
            {' '}
            {reopening ? (
              <span style={{ display: 'inline-flex', gap: 8, marginLeft: 6 }}>
                <button onClick={reopenShift} style={miniBtn(C.green)}>Yes, reopen</button>
                <button onClick={() => setReopening(false)} style={miniBtn(C.dark)}>No</button>
              </span>
            ) : (
              <button onClick={() => setReopening(true)} style={miniBtn(C.dark)}>Reopen</button>
            )}
          </Banner>
        )}

        {p1Done && !closed && (
          <Banner tone="ok">
            ✓ <b>P1 complete — {fmtShopTime(shift.p1_complete_at ?? new Date(now))}</b>. Everything left is P2 and P3.
          </Banner>
        )}

        {/* Who's on + split */}
        <div style={{ ...cardStyle, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ color: C.tan, fontSize: 13 }}>On tonight:</span>
          {crew.length === 0 && <span style={{ color: C.lightBrown, fontSize: 13 }}>nobody checked in</span>}
          {crew.map(c => (
            <span key={c.id} style={{
              color: C.cream, fontSize: 13, fontWeight: 700,
              border: `1px solid ${C.medBrown}`, borderRadius: 14, padding: '3px 10px',
            }}>
              {c.name}
            </span>
          ))}
          {!closed && (
            <button onClick={() => setSplitOpen(o => !o)} style={{ ...miniBtn(C.dark), marginLeft: 'auto' }}>
              {splitOpen ? 'Done' : crew.length > 1 ? 'Crew & split' : 'Crew'}
            </button>
          )}
          {shift.production_seen && (
            <div style={{ width: '100%', color: C.lightBrown, fontSize: 12 }}>
              {shift.production_seen.length > 0
                ? <>Built for: {shift.production_seen.join(' · ')}</>
                : <>No production logged this day — showing the everyday list only.</>}
            </div>
          )}
        </div>

        {splitOpen && !closed && (
          <SplitEditor
            key={JSON.stringify(shift.area_assignments) + crew.map(c => c.id).join(',')}
            shift={shift}
            crew={crew}
            areas={[...new Set(items.map(i => i.area_name))]}
            onSave={updateShift}
          />
        )}

        {items.length === 0 && (
          <div style={{ ...cardStyle, textAlign: 'center', color: C.tan }}>
            <p style={{ marginBottom: 12 }}>Nothing on tonight&apos;s list.</p>
            <p style={{ fontSize: 13, color: C.lightBrown }}>
              Either the checklist hasn&apos;t been set up yet, or nothing came due.
            </p>
          </div>
        )}

        {/* ── Tiers ──────────────────────────────────────────────────────── */}
        {tiers.map(({ p, all, list, areas, progress, mineProgress }) => {
          if (all.length === 0) return null
          const open = visibleTiers.has(p)
          const tone = PRIORITY_TONE[p]
          const tierDone = progress.pending === 0 && progress.rolled === 0
          return (
            <div key={p} style={{ marginBottom: 16 }}>
              <button
                onClick={() => setOpenTiers(() => {
                  const next = new Set(visibleTiers)
                  if (next.has(p)) next.delete(p); else next.add(p)
                  return next
                })}
                style={{
                  width: '100%', minHeight: TAP, background: C.dark,
                  border: `2px solid ${tierDone ? C.green : tone}`, borderRadius: 12,
                  color: C.cream, padding: '10px 14px', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left',
                }}
              >
                <span style={{ fontSize: 16, color: C.tan }}>{open ? '▾' : '▸'}</span>
                <span style={{
                  color: tierDone ? C.green : tone, fontSize: 18, fontWeight: 900, letterSpacing: 0.5,
                }}>
                  P{p}
                </span>
                <span style={{ flex: 1 }}>
                  <div style={{ fontSize: 15, fontWeight: 700 }}>{PRIORITY_LABEL[p]}</div>
                  <div style={{ fontSize: 12, color: C.lightBrown }}>{PRIORITY_BLURB[p]}</div>
                </span>
                <span style={{
                  fontSize: 15, fontWeight: 700, whiteSpace: 'nowrap',
                  color: tierDone ? C.green : C.cream,
                }}>
                  {tierDone ? '✓ ' : ''}{progress.done + progress.na}/{progress.total}
                  {showMine && list.length !== all.length && (
                    <span style={{ color: C.lightBrown, fontSize: 12, fontWeight: 400 }}>
                      {' '}· mine {mineProgress.done + mineProgress.na}/{mineProgress.total}
                    </span>
                  )}
                </span>
              </button>

              {open && areas.length === 0 && (
                <div style={{ color: C.lightBrown, fontSize: 13, padding: '10px 14px' }}>
                  Nothing in this tier is on your side of the plant.
                </div>
              )}

              {open && areas.map(({ area, rows, loose, equipment }) => {
                const key    = `${p}:${area}`
                const aOpen  = visibleAreas.has(key)
                const ap     = shiftProgress(rows)
                const who    = crew.length > 1 ? assigneeOf(rows[0]) : null
                return (
                  <div key={key} style={{ margin: '10px 0 0 6px' }}>
                    <button
                      onClick={() => setOpenAreas(() => {
                        const next = new Set(visibleAreas)
                        if (next.has(key)) next.delete(key); else next.add(key)
                        return next
                      })}
                      style={{
                        width: '100%', minHeight: TAP, background: C.dark,
                        border: `1px solid ${C.medBrown}`, borderRadius: 10,
                        color: C.cream, padding: '10px 14px', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left',
                      }}
                    >
                      <span style={{ fontSize: 16, color: C.tan }}>{aOpen ? '▾' : '▸'}</span>
                      <span style={{ flex: 1, fontSize: 16, fontWeight: 700 }}>{area}</span>
                      {who && <AssigneeChip name={who.name} mine={who.id === member.id} />}
                      <span style={{
                        fontSize: 13,
                        color: ap.complete ? C.green : C.tan,
                        whiteSpace: 'nowrap',
                      }}>
                        {ap.complete ? '✓ done' : ap.rolled > 0 && ap.pending === 0 ? `${ap.rolled} → morning` : `${ap.pending} left`}
                      </span>
                    </button>

                    {aOpen && (() => {
                      const row = (item: CleaningShiftItem) => (
                        <ItemRow
                          key={item.id}
                          item={item}
                          photos={photosFor(item.id)}
                          shiftId={shift.id}
                          memberName={member.name}
                          disabled={closed}
                          expanded={expanded === item.id}
                          onToggleExpand={() => setExpanded(expanded === item.id ? null : item.id)}
                          onMark={mark}
                          onPhoto={ph => setPhotos(prev => [...prev, ph])}
                        />
                      )
                      return (
                        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
                          {loose.map(row)}
                          {/* One block per machine, with its own count — a
                              stuffer is stripped, washed and put back as one
                              job, and the crew needs to see whether the whole
                              machine is done. */}
                          {equipment.map(([name, eqRows]) => {
                            const ep = shiftProgress(eqRows)
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
                                {eqRows.map(row)}
                              </div>
                            )
                          })}
                        </div>
                      )
                    })()}
                  </div>
                )
              })}
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
            {!over && (
              closing ? (
                <CloseConfirm p1Pending={p1Pending} rollable={rollable} onYes={closeShift} onNo={() => setClosing(false)} />
              ) : (
                <BigButton
                  label="Close out the night"
                  tone={p1Done ? C.green : C.medBrown}
                  onClick={() => setClosing(true)}
                />
              )
            )}
          </div>
        )}
      </div>

      {/* ── Hard stop ──────────────────────────────────────────────────── */}
      {over && (
        <div style={{
          position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 60,
          background: C.red, borderTop: `2px solid ${C.cream}`,
          padding: '12px 16px', boxShadow: '0 -6px 20px rgba(0,0,0,0.5)',
        }}>
          <div style={{ maxWidth: 720, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ color: C.cream, fontSize: 17, fontWeight: 800 }}>
              Shift over — {fmtShopTime(hardStop)} hard stop, {fmtSpan(now - hardStop.getTime())} ago
            </div>
            {closing ? (
              <CloseConfirm p1Pending={p1Pending} rollable={rollable} onYes={closeShift} onNo={() => setClosing(false)} dark />
            ) : (
              <BigButton label="Close out the night" tone={C.dark} onClick={() => setClosing(true)} />
            )}
          </div>
        </div>
      )}
    </div>
  )
}

const miniBtn = (bg: string): React.CSSProperties => ({
  background: bg, border: `1px solid ${C.medBrown}`, borderRadius: 8,
  color: C.cream, fontSize: 13, fontWeight: 600, padding: '6px 12px', cursor: 'pointer', minHeight: 36,
})

function AssigneeChip({ name, mine }: { name: string; mine: boolean }) {
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap',
      color: mine ? C.cream : C.tan,
      background: mine ? C.medBrown : 'transparent',
      border: `1px solid ${C.medBrown}`, borderRadius: 10, padding: '2px 8px',
    }}>
      {firstName(name)}
    </span>
  )
}

// ── Close-out confirm ───────────────────────────────────────────────────

function CloseConfirm({ p1Pending, rollable, onYes, onNo, dark }: {
  p1Pending: number; rollable: number; onYes: () => void; onNo: () => void; dark?: boolean
}) {
  return (
    <div style={{
      ...cardStyle, background: dark ? C.dark : C.darkBrown,
      display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      {p1Pending > 0 ? (
        <div style={{ color: C.red, fontSize: 15, fontWeight: 700 }}>
          ⚠ {p1Pending} P1 item{p1Pending === 1 ? '' : 's'} still open. P1 is not optional — closing now records {p1Pending === 1 ? 'it' : 'them'} as missed.
        </div>
      ) : (
        <div style={{ color: C.green, fontSize: 15, fontWeight: 700 }}>✓ P1 is finished.</div>
      )}
      <div style={{ color: C.cream, fontSize: 14 }}>
        {rollable > 0
          ? `${rollable} P2/P3 item${rollable === 1 ? '' : 's'} will roll to the morning list for the first cutter.`
          : 'Nothing left to roll to the morning.'}
      </div>
      <BigButton label="Yes, close the shift" tone={C.green} onClick={onYes} />
      <BigButton label="Not yet" tone={dark ? C.darkBrown : C.dark} onClick={onNo} />
    </div>
  )
}

// ── Start screen ────────────────────────────────────────────────────────

function StartShift({ member, onStart }: { member: CrewMember; onStart: (ids: string[]) => void }) {
  const [roster,  setRoster]  = useState<Crew[]>([])
  const [picked,  setPicked]  = useState<Set<string>>(() => new Set([member.id]))
  const [busy,    setBusy]    = useState(false)

  useEffect(() => {
    fetch('/api/cleaning/crew')
      .then(r => r.json())
      .then(d => setRoster(Array.isArray(d) ? d : []))
      .catch(() => setRoster([]))
  }, [])

  const toggle = (id: string) => setPicked(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  return (
    <div style={{ ...cardStyle, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <div style={{ color: C.cream, fontSize: 20, fontWeight: 800 }}>Start tonight&apos;s shift</div>
        <div style={{ color: C.tan, fontSize: 14, marginTop: 4 }}>
          Tick everyone on tonight. The clock starts when you press Start; hard stop is 1:30 AM.
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {roster.map(c => {
          const on = picked.has(c.id)
          return (
            <button
              key={c.id}
              onClick={() => toggle(c.id)}
              style={{
                minHeight: TAP, textAlign: 'left', padding: '0 16px', cursor: 'pointer',
                background: on ? C.medBrown : C.dark,
                border: `2px solid ${on ? C.tan : C.medBrown}`, borderRadius: 10,
                color: C.cream, fontSize: 17, fontWeight: 600,
                display: 'flex', alignItems: 'center', gap: 12,
              }}
            >
              <span style={{ fontSize: 22, width: 28 }}>{on ? '☑' : '☐'}</span>
              {c.name}
              {c.id === member.id && <span style={{ color: C.tan, fontSize: 12, marginLeft: 'auto' }}>you</span>}
            </button>
          )
        })}
      </div>

      <BigButton
        label={busy ? 'Starting…' : `Start shift — ${picked.size} on tonight`}
        tone={C.green}
        disabled={busy || picked.size === 0}
        onClick={() => { setBusy(true); onStart([...picked]) }}
      />
      <div style={{ color: C.lightBrown, fontSize: 12 }}>
        With two on, the plant splits harvest side / processing side by default. You can move rooms after starting.
      </div>
    </div>
  )
}

// ── Breaks ──────────────────────────────────────────────────────────────

function slotRange(shiftDate: string, slot: BreakSlot): [number, number] {
  // Breaks live on the evening of shift_date; a slot ending at 00:00 (or any
  // time before the 5 PM start) has crossed midnight into the next day.
  const day = (hhmm: string) => Number(hhmm.slice(0, 2)) < 12 ? addDaysISO(shiftDate, 1) : shiftDate
  const at  = (hhmm: string) => {
    const [h, m] = hhmm.split(':').map(Number)
    return shopTime(day(hhmm), h, m).getTime()
  }
  return [at(slot.start), at(slot.end)]
}

function BreakStrip({ shiftDate, crew, now }: { shiftDate: string; crew: Crew[]; now: number }) {
  const plan = breakPlan(crew.map(c => c.name))
  return (
    <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 2 }}>
      {plan.map(({ who, slots }, i) => (
        <div key={who + i} style={{ display: 'flex', gap: 8, fontSize: 12, color: C.lightBrown, flexWrap: 'wrap' }}>
          {plan.length > 1 && (
            <span style={{ color: C.tan, fontWeight: 700, minWidth: 60 }}>{firstName(who)}</span>
          )}
          {slots.map((s, j) => {
            const [a, b] = slotRange(shiftDate, s)
            const live = now >= a && now < b
            return (
              <span key={j} style={{ color: live ? C.cream : undefined, fontWeight: live ? 700 : 400 }}>
                {live ? '● ' : ''}{s.label} {fmtClock(s.start)}–{fmtClock(s.end)}
                {j < slots.length - 1 ? ' ·' : ''}
              </span>
            )
          })}
        </div>
      ))}
    </div>
  )
}

// ── Crew & area split ───────────────────────────────────────────────────

function SplitEditor({ shift, crew, areas, onSave }: {
  shift: Shift
  crew: Crew[]
  areas: string[]
  onSave: (patch: { crew_ids?: string[]; area_assignments?: Record<string, string> }) => Promise<void>
}) {
  const [roster, setRoster] = useState<Crew[]>([])
  const [assign, setAssign] = useState<Record<string, string>>(shift.area_assignments ?? {})
  const [dirty,  setDirty]  = useState(false)

  useEffect(() => {
    fetch('/api/cleaning/crew')
      .then(r => r.json())
      .then(d => setRoster(Array.isArray(d) ? d : []))
      .catch(() => setRoster([]))
  }, [])

  // Re-seeded by the parent keying this component on the server's split, so a
  // re-deal after a crew change remounts it with fresh state.
  const onIds = new Set(crew.map(c => c.id))

  return (
    <div style={{ ...cardStyle, marginBottom: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <div style={{ color: C.cream, fontSize: 15, fontWeight: 700, marginBottom: 6 }}>Who&apos;s on</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {roster.map(c => {
            const on = onIds.has(c.id)
            return (
              <button
                key={c.id}
                onClick={() => {
                  const next = on ? crew.filter(x => x.id !== c.id).map(x => x.id) : [...crew.map(x => x.id), c.id]
                  onSave({ crew_ids: next })
                }}
                style={{
                  minHeight: 40, padding: '0 12px', borderRadius: 20, cursor: 'pointer',
                  background: on ? C.medBrown : C.dark, border: `1px solid ${on ? C.tan : C.medBrown}`,
                  color: C.cream, fontSize: 14, fontWeight: on ? 700 : 400,
                }}
              >
                {on ? '✓ ' : ''}{c.name}
              </button>
            )
          })}
        </div>
        <div style={{ color: C.lightBrown, fontSize: 12, marginTop: 6 }}>
          Changing who&apos;s on re-deals the default split below.
        </div>
      </div>

      {crew.length > 1 && (
        <div>
          <div style={{ color: C.cream, fontSize: 15, fontWeight: 700, marginBottom: 6 }}>Rooms</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {areas.map(area => (
              <div key={area} style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span style={{ flex: '1 1 140px', color: C.tan, fontSize: 14 }}>{area}</span>
                {crew.map(c => {
                  const on = assign[area] === c.id
                  return (
                    <button
                      key={c.id}
                      onClick={() => { setAssign(a => ({ ...a, [area]: c.id })); setDirty(true) }}
                      style={{
                        minHeight: 36, padding: '0 10px', borderRadius: 8, cursor: 'pointer',
                        background: on ? C.medBrown : C.dark, border: `1px solid ${on ? C.tan : C.medBrown}`,
                        color: C.cream, fontSize: 13, fontWeight: on ? 700 : 400,
                      }}
                    >
                      {firstName(c.name)}
                    </button>
                  )
                })}
                <button
                  onClick={() => { setAssign(a => { const n = { ...a }; delete n[area]; return n }); setDirty(true) }}
                  style={{
                    minHeight: 36, padding: '0 10px', borderRadius: 8, cursor: 'pointer',
                    background: !assign[area] ? C.medBrown : C.dark,
                    border: `1px solid ${!assign[area] ? C.tan : C.medBrown}`,
                    color: C.cream, fontSize: 13,
                  }}
                >
                  Either
                </button>
              </div>
            ))}
          </div>
          {dirty && (
            <div style={{ marginTop: 10 }}>
              <BigButton label="Save split" tone={C.green} onClick={() => onSave({ area_assignments: assign }).then(() => setDirty(false))} />
            </div>
          )}
        </div>
      )}
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

  const done   = item.status === 'done'
  const na     = item.status === 'na'
  const flag   = item.status === 'issue'
  const rolled = item.status === 'rolled'
  const spec   = outOfSpec(item)
  const badge  = itemSourceLabel(item.source)
  const locked = disabled || rolled

  const tone = flag ? C.amber : spec ? C.red : done ? C.green : na ? C.lightBrown : rolled ? C.blue : C.medBrown

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
          onClick={() => !locked && onMark(item, done ? 'pending' : 'done',
            item.input_type === 'number' && reading !== ''
              ? { value_num: Number(reading) }
              : undefined)}
          disabled={locked}
          aria-label={done ? `Undo ${item.title}` : `Mark ${item.title} done`}
          style={{
            width:      TAP,
            minHeight:  TAP,
            background: done ? C.green : 'transparent',
            border:     'none',
            borderRight: `1px solid ${C.medBrown}`,
            color:      done ? C.cream : C.medBrown,
            fontSize:   26,
            cursor:     locked ? 'default' : 'pointer',
            flexShrink: 0,
          }}
        >
          {done ? '✓' : na ? '—' : flag ? '!' : rolled ? '→' : '○'}
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
            {rolled && (
              <span style={{ color: C.blue, fontSize: 11, fontWeight: 700 }}>→ morning list</span>
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
                onBlur={() => reading !== '' && !locked &&
                  onMark(item, item.status, { value_num: Number(reading) })}
                style={inputStyle}
              />
            </div>
          )}

          <PhotoButton
            label={photos.length ? 'Another photo' : 'Add a photo'}
            disabled={locked}
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
            onBlur={() => note !== (item.note ?? '') && !locked &&
              onMark(item, item.status, { note })}
            placeholder="Note (optional)"
            rows={2}
            style={{ ...inputStyle, resize: 'vertical' }}
          />

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => !locked && onMark(item, na ? 'pending' : 'na')}
              disabled={locked}
              style={{
                flex: 1, minHeight: 46, background: na ? C.lightBrown : C.dark,
                border: `1px solid ${C.medBrown}`, borderRadius: 8,
                color: C.cream, fontSize: 14, cursor: locked ? 'default' : 'pointer',
              }}
            >
              {na ? 'Undo N/A' : "Didn't apply"}
            </button>
            <button
              onClick={() => !locked && onMark(item, flag ? 'pending' : 'issue')}
              disabled={locked}
              style={{
                flex: 1, minHeight: 46, background: flag ? C.amber : C.dark,
                border: `1px solid ${flag ? C.amber : C.medBrown}`, borderRadius: 8,
                color: C.cream, fontSize: 14, cursor: locked ? 'default' : 'pointer',
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
