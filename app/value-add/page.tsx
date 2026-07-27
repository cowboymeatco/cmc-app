'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { isoDate } from '@/lib/dates'
import {
  ValueAddJob, ValueAddJobType as JobType,
  ValueAddStatus as JobStatus, ValueAddSourceType as SourceType,
} from '@/lib/types'
import { fmtDayClock } from '@/lib/cookPredict'
import { WeightOutProposal } from '@/lib/boxWeight'
import ScheduleTab from './ScheduleTab'

type Tab = 'active' | 'schedule' | 'new' | 'history'

// What /api/value-add/box-weight returns per job: the proposal plus which job
// it belongs to and what the job already had recorded.
type WeightProposal = WeightOutProposal & {
  job_id:         string
  current_lbs:    number | null
  current_source: string | null
}

// The WIP tag rides with the tub to value add — opens in its own window and
// prints itself, same as the box label.
function printWIPTag(jobId: string) {
  window.open(`/api/value-add/label?id=${encodeURIComponent(jobId)}`, '_blank')
}

interface RetailOrderSummary { id: string; customer_name: string; due_date: string }
interface CuttingInstructionSummary { id: string; label: string }
interface PluItem { plu_number: string; item_name: string }

const C = {
  dark:       '#1A0A04',
  darkBrown:  '#351E0E',
  medBrown:   '#75471B',
  lightBrown: '#A6785A',
  tan:        '#C9A882',
  cream:      '#F2E8D9',
  green:      '#4CAF50',
  red:        '#E53E3E',
  yellow:     '#D97706',
  blue:       '#3B82F6',
  orange:     '#E8883A',
}

const INPUT: React.CSSProperties = {
  width: '100%', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(166,120,90,0.35)',
  borderRadius: 3, padding: '0.5rem 0.75rem', color: C.cream, fontSize: '0.88rem',
  outline: 'none', boxSizing: 'border-box',
}
const LABEL: React.CSSProperties = {
  display: 'block', fontSize: '0.72rem', color: C.lightBrown,
  textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.3rem',
}
const BTN = (bg: string, color = C.dark): React.CSSProperties => ({
  background: bg, color, border: 'none', borderRadius: 3,
  padding: '0.5rem 1.1rem', fontSize: '0.83rem', fontWeight: 600,
  cursor: 'pointer', letterSpacing: '0.04em',
})

const JOB_TYPE_LABELS: Record<JobType, string> = {
  smokehouse: '🔥 Smokehouse',
  patties:    '🍔 Patties',
  sausage:    '🌭 Sausage',
  other:      '⚙️ Other',
}
const JOB_TYPE_COLORS: Record<JobType, string> = {
  smokehouse: C.orange,
  patties:    C.yellow,
  sausage:    C.red,
  other:      C.lightBrown,
}
const STATUS_COLORS: Record<JobStatus, string> = {
  pending:    C.yellow,
  in_progress: C.blue,
  complete:   C.green,
}
const STATUS_LABELS: Record<JobStatus, string> = {
  pending:    'Pending',
  in_progress: 'In Progress',
  complete:   'Complete',
}
const NEXT_STATUS: Record<JobStatus, JobStatus | null> = {
  pending:    'in_progress',
  in_progress: 'complete',
  complete:   null,
}

function StatusBadge({ status }: { status: JobStatus }) {
  const color = STATUS_COLORS[status]
  return (
    <span style={{
      background: `${color}22`, border: `1px solid ${color}55`,
      color, fontSize: '0.7rem', fontWeight: 700, borderRadius: 99,
      padding: '2px 10px', textTransform: 'uppercase', letterSpacing: '0.08em', whiteSpace: 'nowrap',
    }}>
      {STATUS_LABELS[status]}
    </span>
  )
}

