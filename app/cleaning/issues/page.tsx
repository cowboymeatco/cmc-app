'use client'
import { useEffect, useState, useCallback } from 'react'
import { dateLabel } from '@/lib/dates'
import { C, useCrewMember, CleaningHeader, Banner, BigButton, inputStyle, cardStyle } from '../ui'

// The shared inbox. Day crew files problems here; the night crew pulls them
// onto a list and closes them out.

interface Issue {
  id: string
  created_at: string
  intent: 'heads_up' | 'miss'
  severity: 'normal' | 'urgent'
  description: string
  reported_by: string
  area_name: string | null
  equipment_name: string | null
  photo_url: string | null
  status: 'open' | 'scheduled' | 'resolved' | 'declined'
  resolved_by: string | null
  resolution_note: string | null
}

export default function IssuesPage() {
  const { member } = useCrewMember()
  const [issues,  setIssues]  = useState<Issue[]>([])
  const [showAll, setShowAll] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)
  const [busy,    setBusy]    = useState<string | null>(null)

  // No setLoading(true) up front — this runs from an effect, where a
  // synchronous setState cascades a render. The list simply stays on screen
  // while the filter re-reads, which also avoids a flash of "Loading…"
  // every time somebody toggles between Open and Everything.
  const load = useCallback(() => {
    fetch(`/api/cleaning/issues?status=${showAll ? 'all' : 'open'}`)
      .then(r => r.json())
      .then(d => setIssues(Array.isArray(d) ? d : []))
      .catch(() => setError('Could not load the inbox.'))
      .finally(() => setLoading(false))
  }, [showAll])

  useEffect(() => { load() }, [load])

  async function act(issue: Issue, action: 'schedule' | 'resolve' | 'decline', note?: string) {
    if (action !== 'schedule' && !member) {
      setError('Sign in on the hub first so this gets recorded under your name.')
      return
    }
    setBusy(issue.id)
    setError(null)
    try {
      const res = await fetch('/api/cleaning/issues', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ id: issue.id, action, by: member?.name, note }),
      })
      const body = await res.json()
      if (!res.ok) { setError(body?.error ?? "That didn't work."); return }
      load()
    } catch {
      setError('No connection.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div style={{ paddingBottom: 60 }}>
      <CleaningHeader title="Issues" back="/cleaning" member={member} />

      <div style={{ padding: 16, maxWidth: 720, margin: '0 auto' }}>
        {error && <Banner tone="error">{error}</Banner>}

        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {([false, true] as const).map(all => (
            <button
              key={String(all)}
              onClick={() => setShowAll(all)}
              style={{
                flex: 1, minHeight: 46, borderRadius: 8,
                background: showAll === all ? C.medBrown : C.dark,
                border: `1px solid ${C.medBrown}`,
                color: showAll === all ? C.cream : C.tan,
                fontSize: 14, fontWeight: showAll === all ? 700 : 400, cursor: 'pointer',
              }}
            >
              {all ? 'Everything' : 'Open'}
            </button>
          ))}
        </div>

        {loading && <p style={{ color: C.tan }}>Loading…</p>}

        {!loading && issues.length === 0 && (
          <div style={{ ...cardStyle, textAlign: 'center', color: C.tan }}>
            <div style={{ fontSize: 30, marginBottom: 8 }}>✓</div>
            {showAll ? 'Nothing here yet.' : 'Nothing open. Good.'}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {issues.map(issue => (
            <IssueCard
              key={issue.id}
              issue={issue}
              busy={busy === issue.id}
              onAct={act}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function IssueCard({ issue, busy, onAct }: {
  issue: Issue
  busy: boolean
  onAct: (i: Issue, a: 'schedule' | 'resolve' | 'decline', note?: string) => void
}) {
  const [resolving, setResolving] = useState(false)
  const [note,      setNote]      = useState('')

  const tone =
    issue.status === 'resolved'  ? C.green :
    issue.status === 'declined'  ? C.lightBrown :
    issue.severity === 'urgent'  ? C.red :
    issue.intent === 'miss'      ? C.amber : C.medBrown

  return (
    <div style={{ ...cardStyle, borderColor: tone }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
        <span style={{
          fontSize: 11, fontWeight: 700, color: tone,
          border: `1px solid ${tone}`, borderRadius: 4, padding: '2px 6px',
        }}>
          {issue.intent === 'miss' ? 'MISSED LAST NIGHT' : 'FOR TONIGHT'}
        </span>
        {issue.severity === 'urgent' && (
          <span style={{ fontSize: 11, fontWeight: 700, color: C.red }}>URGENT</span>
        )}
        {issue.status === 'scheduled' && (
          <span style={{ fontSize: 11, color: C.blue }}>on tonight&apos;s list</span>
        )}
        {issue.status === 'resolved' && (
          <span style={{ fontSize: 11, color: C.green }}>✓ resolved by {issue.resolved_by}</span>
        )}
        {issue.status === 'declined' && (
          <span style={{ fontSize: 11, color: C.lightBrown }}>closed without action</span>
        )}
      </div>

      <div style={{ color: C.cream, fontSize: 16, lineHeight: 1.45, marginBottom: 8 }}>
        {issue.description}
      </div>

      {issue.photo_url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={issue.photo_url} alt=""
          style={{
            width: '100%', borderRadius: 8, marginBottom: 8,
            border: `1px solid ${C.medBrown}`,
          }}
        />
      )}

      <div style={{ color: C.tan, fontSize: 12, marginBottom: 12 }}>
        {[issue.area_name, issue.equipment_name].filter(Boolean).join(' · ')}
        {(issue.area_name || issue.equipment_name) && ' · '}
        {issue.reported_by} · {dateLabel(issue.created_at.slice(0, 10), { month: 'short', day: 'numeric' })}
      </div>

      {issue.resolution_note && (
        <div style={{ color: C.tan, fontSize: 13, fontStyle: 'italic', marginBottom: 10 }}>
          “{issue.resolution_note}”
        </div>
      )}

      {(issue.status === 'open' || issue.status === 'scheduled') && !resolving && (
        <div style={{ display: 'flex', gap: 8 }}>
          {issue.status === 'open' && (
            <button
              onClick={() => onAct(issue, 'schedule')}
              disabled={busy}
              style={{
                flex: 1, minHeight: 46, background: C.dark,
                border: `1px solid ${C.blue}`, borderRadius: 8,
                color: C.blue, fontSize: 14, cursor: 'pointer',
              }}
            >
              Add to tonight
            </button>
          )}
          <button
            onClick={() => setResolving(true)}
            disabled={busy}
            style={{
              flex: 1, minHeight: 46, background: C.dark,
              border: `1px solid ${C.green}`, borderRadius: 8,
              color: C.green, fontSize: 14, cursor: 'pointer',
            }}
          >
            Close out
          </button>
        </div>
      )}

      {resolving && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="What was done? (optional)"
            rows={2}
            style={{ ...inputStyle, resize: 'vertical' }}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <BigButton
              label="Fixed"
              tone={C.green}
              disabled={busy}
              onClick={() => { onAct(issue, 'resolve', note); setResolving(false) }}
            />
            <BigButton
              label="No action"
              tone={C.dark}
              disabled={busy}
              onClick={() => { onAct(issue, 'decline', note); setResolving(false) }}
            />
          </div>
          <button
            onClick={() => setResolving(false)}
            style={{
              background: 'none', border: 'none', color: C.lightBrown,
              fontSize: 13, cursor: 'pointer', minHeight: 40,
            }}
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  )
}
