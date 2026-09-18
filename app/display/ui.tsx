'use client'
// Shared furniture for the wall screens.
//
// Everything here is sized in vw/vh rather than rem. A phone page can trust
// 1rem to mean "readable at arm's length"; a TV cannot, because the same markup
// has to hold up on a 32" screen across a bench and a 55" across the room, and
// the browser has no idea which one it is plugged into. Sizing off the viewport
// makes the card fill whatever it lands on, and clamp() stops it turning into
// billboard text on the laptop's own screen while a window is being dragged.
//
// No FeedbackButton, no nav, no chrome of any kind: nothing on these pages is
// tappable, because nothing is standing in front of them.

import { useEffect, useRef, useState } from 'react'
import { PRIMAL_COLORS, type PrimalBand, bandOf } from '@/lib/cutRoomCard'

export const C = {
  dark:       '#1A0A04',
  darkBrown:  '#351E0E',
  medBrown:   '#75471B',
  lightBrown: '#A6785A',
  tan:        '#C9A882',
  cream:      '#F2E8D9',
  green:      '#4CAF50',
  red:        '#EF4444',
  amber:      '#F59E0B',
}

// The cutting table's own three colors, as the wall renders them. The printed
// card tints a section's body and fills its header bar; on a dark screen the
// tint reads as a wash over black instead, so the bar keeps the exact hex the
// paper uses and the body gets that color at low alpha.
export const BAND_TINT: Record<PrimalBand, string> = {
  green:  'rgba(46,125,50,0.16)',
  yellow: 'rgba(242,194,0,0.13)',
  red:    'rgba(183,28,28,0.16)',
  other:  'rgba(166,120,90,0.10)',
}
export const BAND_EDGE: Record<PrimalBand, string> = {
  green:  'rgba(76,175,80,0.55)',
  yellow: 'rgba(242,194,0,0.55)',
  red:    'rgba(239,68,68,0.55)',
  other:  'rgba(166,120,90,0.40)',
}

/** The header bar color the printed card uses for this primal, or the plant's
 *  brown for a section the color map doesn't name (trim, smokehouse, notes). */
export function barFor(title: string): { bar: string; text: string } {
  const c = PRIMAL_COLORS[title]
  return { bar: c?.bar ?? C.darkBrown, text: c?.text ?? C.cream }
}

export { bandOf }

// ── Type scale ───────────────────────────────────────────────────────────────
// One place, because a value that shrinks while its label doesn't is how a
// board stops being readable from the rail.
export const T = {
  /** The customer's name in the header. */
  name:      'clamp(1.4rem, 2.6vw, 3rem)',
  /** Header supporting detail — tag, hanging weight, days. */
  meta:      'clamp(0.75rem, 1.05vw, 1.25rem)',
  /** A primal's title bar. */
  secTitle:  'clamp(0.8rem, 1.15vw, 1.4rem)',
  /** What a cut actually says. The whole point of the screen. */
  value:     'clamp(1rem, 1.7vw, 2.1rem)',
  /** Which cut it is. Deliberately smaller than the answer. */
  label:     'clamp(0.68rem, 0.95vw, 1.15rem)',
  /** Stat tile numbers. */
  stat:      'clamp(1.5rem, 3vw, 3.4rem)',
  statLabel: 'clamp(0.6rem, 0.8vw, 1rem)',
  /** Queue rows. */
  queue:     'clamp(0.85rem, 1.3vw, 1.6rem)',
  /** The "nothing on the board" plate. */
  idle:      'clamp(1.2rem, 2.2vw, 2.6rem)',
}

export function StatTile({ value, label, color }: { value: string; label: string; color?: string }) {
  return (
    <div style={{
      flex: 1, minWidth: 0, background: C.dark, border: '1px solid rgba(166,120,90,0.25)',
      borderRadius: 8, padding: '0.5vw 0.4vw', textAlign: 'center',
    }}>
      <div style={{ fontSize: T.stat, fontWeight: 700, color: color ?? C.cream, lineHeight: 1.05 }}>{value}</div>
      <div style={{
        fontSize: T.statLabel, color: C.lightBrown, textTransform: 'uppercase',
        letterSpacing: '0.08em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>{label}</div>
    </div>
  )
}

/**
 * The screen is showing something, but is it showing something CURRENT?
 *
 * A wall TV has no way to say "my last request failed" — it just keeps
 * displaying the answer it already has, which on a cutting floor is the
 * dangerous failure: nobody doubts a screen that looks fine. So a board whose
 * data has gone stale says so across its full width, in the one color the room
 * already reads as stop.
 */
export function StaleBar({ seconds }: { seconds: number }) {
  if (seconds < 45) return null
  const mins = Math.floor(seconds / 60)
  return (
    <div style={{
      background: C.red, color: '#fff', textAlign: 'center', fontWeight: 800,
      fontSize: T.meta, letterSpacing: '0.1em', textTransform: 'uppercase',
      padding: '0.35vh 0', flexShrink: 0,
    }}>
      ⚠ Not updating — last refreshed {mins >= 1 ? `${mins} min` : `${Math.round(seconds)} sec`} ago
    </div>
  )
}

/** Nothing pointed at this screen yet. Says which TV it is, so the crew can
 *  tell three identical black rectangles apart while hanging them. */
export function IdlePlate({ screen, label, hint }: { screen: string; label: string; hint: string }) {
  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', gap: '1.5vh', color: C.lightBrown, textAlign: 'center', padding: '4vh 4vw',
    }}>
      <div style={{ fontSize: 'clamp(2.5rem, 6vw, 6rem)' }}>🔪</div>
      <div style={{ fontSize: T.idle, color: C.tan, fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: T.meta }}>{hint}</div>
      <div style={{
        fontSize: T.meta, color: C.medBrown, letterSpacing: '0.2em',
        textTransform: 'uppercase', marginTop: '2vh',
      }}>
        screen “{screen}”
      </div>
    </div>
  )
}

/**
 * Is this box showing everything it holds?
 *
 * A wall screen cannot be scrolled — there is no mouse, and the crew's hands
 * are full — so content that overflows is content that silently does not
 * exist. On a page whose whole job is carrying a cutting instruction, a primal
 * quietly clipped off the bottom is the worst thing this code could do. The
 * boards measure themselves and say so out loud instead.
 */
export function useClipped(deps: unknown[]) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [clipped, setClipped] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => {
      // A pixel or two of rounding is not a clipped primal.
      setClipped(el.scrollHeight - el.clientHeight > 4)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return { ref, clipped }
}

/** Said across the foot of a board that could not fit everything it was given. */
export function ClippedBar({ what }: { what: string }) {
  return (
    <div style={{
      background: C.amber, color: C.dark, textAlign: 'center', fontWeight: 800,
      fontSize: T.statLabel, letterSpacing: '0.08em', textTransform: 'uppercase',
      padding: '0.3vh 0', flexShrink: 0,
    }}>
      ⚠ More {what} than fits this screen — check the printed card
    </div>
  )
}
