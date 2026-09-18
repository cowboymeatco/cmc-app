'use client'
// ══════════════════════════════════════════════════════════════════════════════
// THE CUT ROOM BOARD
//
// The one page a person touches. Everything else in /display is furniture bolted
// to a wall.
//
// This runs on the laptop that drives the cutter TVs — and equally on a phone in
// the cooler, which is the point of keeping the screens' state on the server
// rather than in the windows. Setting the animal here moves all three cutter TVs
// at once, because they share the 'cutroom' channel; they were never independent
// and the board deliberately offers no way to make them so.
//
// The packing kiosk's channel is shown but not settable. It follows whatever
// session the scanner has open, and a manual override would be a second source
// of truth for a screen nobody is watching — the packer would have no way to
// know the TV had stopped following their gun.
// ══════════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import {
  DEFAULT_WEIGHTS, buildEntries, cutDaySections, loadScheduleData,
  hangColor, portionBadge, speciesIcon, type CutDaySection,
} from '@/lib/cutSchedule'
import { isoDate, dateLabel } from '@/lib/dates'
import { C } from './ui'

const VIEWS: { key: string; label: string; hint: string }[] = [
  { key: 'primals', label: 'Primals', hint: 'The cut card at wall size, banded green / yellow / red' },
  { key: 'queue',   label: 'Queue',   hint: "The day's rail order, head and hanging weight" },
  { key: 'grind',   label: 'Grind',   hint: 'Trim, ground blend, patties and the smokehouse' },
  { key: 'split',   label: 'Split',   hint: 'Primals down one half, stats and queue down the other' },
]

interface ScreenCfg { screen: string; label: string; view: string; channel: string; sort: number }
interface ChannelRow {
  channel: string
  cutting_instruction_id: string | null
  harvest_log_id: string | null
  customer_name: string
  session_date: string | null
  updated_at: string
  updated_by: string
}

const WHO_KEY = 'cutRoomBoardWho'

