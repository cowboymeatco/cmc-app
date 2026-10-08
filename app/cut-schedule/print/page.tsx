'use client'
// ══════════════════════════════════════════════════════════════════════════════
// CUT SCHEDULE, ON PAPER
//
// Charlie, 2026-09-29: "Can I get an easy print off that I can hand to my
// guys?" The phone view is the same plan, but a sheet on the clipboard is
// what gets carried down the rail and ticked off with a pen.
//
// Same plan, same days as the phone view (lib/cutSchedule buildCrewSections)
// — the LAST SAVED plan, so the planner saves first. Laid out black on white
// for a Letter page: a heading per cutting day, its carcasses in rail order,
// a box to tick each one off. Opened from the planner's 🖨 Print button with
// ?auto=1, which brings up the print dialog once the plan has loaded; without
// it the sheet just shows with its own Print button, so a day can be left
// off first — most mornings the crew only needs today's.
// ══════════════════════════════════════════════════════════════════════════════
import { use, useCallback, useEffect, useState } from 'react'
import {
  type CrewSection,
  DEFAULT_WEIGHTS, buildEntries, loadScheduleData, buildCrewSections, carcassTotals, killMix,
  portionBadge, hangAtCut,
} from '@/lib/cutSchedule'
import { isoDate, dateLabel } from '@/lib/dates'