function YieldBadge({ weightIn, weightOut }: { weightIn: number | null; weightOut: number | null }) {
  if (!weightIn || !weightOut) return null
  const pct = Math.round((weightOut / weightIn) * 100)
  const color = pct >= 80 ? C.green : pct >= 65 ? C.yellow : C.red
  return (
    <span style={{ fontSize: '0.72rem', fontWeight: 700, color, background: `${color}22`, border: `1px solid ${color}44`, borderRadius: 99, padding: '2px 8px' }}>
      {pct}% yield
    </span>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// JOB CARD (in active list)
// ══════════════════════════════════════════════════════════════════════════════
function JobCard({ job, proposal, onUpdated }: {
  job:      ValueAddJob
  proposal: WeightProposal | null
  onUpdated: (j: ValueAddJob) => void
}) {
  const [advancing, setAdvancing]       = useState(false)
  const [editingWeights, setEditingWeights] = useState(false)
  const [applying, setApplying]         = useState(false)
  const [showBoxes, setShowBoxes]       = useState(false)
  const [wIn,  setWIn]  = useState(String(job.weight_in_lbs  ?? ''))
  const [wOut, setWOut] = useState(String(job.weight_out_lbs ?? ''))

  const nextStatus = NEXT_STATUS[job.status]
  const typeColor  = JOB_TYPE_COLORS[job.job_type]

  // Offer the scanned weight while it would actually tell the crew something:
  // there is nothing recorded yet, or what's recorded came from the boxes and
  // has since moved. A hand-typed weight is left alone.
  const offerProposal = !!proposal && job.weight_out_source !== 'manual' &&
    (job.weight_out_lbs == null || Math.abs(Number(job.weight_out_lbs) - proposal.lbs) >= 0.1)

  async function applyProposal() {
    if (!proposal) return
    setApplying(true)
    const res = await fetch('/api/value-add/box-weight', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: job.id, lbs: proposal.lbs }),
    })
    const updated = await res.json()
    setApplying(false)
    if (!updated?.error) { setWOut(String(proposal.lbs)); onUpdated(updated) }
  }

  async function advance() {
    if (!nextStatus) return
    setAdvancing(true)
    const res = await fetch('/api/value-add', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: job.id, status: nextStatus }),
    })
    const updated = await res.json()
    setAdvancing(false)
    onUpdated(updated)
  }

  async function saveWeights() {
    const res = await fetch('/api/value-add', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: job.id,
        weight_in_lbs:  wIn  ? parseFloat(wIn)  : null,
        weight_out_lbs: wOut ? parseFloat(wOut) : null,
        // Typing it makes it manual, which stops the box sweep from
        // overwriting a correction somebody made on purpose.
        weight_out_source: wOut ? 'manual' : null,
      }),
    })
    const updated = await res.json()
    setEditingWeights(false)
    onUpdated(updated)
  }

  return (
    <div style={{
      background: C.dark,
      border: `1px solid rgba(166,120,90,0.2)`,
      borderLeft: `4px solid ${typeColor}`,
      borderRadius: 4,
      padding: '1rem 1.25rem',
    }}>
      {/* Top row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
        <div>
          <span style={{ fontSize: '0.82rem', fontWeight: 700, color: typeColor, marginRight: '0.6rem' }}>
            {JOB_TYPE_LABELS[job.job_type]}
          </span>
          <span style={{ color: C.cream, fontWeight: 600, fontSize: '0.92rem' }}>
            {job.output_item_name || job.description || '—'}
          </span>
          {job.source_description && (
            <span style={{ fontSize: '0.78rem', color: C.lightBrown, marginLeft: '0.5rem' }}>
              ← {job.source_description}
            </span>
          )}
          {job.output_plu && (
            <span style={{ fontFamily: 'monospace', fontSize: '0.72rem', color: C.lightBrown, marginLeft: '0.5rem' }}>
              PLU {job.output_plu}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <StatusBadge status={job.status} />
        </div>
      </div>

      {/* Published slot — what the Schedule tab committed this job to. Shown
          here so the crew working the active list sees the same times the
          board does, without switching tabs. */}
      {job.scheduled_start && (
        <div style={{
          display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.4rem',
          fontSize: '0.78rem', color: C.orange, fontWeight: 600,
        }}>
          <span>🔥 In {fmtDayClock(new Date(job.scheduled_start))}</span>
          {job.predicted_minutes != null && (
            <span style={{ color: C.lightBrown, fontWeight: 400 }}>
              → out {fmtDayClock(new Date(new Date(job.scheduled_start).getTime() + job.predicted_minutes * 60000))}
            </span>
          )}
          {job.schedule_locked && <span title="Pinned to this time">📌</span>}
        </div>
      )}

      {/* Customer — blank means CMC shelf stock, named means keep it separate */}
      {job.customer_name && (
        <div style={{ fontSize: '0.82rem', color: C.tan, fontWeight: 700, marginBottom: '0.3rem' }}>
          👤 {job.customer_name}
        </div>
      )}

      {/* Source / link */}
      <div style={{ fontSize: '0.75rem', color: C.lightBrown, marginBottom: '0.6rem' }}>
        {job.source_type === 'general'          && '🗂 General / Shelf Stock'}
        {job.source_type === 'retail_order'     && '📋 Retail Order'}
        {job.source_type === 'cutting_instruction' && '📝 Cutting Instruction'}
        {job.assigned_to ? ` · ${job.assigned_to}` : ''}
        {' · '}{new Date(job.requested_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
        {job.tag_code && (
          <span style={{ fontFamily: 'monospace', color: C.tan, marginLeft: '0.5rem' }}>· {job.tag_code}</span>
        )}
      </div>

      {/* Weight in / out */}
      {editingWeights ? (
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end', marginBottom: '0.75rem' }}>
          <div>
            <label style={LABEL}>Weight In (lbs)</label>
            <input type="number" step="0.1" style={{ ...INPUT, width: 110 }} value={wIn} onChange={e => setWIn(e.target.value)} autoFocus />
          </div>
          <div>
            <label style={LABEL}>Weight Out (lbs)</label>
            <input type="number" step="0.1" style={{ ...INPUT, width: 110 }} value={wOut} onChange={e => setWOut(e.target.value)} />
          </div>
          <button style={BTN(C.green)} onClick={saveWeights}>Save</button>
          <button style={{ ...BTN('transparent', C.lightBrown), border: '1px solid rgba(166,120,90,0.3)' }} onClick={() => setEditingWeights(false)}>Cancel</button>
        </div>
      ) : (
        <div
          onClick={() => setEditingWeights(true)}
          style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginBottom: '0.75rem', cursor: 'pointer', padding: '0.4rem 0.6rem', borderRadius: 3, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(166,120,90,0.12)' }}
          title="Click to edit weights"
        >
          <div>
            <div style={{ fontSize: '0.65rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.08em' }}>In</div>
            <div style={{ color: job.weight_in_lbs ? C.tan : C.lightBrown, fontWeight: 600, fontSize: '0.88rem' }}>
              {job.weight_in_lbs ? `${Number(job.weight_in_lbs).toFixed(1)} lbs` : '—'}
            </div>
          </div>
          <div style={{ color: 'rgba(166,120,90,0.3)', fontSize: '1rem' }}>→</div>
          <div>
            <div style={{ fontSize: '0.65rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Out</div>
            <div style={{ color: job.weight_out_lbs ? C.cream : C.lightBrown, fontWeight: 600, fontSize: '0.88rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              {job.weight_out_lbs ? `${Number(job.weight_out_lbs).toFixed(1)} lbs` : '—'}
              {job.weight_out_source === 'boxes' && (
                <span title="Summed off the Hobart labels scanned into the boxes" style={{ fontSize: '0.7rem' }}>📦</span>
              )}
            </div>
          </div>
          {job.weight_in_lbs && job.weight_out_lbs && (
            <YieldBadge weightIn={job.weight_in_lbs} weightOut={job.weight_out_lbs} />
          )}
          <span style={{ marginLeft: 'auto', fontSize: '0.7rem', color: C.lightBrown }}>✎ edit</span>
        </div>
      )}

      {/* Finished weight found in the box labels. The number is already on the
          Hobart tickets — this offers it rather than asking anyone to add it
          up. Applying is a tap, because the box→job link is inferred from PLU
          and pack date, not a hard key. */}
      {offerProposal && proposal && (
        <div style={{
          background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.3)',
          borderRadius: 3, padding: '0.55rem 0.7rem', marginBottom: '0.75rem',
        }}>
          <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.8rem', color: C.blue, fontWeight: 700 }}>
              📦 {proposal.lbs.toFixed(1)} lbs scanned
            </span>
            <span style={{ fontSize: '0.72rem', color: C.lightBrown }}>
              {proposal.packages} package{proposal.packages === 1 ? '' : 's'} in {proposal.boxes.length} box{proposal.boxes.length === 1 ? '' : 'es'}
              {!proposal.narrowedToCustomer && job.customer_name && ' · not matched to this customer'}
            </span>
            <button
              style={{ ...BTN(C.blue, C.cream), fontSize: '0.75rem', padding: '0.3rem 0.75rem' }}
              onClick={applyProposal}
              disabled={applying}
            >
              {applying ? '…' : `Use ${proposal.lbs.toFixed(1)} lbs`}
            </button>
            <button
              onClick={() => setShowBoxes(s => !s)}
              style={{
                background: 'transparent', border: '1px solid rgba(166,120,90,0.3)',
                color: C.lightBrown, borderRadius: 3, cursor: 'pointer',
                fontSize: '0.72rem', padding: '0.25rem 0.55rem',
              }}>{showBoxes ? 'Hide boxes' : 'Show boxes'}</button>
          </div>

          {proposal.otherCustomerBoxes > 0 && (
            <div style={{ fontSize: '0.7rem', color: C.yellow, marginTop: '0.35rem' }}>
              ⚠️ {proposal.otherCustomerBoxes} more box{proposal.otherCustomerBoxes === 1 ? '' : 'es'} of PLU {proposal.plu} packed
              in this window for other customers — one cook often fills several orders.
            </div>
          )}

          {showBoxes && (
            <div style={{ marginTop: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
              {proposal.boxes.map(b => (
                <div key={b.box_id} style={{ fontSize: '0.72rem', color: C.lightBrown, display: 'flex', gap: '0.5rem' }}>
                  <span style={{ fontFamily: 'monospace', color: C.tan, minWidth: 92 }}>{b.box_label ?? '—'}</span>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.customer_name ?? '—'}</span>
                  <span>{b.pack_date}</span>
                  <span style={{ color: C.cream, minWidth: 56, textAlign: 'right' }}>{b.lbs.toFixed(1)} lbs</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {job.notes && (
        <div style={{ fontSize: '0.78rem', color: C.tan, fontStyle: 'italic', marginBottom: '0.6rem' }}>{job.notes}</div>
      )}

      {/* Action */}
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        {nextStatus && (
          <button
            style={{ ...BTN(STATUS_COLORS[nextStatus]), fontSize: '0.78rem', padding: '0.35rem 0.9rem' }}
            onClick={advance}
            disabled={advancing}
          >
            {advancing ? '…' : `→ Mark ${STATUS_LABELS[nextStatus]}`}
          </button>
        )}
        <button
          style={{ ...BTN('transparent', C.tan), border: `1px solid ${C.tan}`, fontSize: '0.78rem', padding: '0.35rem 0.9rem' }}
          onClick={() => printWIPTag(job.id)}
        >
          🏷 Print WIP Tag
        </button>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// NEW JOB FORM
// ══════════════════════════════════════════════════════════════════════════════
function NewJobTab({ onSaved, orders, cuttingInstructions, pluList }: { onSaved: () => void; orders: RetailOrderSummary[]; cuttingInstructions: CuttingInstructionSummary[]; pluList: PluItem[] }) {
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)
  const [pluSearch, setPluSearch] = useState('')
  const [pluDropdown, setPluDropdown] = useState<PluItem[]>([])

  const blankForm = () => ({
    job_type:         'other' as JobType,
    description:      '',
    source_type:      'general' as SourceType,
    linked_order_id:  '',
    linked_cutting_instruction_id: '',
    output_plu:       '',
    output_item_name: '',
    weight_in_lbs:    '',
    assigned_to:      '',
    requested_date:   isoDate(),
    notes:            '',
    customer_name:      '',
    source_description: '',
  })

  const [form, setForm] = useState(blankForm())
  const f = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }))

  function searchPlu(q: string) {
    setPluSearch(q)
    if (q.length < 1) { setPluDropdown([]); return }
    const lower = q.toLowerCase()
    setPluDropdown(pluList.filter(p => p.plu_number.includes(q) || p.item_name.toLowerCase().includes(lower)).slice(0, 8))
  }

  function selectPlu(p: PluItem) {
    setForm(prev => ({ ...prev, output_plu: p.plu_number, output_item_name: p.item_name }))
    setPluSearch(`${p.plu_number} — ${p.item_name}`)
    setPluDropdown([])
  }

  // The tag needs something to say it's becoming — a label or a typed intent.
  const canCreate = !!(form.output_item_name || form.output_plu || form.description.trim())

  async function handleSubmit(andPrint = false) {
    if (!form.output_item_name && !form.description) return
    setSaving(true)
    const res = await fetch('/api/value-add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...form,
        linked_order_id:               form.source_type === 'retail_order'        ? (form.linked_order_id || null)               : null,
        linked_cutting_instruction_id: form.source_type === 'cutting_instruction' ? (form.linked_cutting_instruction_id || null) : null,
        output_plu:      form.output_plu      || null,
        weight_in_lbs:   form.weight_in_lbs   ? parseFloat(form.weight_in_lbs) : null,
        customer_name:      form.customer_name.trim()      || null,
        source_description: form.source_description.trim() || null,
      }),
    })
    const saved = await res.json().catch(() => null)
    setSaving(false)
    // Print straight off the create — the tag needs to be on the tub before it
    // leaves the processing room, not after somebody remembers.
    if (andPrint && saved?.id) printWIPTag(saved.id)
    setSuccess(true)
    setForm(blankForm())
    setPluSearch('')
    onSaved()
    setTimeout(() => setSuccess(false), 4000)
  }

  return (
    <div style={{ maxWidth: 640, margin: '0 auto' }}>
      <div style={{ background: C.dark, border: '1px solid rgba(166,120,90,0.25)', borderRadius: 4, padding: '1.75rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <h3 style={{ fontFamily: 'Georgia, serif', color: C.cream, fontSize: '1rem', textTransform: 'uppercase', letterSpacing: '0.06em', margin: 0 }}>
          New Value-Add Job
        </h3>

        {success && (
          <div style={{ background: 'rgba(76,175,80,0.15)', border: '1px solid rgba(76,175,80,0.4)', borderRadius: 4, padding: '0.75rem', color: C.green, fontSize: '0.85rem' }}>
            ✓ Job created
          </div>
        )}

        {/* Whose product + what's in the tub — the two the handwritten WIP
            sheet asked for that had nowhere to go */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
          <div>
            <label style={LABEL}>Customer</label>
            <input style={INPUT} value={form.customer_name} onChange={f('customer_name')} placeholder="Blank = CMC shelf stock" />
          </div>
          <div>
            <label style={LABEL}>What is it now</label>
            <input style={INPUT} value={form.source_description} onChange={f('source_description')} placeholder="Trim, Round Roast…" />
          </div>
        </div>

        {/* The intent is the biggest thing on the printed tag — what the floor
            reads to know why this tub is on their bench. */}
        <div>
          <label style={LABEL}>Intent — what it becomes</label>
          <input style={INPUT} value={form.description} onChange={f('description')} placeholder="Make snack sticks, Make jerky…" />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
          <div>
            <label style={LABEL}>Job Type</label>
            <select style={INPUT} value={form.job_type} onChange={f('job_type')}>
              {(Object.keys(JOB_TYPE_LABELS) as JobType[]).map(t => (
                <option key={t} value={t}>{JOB_TYPE_LABELS[t]}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={LABEL}>Source</label>
            <select style={INPUT} value={form.source_type} onChange={f('source_type')}>
              <option value="general">General / Shelf Stock</option>
              <option value="retail_order">Retail Order</option>
              <option value="cutting_instruction">Cutting Instruction</option>
            </select>
          </div>
        </div>

        {form.source_type === 'retail_order' && (
          <div>
            <label style={LABEL}>Linked Retail Order</label>
            <select style={INPUT} value={form.linked_order_id} onChange={f('linked_order_id')}>
              <option value="">— Select order —</option>
              {orders.map(o => (
                <option key={o.id} value={o.id}>
                  {o.customer_name} · Due {new Date(o.due_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </option>
              ))}
            </select>
          </div>
        )}

        {form.source_type === 'cutting_instruction' && (
          <div>
            <label style={LABEL}>Linked Cutting Instruction</label>
            <select style={INPUT} value={form.linked_cutting_instruction_id} onChange={f('linked_cutting_instruction_id')}>
              <option value="">— Select cutting instruction —</option>
              {cuttingInstructions.map(ci => (
                <option key={ci.id} value={ci.id}>{ci.label}</option>
              ))}
            </select>
            {cuttingInstructions.length === 0 && (
              <div style={{ fontSize: '0.72rem', color: C.lightBrown, marginTop: '0.3rem' }}>
                No cutting instructions found yet.
              </div>
            )}
          </div>
        )}

        {/* Output PLU search */}
        <div style={{ position: 'relative' }}>
          <label style={LABEL}>Output Item (PLU / Name) *</label>
          <input
            style={INPUT}
            value={pluSearch}
            onChange={e => searchPlu(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && pluDropdown.length > 0) selectPlu(pluDropdown[0]) }}
            placeholder="Search PLU or type item name…"
          />
          {pluDropdown.length > 0 && (
            <div style={{
              position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50,
              background: C.darkBrown, border: '1px solid rgba(166,120,90,0.4)',
              borderRadius: 3, boxShadow: '0 4px 16px rgba(0,0,0,0.4)', maxHeight: 200, overflowY: 'auto',
            }}>
              {pluDropdown.map(p => (
                <div
                  key={p.plu_number}
                  onClick={() => selectPlu(p)}
                  style={{ padding: '0.5rem 0.85rem', cursor: 'pointer', borderBottom: '1px solid rgba(166,120,90,0.1)' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(166,120,90,0.12)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <span style={{ fontFamily: 'monospace', color: C.lightBrown, fontSize: '0.78rem' }}>PLU {p.plu_number}</span>
                  <span style={{ color: C.cream, marginLeft: '0.6rem', fontSize: '0.85rem' }}>{p.item_name}</span>
                </div>
              ))}
            </div>
          )}
          {/* Manual name fallback if no PLU selected */}
          {!form.output_plu && pluSearch && (
            <div style={{ marginTop: '0.3rem' }}>
              <button
                style={{ ...BTN('transparent', C.lightBrown), border: '1px solid rgba(166,120,90,0.3)', fontSize: '0.75rem', padding: '0.25rem 0.6rem' }}
                onClick={() => { setForm(p => ({ ...p, output_item_name: pluSearch, output_plu: '' })); setPluDropdown([]) }}
              >
                Use "{pluSearch}" as item name
              </button>
            </div>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem' }}>
          <div>
            <label style={LABEL}>Weight In (lbs)</label>
            <input type="number" step="0.1" min="0" style={INPUT} value={form.weight_in_lbs} onChange={f('weight_in_lbs')} placeholder="0.0" />
          </div>
          <div>
            <label style={LABEL}>Assigned To</label>
            <input style={INPUT} value={form.assigned_to} onChange={f('assigned_to')} placeholder="Staff name" />
          </div>
          <div>
            <label style={LABEL}>Requested Date</label>
            <input type="date" style={INPUT} value={form.requested_date} onChange={f('requested_date')} />
          </div>
        </div>

        <div>
          <label style={LABEL}>Notes</label>
          <textarea style={{ ...INPUT, height: 64, resize: 'vertical' }} value={form.notes} onChange={f('notes')} placeholder="Special instructions, blend notes, etc." />
        </div>

        <div style={{ display: 'flex', gap: '0.6rem' }}>
          <button
            style={{ ...BTN(canCreate ? C.tan : C.medBrown), flex: 2, opacity: canCreate ? 1 : 0.5 }}
            onClick={() => handleSubmit(true)}
            disabled={saving || !canCreate}
          >
            {saving ? 'Saving…' : '🏷 Create + Print WIP Tag'}
          </button>
          <button
            style={{ ...BTN('transparent', C.lightBrown), border: '1px solid rgba(166,120,90,0.35)', flex: 1, opacity: canCreate ? 1 : 0.5 }}
            onClick={() => handleSubmit(false)}
            disabled={saving || !canCreate}
          >
            Create only
          </button>
        </div>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// ACTIVE JOBS TAB
// ══════════════════════════════════════════════════════════════════════════════
function ActiveJobsTab() {
  const [jobs, setJobs] = useState<ValueAddJob[]>([])
  const [proposals, setProposals] = useState<Map<string, WeightProposal>>(new Map())
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const res  = await fetch('/api/value-add')
    const data = await res.json()
    const active = Array.isArray(data) ? data.filter((j: ValueAddJob) => j.status !== 'complete') : []
    setJobs(active)
    setLoading(false)

    // Scanned weights load after the list so a slow scan sweep never holds up
    // the jobs themselves; the cards fill in when it lands.
    fetch('/api/value-add/box-weight')
      .then(r => r.json())
      .then((d: { proposals?: WeightProposal[] }) => {
        if (Array.isArray(d?.proposals)) {
          setProposals(new Map(d.proposals.map(p => [p.job_id, p])))
        }
      })
      .catch(() => {})
  }, [])

  useEffect(() => { load() }, [load])

  function handleUpdated(updated: ValueAddJob) {
    if (updated.status === 'complete') {
      setJobs(prev => prev.filter(j => j.id !== updated.id))
    } else {
      setJobs(prev => prev.map(j => j.id === updated.id ? updated : j))
    }
  }

  const byType = (jobs: ValueAddJob[], type: JobType) => jobs.filter(j => j.job_type === type)

  const typeOrder: JobType[] = ['smokehouse', 'patties', 'sausage', 'other']

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {loading && <div style={{ color: C.lightBrown, fontSize: '0.85rem', padding: '1.5rem', textAlign: 'center' }}>Loading…</div>}
      {!loading && jobs.length === 0 && (
        <div style={{ color: C.lightBrown, fontSize: '0.9rem', padding: '3rem', textAlign: 'center', background: C.dark, borderRadius: 4, border: '1px solid rgba(166,120,90,0.2)' }}>
          No active jobs — use <strong style={{ color: C.tan }}>+ New Job</strong> to create one.
        </div>
      )}
      {typeOrder.map(type => {
        const group = byType(jobs, type)
        if (group.length === 0) return null
        return (
          <div key={type}>
            <div style={{ fontSize: '0.72rem', color: JOB_TYPE_COLORS[type], textTransform: 'uppercase', letterSpacing: '0.12em', fontWeight: 700, marginBottom: '0.6rem' }}>
              {JOB_TYPE_LABELS[type]} · {group.length}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              {group.map(j => (
                <JobCard key={j.id} job={j} proposal={proposals.get(j.id) ?? null} onUpdated={handleUpdated} />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// HISTORY TAB
// ══════════════════════════════════════════════════════════════════════════════
function HistoryTab() {
  const [jobs, setJobs]     = useState<ValueAddJob[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/value-add?status=complete')
      .then(r => r.json())
      .then((data: unknown) => {
        setJobs(Array.isArray(data) ? (data as ValueAddJob[]) : [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      {loading && <div style={{ color: C.lightBrown, padding: '1.5rem', textAlign: 'center' }}>Loading…</div>}
      {!loading && jobs.length === 0 && (
        <div style={{ color: C.lightBrown, padding: '2rem', textAlign: 'center', background: C.dark, borderRadius: 4, border: '1px solid rgba(166,120,90,0.2)' }}>No completed jobs yet.</div>
      )}
      {jobs.map(j => (
        <div key={j.id} style={{ background: C.dark, border: '1px solid rgba(166,120,90,0.15)', borderLeft: `3px solid ${JOB_TYPE_COLORS[j.job_type]}`, borderRadius: 4, padding: '0.75rem 1.1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <span style={{ fontSize: '0.78rem', color: JOB_TYPE_COLORS[j.job_type], marginRight: '0.5rem' }}>{JOB_TYPE_LABELS[j.job_type]}</span>
            <span style={{ color: C.cream, fontWeight: 600, fontSize: '0.88rem' }}>{j.output_item_name || j.description}</span>
            {j.output_plu && <span style={{ fontFamily: 'monospace', fontSize: '0.7rem', color: C.lightBrown, marginLeft: '0.5rem' }}>PLU {j.output_plu}</span>}
            <div style={{ fontSize: '0.72rem', color: C.lightBrown, marginTop: '0.2rem' }}>
              Completed {j.completed_date ? new Date(j.completed_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
              {j.assigned_to ? ` · ${j.assigned_to}` : ''}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexShrink: 0 }}>
            {j.weight_in_lbs != null && (
              <div style={{ textAlign: 'right', fontSize: '0.78rem' }}>
                <span style={{ color: C.lightBrown }}>{Number(j.weight_in_lbs).toFixed(1)} in</span>
                {j.weight_out_lbs != null && (
                  <> <span style={{ color: 'rgba(166,120,90,0.4)' }}>→</span> <span style={{ color: C.tan }}>{Number(j.weight_out_lbs).toFixed(1)} out</span></>
                )}
              </div>
            )}
            <YieldBadge weightIn={j.weight_in_lbs} weightOut={j.weight_out_lbs} />
          </div>
        </div>
      ))}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// PAGE
// ══════════════════════════════════════════════════════════════════════════════
export default function ValueAddPage() {
  const [tab,    setTab]    = useState<Tab>('active')
  const [newKey, setNewKey] = useState(0)
  const [orders,  setOrders]  = useState<RetailOrderSummary[]>([])
  const [cuttingInstructions, setCuttingInstructions] = useState<CuttingInstructionSummary[]>([])
  const [pluList, setPluList] = useState<PluItem[]>([])

  useEffect(() => {
    // Load open retail orders for linking
    fetch('/api/orders')
      .then(r => r.json())
      .then((data: unknown) => {
        if (Array.isArray(data)) {
          setOrders((data as { id: string; customer_name: string; due_date: string; status: string }[])
            .filter(o => o.status !== 'fulfilled')
            .map(o => ({ id: o.id, customer_name: o.customer_name, due_date: o.due_date }))
          )
        }
      })
      .catch(() => {})

    // Load cutting instructions for linking
    fetch('/api/cutting-instructions')
      .then(r => r.json())
      .then((data: unknown) => {
        if (Array.isArray(data)) {
          setCuttingInstructions((data as { id: string; data?: Record<string, unknown> }[])
            .map(ci => {
              const d = ci.data ?? {}
              const name    = (d.customerName as string) || 'Unnamed'
              const species = (d.species as string) || ''
              const killDate = (d.killDate as string) || ''
              const parts = [name, species, killDate].filter(Boolean)
              return { id: ci.id, label: parts.join(' · ') }
            })
          )
        }
      })
      .catch(() => {})

    // Load PLU list for output item search
    fetch('/api/processing?active=true')
      .then(r => r.json())
      .then((data: unknown) => {
        if (Array.isArray(data)) {
          setPluList((data as { plu_number?: string; item_name?: string }[])
            .filter(d => d.plu_number)
            .map(d => ({ plu_number: String(d.plu_number), item_name: d.item_name ?? '' }))
          )
        }
      })
      .catch(() => {})
  }, [])

  const tabs = [
    { id: 'active'   as Tab, label: '⚙️ Active Jobs' },
    { id: 'schedule' as Tab, label: '📅 Schedule' },
    { id: 'new'      as Tab, label: '+ New Job' },
    { id: 'history'  as Tab, label: '📜 History' },
  ]

  const cookLogHref = '/value-add/cooking'

  return (
    <div style={{ minHeight: '100vh', background: 'var(--dark-brown)', display: 'flex', flexDirection: 'column' }}>
      <header style={{ background: 'var(--dark)', borderBottom: '1px solid rgba(166,120,90,0.3)', padding: '0 2rem', height: '64px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <Link href="/" style={{ color: C.lightBrown, textDecoration: 'none', fontSize: '0.82rem' }}>← Dashboard</Link>
          <span style={{ color: 'rgba(166,120,90,0.4)' }}>|</span>
          <h1 style={{ fontFamily: 'Georgia, serif', fontSize: '1.1rem', fontWeight: 700, color: C.cream, letterSpacing: '0.08em', textTransform: 'uppercase', margin: 0 }}>Value Add</h1>
        </div>
        <div style={{ display: 'flex', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(166,120,90,0.25)', borderRadius: 4, overflow: 'hidden' }}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              padding: '0.45rem 1.25rem', border: 'none', cursor: 'pointer', fontSize: '0.83rem', fontWeight: 600,
              background: tab === t.id ? C.medBrown : 'transparent',
              color: tab === t.id ? C.cream : C.lightBrown,
              letterSpacing: '0.04em', transition: 'background 0.15s',
            }}>{t.label}</button>
          ))}
          <Link href={cookLogHref} style={{
            padding: '0.45rem 1.25rem', fontSize: '0.83rem', fontWeight: 600,
            color: C.lightBrown, letterSpacing: '0.04em', textDecoration: 'none',
            display: 'flex', alignItems: 'center',
            borderLeft: '1px solid rgba(166,120,90,0.25)',
          }}>🌡️ Cook Log</Link>
        </div>
      </header>

      <main style={{ flex: 1, padding: '1.5rem 2rem', maxWidth: '1200px', width: '100%', margin: '0 auto', boxSizing: 'border-box' }}>
        {tab === 'active'   && <ActiveJobsTab key={newKey} />}
        {tab === 'schedule' && <ScheduleTab />}
        {tab === 'new'      && <NewJobTab key={newKey} onSaved={() => { setNewKey(k => k + 1); setTab('active') }} orders={orders} cuttingInstructions={cuttingInstructions} pluList={pluList} />}
        {tab === 'history'  && <HistoryTab />}
      </main>

      <footer style={{ background: 'var(--dark)', borderTop: '1px solid rgba(166,120,90,0.2)', padding: '0.5rem 2rem', textAlign: 'center', fontSize: '0.72rem', color: C.lightBrown, flexShrink: 0 }}>
        Cowboy Meat Company · 1109 Front St, Forsyth MT · (406) 346-7660
      </footer>
    </div>
  )
}
