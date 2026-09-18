'use client'
// ══════════════════════════════════════════════════════════════════════════════
// ONE WALL TV
//
// The packing bench proved the idea: throw the cut card on a screen and the
// answer is readable from the rail instead of being a sheet of paper somebody
// has to walk to. This is that, at the size the cut room actually is — three
// TVs over the cutting table, one over the packing kiosk, one at the burger
// setup, every one of them an HDMI export off a computer.
//
// The three cutter TVs are three browser windows on ONE laptop dragged onto
// three displays, and they all follow the 'cutroom' channel. Setting the animal
// once moves all three at the same instant; they differ only in what they
// render of it. That is why this page takes a screen name and asks the server
// what to be, instead of taking the animal in its URL: a window that remembers
// its own animal is a window that can disagree with the one beside it.
//
// Nothing here is tappable. Nobody is standing in front of these.
// ══════════════════════════════════════════════════════════════════════════════
import { use, useCallback, useEffect, useRef, useState } from 'react'
import {
  DEFAULT_WEIGHTS, buildEntries, carcassTotals, cutDaySections, loadScheduleData,
  hangColor, portionBadge, speciesIcon, type CutDaySection,
} from '@/lib/cutSchedule'
import { isoDate, dateLabel } from '@/lib/dates'
import type { CutSection } from '@/lib/cutRoomCard'
import {
  BAND_EDGE, BAND_TINT, C, ClippedBar, IdlePlate, StaleBar, StatTile, T, bandOf, barFor, useClipped,
} from '../ui'

// How often each half of the screen goes back to the server. The card is cheap
// (two indexed reads) and has to land within a few seconds of somebody moving
// the board, so it polls hard. The rail order is half a dozen endpoints and
// changes when a plan is saved, not while a carcass is being cut.
const CARD_MS  = 5_000
const QUEUE_MS = 45_000

interface ScreenCfg { screen: string; label: string; view: string; channel: string; sort: number }
interface ChannelRow { channel: string; customer_name: string; updated_at: string; updated_by: string }
interface CardPayload {
  cutting_instruction_id: string
  customer_name: string
  species: string
  portion: string
  sections: CutSection[]
  grind_whole: boolean
  notes: string
}
interface CarcassPayload {
  carcass_tag: string
  species: string
  harvest_date: string
  hot_carcass_weight_lbs: number | null
  days_hanging: number
}
interface Payload {
  screen: ScreenCfg
  channel: ChannelRow | null
  card: CardPayload | null
  carcass: CarcassPayload | null
}

// Trim, sausage and the smokehouse are the burger station's work, not the
// cutting table's — they're the one group that splits off onto its own screen.
// Matched on the title because that is what the card itself names them: the
// beef section is "Trim & Ground Beef" or bare "Trim" when the trim is bagged,
// and pork's is "Sausage / Trim".
const isGrindSection = (title: string) =>
  /trim|ground|sausage|smokehouse/i.test(title)