// When the sheet came off the printer, on the shop clock — the plan moves
// through the day, and the crew should know which version they're holding.
function printedStamp(): string {
  return new Date().toLocaleString('en-US', {
    timeZone: 'America/Denver', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

const CSS = `
.cutprint { min-height: 100vh; background: #d9d2c6; color: #000; font-family: Arial, Helvetica, sans-serif; }
.cutprint .bar { position: sticky; top: 0; z-index: 5; display: flex; flex-wrap: wrap; align-items: center; gap: .6rem 1.25rem; padding: .6rem 1rem; background: #1A0A04; color: #F2E8D9; font-size: .85rem; }
.cutprint .bar .hint { display: block; color: #C9A882; font-size: .74rem; margin-top: 2px; }
.cutprint .bar .days { display: flex; flex-wrap: wrap; gap: .35rem .9rem; }
.cutprint .bar label { cursor: pointer; white-space: nowrap; }
.cutprint .bar .actions { margin-left: auto; display: flex; gap: .5rem; }
.cutprint .bar button { background: transparent; border: 1px solid rgba(201,168,130,.5); color: #C9A882; border-radius: 4px; padding: .45rem .9rem; font-weight: 700; cursor: pointer; font-size: .85rem; }
.cutprint .bar button.primary { background: #4CAF50; color: #1A0A04; border-color: #4CAF50; }
.cutprint .bar button:disabled { opacity: .5; cursor: not-allowed; }
.cutprint .sheet { background: #fff; max-width: 8.5in; margin: 1rem auto; padding: .5in; box-shadow: 0 2px 12px rgba(0,0,0,.25); }
.cutprint .title { display: flex; justify-content: space-between; align-items: flex-end; gap: 1rem; border-bottom: 2px solid #000; padding-bottom: 6px; margin-bottom: 14px; }
.cutprint h1 { font-family: Georgia, serif; font-size: 20pt; margin: 0; letter-spacing: .04em; text-transform: uppercase; }
.cutprint .meta { font-size: 9pt; text-align: right; line-height: 1.5; }
.cutprint .day { margin-bottom: 16px; }
.cutprint .harvest { font-size: 9pt; padding: 3px 8px; border: 1px dashed #777; margin-bottom: 4px; }
.cutprint h2 { display: flex; justify-content: space-between; align-items: baseline; gap: 1rem; font-size: 12pt; margin: 0 0 4px; padding: 4px 8px; border: 1.5px solid #000; text-transform: uppercase; letter-spacing: .05em; break-after: avoid; }
.cutprint h2 .also, .cutprint h2 .sub { font-weight: 400; text-transform: none; letter-spacing: 0; font-size: 9.5pt; white-space: nowrap; }
.cutprint table { width: 100%; border-collapse: collapse; font-size: 9.5pt; }
.cutprint th { text-align: left; font-size: 8pt; text-transform: uppercase; letter-spacing: .05em; border-bottom: 1.5px solid #000; padding: 3px 5px; }
.cutprint td { padding: 5px; border-bottom: 1px solid #bbb; vertical-align: top; }
.cutprint tr { break-inside: avoid; }
.cutprint .no { font-family: Georgia, serif; font-size: 13pt; font-weight: 700; width: 2em; }
.cutprint .box { width: 2.2em; }
.cutprint .tick { display: inline-block; width: 16px; height: 16px; border: 1.5px solid #000; border-radius: 2px; }
.cutprint .cust strong { font-size: 10.5pt; }
.cutprint .portion { font-size: 8.5pt; border: 1px solid #000; border-radius: 3px; padding: 0 4px; margin-left: 3px; white-space: nowrap; }
.cutprint .split { font-size: 8pt; text-transform: uppercase; letter-spacing: .04em; }
.cutprint .mono { font-family: ui-monospace, Menlo, monospace; }
.cutprint .num { text-align: right; white-space: nowrap; }
.cutprint .atcut { font-size: 8.5pt; }
.cutprint .custom { font-weight: 700; }
.cutprint .warn { font-weight: 700; border: 1.5px solid #000; padding: 0 4px; white-space: nowrap; }
.cutprint .notes { font-style: italic; min-width: 1.2in; }
.cutprint .muted { color: #666; text-align: center; padding: 2rem; }
@media print {
  @page { size: letter portrait; margin: 0.45in 0.4in; }
  .cutprint { background: #fff; min-height: 0; }
  .cutprint .bar { display: none !important; }
  .cutprint .sheet { max-width: none; margin: 0; padding: 0; box-shadow: none; }
  .cutprint th, .cutprint td { white-space: normal; padding: 4pt 5pt !important; }
  .cutprint .num, .cutprint .warn, .cutprint .portion { white-space: nowrap !important; }
  /* globals.css greys every border and hides a table's last column for the
     kill sheet's action buttons. This sheet's last column is the notes, and
     its rules are ink, so both come back here. */
  .cutprint table th:last-child, .cutprint table td:last-child { display: table-cell !important; }
  .cutprint h1, .cutprint h2, .cutprint th, .cutprint .tick, .cutprint .warn, .cutprint .portion, .cutprint .title { border-color: #000 !important; }
  .cutprint thead { display: table-header-group; }
}
`

export default function CutSchedulePrintPage({ searchParams }: { searchParams: Promise<{ auto?: string }> }) {
  const { auto } = use(searchParams)
  const [sections, setSections] = useState<CrewSection[]>([])
  const [planDate, setPlanDate] = useState<string | null>(null)
  const [state,    setState]    = useState<'loading' | 'ready' | 'error'>('loading')
  // Days left off the sheet.
  const [skipped,  setSkipped]  = useState<Set<string>>(new Set())
  const [stamp,    setStamp]    = useState('')
  const todayISO = isoDate()

  // Fetch and fold the plan; the callers below decide what to do with it.
  const fetchPlan = useCallback(async () => {
    const today = isoDate()
    const { logs, apptMap, instrIds, instrByBuyer, saved, assignments, harvestDays } = await loadScheduleData(today)
    const list = buildEntries(logs, apptMap, instrIds, saved, assignments, DEFAULT_WEIGHTS, [], instrByBuyer)
    return { sections: buildCrewSections(list, harvestDays, today), planDate: saved[0]?.schedule_date ?? null }
  }, [])

  // Starts in 'loading'; a refresh flips it back in the click handler.
  const load = useCallback(() => {
    fetchPlan().then(
      plan => {
        setSections(plan.sections)
        setPlanDate(plan.planDate)
        setStamp(printedStamp())
        setState('ready')
      },
      () => setState('error'),
    )
  }, [fetchPlan])

  useEffect(() => { load() }, [load])

  // The planner's button asks for the dialog straight away. A beat after the
  // plan renders, so the dialog previews the sheet and not a blank page.
  useEffect(() => {
    if (auto !== '1' || state !== 'ready' || sections.length === 0) return
    const t = setTimeout(() => window.print(), 400)
    return () => clearTimeout(t)
  }, [auto, state, sections.length])

  const shown   = sections.filter(s => !skipped.has(s.key))
  const entries = shown.flatMap(s => s.entries)
  const totals  = carcassTotals(entries)
  const noSheet = entries.filter(e => !e.has_instructions).length
  // Rail-order number across the WHOLE plan, so the sheet's numbers match the
  // phone view even when a day is left off.
  const orderNo = new Map(sections.flatMap(s => s.entries).map((e, i) => [e.key, i + 1]))

  const dayLabel = (sec: CrewSection): string => {
    if (!sec.date) return sec.key === 'first' ? 'Up first' : 'Date not set'
    const label = dateLabel(sec.date)
    return sec.date === todayISO ? `Today — ${label}` : label
  }
  const toggle = (key: string) => setSkipped(prev => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key); else next.add(key)
    return next
  })

  return (
    <div className="cutprint">
      <style>{CSS}</style>

      {/* On-screen only — the sheet below is what prints. */}
      <header className="bar">
        <div>
          <strong>🔪 Cut Schedule — print-off</strong>
          <span className="hint">Prints the last saved plan. Untick a day to leave it off the sheet.</span>
        </div>
        {sections.length > 1 && (
          <div className="days">
            {sections.map(sec => (
              <label key={sec.key}>
                <input type="checkbox" checked={!skipped.has(sec.key)} onChange={() => toggle(sec.key)} />
                {' '}{dayLabel(sec)}
              </label>
            ))}
          </div>
        )}
        <div className="actions">
          <button onClick={() => { setState('loading'); load() }} disabled={state === 'loading'}>↻ Refresh</button>
          <button className="primary" onClick={() => window.print()} disabled={state !== 'ready' || entries.length === 0}>🖨 Print</button>
        </div>
      </header>

      <main className="sheet">
        {state === 'loading' && <p className="muted">Loading the cooler…</p>}
        {state === 'error' && (
          <p className="muted">Couldn&apos;t reach the server. <button onClick={() => { setState('loading'); load() }}>Try again</button></p>
        )}
        {state === 'ready' && (
          <>
            <div className="title">
              <h1>Cut Schedule</h1>
              <div className="meta">
                Printed {stamp}
                {planDate && <> · plan saved {dateLabel(planDate, { month: 'short', day: 'numeric' })}</>}
                <br />
                {totals.head} head · {Math.round(totals.lbs).toLocaleString()} lb hanging
                {noSheet > 0 && <> · <strong>{noSheet} with no cut sheet</strong></>}
              </div>
            </div>

            {entries.length === 0 && (
              <p className="muted">Nothing to cut — nothing is scheduled on the cut list right now.</p>
            )}

            {shown.map(sec => {
              const secTotals = carcassTotals(sec.entries)
              return (
                <section key={sec.key} className="day">
                  {sec.harvest.map(hd => (
                    <div key={hd.date} className="harvest">
                      🔪 {dateLabel(hd.date)} — harvest day · {hd.head} head in · nothing cut
                    </div>
                  ))}
                  <h2>
                    <span>
                      ▸ {dayLabel(sec)}
                      {sec.alsoKilling != null && <span className="also"> · killing {sec.alsoKilling} head too</span>}
                    </span>
                    <span className="sub">
                      {secTotals.head} head · {Math.round(secTotals.lbs).toLocaleString()} lb
                      {killMix(sec.entries).map(m => <span key={m.type}> · {m.head} {m.type}</span>)}
                    </span>
                  </h2>
                  <table>
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Done</th>
                        <th>Customer</th>
                        <th>Species</th>
                        <th>Tag</th>
                        <th>Producer</th>
                        <th className="num">lb</th>
                        <th className="num">Hung</th>
                        <th>Insp.</th>
                        <th>Cut sheet</th>
                        <th>Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sec.entries.map(entry => {
                        // What it'll have hung by the day this section is headed
                        // for — the number that decides whether it's still fit to cut.
                        const atCut = hangAtCut(entry.harvest_date, sec.date ?? undefined, entry.days_hanging)
                        return (
                          <tr key={entry.key}>
                            <td className="no">{orderNo.get(entry.key)}</td>
                            <td className="box"><span className="tick" /></td>
                            <td className="cust">
                              {entry.cut_customers.length > 1 ? (
                                <>
                                  <div className="split">Split — one animal, {entry.cut_customers.length} cut sheets</div>
                                  {entry.cut_customers.map(cc => (
                                    <div key={cc.appointment_customer_id}>
                                      {portionBadge(cc.portion).label} — <strong>{cc.name}</strong>
                                      {!cc.has_instructions && <> <span className="warn">NO SHEET</span></>}
                                    </div>
                                  ))}
                                </>
                              ) : (
                                <>
                                  <strong>{entry.customer_name}</strong>
                                  <span className="portion">{portionBadge(entry.portion).label}</span>
                                </>
                              )}
                            </td>
                            <td>{entry.species}</td>
                            <td className="mono">{entry.carcass_tag || '—'}</td>
                            <td>{entry.producer || '—'}</td>
                            <td className="num">{entry.hot_carcass_weight_lbs ?? '—'}</td>
                            <td className="num">
                              {entry.days_hanging}d
                              {atCut > entry.days_hanging && <span className="atcut"> → {atCut}d</span>}
                            </td>
                            <td className={entry.kill_type === 'Custom' ? 'custom' : ''}>{entry.kill_type ?? ''}</td>
                            <td>
                              {entry.has_instructions
                                ? '✓'
                                : entry.sheet_state === 'no-buyer'
                                  ? <span className="warn">NO BUYER</span>
                                  : <span className="warn">NO SHEET</span>}
                            </td>
                            <td className="notes">{entry.entry_notes}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </section>
              )
            })}
          </>
        )}
      </main>
    </div>
  )
}
