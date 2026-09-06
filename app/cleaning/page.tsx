'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { dateLabel } from '@/lib/dates'
import { shiftProgress, type CleaningShiftItem } from '@/lib/cleaning'
import { C, TAP, useCrewMember, CrewPicker, CleaningHeader, ProgressBar, cardStyle } from './ui'

// The cleaning hub. One screen that answers "what do I do now" for whoever
// picks up the phone — night crew, day crew reporting something, or Jill
// checking whether last night got finished.

interface HubState {
  shift:  { id: string; shift_date: string; status: string; closed_by: string | null } | null
  items:  CleaningShiftItem[]
  issues: number
  urgent: number
  supplies: number
  out:    number
  /** Items rolled from the last shift, still open for the first cutter. */
  rolled: number
  pastPreop: boolean
}

export default function CleaningHub() {
  const { member, setMember } = useCrewMember()
  const [picking, setPicking] = useState(false)
  const [state,   setState]   = useState<HubState | null>(null)

  useEffect(() => {
    Promise.allSettled([
      // Reading never opens a night any more — only "Start shift" does — so
      // glancing at the hub at 9am is safe.
      fetch('/api/cleaning/shift').then(r => r.json()),
      fetch('/api/cleaning/issues?status=open').then(r => r.json()),
      fetch('/api/cleaning/supply-requests?status=open').then(r => r.json()),
      // Also closes anything still open past 3 AM, which is the right side
      // effect for the first screen anyone opens in the morning.
      fetch('/api/cleaning/morning').then(r => r.json()),
    ]).then(([shiftRes, issuesRes, supplyRes, morningRes]) => {
      const shiftBody = shiftRes.status  === 'fulfilled' ? shiftRes.value  : null
      const issues    = issuesRes.status === 'fulfilled' && Array.isArray(issuesRes.value) ? issuesRes.value : []
      const supplies  = supplyRes.status === 'fulfilled' && Array.isArray(supplyRes.value) ? supplyRes.value : []
      const morning   = morningRes.status === 'fulfilled' ? morningRes.value : null

      setState({
        shift:     shiftBody?.shift ?? null,
        items:     shiftBody?.items ?? [],
        issues:    issues.length,
        urgent:    issues.filter((i: { severity: string }) => i.severity === 'urgent').length,
        supplies:  supplies.length,
        out:       supplies.filter((s: { urgency: string }) => s.urgency === 'out').length,
        rolled:    Array.isArray(morning?.rolled) ? morning.rolled.length : 0,
        pastPreop: Boolean(morning?.past_preop),
      })
    })
  }, [])

  if (picking) {
    return (
      <>
        <CleaningHeader title="Cleaning & Sanitation" back="/" />
        <CrewPicker
          onPick={m => { setMember(m); setPicking(false) }}
          onCancel={() => setPicking(false)}
        />
      </>
    )
  }

  const progress = state ? shiftProgress(state.items) : null
  const closed   = state?.shift?.status === 'closed'

  return (
    <div style={{ paddingBottom: 60 }}>
      <CleaningHeader
        title="Cleaning & Sanitation"
        back="/"
        member={member}
        onSwitch={() => setPicking(true)}
      />

      <div style={{ padding: 16, maxWidth: 720, margin: '0 auto' }}>
        {!member && (
          <button
            onClick={() => setPicking(true)}
            style={{
              ...cardStyle, width: '100%', minHeight: TAP, marginBottom: 16,
              color: C.cream, fontSize: 16, cursor: 'pointer', textAlign: 'left',
            }}
          >
            👤 <strong>Tap to sign in</strong>
            <div style={{ color: C.tan, fontSize: 13, marginTop: 2 }}>
              So your work gets recorded under your name
            </div>
          </button>
        )}

        {/* Tonight */}
        <Link href="/cleaning/shift" style={{ textDecoration: 'none' }}>
          <div style={{ ...cardStyle, marginBottom: 12, borderColor: closed ? C.green : C.amber }}>
            <div style={{
              display: 'flex', justifyContent: 'space-between',
              alignItems: 'baseline', marginBottom: 10,
            }}>
              <span style={{ color: C.cream, fontSize: 18, fontWeight: 700 }}>
                🧽 Tonight&apos;s list
              </span>
              <span style={{ color: C.tan, fontSize: 13 }}>
                {state?.shift ? dateLabel(state.shift.shift_date, { month: 'short', day: 'numeric' }) : ''}
              </span>
            </div>

            {progress && progress.total > 0 ? (
              <>
                <ProgressBar
                  pct={progress.pct}
                  tone={closed ? C.green : progress.issue > 0 ? C.amber : C.green}
                />
                <div style={{ color: C.tan, fontSize: 14, marginTop: 8 }}>
                  {closed
                    ? `Closed by ${state?.shift?.closed_by}`
                    : `${progress.pending} of ${progress.total} still to do`}
                  {progress.issue > 0 && (
                    <span style={{ color: C.amber }}> · {progress.issue} flagged</span>
                  )}
                </div>
              </>
            ) : (
              <div style={{ color: C.tan, fontSize: 14 }}>
                {!state       ? 'Loading…'
                 : !state.shift ? 'Not started — tap to start the shift'
                 : 'Nothing came due tonight.'}
              </div>
            )}
          </div>
        </Link>

        {/* The rest */}
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: '1fr 1fr' }}>
          <HubTile
            href="/cleaning/morning"
            icon="🌅"
            title="Morning list"
            sub={!state ? '—' : state.rolled > 0 ? `${state.rolled} rolled from last night` : 'Nothing rolled over'}
            alert={state ? state.pastPreop : false}
          />
          <HubTile
            href="/cleaning/map"
            icon="🗺️"
            title="Plant map"
            sub="Where the work is"
          />
          <HubTile
            href="/cleaning/equipment"
            icon="🔧"
            title="Equipment"
            sub="Teardown & reassembly"
          />
          <HubTile
            href="/cleaning/issues"
            icon="📣"
            title="Issues"
            sub={state ? `${state.issues} open` : '—'}
            alert={state ? state.urgent > 0 : false}
          />
          <HubTile
            href="/cleaning/supplies"
            icon="🧴"
            title="Supplies"
            sub={state ? `${state.supplies} requested` : '—'}
            alert={state ? state.out > 0 : false}
          />
          <HubTile
            href="/cleaning/admin"
            icon="⚙️"
            title="Manage"
            sub="Lists & procedures"
          />
        </div>
      </div>
    </div>
  )
}

function HubTile({ href, icon, title, sub, alert }: {
  href: string; icon: string; title: string; sub: string; alert?: boolean
}) {
  return (
    <Link href={href} style={{ textDecoration: 'none' }}>
      <div style={{
        ...cardStyle,
        minHeight:   96,
        display:     'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap:         4,
        borderColor: alert ? C.amber : C.medBrown,
      }}>
        <div style={{ fontSize: 24 }}>{icon}</div>
        <div style={{ color: C.cream, fontSize: 15, fontWeight: 700 }}>{title}</div>
        <div style={{ color: alert ? C.amber : C.tan, fontSize: 12 }}>{sub}</div>
      </div>
    </Link>
  )
}