export default function DisplayScreenPage({ params }: { params: Promise<{ screen: string }> }) {
  const { screen } = use(params)

  const [payload,  setPayload]  = useState<Payload | null>(null)
  const [notFound, setNotFound] = useState<string[] | null>(null)
  const [sections, setSections] = useState<CutDaySection[]>([])
  // Wall-clock of the last SUCCESSFUL card fetch. A screen that keeps showing
  // yesterday's animal because the laptop dropped off the wifi is the failure
  // that matters here, and the only way to see it is to watch this go stale.
  const [cardAt, setCardAt] = useState<number | null>(null)
  const [now,    setNow]    = useState<number | null>(null)
  const inFlight = useRef(false)

  // ── The card ───────────────────────────────────────────────────────────────
  const loadCard = useCallback(async () => {
    if (inFlight.current) return
    inFlight.current = true
    try {
      const res  = await fetch(`/api/display?screen=${encodeURIComponent(screen)}`, { cache: 'no-store' })
      const body = await res.json()
      if (res.status === 404) { setNotFound(body.known ?? []); return }
      setNotFound(null)
      setPayload(body as Payload)
      setCardAt(Date.now())
    } catch {
      // Keep showing what's up. The stale bar is what tells the room the
      // screen has stopped listening — blanking it would throw away the
      // instruction the cutter is halfway through reading.
    } finally {
      inFlight.current = false
    }
  }, [screen])

  useEffect(() => {
    loadCard()
    const t = setInterval(loadCard, CARD_MS)
    return () => clearInterval(t)
  }, [loadCard])

  // ── The rail ───────────────────────────────────────────────────────────────
  const view       = payload?.screen.view ?? 'primals'
  const needsQueue = view === 'queue' || view === 'split'

  useEffect(() => {
    if (!needsQueue) return
    let alive = true
    const load = async () => {
      try {
        const today = isoDate()
        const { logs, apptMap, instrIds, instrByBuyer, saved, assignments, harvestDays } = await loadScheduleData(today)
        const list = buildEntries(logs, apptMap, instrIds, saved, assignments, DEFAULT_WEIGHTS, [], instrByBuyer)
        if (alive) setSections(cutDaySections(list, today, harvestDays))
      } catch {
        // Same as above: a failed refresh leaves the last good rail order up.
      }
    }
    load()
    const t = setInterval(load, QUEUE_MS)
    return () => { alive = false; clearInterval(t) }
  }, [needsQueue])

  // Clock ticks client-side only — rendering a time during SSR would hydrate
  // against a different second and blank the board for a frame. The first tick
  // arrives a second in, which is also why the header reserves the space.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(t)
  }, [])

  const staleFor = cardAt && now ? (now - cardAt) / 1000 : 0

  if (notFound) {
    return (
      <Shell>
        <IdlePlate
          screen={screen}
          label="No screen by that name"
          hint={notFound.length ? `Try: ${notFound.join(', ')}` : 'No screens are set up yet.'}
        />
      </Shell>
    )
  }

  const card    = payload?.card ?? null
  const carcass = payload?.carcass ?? null
  const cfg     = payload?.screen

  const cutSections   = (card?.sections ?? []).filter(s => !isGrindSection(s.title))
  const grindSections = (card?.sections ?? []).filter(s =>  isGrindSection(s.title))

  return (
    <Shell>
      <StaleBar seconds={staleFor} />
      <Header screen={screen} cfg={cfg} card={card} carcass={carcass} channel={payload?.channel ?? null} now={now} />

      {!card && view !== 'queue' && (
        <IdlePlate
          screen={screen}
          label={carcass
            ? `Tag ${carcass.carcass_tag || '—'} — no cut card`
            : payload?.channel?.customer_name
              ? `${payload.channel.customer_name} — no cut card`
              : (cfg?.label || 'Nothing on the board')}
          hint={carcass
            ? 'This animal is on the board but no cut card is linked to it yet.'
            : cfg?.channel === 'kiosk'
              // A session IS open, it just has no card on it — so the useful
              // thing to say is the one action that fixes it, not "open a
              // session" to somebody who already has.
              ? payload?.channel?.customer_name
                ? 'Scan the cut card or packaging sheet at the kiosk.'
                : 'Open a session on the packing scanner and it shows up here.'
              : 'Set the animal from the cut room board on the laptop.'}
        />
      )}

      {card?.grind_whole && (
        <div style={{
          background: C.amber, color: C.dark, textAlign: 'center', fontWeight: 900,
          fontSize: 'clamp(1.1rem, 2.2vw, 2.6rem)', letterSpacing: '0.12em',
          textTransform: 'uppercase', padding: '0.8vh 0', flexShrink: 0,
        }}>
          Grind the whole animal
        </div>
      )}

      {view === 'primals' && card && <Boards sections={cutSections} cols={3} />}
      {view === 'grind'   && card && <Boards sections={grindSections} cols={2} />}
      {view === 'queue'   && <Queue sections={sections} highlight={card?.customer_name ?? ''} />}
      {view === 'split'   && (
        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
          <div style={{ flex: '1 1 58%', minWidth: 0, display: 'flex', borderRight: `2px solid ${C.medBrown}` }}>
            {card
              ? <Boards sections={cutSections} cols={2} />
              : <IdlePlate screen={screen} label="No card" hint="Nothing pointed at this screen." />}
          </div>
          <div style={{ flex: '1 1 42%', minWidth: 0, display: 'flex' }}>
            <Queue sections={sections} highlight={card?.customer_name ?? ''} />
          </div>
        </div>
      )}
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, background: C.darkBrown, color: C.cream,
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
      fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      {children}
    </div>
  )
}

