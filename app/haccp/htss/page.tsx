'use client'
import { useState, useRef, useCallback } from 'react'
import Link from 'next/link'

const C = {
  dark:       '#1A0A04',
  darkBrown:  '#351E0E',
  lightBrown: '#A6785A',
  tan:        '#C9A882',
  cream:      '#F2E8D9',
  green:      '#4CAF50',
  amber:      '#F59E0B',
  red:        '#EF4444',
}

const INPUT: React.CSSProperties = {
  background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(166,120,90,0.35)',
  borderRadius: 3, padding: '0.5rem 0.75rem', color: C.cream, fontSize: '0.88rem',
  outline: 'none', boxSizing: 'border-box', width: '100%',
}

// ── Psychrometrics ────────────────────────────────────────────────────────────

// Saturation vapor pressure (Magnus formula) in hPa, T in °C
function esat(T: number): number {
  return 6.1078 * Math.exp(17.27 * T / (T + 237.3))
}

// Wet bulb (°F) from dry bulb (°F) + RH (%) via Newton-Raphson on psychrometric equation
// e = esat(Tw) - γ·P·(Td - Tw)
function calcWetBulb(dryBulbF: number, rhPct: number): number {
  const Td = (dryBulbF - 32) * 5 / 9
  const e  = (rhPct / 100) * esat(Td)
  const P  = 1013.25   // hPa standard atmosphere
  const γ  = 6.6e-4    // psychrometric constant (aspirated)
  let Tw = Td - 5
  for (let i = 0; i < 100; i++) {
    const f  = esat(Tw) - γ * P * (Td - Tw) - e
    const df = esat(Tw) * (17.27 * 237.3 / (Tw + 237.3) ** 2) + γ * P
    const Δ  = f / df
    Tw -= Δ
    if (Math.abs(Δ) < 1e-5) break
  }
  return Tw * 9 / 5 + 32
}

// Minimum RH needed (at dryBulbF) to achieve wet bulb = 125°F
function rhForWB125(dryBulbF: number): number {
  const Td = (dryBulbF - 32) * 5 / 9
  const Tw = (125 - 32) * 5 / 9   // 51.67°C
  const P  = 1013.25
  const γ  = 6.6e-4
  const e  = esat(Tw) - γ * P * (Td - Tw)
  return Math.max(0, Math.min(100, (e / esat(Td)) * 100))
}

// ── FSIS Appendix A — Beef, 5-log Salmonella, high-humidity schedule ─────────
// [oven temp °F, required hold time in seconds]
// Condition: RH ≥ 90% for ≥ 50% of scheduled cook time
const APPENDIX_A: [number, number][] = [
  [130, 7260], [131, 5820], [133, 3720], [135, 2400],
  [136, 1920], [138, 1200], [140, 780],  [142, 480],
  [144, 300],  [145, 240],  [147, 134],  [149, 85],
  [151, 54],   [153, 34],   [155, 22],   [157, 14],
  [158, 0],
]

function getRequiredSeconds(tempF: number): number | null {
  if (tempF < 130) return null
  if (tempF >= 158) return 0
  for (let i = APPENDIX_A.length - 1; i >= 0; i--) {
    if (tempF >= APPENDIX_A[i][0]) return APPENDIX_A[i][1]
  }
  return null
}

function fmtSec(s: number): string {
  if (s === 0) return 'instantaneous'
  if (s < 60) return `${s} sec`
  const m = Math.floor(s / 60)
  const r = s % 60
  return r > 0 ? `${m} min ${r} sec` : `${m} min`
}

// ── Cook log CSV types + parsing ──────────────────────────────────────────────
// Expected columns: Date,Time,Batch#,Truck#,Operator,Temperature,Temp SP,Humidity,Humidity SP,Core Probe 1,Damper %Out

interface CookRow {
  datetime:  string
  dryBulbF:  number
  dryBulbSP: number
  rhPct:     number
  rhSP:      number
  coreTempF: number
  wetBulbF:  number
}

