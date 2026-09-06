'use client'
import { useEffect, useState, useCallback } from 'react'
import {
  FREQUENCIES, PRODUCTION_SIGNALS, SIGNAL_LABEL, SIGNAL_SOURCE, PHASES, PHASE_LABEL,
  PRIORITIES, PRIORITY_LABEL, PRIORITY_BLURB,
  type Frequency, type ProductionSignal, type Phase, type CleaningStep, type Priority,
} from '@/lib/cleaning'
import { C, TAP, CleaningHeader, Banner, BigButton, PhotoButton, VideoButton, StepVideo, inputStyle, cardStyle } from '../ui'
import MapEditor from './MapEditor'

// Where the checklist and the procedures get written.
//
// Not crew-facing, so it trades thumb-sized targets for density. It's still on
// the same phone-first layout though — a lot of this gets written standing in
// front of a machine with the parts in pieces, which is the only time the steps
// are actually fresh in someone's mind.

type Tab = 'tasks' | 'equipment' | 'map' | 'crew' | 'supplies' | 'suggestions'

interface Area  { id: string; name: string; sort_order: number; cleaning_equipment: Equip[] }
interface Equip { id: string; name: string; make_model: string | null; area_id?: string }
interface Task {
  id: string; area_id: string; asset_id: string | null
  title: string; detail: string | null; frequency: Frequency
  priority: Priority
  weekday: number | null; day_of_month: number | null
  production_triggers: string[] | null; requires_photo: boolean
  input_type: 'none' | 'number' | 'text'
  input_label: string | null; input_unit: string | null
  input_min: number | null; input_max: number | null
  cleaning_areas?: { name: string } | null
  cleaning_equipment?: { name: string } | null
}
interface Crew   { id: string; name: string; role: 'crew' | 'lead' }
interface Supply { id: string; name: string; unit: string | null; vendor: string | null; active: boolean }
interface Suggestion {
  id: string; suggestion: string; suggested_by: string; created_at: string
  photo_url: string | null
  cleaning_equipment?: { id: string; name: string } | null
  cleaning_steps?: { step_no: number; phase: string; instruction: string } | null
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

// Same tier colours the shift view uses.
const PRIORITY_TONE: Record<Priority, string> = { 1: C.red, 2: C.amber, 3: C.blue }

export default function AdminPage() {
  const [tab,   setTab]   = useState<Tab>('tasks')
  const [areas, setAreas] = useState<Area[]>([])
  const [error, setError] = useState<string | null>(null)

  const loadAreas = useCallback(() => {
    fetch('/api/cleaning/areas')
      .then(r => r.json())
      .then(d => setAreas(Array.isArray(d) ? d : []))
      .catch(() => setError('Could not load areas.'))
  }, [])

  useEffect(() => { loadAreas() }, [loadAreas])

  const TABS: [Tab, string][] = [
    ['tasks', 'Checklist'], ['equipment', 'Equipment'], ['map', 'Map'],
    ['crew', 'Crew'], ['supplies', 'Supplies'], ['suggestions', 'Notes'],
  ]

  return (
    <div style={{ paddingBottom: 60 }}>
      <CleaningHeader title="Manage" back="/cleaning" />

      <div style={{ padding: 16, maxWidth: 760, margin: '0 auto' }}>
        {error && <Banner tone="error">{error}</Banner>}

        <div style={{ display: 'flex', gap: 6, marginBottom: 20, overflowX: 'auto' }}>
          {TABS.map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              style={{
                minHeight: 44, padding: '0 14px', borderRadius: 8, whiteSpace: 'nowrap',
                background: tab === key ? C.medBrown : C.dark,
                border: `1px solid ${C.medBrown}`,
                color: tab === key ? C.cream : C.tan,
                fontSize: 14, fontWeight: tab === key ? 700 : 400, cursor: 'pointer',
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'tasks'       && <TasksTab areas={areas} onError={setError} />}
        {tab === 'equipment'   && <EquipmentTab areas={areas} reload={loadAreas} onError={setError} />}
        {tab === 'map'         && <MapEditor onError={setError} />}
        {tab === 'crew'        && <CrewTab onError={setError} />}
        {tab === 'supplies'    && <SuppliesTab onError={setError} />}
        {tab === 'suggestions' && <SuggestionsTab onError={setError} />}
      </div>
    </div>
  )
}

// ── Checklist ───────────────────────────────────────────────────────────

function TasksTab({ areas, onError }: { areas: Area[]; onError: (e: string) => void }) {
  const [tasks,   setTasks]   = useState<Task[]>([])
  const [editing, setEditing] = useState<Partial<Task> | null>(null)

  const load = useCallback(() => {
    fetch('/api/cleaning/tasks')
      .then(r => r.json())
      .then(d => setTasks(Array.isArray(d) ? d : []))
      .catch(() => onError('Could not load the checklist.'))
  }, [onError])

  useEffect(() => { load() }, [load])

  async function save(task: Partial<Task>) {
    const res = await fetch('/api/cleaning/tasks', {
      method:  task.id ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(task),
    })
    const body = await res.json()
    if (!res.ok) { onError(body?.error ?? "Couldn't save that."); return }
    setEditing(null)
    load()
  }

  async function remove(id: string) {
    await fetch(`/api/cleaning/tasks?id=${id}`, { method: 'DELETE' })
    load()
  }

  const byArea = new Map<string, Task[]>()
  for (const t of tasks) {
    const key = t.cleaning_areas?.name ?? 'Unassigned'
    if (!byArea.has(key)) byArea.set(key, [])
    byArea.get(key)!.push(t)
  }

  if (editing) {
    return (
      <TaskEditor
        task={editing}
        areas={areas}
        onSave={save}
        onCancel={() => setEditing(null)}
      />
    )
  }

  return (
    <>
      <div style={{ marginBottom: 16 }}>
        <BigButton label="+ Add a checklist item" onClick={() => setEditing({ frequency: 'daily', priority: 2 })} />
      </div>

      {[...byArea.entries()].map(([area, list]) => (
        <div key={area} style={{ marginBottom: 20 }}>
          <div style={{
            color: C.tan, fontSize: 13, fontWeight: 700,
            textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8,
          }}>
            {area}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {list.map(t => (
              <div key={t.id} style={{ ...cardStyle, padding: 12 }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ color: C.cream, fontSize: 15, fontWeight: 600 }}>{t.title}</div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 5 }}>
                      <Chip tone={PRIORITY_TONE[t.priority] ?? C.amber}>P{t.priority}</Chip>
                      <Chip tone={C.blue}>{t.frequency}</Chip>
                      {t.frequency === 'weekly' && t.weekday !== null && (
                        <Chip tone={C.blue}>{WEEKDAYS[t.weekday]}</Chip>
                      )}
                      {t.cleaning_equipment?.name && <Chip tone={C.tan}>{t.cleaning_equipment.name}</Chip>}
                      {t.production_triggers?.map(s => (
                        <Chip key={s} tone={C.amber}>{s}</Chip>
                      ))}
                      {t.requires_photo && <Chip tone={C.green}>📷 required</Chip>}
                      {t.input_type === 'number' && (
                        <Chip tone={C.green}>
                          {t.input_label ?? 'reading'}{t.input_unit ? ` ${t.input_unit}` : ''}
                        </Chip>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => setEditing(t)}
                    style={miniBtn(C.tan)}
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => remove(t.id)}
                    style={miniBtn(C.red)}
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </>
  )
}

function TaskEditor({ task, areas, onSave, onCancel }: {
  task: Partial<Task>
  areas: Area[]
  onSave: (t: Partial<Task>) => void
  onCancel: () => void
}) {
  const [t, setT] = useState<Partial<Task>>(task)
  const set = (patch: Partial<Task>) => setT(prev => ({ ...prev, ...patch }))

  const equipInArea = areas.find(a => a.id === t.area_id)?.cleaning_equipment ?? []
  const triggers    = t.production_triggers ?? []

  return (
    <div style={{ ...cardStyle, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Field label="What needs doing">
        <input
          value={t.title ?? ''}
          onChange={e => set({ title: e.target.value })}
          placeholder="e.g. Break down and clean the grinder"
          style={inputStyle}
        />
      </Field>

      <Field label="Detail (optional)">
        <textarea
          value={t.detail ?? ''}
          onChange={e => set({ detail: e.target.value })}
          rows={2}
          style={{ ...inputStyle, resize: 'vertical' }}
        />
      </Field>

      <Field label="Area">
        <select
          value={t.area_id ?? ''}
          onChange={e => set({ area_id: e.target.value, asset_id: null })}
          style={inputStyle}
        >
          <option value="">— pick an area —</option>
          {areas.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </Field>

      {equipInArea.length > 0 && (
        <Field label="Equipment (optional — links to its procedure)">
          <select
            value={t.asset_id ?? ''}
            onChange={e => set({ asset_id: e.target.value || null })}
            style={inputStyle}
          >
            <option value="">— none, this is an area job —</option>
            {equipInArea.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </Field>
      )}

      <Field label="Priority">
        <div style={{ color: C.lightBrown, fontSize: 12, marginBottom: 8, lineHeight: 1.5 }}>
          P1 has to be finished inside the shift. P2 is done as time allows. P3 rolls to the
          first cutter in the morning. Changing this re-tiers the item on tonight&apos;s open
          list too; closed nights keep the tier they were judged by.
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {PRIORITIES.map(p => {
            const on = (t.priority ?? 2) === p
            return (
              <button
                key={p}
                onClick={() => set({ priority: p })}
                style={{
                  minHeight: 46, borderRadius: 8, textAlign: 'left', padding: '6px 12px',
                  background: on ? C.medBrown : C.dark,
                  border: `1px solid ${on ? PRIORITY_TONE[p] : C.medBrown}`,
                  color: on ? C.cream : C.tan, fontSize: 14, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 10,
                }}
              >
                <span style={{ color: PRIORITY_TONE[p], fontWeight: 900, fontSize: 15, width: 28 }}>P{p}</span>
                <span>
                  {PRIORITY_LABEL[p]}
                  <div style={{ fontSize: 11, color: C.lightBrown }}>{PRIORITY_BLURB[p]}</div>
                </span>
              </button>
            )
          })}
        </div>
      </Field>

      <Field label="How often">
        <div style={{ display: 'flex', gap: 6 }}>
          {FREQUENCIES.map(f => (
            <button
              key={f}
              onClick={() => set({ frequency: f, weekday: null, day_of_month: null })}
              style={{
                flex: 1, minHeight: 46, borderRadius: 8,
                background: t.frequency === f ? C.medBrown : C.dark,
                border: `1px solid ${C.medBrown}`,
                color: t.frequency === f ? C.cream : C.tan,
                fontSize: 13, cursor: 'pointer', textTransform: 'capitalize',
              }}
            >
              {f}
            </button>
          ))}
        </div>
      </Field>

      {t.frequency === 'weekly' && (
        <Field label="Which day">
          <select
            value={t.weekday ?? ''}
            onChange={e => set({ weekday: e.target.value === '' ? null : Number(e.target.value) })}
            style={inputStyle}
          >
            <option value="">Any day that week</option>
            {WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
          </select>
        </Field>
      )}

      {t.frequency === 'monthly' && (
        <Field label="Day of the month (1–28)">
          <input
            type="number" min={1} max={28}
            value={t.day_of_month ?? ''}
            onChange={e => set({ day_of_month: e.target.value === '' ? null : Number(e.target.value) })}
            style={inputStyle}
          />
        </Field>
      )}

      <Field label="Only when the plant actually did this">
        <div style={{ color: C.lightBrown, fontSize: 12, marginBottom: 8, lineHeight: 1.5 }}>
          Leave all off and it&apos;s on the list every time it&apos;s due. Turn one on and it
          only shows up on days that work happened — so the grinder teardown skips
          the days nobody ground anything.
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {PRODUCTION_SIGNALS.map(s => {
            const on = triggers.includes(s)
            return (
              <button
                key={s}
                onClick={() => set({
                  production_triggers: on
                    ? triggers.filter(x => x !== s)
                    : [...triggers, s],
                })}
                style={{
                  minHeight: 46, borderRadius: 8, textAlign: 'left', padding: '6px 12px',
                  background: on ? C.medBrown : C.dark,
                  border: `1px solid ${on ? C.amber : C.medBrown}`,
                  color: on ? C.cream : C.tan, fontSize: 14, cursor: 'pointer',
                }}
              >
                {on ? '☑' : '☐'} {SIGNAL_LABEL[s as ProductionSignal]}
                <div style={{ fontSize: 11, color: C.lightBrown }}>
                  detected from {SIGNAL_SOURCE[s as ProductionSignal]}
                </div>
              </button>
            )
          })}
        </div>
      </Field>

      <Field label="Photo required to check it off">
        <button
          onClick={() => set({ requires_photo: !t.requires_photo })}
          style={{
            minHeight: 46, width: '100%', borderRadius: 8,
            background: t.requires_photo ? C.green : C.dark,
            border: `1px solid ${t.requires_photo ? C.green : C.medBrown}`,
            color: C.cream, fontSize: 14, cursor: 'pointer',
          }}
        >
          {t.requires_photo ? '📷 Yes — photo required' : 'No photo needed'}
        </button>
      </Field>

      <Field label="Record a reading">
        <div style={{ color: C.lightBrown, fontSize: 12, marginBottom: 8, lineHeight: 1.5 }}>
          Turn this on for anything measured — sanitizer ppm, final rinse temp.
          The crew has to enter the number before the item will check off, and a
          value outside the range is flagged on the spot.
        </div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          {(['none', 'number', 'text'] as const).map(k => (
            <button
              key={k}
              onClick={() => set({ input_type: k })}
              style={{
                flex: 1, minHeight: 44, borderRadius: 8,
                background: t.input_type === k ? C.medBrown : C.dark,
                border: `1px solid ${C.medBrown}`,
                color: t.input_type === k ? C.cream : C.tan,
                fontSize: 13, cursor: 'pointer',
              }}
            >
              {k === 'none' ? 'Just a checkmark' : k === 'number' ? 'A number' : 'Free text'}
            </button>
          ))}
        </div>

        {t.input_type === 'number' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <input
              value={t.input_label ?? ''}
              onChange={e => set({ input_label: e.target.value })}
              placeholder="Label — e.g. Sanitizer concentration"
              style={inputStyle}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                value={t.input_unit ?? ''}
                onChange={e => set({ input_unit: e.target.value })}
                placeholder="Unit (ppm)"
                style={inputStyle}
              />
              <input
                type="number"
                value={t.input_min ?? ''}
                onChange={e => set({ input_min: e.target.value === '' ? null : Number(e.target.value) })}
                placeholder="Min"
                style={inputStyle}
              />
              <input
                type="number"
                value={t.input_max ?? ''}
                onChange={e => set({ input_max: e.target.value === '' ? null : Number(e.target.value) })}
                placeholder="Max"
                style={inputStyle}
              />
            </div>
          </div>
        )}
      </Field>

      <BigButton
        label={t.id ? 'Save changes' : 'Add it'}
        onClick={() => onSave(t)}
        disabled={!t.title?.trim() || !t.area_id}
      />
      <button
        onClick={onCancel}
        style={{
          background: 'none', border: 'none', color: C.lightBrown,
          fontSize: 14, cursor: 'pointer', minHeight: 40,
        }}
      >
        Cancel
      </button>
    </div>
  )
}

// ── Equipment & procedures ──────────────────────────────────────────────

function EquipmentTab({ areas, reload, onError }: {
  areas: Area[]; reload: () => void; onError: (e: string) => void
}) {
  const [selected, setSelected] = useState<string | null>(null)
  const [adding,   setAdding]   = useState(false)
  const [name,     setName]     = useState('')
  const [model,    setModel]    = useState('')
  const [areaId,   setAreaId]   = useState('')

  async function add() {
    const res = await fetch('/api/cleaning/equipment', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ area_id: areaId, name, make_model: model }),
    })
    const body = await res.json()
    if (!res.ok) { onError(body?.error ?? "Couldn't add that."); return }
    setName(''); setModel(''); setAdding(false)
    reload()
    setSelected(body.id)
  }

  if (selected) {
    return <ProcedureEditor equipmentId={selected} onBack={() => setSelected(null)} onError={onError} />
  }

  return (
    <>
      {!adding && (
        <div style={{ marginBottom: 16 }}>
          <BigButton label="+ Add a machine" onClick={() => setAdding(true)} />
        </div>
      )}

      {adding && (
        <div style={{ ...cardStyle, marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <select value={areaId} onChange={e => setAreaId(e.target.value)} style={inputStyle}>
            <option value="">— which area? —</option>
            {areas.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <input
            value={name} onChange={e => setName(e.target.value)}
            placeholder="Name — e.g. Grinder" style={inputStyle}
          />
          <input
            value={model} onChange={e => setModel(e.target.value)}
            placeholder="Make & model (optional)" style={inputStyle}
          />
          <BigButton label="Add" onClick={add} disabled={!name.trim() || !areaId} />
          <button
            onClick={() => setAdding(false)}
            style={{
              background: 'none', border: 'none', color: C.lightBrown,
              fontSize: 14, cursor: 'pointer', minHeight: 40,
            }}
          >
            Cancel
          </button>
        </div>
      )}

      {areas.map(area => (
        <div key={area.id} style={{ marginBottom: 18 }}>
          <div style={{
            color: C.tan, fontSize: 13, fontWeight: 700,
            textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8,
          }}>
            {area.name}
          </div>
          {area.cleaning_equipment.length === 0 && (
            <div style={{ color: C.lightBrown, fontSize: 13, marginBottom: 8 }}>
              Nothing here yet.
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {area.cleaning_equipment.map(e => (
              <button
                key={e.id}
                onClick={() => setSelected(e.id)}
                style={{
                  ...cardStyle, minHeight: TAP, textAlign: 'left',
                  cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10,
                }}
              >
                <div style={{ flex: 1 }}>
                  <div style={{ color: C.cream, fontSize: 15, fontWeight: 600 }}>{e.name}</div>
                  {e.make_model && (
                    <div style={{ color: C.tan, fontSize: 12 }}>{e.make_model}</div>
                  )}
                </div>
                <span style={{ color: C.tan }}>›</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </>
  )
}

function ProcedureEditor({ equipmentId, onBack, onError }: {
  equipmentId: string; onBack: () => void; onError: (e: string) => void
}) {
  const [equip, setEquip] = useState<{ name: string; steps: CleaningStep[] } | null>(null)
  const [phase, setPhase] = useState<Phase>('teardown')
  const [text,  setText]  = useState('')
  const [caution, setCaution] = useState('')
  const [photo, setPhoto] = useState<string | null>(null)
  const [video, setVideo] = useState<string | null>(null)

  const load = useCallback(() => {
    fetch(`/api/cleaning/equipment?id=${equipmentId}`)
      .then(r => r.json())
      .then(setEquip)
      .catch(() => onError('Could not load that machine.'))
  }, [equipmentId, onError])

  useEffect(() => { load() }, [load])

  async function addStep() {
    const res = await fetch('/api/cleaning/steps', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        asset_id: equipmentId, phase,
        instruction: text, caution: caution || undefined,
        photo_url: photo, video_url: video,
      }),
    })
    const body = await res.json()
    if (!res.ok) { onError(body?.error ?? "Couldn't add that step."); return }
    setText(''); setCaution(''); setPhoto(null); setVideo(null)
    load()
  }

  async function move(id: string, dir: 'up' | 'down') {
    await fetch('/api/cleaning/steps', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, move: dir }),
    })
    load()
  }

  async function removeStep(id: string) {
    await fetch(`/api/cleaning/steps?id=${id}`, { method: 'DELETE' })
    load()
  }

  if (!equip) return <p style={{ color: C.tan }}>Loading…</p>

  const steps = equip.steps.filter(s => s.phase === phase)

  return (
    <>
      <button
        onClick={onBack}
        style={{
          background: 'none', border: 'none', color: C.tan,
          fontSize: 15, cursor: 'pointer', marginBottom: 12, padding: 0,
        }}
      >
        ‹ All equipment
      </button>

      <h2 style={{ color: C.cream, fontSize: 20, marginBottom: 14 }}>{equip.name}</h2>

      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        {PHASES.map(p => (
          <button
            key={p}
            onClick={() => setPhase(p)}
            style={{
              flex: 1, minHeight: 46, borderRadius: 8,
              background: phase === p ? C.medBrown : C.dark,
              border: `1px solid ${phase === p ? C.amber : C.medBrown}`,
              color: phase === p ? C.cream : C.tan,
              fontSize: 13, cursor: 'pointer',
            }}
          >
            {PHASE_LABEL[p]}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
        {steps.map((s, i) => (
          <div key={s.id} style={{ ...cardStyle, padding: 12 }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <span style={{ color: C.tan, fontSize: 14, fontWeight: 700, minWidth: 20 }}>
                {s.step_no}.
              </span>
              <div style={{ flex: 1 }}>
                <div style={{ color: C.cream, fontSize: 15, lineHeight: 1.4 }}>{s.instruction}</div>
                {s.caution && (
                  <div style={{ color: C.red, fontSize: 13, marginTop: 4 }}>⚠ {s.caution}</div>
                )}
                {s.photo_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={s.photo_url} alt=""
                    style={{
                      width: 100, height: 100, objectFit: 'cover',
                      borderRadius: 6, marginTop: 8, border: `1px solid ${C.medBrown}`,
                    }}
                  />
                )}
                {/* Small, but playable — the only way to be sure the right clip
                    landed on the right step is to watch a second of it. */}
                {s.video_url && <StepVideo src={s.video_url} style={{ width: 180, marginTop: 8 }} />}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <button onClick={() => move(s.id, 'up')}   disabled={i === 0} style={miniBtn(C.tan)}>↑</button>
                <button onClick={() => move(s.id, 'down')} disabled={i === steps.length - 1} style={miniBtn(C.tan)}>↓</button>
                <button onClick={() => removeStep(s.id)} style={miniBtn(C.red)}>✕</button>
              </div>
            </div>
          </div>
        ))}
        {steps.length === 0 && (
          <div style={{ color: C.lightBrown, fontSize: 14 }}>
            No {PHASE_LABEL[phase].toLowerCase()} steps yet.
          </div>
        )}
      </div>

      <div style={{ ...cardStyle, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ color: C.tan, fontSize: 13, fontWeight: 700 }}>
          Add a {PHASE_LABEL[phase].toLowerCase()} step
        </div>
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder="What to do"
          rows={2}
          style={{ ...inputStyle, resize: 'vertical' }}
        />
        <input
          value={caution}
          onChange={e => setCaution(e.target.value)}
          placeholder="Caution (lockout, sharp parts, chemical) — optional"
          style={inputStyle}
        />
        <PhotoButton
          label={photo ? 'Photo attached ✓' : 'Reference photo'}
          extra={{ kind: 'reference' }}
          onUploaded={url => setPhoto(url)}
        />
        <VideoButton
          label={video ? 'Clip attached ✓' : 'Reference clip (optional)'}
          onUploaded={url => setVideo(url)}
        />
        <BigButton label="Add step" onClick={addStep} disabled={!text.trim()} />
      </div>
    </>
  )
}

// ── Crew, supplies, suggestions ─────────────────────────────────────────

function CrewTab({ onError }: { onError: (e: string) => void }) {
  const [crew, setCrew] = useState<Crew[]>([])
  const [name, setName] = useState('')
  const [lead, setLead] = useState(false)

  const load = useCallback(() => {
    fetch('/api/cleaning/crew').then(r => r.json())
      .then(d => setCrew(Array.isArray(d) ? d : []))
      .catch(() => onError('Could not load the roster.'))
  }, [onError])

  useEffect(() => { load() }, [load])

  async function add() {
    const res = await fetch('/api/cleaning/crew', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, role: lead ? 'lead' : 'crew' }),
    })
    const body = await res.json()
    if (!res.ok) { onError(body?.error ?? "Couldn't add them."); return }
    setName(''); setLead(false); load()
  }

  return (
    <>
      <PayrollPull onAdded={load} onError={onError} />

      <div style={{ ...cardStyle, marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ color: C.tan, fontSize: 13, lineHeight: 1.5 }}>
          These names are what the crew taps to sign in. It records who did what —
          it isn&apos;t a password.
        </div>
        <input
          value={name} onChange={e => setName(e.target.value)}
          placeholder="Name" style={inputStyle}
        />
        <button
          onClick={() => setLead(!lead)}
          style={{
            minHeight: 44, borderRadius: 8,
            background: lead ? C.medBrown : C.dark,
            border: `1px solid ${C.medBrown}`, color: C.cream,
            fontSize: 14, cursor: 'pointer',
          }}
        >
          {lead ? '★ Lead' : 'Crew member'}
        </button>
        <BigButton label="Add to roster" onClick={add} disabled={!name.trim()} />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {crew.map(m => (
          <div key={m.id} style={{ ...cardStyle, display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ flex: 1, color: C.cream, fontSize: 15 }}>{m.name}</span>
            {m.role === 'lead' && <span style={{ color: C.amber, fontSize: 12 }}>LEAD</span>}
            <button
              onClick={async () => {
                await fetch(`/api/cleaning/crew?id=${m.id}`, { method: 'DELETE' })
                load()
              }}
              style={miniBtn(C.red)}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </>
  )
}

// Pull names from QuickBooks rather than typing them.
//
// Propose-and-accept, not a sync: everyone starts unticked and nothing is
// written until someone presses Add.
//
// That design is forced by the data, not just caution. QuickBooks' Accounting
// API can't say who currently works here — its "active" flag only means the
// record isn't archived, so people who left years ago still come back. The
// list below is therefore candidates, not staff, and the warning saying so is
// not boilerplate: roughly half of it is expected to be leavers whose record
// was never closed out.
function PayrollPull({ onAdded, onError }: { onAdded: () => void; onError: (e: string) => void }) {
  interface Candidate { qbo_id: string; name: string; hired: string | null; on_roster: boolean }

  const [open,    setOpen]    = useState(false)
  const [loading, setLoading] = useState(false)
  const [rows,    setRows]    = useState<Candidate[]>([])
  const [picked,  setPicked]  = useState<Set<string>>(new Set())
  const [note,    setNote]    = useState<string | null>(null)
  const [busy,    setBusy]    = useState(false)

  async function pull() {
    setOpen(true)
    setLoading(true)
    setNote(null)
    try {
      const res  = await fetch('/api/cleaning/crew/payroll')
      const body = await res.json()
      if (!res.ok) { onError(body?.error ?? 'Could not reach QuickBooks.'); setOpen(false); return }
      setRows(body.employees ?? [])
      // Nothing pre-ticked: adding someone is a decision, and a pre-ticked list
      // turns it into whatever the default was.
      setPicked(new Set())
      if (body.new_count === 0) {
        setNote(`QuickBooks has ${body.total} active ${body.total === 1 ? 'employee' : 'employees'} — all already on the roster.`)
      }
    } catch {
      onError('Could not reach QuickBooks — check your connection.')
      setOpen(false)
    } finally {
      setLoading(false)
    }
  }

  async function add() {
    setBusy(true)
    try {
      const res = await fetch('/api/cleaning/crew/payroll', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ names: [...picked] }),
      })
      const body = await res.json()
      if (!res.ok) { onError(body?.error ?? 'Could not add them.'); return }
      setOpen(false)
      setPicked(new Set())
      onAdded()
    } finally {
      setBusy(false)
    }
  }

  const fresh = rows.filter(r => !r.on_roster)

  if (!open) {
    return (
      <div style={{ marginBottom: 16 }}>
        <BigButton label="⬇ Suggest names from QuickBooks" tone={C.dark} onClick={pull} />
      </div>
    )
  }

  return (
    <div style={{ ...cardStyle, marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ color: C.cream, fontSize: 15, fontWeight: 700 }}>From QuickBooks</span>
        <button
          onClick={() => setOpen(false)}
          style={{ background: 'none', border: 'none', color: C.tan, fontSize: 18, cursor: 'pointer' }}
        >
          ✕
        </button>
      </div>

      {loading && <div style={{ color: C.tan, fontSize: 14 }}>Asking QuickBooks…</div>}

      {!loading && note && <Banner tone="info">{note}</Banner>}

      {!loading && fresh.length > 0 && (
        <>
          <Banner tone="warn">
            QuickBooks can&apos;t tell us who still works here — it only knows whether a
            record was closed out. <strong>People who have left will be in this list.</strong>{' '}
            Tick only the ones you know clean.
          </Banner>

          <div style={{ color: C.tan, fontSize: 13, lineHeight: 1.5 }}>
            {fresh.length} {fresh.length === 1 ? 'name is' : 'names are'} not on the roster,
            newest hire first.
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {fresh.map(r => {
              const on = picked.has(r.name)
              return (
                <button
                  key={r.qbo_id}
                  onClick={() => setPicked(prev => {
                    const next = new Set(prev)
                    if (next.has(r.name)) next.delete(r.name); else next.add(r.name)
                    return next
                  })}
                  style={{
                    minHeight: 46, borderRadius: 8, textAlign: 'left', padding: '6px 12px',
                    background: on ? C.medBrown : C.dark,
                    border: `1px solid ${on ? C.amber : C.medBrown}`,
                    color: on ? C.cream : C.tan, fontSize: 15, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 8,
                  }}
                >
                  <span>{on ? '☑' : '☐'}</span>
                  <span style={{ flex: 1 }}>{r.name}</span>
                  {/* Hire date is the only cue here for spotting a stale record —
                      a 2020 hire nobody recognises is almost certainly a leaver. */}
                  {r.hired && (
                    <span style={{ color: C.lightBrown, fontSize: 11, whiteSpace: 'nowrap' }}>
                      hired {r.hired}
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          <BigButton
            label={busy ? 'Adding…' : picked.size ? `Add ${picked.size}` : 'Pick someone to add'}
            onClick={add}
            disabled={picked.size === 0 || busy}
          />
        </>
      )}

      {!loading && (
        <div style={{ color: C.lightBrown, fontSize: 12, lineHeight: 1.5 }}>
          Anyone already on the roster is left alone, including people you turned
          off on purpose. Names and hire dates only — no pay information is read.
        </div>
      )}
    </div>
  )
}

function SuppliesTab({ onError }: { onError: (e: string) => void }) {
  const [supplies, setSupplies] = useState<Supply[]>([])
  const [name, setName]     = useState('')
  const [unit, setUnit]     = useState('')
  const [vendor, setVendor] = useState('')

  // Retired supplies are asked for too. Taking one off the list only sets
  // active=false, so hiding them here made a removed item look deleted while
  // still holding its name against anyone re-adding it (Charlie, 2026-08-23).
  const load = useCallback(() => {
    fetch('/api/cleaning/supplies?all=1').then(r => r.json())
      .then(d => setSupplies(Array.isArray(d) ? d : []))
      .catch(() => onError('Could not load supplies.'))
  }, [onError])

  useEffect(() => { load() }, [load])

  async function add() {
    const res = await fetch('/api/cleaning/supplies', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, unit, vendor }),
    })
    const body = await res.json()
    if (!res.ok) { onError(body?.error ?? "Couldn't add that."); return }
    setName(''); setUnit(''); setVendor(''); load()
  }

  async function setActive(id: string, active: boolean) {
    if (active) {
      await fetch('/api/cleaning/supplies', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, active: true }),
      })
    } else {
      await fetch(`/api/cleaning/supplies?id=${id}`, { method: 'DELETE' })
    }
    load()
  }

  const live    = supplies.filter(s => s.active)
  const retired = supplies.filter(s => !s.active)

  return (
    <>
      <div style={{ ...cardStyle, marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ color: C.tan, fontSize: 13, lineHeight: 1.5 }}>
          The list the crew picks from when requesting. They can always type
          something that isn&apos;t here.
        </div>
        <input value={name}   onChange={e => setName(e.target.value)}   placeholder="Supply name" style={inputStyle} />
        <input value={unit}   onChange={e => setUnit(e.target.value)}   placeholder="Unit — case, 5 gal pail" style={inputStyle} />
        <input value={vendor} onChange={e => setVendor(e.target.value)} placeholder="Vendor (optional)" style={inputStyle} />
        <BigButton label="Add supply" onClick={add} disabled={!name.trim()} />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {live.map(s => (
          <div key={s.id} style={{ ...cardStyle, display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ flex: 1 }}>
              <div style={{ color: C.cream, fontSize: 15 }}>{s.name}</div>
              <div style={{ color: C.tan, fontSize: 12 }}>
                {[s.unit, s.vendor].filter(Boolean).join(' · ')}
              </div>
            </div>
            <button title="Take off the list" onClick={() => setActive(s.id, false)} style={miniBtn(C.red)}>
              ✕
            </button>
          </div>
        ))}
      </div>

      {retired.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <div style={{ color: C.lightBrown, fontSize: 12, lineHeight: 1.5, marginBottom: 8 }}>
            Off the list. The crew can&apos;t pick these, but the names are still
            spoken for — bring one back rather than re-typing it.
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {retired.map(s => (
              <div key={s.id} style={{ ...cardStyle, display: 'flex', alignItems: 'center', gap: 10, opacity: 0.55 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ color: C.cream, fontSize: 15 }}>{s.name}</div>
                  <div style={{ color: C.tan, fontSize: 12 }}>
                    {[s.unit, s.vendor].filter(Boolean).join(' · ')}
                  </div>
                </div>
                <button title="Put it back on the list" onClick={() => setActive(s.id, true)} style={miniBtn(C.green)}>
                  ↩
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  )
}

function SuggestionsTab({ onError }: { onError: (e: string) => void }) {
  const [rows, setRows] = useState<Suggestion[]>([])

  const load = useCallback(() => {
    fetch('/api/cleaning/suggestions?status=open').then(r => r.json())
      .then(d => setRows(Array.isArray(d) ? d : []))
      .catch(() => onError('Could not load notes.'))
  }, [onError])

  useEffect(() => { load() }, [load])

  async function review(id: string, action: 'applied' | 'declined') {
    await fetch('/api/cleaning/suggestions', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, action }),
    })
    load()
  }

  return (
    <>
      <div style={{ color: C.tan, fontSize: 13, marginBottom: 14, lineHeight: 1.5 }}>
        Corrections the crew sent in from the procedure screens. Fix the write-up
        yourself, then mark it done here.
      </div>

      {rows.length === 0 && (
        <div style={{ ...cardStyle, textAlign: 'center', color: C.tan }}>Nothing pending.</div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {rows.map(s => (
          <div key={s.id} style={cardStyle}>
            <div style={{ color: C.tan, fontSize: 12, marginBottom: 6 }}>
              {s.cleaning_equipment?.name}
              {s.cleaning_steps && ` · step ${s.cleaning_steps.step_no} (${s.cleaning_steps.phase})`}
            </div>
            <div style={{ color: C.cream, fontSize: 15, lineHeight: 1.45 }}>{s.suggestion}</div>
            {s.photo_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={s.photo_url} alt=""
                style={{
                  width: '100%', marginTop: 10, borderRadius: 8,
                  border: `1px solid ${C.medBrown}`,
                }}
              />
            )}
            <div style={{ color: C.lightBrown, fontSize: 12, marginTop: 8 }}>
              — {s.suggested_by}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button onClick={() => review(s.id, 'applied')}  style={{ ...miniBtn(C.green), flex: 1, minHeight: 44 }}>Done</button>
              <button onClick={() => review(s.id, 'declined')} style={{ ...miniBtn(C.lightBrown), flex: 1, minHeight: 44 }}>Dismiss</button>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

// ── Bits ────────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ color: C.tan, fontSize: 13, display: 'block', marginBottom: 6 }}>
        {label}
      </label>
      {children}
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

function miniBtn(color: string): React.CSSProperties {
  return {
    background: 'transparent', border: `1px solid ${color}`, borderRadius: 6,
    color, fontSize: 13, padding: '6px 10px', cursor: 'pointer', minHeight: 34,
  }
}