// ── Header ───────────────────────────────────────────────────────────────────
// Who, what animal, how long it has hung. The clock is not decoration: a
// stopped clock is the fastest way for anyone walking past to spot a screen
// whose browser has died, which the stale bar cannot catch.
function Header({ screen, cfg, card, carcass, channel, now }: {
  screen: string
  cfg?: ScreenCfg
  card: CardPayload | null
  carcass: CarcassPayload | null
  channel: ChannelRow | null
  now: number | null
}) {
  const species = card?.species || carcass?.species || ''
  const badge   = card?.portion ? portionBadge(card.portion) : null
  const meta: string[] = []
  if (carcass?.carcass_tag) meta.push(`Tag ${carcass.carcass_tag}`)
  if (carcass?.hot_carcass_weight_lbs) meta.push(`${Math.round(carcass.hot_carcass_weight_lbs)} lb hanging`)
  if (carcass?.harvest_date) meta.push(`killed ${dateLabel(carcass.harvest_date, { month: 'short', day: 'numeric' })}`)

  return (
    <header style={{
      background: C.dark, borderBottom: `1px solid ${C.medBrown}`,
      padding: '0.8vh 1.2vw', display: 'flex', alignItems: 'center',
      justifyContent: 'space-between', gap: '1vw', flexShrink: 0,
    }}>
      <div style={{ minWidth: 0, display: 'flex', alignItems: 'baseline', gap: '0.8vw', flexWrap: 'wrap' }}>
        <span style={{ fontSize: T.name, fontWeight: 800, whiteSpace: 'nowrap' }}>
          {species && <span style={{ marginRight: '0.4vw' }}>{speciesIcon(species)}</span>}
          {/* Who, even before a card reaches the screen: a packing session
              with no cut card scanned yet still has a name on it, and a
              header reading "—" over an open session helps nobody. */}
          {card?.customer_name || channel?.customer_name || '—'}
        </span>
        {badge && (
          <span style={{
            fontSize: T.meta, fontWeight: 700, color: badge.color,
            border: `1px solid ${badge.color}`, borderRadius: 5, padding: '0.1vh 0.5vw',
          }}>{badge.label}</span>
        )}
        {carcass && carcass.days_hanging > 0 && (
          <span style={{ fontSize: T.meta, fontWeight: 700, color: hangColor(carcass.days_hanging) }}>
            {carcass.days_hanging}d hanging
          </span>
        )}
        {meta.length > 0 && (
          <span style={{ fontSize: T.meta, color: C.lightBrown }}>{meta.join(' · ')}</span>
        )}
      </div>

      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ fontSize: T.meta, color: C.tan, fontWeight: 700, whiteSpace: 'nowrap' }}>
          {cfg?.label || screen}
        </div>
        <div style={{ fontSize: T.statLabel, color: C.medBrown, letterSpacing: '0.1em' }}>
          {now ? new Date(now).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : ' '}
        </div>
      </div>
    </header>
  )
}

// ── Primal boards ────────────────────────────────────────────────────────────
// CSS columns rather than a grid, for the same reason the printed card uses
// them: a primal is atomic. break-inside:avoid keeps Round's six rows together
// instead of dealing the last two into the next column, where a cutter reading
// left to right would never find them.
function Boards({ sections, cols }: { sections: CutSection[]; cols: number }) {
  const { ref, clipped } = useClipped([sections, cols])
  if (!sections.length) {
    return (
      <div style={{
        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: C.lightBrown, fontSize: T.idle,
      }}>
        Nothing on this card for this board
      </div>
    )
  }
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div
        ref={ref}
        style={{
          flex: 1, minHeight: 0, overflow: 'hidden',
          // columnCount, not the `columns` shorthand: React appends px to any
          // numeric style value outside its unitless list, and `columns` is not
          // on it — `columns: 3` would reach the browser as `columns: 3px`.
          columnCount: cols, columnGap: '0.8vw', padding: '0.8vh 0.8vw',
        }}
      >
        {sections.map(s => <Board key={s.title} section={s} />)}
      </div>
      {clipped && <ClippedBar what="on this card" />}
    </div>
  )
}

function Board({ section }: { section: CutSection }) {
  const band = bandOf(section.title)
  const { bar, text } = barFor(section.title)
  return (
    <div style={{
      breakInside: 'avoid', marginBottom: '0.8vh', borderRadius: 6, overflow: 'hidden',
      border: `1px solid ${BAND_EDGE[band]}`, background: BAND_TINT[band],
    }}>
      <div style={{
        background: bar, color: text, padding: '0.25vh 0.6vw', fontWeight: 800,
        fontSize: T.secTitle, letterSpacing: '0.1em', textTransform: 'uppercase',
      }}>
        {section.title}
      </div>
      {section.rows.map((r, i) => (
        <div key={i} style={{
          display: 'flex', alignItems: 'baseline', gap: '0.6vw',
          padding: '0.22vh 0.6vw',
          borderTop: i ? '1px solid rgba(0,0,0,0.25)' : 'none',
          background: r.addon ? 'rgba(242,194,0,0.10)' : 'transparent',
        }}>
          <span style={{
            fontSize: T.label, color: r.addon ? C.amber : C.lightBrown,
            flex: '0 0 34%', minWidth: 0, lineHeight: 1.25,
          }}>
            {/* The shared builder indents add-on labels the way the printed
                card wants them; on screen the tint and color already say it. */}
            {r.label.trim()}
          </span>
          <span style={{
            fontSize: T.value, fontWeight: 700, color: C.cream, minWidth: 0,
            fontStyle: r.addon ? 'italic' : 'normal', lineHeight: 1.2,
          }}>
            {r.value}
          </span>
        </div>
      ))}
    </div>
  )
}