function parseCookCsv(text: string): CookRow[] {
  const lines = text.trim().split(/\r?\n/)
  const rows: CookRow[] = []
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(',')
    if (c.length < 10) continue
    const dryBulbF = parseFloat(c[5])
    const rhPct    = parseFloat(c[7])
    if (isNaN(dryBulbF) || isNaN(rhPct) || rhPct <= 0) continue
    rows.push({
      datetime:  `${c[0].trim()} ${c[1].trim()}`,
      dryBulbF,
      dryBulbSP: parseFloat(c[6]) || 0,
      rhPct,
      rhSP:       parseFloat(c[8]) || 0,
      coreTempF:  parseFloat(c[9]) || 0,
      wetBulbF:   calcWetBulb(dryBulbF, rhPct),
    })
  }
  return rows
}

// ── Cook analysis ─────────────────────────────────────────────────────────────

interface PhaseResult {
  spTemp:      number
  spRH:        number
  startTime:   string
  endTime:     string
  durationMin: number
  avgDryBulb:  number
  avgRH:       number
  avgWetBulb:  number
  avgCore:     number
  wbOkMin:     number   // minutes with WB ≥ 125°F
  rhOkMin:     number   // minutes with RH ≥ 30%
  ovenOkMin:   number   // minutes with oven ≥ 145°F
}

interface CookSummary {
  totalMin:    number
  peakOven:    number
  peakCore:    number
  peakWB:      number
  wbOkTotal:   number
  rhOkTotal:   number
  ovenOkTotal: number
  coreOkTotal: number
  steamOnMin:  number
  steamPct:    number
  ovenCLMet:   boolean  // oven ≥ 145°F for ≥ 4 min
  coreCLMet:   boolean  // core ≥ 145°F for ≥ 4 min
  wbCLMet:     boolean  // WB hit 125°F at any point
  rhCLMet:     boolean  // RH ≥ 30% at any point
  steamCLMet:  boolean  // steam on ≥ 50% of cycle AND ≥ 60 min
  phases:      PhaseResult[]
}

// The controller export has no steam-valve column (Date,Time,Batch#,Truck#,
// Operator,Temperature,Temperature SP,Humidity,Humidity SP,Core Probe 1,
// Damper %Out), so "steam on" has to be inferred. This counts the minutes
// where humidity was scheduled AND the chamber actually held it.
//
// Two rules were rejected getting here:
//  · "Humidity SP > 0" is true for 451 of 452 minutes on a jerky run — it
//    would pass every cook ever uploaded and tell nobody anything.
//  · "chamber below setpoint" (valve actively calling) INVERTS. Checked
//    against 14 jerky cooks: normal runs scored 52–86%, but 2026-07-30 —
//    where the house failed to dry down and sat at 91% RH against a 14%
//    setpoint — scored 34% and failed. It marked a cook down for being too
//    wet, which is backwards for a limit meant to assure moisture is present.
//
// This rule reads a flat 60% on every normal jerky cook (the humid portion of
// the recipe) and rises, never falls, when the house runs wet. It is a proxy,
// not a valve-state record; the note on the page says so.
const steamOn = (r: CookRow) => r.rhSP > 0 && r.rhPct >= 30

function analyze(rows: CookRow[]): CookSummary {
  const phases: PhaseResult[] = []
  let ps = 0

  for (let i = 1; i <= rows.length; i++) {
    const end     = i === rows.length
    const changed = !end && (
      rows[i].dryBulbSP !== rows[ps].dryBulbSP ||
      rows[i].rhSP      !== rows[ps].rhSP
    )
    if (changed || end) {
      const s   = rows.slice(ps, i)
      const avg = (fn: (r: CookRow) => number) => s.reduce((a, r) => a + fn(r), 0) / s.length
      phases.push({
        spTemp:      rows[ps].dryBulbSP,
        spRH:        rows[ps].rhSP,
        startTime:   s[0].datetime,
        endTime:     s[s.length - 1].datetime,
        durationMin: s.length,
        avgDryBulb:  avg(r => r.dryBulbF),
        avgRH:       avg(r => r.rhPct),
        avgWetBulb:  avg(r => r.wetBulbF),
        avgCore:     avg(r => r.coreTempF),
        wbOkMin:     s.filter(r => r.wetBulbF >= 125).length,
        rhOkMin:     s.filter(r => r.rhPct >= 30).length,
        ovenOkMin:   s.filter(r => r.dryBulbF >= 145).length,
      })
      ps = i
    }
  }

  return {
    totalMin:    rows.length,
    peakOven:    Math.max(...rows.map(r => r.dryBulbF)),
    peakCore:    Math.max(...rows.map(r => r.coreTempF)),
    peakWB:      Math.max(...rows.map(r => r.wetBulbF)),
    wbOkTotal:   rows.filter(r => r.wetBulbF >= 125).length,
    rhOkTotal:   rows.filter(r => r.rhPct >= 30).length,
    ovenOkTotal: rows.filter(r => r.dryBulbF >= 145).length,
    coreOkTotal: rows.filter(r => r.coreTempF >= 145).length,
    steamOnMin:  rows.filter(steamOn).length,
    steamPct:    rows.length ? (rows.filter(steamOn).length / rows.length) * 100 : 0,
    ovenCLMet:   rows.filter(r => r.dryBulbF >= 145).length >= 4,
    coreCLMet:   rows.filter(r => r.coreTempF >= 145).length >= 4,
    wbCLMet:     rows.some(r => r.wetBulbF >= 125),
    rhCLMet:     rows.some(r => r.rhPct >= 30),
    // Both halves of the CL: at least half the cycle, and never less than an hour
    steamCLMet:  rows.filter(steamOn).length >= rows.length / 2 && rows.filter(steamOn).length >= 60,
    phases,
  }
}