export default function CutRoomBoardPage() {
  const [screens,  setScreens]  = useState<ScreenCfg[]>([])
  const [channels, setChannels] = useState<ChannelRow[]>([])
  const [sections, setSections] = useState<CutDaySection[]>([])
  const [who,      setWho]      = useState('')
  // Tracks the CUT LIST specifically. It used to be cleared by the board fetch
  // finishing, which is a different request entirely — so "Loading the cut
  // list…" could vanish while the cut list was still on its way.
  const [listLoaded, setListLoaded] = useState(false)
  const [busy,     setBusy]     = useState('')
  const [error,    setError]    = useState('')

  useEffect(() => {
    try { setWho(localStorage.getItem(WHO_KEY) ?? '') } catch { /* private browsing */ }
  }, [])

  const loadBoard = useCallback(async () => {
    try {
      const res  = await fetch('/api/display', { cache: 'no-store' })
      const body = await res.json()
      setScreens(body.screens ?? [])
      setChannels(body.channels ?? [])
      setError('')
    } catch {
      setError('Could not reach the server.')
    }
  }, [])

  useEffect(() => {
    // The kiosk channel moves without anyone touching this page, so the board
    // keeps checking rather than showing whatever was true when it loaded.
    loadBoard()
    const t = setInterval(loadBoard, 10_000)
    return () => clearInterval(t)
  }, [loadBoard])

  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const today = isoDate()
        const { logs, apptMap, instrIds, instrByBuyer, saved, assignments, harvestDays } = await loadScheduleData(today)
        const list = buildEntries(logs, apptMap, instrIds, saved, assignments, DEFAULT_WEIGHTS, [], instrByBuyer)
        if (alive) setSections(cutDaySections(list, today, harvestDays))
      } catch {
        if (alive) setError('Could not load the cut list.')
      } finally {
        if (alive) setListLoaded(true)
      }
    }
    load()
    const t = setInterval(load, 60_000)
    return () => { alive = false; clearInterval(t) }
  }, [])

  const post = async (body: Record<string, unknown>, key: string) => {
    setBusy(key)
    try {
      const res = await fetch('/api/display', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const b = await res.json().catch(() => ({}))
        setError(b.error || 'That did not save.')
      } else {
        setError('')
        await loadBoard()
      }
    } catch {
      setError('That did not save.')
    } finally {
      setBusy('')
    }
  }

  const rememberWho = (v: string) => {
    setWho(v)
    try { localStorage.setItem(WHO_KEY, v) } catch { /* private browsing */ }
  }

  const cutroom = channels.find(c => c.channel === 'cutroom')
  const kiosk   = channels.find(c => c.channel === 'kiosk')
  const entries = sections.flatMap(s => s.entries)
  const today   = isoDate()

  const putOnBoard = (e: typeof entries[number]) => post({
    action: 'channel',
    channel: 'cutroom',
    cutting_instruction_id: e.cutting_instruction_id,
    harvest_log_id: e.harvest_log_id,
    customer_name: e.customer_name,
    updated_by: who,
  }, `set:${e.key}`)

  return (
    <div style={{ minHeight: '100vh', background: C.darkBrown, color: C.cream, paddingBottom: '3rem' }}>
      <header style={{
        position: 'sticky', top: 0, zIndex: 10, background: C.dark,
        borderBottom: '1px solid rgba(166,120,90,0.3)', padding: '0.8rem 1rem',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap',
      }}>
        <div>
          <h1 style={{
            fontFamily: 'Georgia, serif', fontSize: '1.05rem', fontWeight: 700, margin: 0,
            letterSpacing: '0.06em', textTransform: 'uppercase',
          }}>
            📺 Cut Room Board
          </h1>
          <div style={{ fontSize: '0.7rem', color: C.lightBrown, marginTop: 2 }}>
            What each wall screen is showing
          </div>
        </div>
        <input
          value={who}
          onChange={e => rememberWho(e.target.value)}
          placeholder="Your name"
          style={{
            background: C.darkBrown, border: '1px solid rgba(166,120,90,0.4)', color: C.cream,
            borderRadius: 6, padding: '0.5rem 0.7rem', fontSize: '0.85rem', width: 150,
          }}
        />
      </header>

      <main style={{ maxWidth: 900, margin: '0 auto', padding: '1rem 0.75rem' }}>
        {error && (
          <div style={{
            background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.5)',
            color: C.red, borderRadius: 6, padding: '0.6rem 0.8rem', marginBottom: '1rem',
            fontSize: '0.85rem', fontWeight: 700,
          }}>{error}</div>
        )}

        {/* ── What's on the cutting table ─────────────────────────────────── */}
        <section style={{ marginBottom: '1.5rem' }}>
          <SectionTitle>On the cutting table</SectionTitle>
          <div style={{
            background: C.dark, border: `1px solid ${cutroom?.customer_name ? C.amber : 'rgba(166,120,90,0.25)'}`,
            borderRadius: 8, padding: '0.9rem 1rem',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap',
          }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: '1.3rem', fontWeight: 800, color: cutroom?.customer_name ? C.cream : C.lightBrown }}>
                {cutroom?.customer_name || 'Nothing on the board'}
              </div>
              <div style={{ fontSize: '0.72rem', color: C.lightBrown, marginTop: 2 }}>
                {cutroom?.customer_name
                  ? <>all three cutter TVs{cutroom.updated_by ? ` · set by ${cutroom.updated_by}` : ''}</>
                  : 'Pick an animal below and every cutter TV follows it'}
                {cutroom && !cutroom.cutting_instruction_id && cutroom.customer_name && (
                  <span style={{ color: C.red, fontWeight: 700 }}> · no cut card linked</span>
                )}
              </div>
            </div>
            {cutroom?.customer_name && (
              <button
                onClick={() => post({
                  action: 'channel', channel: 'cutroom',
                  cutting_instruction_id: null, harvest_log_id: null, customer_name: '', updated_by: who,
                }, 'clear')}
                disabled={busy === 'clear'}
                style={btn('rgba(239,68,68,0.15)', C.red, 'rgba(239,68,68,0.45)')}
              >
                {busy === 'clear' ? '…' : 'Clear the board'}
              </button>
            )}
          </div>
        </section>

        {/* ── Pick the animal ─────────────────────────────────────────────── */}
        <section style={{ marginBottom: '1.5rem' }}>
          <SectionTitle>Put an animal up</SectionTitle>
          {!listLoaded && <Muted>Loading the cut list…</Muted>}
          {listLoaded && entries.length === 0 && <Muted>Nothing is scheduled on the cut list right now.</Muted>}
          {sections.map((sec, si) => (
            <div key={sec.key} style={{ marginBottom: '0.8rem' }}>
              <div style={{
                color: C.amber, fontWeight: 700, fontSize: '0.72rem', textTransform: 'uppercase',
                letterSpacing: '0.08em', padding: '0.35rem 0.5rem', marginBottom: '0.35rem',
                background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 5,
              }}>
                ▸ {sec.date
                    ? (sec.date === today ? `Today — ${dateLabel(sec.date)}` : dateLabel(sec.date))
                    : (si === 0 ? 'Up first' : 'Date not set')}
              </div>
              {sec.entries.map(e => {
                const current = cutroom?.customer_name === e.customer_name
                const badge   = portionBadge(e.portion)
                return (
                  <button
                    key={e.key}
                    onClick={() => putOnBoard(e)}
                    disabled={busy === `set:${e.key}`}
                    style={{
                      width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: '0.5rem',
                      background: current ? 'rgba(245,158,11,0.18)' : C.dark,
                      border: `1px solid ${current ? C.amber : 'rgba(166,120,90,0.25)'}`,
                      color: C.cream, borderRadius: 6, padding: '0.6rem 0.7rem', marginBottom: '0.3rem',
                      fontSize: '0.9rem', cursor: 'pointer',
                    }}
                  >
                    <span>{speciesIcon(e.species)}</span>
                    <span style={{
                      flex: 1, minWidth: 0, fontWeight: 700, whiteSpace: 'nowrap',
                      overflow: 'hidden', textOverflow: 'ellipsis',
                      color: e.has_instructions ? C.cream : C.red,
                    }}>
                      {e.customer_name || e.producer || '—'}
                      {!e.has_instructions && <span style={{ fontWeight: 400 }}> · no sheet</span>}
                    </span>
                    <span style={{ fontSize: '0.7rem', color: badge.color, flexShrink: 0 }}>{badge.label}</span>
                    {e.carcass_tag && <span style={{ fontSize: '0.75rem', color: C.lightBrown, flexShrink: 0 }}>#{e.carcass_tag}</span>}
                    <span style={{ fontSize: '0.75rem', color: hangColor(e.days_hanging), fontWeight: 700, flexShrink: 0 }}>
                      {e.days_hanging}d
                    </span>
                    <span style={{ fontSize: '0.7rem', color: current ? C.amber : C.medBrown, fontWeight: 700, flexShrink: 0 }}>
                      {current ? 'ON AIR' : 'put up'}
                    </span>
                  </button>
                )
              })}
            </div>
          ))}
        </section>

        {/* ── The screens ─────────────────────────────────────────────────── */}
        <section style={{ marginBottom: '1.5rem' }}>
          <SectionTitle>The screens</SectionTitle>
          <Muted>
            Open each one, drag the window onto its TV and press F11 for full screen. They keep
            themselves up to date — nothing needs pressing again.
          </Muted>
          {screens.map(s => (
            <div key={s.screen} style={{
              background: C.dark, border: '1px solid rgba(166,120,90,0.25)', borderRadius: 8,
              padding: '0.7rem 0.8rem', marginTop: '0.5rem',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700 }}>{s.label || s.screen}</div>
                  <div style={{ fontSize: '0.7rem', color: C.lightBrown }}>
                    /display/{s.screen} · follows{' '}
                    {s.channel === 'kiosk' ? 'the packing scanner' : 'the cutting table'}
                  </div>
                </div>
                <Link
                  href={`/display/${s.screen}`}
                  target="_blank"
                  style={{ ...btn('rgba(201,168,130,0.15)', C.tan, 'rgba(201,168,130,0.4)'), textDecoration: 'none' }}
                >
                  Open ↗
                </Link>
              </div>
              <div style={{ display: 'flex', gap: '0.3rem', marginTop: '0.55rem', flexWrap: 'wrap' }}>
                {VIEWS.map(v => (
                  <button
                    key={v.key}
                    onClick={() => post({ action: 'view', screen: s.screen, view: v.key }, `view:${s.screen}:${v.key}`)}
                    disabled={busy === `view:${s.screen}:${v.key}`}
                    title={v.hint}
                    style={{
                      background: s.view === v.key ? C.medBrown : 'transparent',
                      border: `1px solid ${s.view === v.key ? C.tan : 'rgba(166,120,90,0.35)'}`,
                      color: s.view === v.key ? C.cream : C.lightBrown,
                      borderRadius: 5, padding: '0.35rem 0.7rem', fontSize: '0.78rem',
                      fontWeight: 700, cursor: 'pointer',
                    }}
                  >
                    {v.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </section>

        {/* ── The kiosk ───────────────────────────────────────────────────── */}
        <section>
          <SectionTitle>Packing kiosk</SectionTitle>
          <div style={{
            background: C.dark, border: '1px solid rgba(166,120,90,0.25)',
            borderRadius: 8, padding: '0.8rem 1rem',
          }}>
            <div style={{ fontSize: '1.05rem', fontWeight: 700, color: kiosk?.customer_name ? C.cream : C.lightBrown }}>
              {kiosk?.customer_name || 'No session open'}
            </div>
            <div style={{ fontSize: '0.72rem', color: C.lightBrown, marginTop: 2 }}>
              {kiosk?.session_date
                ? `session ${dateLabel(kiosk.session_date, { month: 'short', day: 'numeric' })} · `
                : ''}
              follows the scanner on its own — nothing to set here
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 style={{
      fontSize: '0.72rem', color: C.tan, textTransform: 'uppercase', letterSpacing: '0.1em',
      fontWeight: 700, margin: '0 0 0.5rem',
    }}>{children}</h2>
  )
}

function Muted({ children }: { children: React.ReactNode }) {
  return <p style={{ fontSize: '0.78rem', color: C.lightBrown, margin: '0 0 0.5rem' }}>{children}</p>
}

function btn(bg: string, color: string, border: string): React.CSSProperties {
  return {
    background: bg, border: `1px solid ${border}`, color,
    borderRadius: 6, padding: '0.5rem 0.9rem', fontSize: '0.82rem',
    fontWeight: 700, cursor: 'pointer', flexShrink: 0,
  }
}