// ── The rail ─────────────────────────────────────────────────────────────────
function Queue({ sections, highlight }: { sections: CutDaySection[]; highlight: string }) {
  const { ref, clipped } = useClipped([sections])
  const entries = sections.flatMap(s => s.entries)
  const totals  = carcassTotals(entries)
  const missing = entries.filter(e => !e.has_instructions).length
  const today   = isoDate()

  let n = 0

  return (
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', padding: '0.8vh 0.8vw' }}>
      <div style={{ display: 'flex', gap: '0.5vw', marginBottom: '0.8vh', flexShrink: 0 }}>
        <StatTile value={String(totals.head)} label="head" color={C.tan} />
        <StatTile value={Math.round(totals.lbs).toLocaleString()} label="lb hanging" />
        <StatTile value={String(missing)} label="no sheet" color={missing > 0 ? C.red : C.green} />
      </div>

      {entries.length === 0 && (
        <div style={{
          flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: C.lightBrown, fontSize: T.idle, textAlign: 'center',
        }}>
          Nothing scheduled on the cut list
        </div>
      )}

      <div ref={ref} style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {sections.map((sec, si) => (
          <div key={sec.key} style={{ marginBottom: '0.6vh' }}>
            <div style={{
              color: C.amber, fontWeight: 800, fontSize: T.statLabel,
              textTransform: 'uppercase', letterSpacing: '0.1em',
              padding: '0.25vh 0.4vw', background: 'rgba(245,158,11,0.12)',
              border: '1px solid rgba(245,158,11,0.3)', borderRadius: 5, marginBottom: '0.3vh',
            }}>
              ▸ {sec.date
                  ? (sec.date === today ? `Today — ${dateLabel(sec.date)}` : dateLabel(sec.date))
                  : (si === 0 ? 'Up first' : 'Date not set')}
              {sec.alsoKilling != null && <span style={{ color: C.tan, fontWeight: 400 }}> · killing {sec.alsoKilling} head too</span>}
            </div>

            {sec.entries.map(e => {
              n++
              // The animal on the table gets the amber rail — on the queue TV
              // that is the whole question the cutters ask it: where are we.
              const onTable = !!highlight && e.customer_name === highlight
              return (
                <div key={e.key} style={{
                  display: 'flex', alignItems: 'center', gap: '0.5vw',
                  padding: '0.3vh 0.5vw', marginBottom: '0.2vh', borderRadius: 5,
                  background: onTable ? 'rgba(245,158,11,0.18)' : C.dark,
                  border: `1px solid ${onTable ? C.amber : 'rgba(166,120,90,0.2)'}`,
                  fontSize: T.queue,
                }}>
                  <span style={{ color: C.medBrown, fontWeight: 700, flex: '0 0 1.8vw' }}>{n}</span>
                  <span style={{ flexShrink: 0 }}>{speciesIcon(e.species)}</span>
                  <span style={{
                    flex: 1, minWidth: 0, fontWeight: 700, whiteSpace: 'nowrap',
                    overflow: 'hidden', textOverflow: 'ellipsis',
                    color: e.has_instructions ? C.cream : C.red,
                  }}>
                    {e.customer_name || e.producer || '—'}
                    {!e.has_instructions && <span style={{ fontWeight: 400 }}> · no sheet</span>}
                  </span>
                  {e.carcass_tag && <span style={{ color: C.lightBrown, flexShrink: 0 }}>#{e.carcass_tag}</span>}
                  {e.hot_carcass_weight_lbs != null && (
                    <span style={{ color: C.tan, flexShrink: 0 }}>{Math.round(e.hot_carcass_weight_lbs)}#</span>
                  )}
                  <span style={{ color: hangColor(e.days_hanging), fontWeight: 700, flexShrink: 0 }}>
                    {e.days_hanging}d
                  </span>
                </div>
              )
            })}
          </div>
        ))}
      </div>
      {clipped && <ClippedBar what="on the rail" />}
    </div>
  )
}