// ── Stat box ──────────────────────────────────────────────────────────────────
function Stat({ label, value, sub, ok }: { label: string; value: string; sub?: string; ok?: boolean }) {
  const clr = ok === undefined ? C.tan : ok ? C.green : C.red
  const bdr = ok === undefined
    ? 'rgba(166,120,90,0.25)'
    : ok ? 'rgba(76,175,80,0.3)' : 'rgba(239,68,68,0.3)'
  return (
    <div style={{
      background: C.dark, border: `1px solid ${bdr}`,
      borderRadius: 4, padding: '0.85rem 1rem',
    }}>
      <div style={{ fontSize: '0.68rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.3rem' }}>
        {label}
      </div>
      <div style={{ fontSize: '1.45rem', fontWeight: 700, color: clr, fontFamily: 'Georgia, serif' }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: '0.72rem', color: ok === false ? 'rgba(239,68,68,0.75)' : 'rgba(166,120,90,0.6)', marginTop: '0.2rem' }}>
          {sub}
        </div>
      )}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function HTSSPage() {
  const [dryBulb, setDryBulb] = useState('')
  const [rh,      setRh]      = useState('')

  const [csvData,     setCsvData]     = useState<CookSummary | null>(null)
  const [csvFilename, setCsvFilename] = useState('')
  const [csvError,    setCsvError]    = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  // Manual calculator derived values
  const db    = parseFloat(dryBulb)
  const rhVal = parseFloat(rh)
  const hasCalc = !isNaN(db) && !isNaN(rhVal) && db > 32 && rhVal > 0 && rhVal <= 100
  const wb       = hasCalc ? calcWetBulb(db, rhVal) : null
  const reqSec   = hasCalc ? getRequiredSeconds(db) : null
  const wbOk     = wb !== null && wb >= 125
  const rhOk     = !isNaN(rhVal) && rhVal >= 30
  const rhNeeded = hasCalc ? rhForWB125(db) : null
  const wbDep    = wb !== null ? db - wb : null

  const handleFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setCsvFilename(file.name)
    setCsvError('')
    setCsvData(null)
    const reader = new FileReader()
    reader.onload = ev => {
      try {
        const text = ev.target?.result as string
        const rows = parseCookCsv(text)
        if (rows.length === 0) { setCsvError('No valid data rows found. Check that columns match the smokehouse log format.'); return }
        setCsvData(analyze(rows))
      } catch {
        setCsvError('Failed to parse file. Expected smokehouse CSV with Temperature and Humidity columns.')
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }, [])

  return (
    <div style={{ minHeight: '100vh', background: 'var(--dark-brown)', display: 'flex', flexDirection: 'column' }}>

      {/* Header */}
      <header style={{
        background: 'var(--dark)', borderBottom: '1px solid rgba(166,120,90,0.3)',
        padding: '0 2rem', height: '64px', display: 'flex', alignItems: 'center', gap: '1rem', flexShrink: 0,
      }}>
        <Link href="/haccp" style={{ color: C.lightBrown, fontSize: '0.82rem', textDecoration: 'none' }}>← HACCP</Link>
        <span style={{ color: 'rgba(166,120,90,0.3)' }}>|</span>
        <div>
          <span style={{ fontFamily: 'Georgia, serif', fontSize: '1rem', fontWeight: 700, color: C.cream, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            HTSS Wet Bulb Calculator
          </span>
          <span style={{ fontSize: '0.72rem', color: C.lightBrown, marginLeft: '0.75rem' }}>
            CCP 2B · Alt-3 · Beef Jerky
          </span>
        </div>
      </header>

      <main style={{ flex: 1, padding: '2rem', maxWidth: '1100px', width: '100%', margin: '0 auto', boxSizing: 'border-box' }}>

        {/* ── Manual Calculator ─────────────────────────────────────────────── */}
        <div style={{ marginBottom: '0.5rem' }}>
          <h2 style={{ fontFamily: 'Georgia, serif', fontSize: '0.85rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.12em', margin: 0 }}>
            Manual Calculator
          </h2>
          <p style={{ fontSize: '0.75rem', color: 'rgba(166,120,90,0.6)', margin: '0.2rem 0 0.85rem' }}>
            Enter smokehouse dry bulb temperature and relative humidity to calculate wet bulb and check CCP 2B critical limits
          </p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '2rem' }}>

          {/* Inputs + CL reminder */}
          <div style={{ background: C.dark, border: '1px solid rgba(166,120,90,0.25)', borderRadius: 4, padding: '1.5rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.25rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.7rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.35rem' }}>
                  Dry Bulb Temp (°F)
                </label>
                <input
                  type="number"
                  value={dryBulb}
                  onChange={e => setDryBulb(e.target.value)}
                  placeholder="e.g. 150"
                  style={INPUT}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.7rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.35rem' }}>
                  Relative Humidity (%)
                </label>
                <input
                  type="number"
                  value={rh}
                  onChange={e => setRh(e.target.value)}
                  placeholder="e.g. 50"
                  style={INPUT}
                />
              </div>
            </div>

            {/* RH needed hint */}
            {hasCalc && !wbOk && rhNeeded !== null && (
              <div style={{
                background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)',
                borderRadius: 3, padding: '0.6rem 0.85rem', fontSize: '0.75rem',
                color: 'rgba(239,68,68,0.85)', marginBottom: '1rem',
              }}>
                To reach WB ≥ 125°F at {db.toFixed(0)}°F dry bulb, you need <strong>≥ {rhNeeded.toFixed(0)}% RH</strong>
                {' '}(currently {rhVal.toFixed(0)}%).
              </div>
            )}
            {hasCalc && wbOk && (
              <div style={{
                background: 'rgba(76,175,80,0.08)', border: '1px solid rgba(76,175,80,0.25)',
                borderRadius: 3, padding: '0.6rem 0.85rem', fontSize: '0.75rem',
                color: 'rgba(76,175,80,0.9)', marginBottom: '1rem',
              }}>
                Wet bulb CL met at these conditions.
              </div>
            )}

            <div style={{ fontSize: '0.72rem', color: 'rgba(166,120,90,0.6)', lineHeight: 1.7, borderTop: '1px solid rgba(166,120,90,0.15)', paddingTop: '0.85rem' }}>
              <strong style={{ color: C.lightBrown }}>CCP 2B Critical Limits (Alt-3):</strong><br />
              Wet Bulb ≥ <strong style={{ color: C.cream }}>125°F</strong> &nbsp;·&nbsp;
              RH ≥ <strong style={{ color: C.cream }}>30%</strong> &nbsp;·&nbsp;
              Oven ≥ <strong style={{ color: C.cream }}>145°F</strong> for <strong style={{ color: C.cream }}>4 min</strong><br />
              Steam on ≥ <strong style={{ color: C.cream }}>50%</strong> of cooking cycle, min <strong style={{ color: C.cream }}>1 hour</strong>
            </div>
          </div>

          {/* Results */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', alignContent: 'start' }}>
            <Stat
              label="Wet Bulb Temp"
              value={wb !== null ? `${wb.toFixed(1)}°F` : '—'}
              sub={wb !== null ? (wbOk ? 'Meets ≥ 125°F CL' : 'BELOW 125°F CL') : 'Enter values above'}
              ok={wb !== null ? wbOk : undefined}
            />
            <Stat
              label="Relative Humidity"
              value={!isNaN(rhVal) && rhVal > 0 ? `${rhVal.toFixed(1)}%` : '—'}
              sub={!isNaN(rhVal) && rhVal > 0 ? (rhOk ? 'Meets ≥ 30% CL' : 'Below 30% CL') : undefined}
              ok={!isNaN(rhVal) && rhVal > 0 ? rhOk : undefined}
            />
            <Stat
              label="Appendix A Hold Time"
              value={reqSec !== null ? fmtSec(reqSec) : (hasCalc && db < 130 ? 'Below 130°F' : '—')}
              sub={reqSec !== null ? `at ${db.toFixed(1)}°F oven temp` : undefined}
            />
            <Stat
              label="WB Depression"
              value={wbDep !== null ? `${wbDep.toFixed(1)}°F` : '—'}
              sub="Dry bulb minus wet bulb"
            />
          </div>
        </div>

        {/* ── Appendix A Reference Table ────────────────────────────────────── */}
        <div style={{ marginBottom: '0.5rem' }}>
          <h2 style={{ fontFamily: 'Georgia, serif', fontSize: '0.85rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.12em', margin: 0 }}>
            Appendix A Reference
          </h2>
          <p style={{ fontSize: '0.75rem', color: 'rgba(166,120,90,0.6)', margin: '0.2rem 0 0.85rem' }}>
            FSIS Appendix A — 5-log Salmonella lethality for beef · Requires RH ≥ 90% for ≥ 50% of scheduled cook time
          </p>
        </div>

        <div style={{ background: C.dark, border: '1px solid rgba(166,120,90,0.25)', borderRadius: 4, marginBottom: '2rem', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(166,120,90,0.3)' }}>
                {['Oven Temp', 'Min. Hold Time', 'RH Needed for WB ≥ 125°F'].map(h => (
                  <th key={h} style={{ padding: '0.6rem 1rem', textAlign: 'left', color: C.lightBrown, fontWeight: 600, fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {APPENDIX_A.map(([t, s], i) => {
                const isActive = hasCalc && db >= t && (i === APPENDIX_A.length - 1 || db < APPENDIX_A[i + 1][0])
                const rhReq = rhForWB125(t)
                const currentRhOk = hasCalc && rhVal >= rhReq
                return (
                  <tr key={t} style={{
                    borderBottom: '1px solid rgba(166,120,90,0.1)',
                    background: isActive ? 'rgba(245,158,11,0.07)' : 'transparent',
                  }}>
                    <td style={{ padding: '0.48rem 1rem', color: isActive ? C.amber : C.cream, fontWeight: isActive ? 700 : 400 }}>
                      {t}°F{isActive ? ' ← current' : ''}
                    </td>
                    <td style={{ padding: '0.48rem 1rem', color: C.tan }}>{fmtSec(s)}</td>
                    <td style={{ padding: '0.48rem 1rem' }}>
                      <span style={{ color: isActive ? (currentRhOk ? C.green : C.red) : 'rgba(166,120,90,0.55)', fontWeight: isActive ? 600 : 400 }}>
                        ≥ {rhReq.toFixed(0)}% RH
                      </span>
                      {isActive && (
                        <span style={{ marginLeft: '0.5rem', fontSize: '0.72rem', color: currentRhOk ? 'rgba(76,175,80,0.7)' : 'rgba(239,68,68,0.7)' }}>
                          {currentRhOk ? '✓ met' : `✗ need +${(rhReq - rhVal).toFixed(0)}%`}
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* ── Cook Log Analyzer ─────────────────────────────────────────────── */}
        <div style={{ marginBottom: '0.5rem' }}>
          <h2 style={{ fontFamily: 'Georgia, serif', fontSize: '0.85rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.12em', margin: 0 }}>
            Cook Log Analyzer
          </h2>
          <p style={{ fontSize: '0.75rem', color: 'rgba(166,120,90,0.6)', margin: '0.2rem 0 0.85rem' }}>
            Upload a smokehouse CSV export to analyze the full cook cycle for CCP 2B compliance, phase by phase
          </p>
        </div>

        <div style={{ background: C.dark, border: '1px solid rgba(166,120,90,0.25)', borderRadius: 4, padding: '1.5rem', marginBottom: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
            <button
              onClick={() => fileRef.current?.click()}
              style={{
                background: C.tan, color: C.dark, border: 'none', borderRadius: 3,
                padding: '0.55rem 1.2rem', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer',
              }}
            >
              Upload Cook Log CSV
            </button>
            {csvFilename && (
              <span style={{ fontSize: '0.8rem', color: C.lightBrown }}>{csvFilename}</span>
            )}
            <span style={{ fontSize: '0.74rem', color: 'rgba(166,120,90,0.45)' }}>
              Expected: smokehouse .CSV with Date, Time, Temperature, Humidity, Core Probe columns
            </span>
          </div>
          <input ref={fileRef} type="file" accept=".csv" onChange={handleFile} style={{ display: 'none' }} />
          {csvError && (
            <div style={{ marginTop: '0.75rem', color: C.red, fontSize: '0.8rem' }}>{csvError}</div>
          )}
        </div>

        {/* Analysis results */}
        {csvData && (
          <>
            {/* CL compliance summary */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.75rem', marginBottom: '1rem' }}>
              <Stat
                label="Oven ≥ 145°F"
                value={`${csvData.ovenOkTotal} min`}
                sub={csvData.ovenCLMet ? 'CL Met (≥ 4 min)' : 'Need ≥ 4 min'}
                ok={csvData.ovenCLMet}
              />
              <Stat
                label="WB ≥ 125°F"
                value={`${csvData.wbOkTotal} min`}
                sub={csvData.wbCLMet ? 'CL Met at some point' : 'Never reached — see note'}
                ok={csvData.wbCLMet}
              />
              <Stat
                label="RH ≥ 30%"
                value={`${csvData.rhOkTotal} min`}
                sub={csvData.rhCLMet ? 'CL Met at some point' : 'Never reached'}
                ok={csvData.rhCLMet}
              />
              <Stat
                label="Steam On"
                value={`${csvData.steamOnMin} min`}
                sub={`${csvData.steamPct.toFixed(0)}% of cycle · ${csvData.steamCLMet ? 'CL Met (≥ 50% & ≥ 1 hr)' : 'Need ≥ 50% & ≥ 1 hr'}`}
                ok={csvData.steamCLMet}
              />
            </div>

            {/* Peak values */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem', marginBottom: '1.5rem' }}>
              <Stat label="Peak Oven Temp" value={`${csvData.peakOven.toFixed(1)}°F`} ok={csvData.peakOven >= 145} sub={csvData.peakOven >= 145 ? 'Above 145°F' : 'Never hit 145°F'} />
              <Stat label="Peak Wet Bulb"  value={`${csvData.peakWB.toFixed(1)}°F`}   ok={csvData.peakWB >= 125}  sub={csvData.peakWB >= 125 ? 'Hit 125°F WB CL' : 'Never hit 125°F WB'} />
              {/* Alt-3 lethality is delivered by the oven/humidity schedule, not by
                  product core — jerky is sliced too thin to seat a probe, and a
                  still-drying strip sits between wet bulb and dry bulb no matter
                  how long you hold it. Core is logged for reference, so it prints
                  neutral: red here read as a deviation on cooks that passed
                  every CL (Charlie, 2026-08-07). */}
              <Stat label="Peak Core Temp" value={`${csvData.peakCore.toFixed(1)}°F`} sub={`${csvData.coreOkTotal} min ≥ 145°F · reference only, not a CL`} />
            </div>

            {/* Phase breakdown table */}
            <div style={{ marginBottom: '0.5rem' }}>
              <h3 style={{ fontFamily: 'Georgia, serif', fontSize: '0.82rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.1em', margin: '0 0 0.75rem' }}>
                Phase Breakdown
              </h3>
            </div>
            <div style={{ background: C.dark, border: '1px solid rgba(166,120,90,0.25)', borderRadius: 4, overflow: 'auto', marginBottom: '1.5rem' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.79rem', minWidth: 750 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(166,120,90,0.3)' }}>
                    {['SP Temp', 'SP RH', 'Duration', 'Avg Oven', 'Avg Wet Bulb', 'Avg RH', 'Avg Core', 'WB ≥125 min', 'RH ≥30 min', 'Oven ≥145 min'].map(h => (
                      <th key={h} style={{ padding: '0.5rem 0.75rem', textAlign: 'left', color: C.lightBrown, fontWeight: 600, fontSize: '0.66rem', textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {csvData.phases.map((p, i) => {
                    const wbHi = p.avgWetBulb >= 125
                    const rhHi = p.avgRH >= 30
                    return (
                      <tr key={i} style={{ borderBottom: '1px solid rgba(166,120,90,0.1)' }}>
                        <td style={{ padding: '0.42rem 0.75rem', color: C.cream, fontWeight: 600 }}>{p.spTemp}°F</td>
                        <td style={{ padding: '0.42rem 0.75rem', color: C.tan }}>{p.spRH}%</td>
                        <td style={{ padding: '0.42rem 0.75rem', color: C.tan }}>{p.durationMin} min</td>
                        <td style={{ padding: '0.42rem 0.75rem', color: C.cream }}>{p.avgDryBulb.toFixed(1)}°F</td>
                        <td style={{ padding: '0.42rem 0.75rem', color: wbHi ? C.green : C.red, fontWeight: 600 }}>{p.avgWetBulb.toFixed(1)}°F</td>
                        <td style={{ padding: '0.42rem 0.75rem', color: rhHi ? C.green : 'rgba(166,120,90,0.55)' }}>{p.avgRH.toFixed(1)}%</td>
                        <td style={{ padding: '0.42rem 0.75rem', color: C.tan }}>{p.avgCore.toFixed(1)}°F</td>
                        <td style={{ padding: '0.42rem 0.75rem', color: p.wbOkMin > 0 ? C.green : C.red, fontWeight: 600 }}>{p.wbOkMin}</td>
                        <td style={{ padding: '0.42rem 0.75rem', color: p.rhOkMin > 0 ? C.green : 'rgba(166,120,90,0.45)' }}>{p.rhOkMin}</td>
                        <td style={{ padding: '0.42rem 0.75rem', color: p.ovenOkMin >= 4 ? C.green : p.ovenOkMin > 0 ? C.amber : 'rgba(166,120,90,0.45)' }}>{p.ovenOkMin}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Important note about WB calculation vs measurement */}
            <div style={{
              background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.25)',
              borderRadius: 4, padding: '1rem 1.25rem', marginBottom: '2rem', fontSize: '0.78rem', color: 'rgba(201,168,130,0.85)', lineHeight: 1.65,
            }}>
              <strong style={{ color: C.amber }}>Note — Calculated WB vs. Measured WB:</strong>{' '}
              The wet bulb values above are <em>calculated</em> from the humidity sensor reading. Your HACCP plan requires a{' '}
              <strong>weekly Direct Observation</strong> using a physical wet bulb thermometer (CCP 2B DO check). The calculated value is a useful
              pre-check and trend indicator, but meat releases moisture during cooking that can raise actual wet bulb above what the sensor alone shows.
              The DO with a calibrated thermometer remains the record of compliance.
            </div>

            {/* How the two inferred numbers are derived, said plainly on the page */}
            <div style={{
              background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.25)',
              borderRadius: 4, padding: '1rem 1.25rem', marginBottom: '2rem', fontSize: '0.78rem', color: 'rgba(201,168,130,0.85)', lineHeight: 1.65,
            }}>
              <strong style={{ color: C.amber }}>Note — Steam On is inferred:</strong>{' '}
              The controller export has no steam-valve column, so <strong>Steam On</strong> counts the minutes where humidity was scheduled
              (humidity setpoint above zero) and the chamber actually held it (RH ≥ 30%). It is a proxy, not a valve-state record — confirm the
              definition against your written plan.
              <br /><br />
              <strong style={{ color: C.amber }}>Note — Core Probe is reference only:</strong>{' '}
              Alt-3 lethality is delivered by the oven and humidity schedule, not by product core temperature. Sliced jerky is too thin to seat a probe
              meaningfully, and product still giving up moisture sits between wet bulb and dry bulb regardless of hold time — so a core reading below
              145°F is expected and is <strong>not</strong> a deviation. Core is shown for trend only and is not scored against a critical limit.
            </div>
          </>
        )}

      </main>

      <footer style={{
        background: 'var(--dark)', borderTop: '1px solid rgba(166,120,90,0.2)',
        padding: '0.5rem 2rem', textAlign: 'center',
        fontSize: '0.72rem', color: 'var(--light-brown)',
      }}>
        Cowboy Meat Company · 1109 Front St, Forsyth MT · (406) 346-7660 · info@cowboymeats.com
      </footer>
    </div>
  )
}
