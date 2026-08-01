'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'

// Executive suite — Charlie's eyes-only dashboard: cash position, break-even
// vs actual months, the WAR ops numbers, and weekly labor efficiency.
// Gated by passphrase (see lib/execGate.ts); every data route re-checks the
// session server-side, so this page renders nothing sensitive until signed in.

const C = {
  dark:       '#1A0A04',
  darkBrown:  '#351E0E',
  medBrown:   '#75471B',
  lightBrown: '#A6785A',
  tan:        '#C9A882',
  cream:      '#F2E8D9',
}

const INCOME_COLOR = '#3E9D63'
const COST_COLOR   = '#CE6A20'
const WARN_COLOR   = '#FAB219'
const GRID         = 'rgba(166,120,90,0.15)'

const fmt = (n: number) => Math.round(n).toLocaleString('en-US')
const usd = (n: number) => `$${fmt(n)}`
const usdK = (n: number) => `$${Math.round(n / 1000)}k`

function niceCeil(max: number): number {
  if (max <= 0) return 1
  const pow = Math.pow(10, Math.floor(Math.log10(max)))
  for (const m of [1, 2, 2.5, 5, 10]) {
    if (m * pow >= max) return m * pow
  }
  return 10 * pow
}

function niceTicks(max: number, divisions = 4): number[] {
  const step = niceCeil(Math.max(max, 1) / divisions)
  const top = step * Math.ceil(Math.max(max, 1) / step)
  const ticks = []
  for (let v = 0; v <= top; v += step) ticks.push(v)
  return ticks
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const monthLabel = (ym: string) => `${MONTH_NAMES[Number(ym.slice(5, 7)) - 1]} ${ym.slice(2, 4)}`

// ── Data shapes (mirror the /api/exec routes) ─────────────────────────────────
interface PnlMonth { month: string; income: number; cogs: number; expenses: number; net: number }
interface PnlData {
  months: PnlMonth[]
  totals: { income: number; cogs: number; expenses: number; net: number }
  variableRate: number
  fixedMonthly: number
  breakEvenMonthly: number | null
  avgMonthlyIncome: number
}
interface OverviewData {
  asOf: string
  cash: number
  accountsReceivable: number
  openInvoices: { count: number; balance: number; top: { docNumber: string; customerName: string; balance: number; txnDate: string }[] }
}
interface WarData {
  today: string; week_since: string
  recv_in_d: number; recv_in_w: number; harv_out_d: number; harv_out_w: number
  livelb_d: number; livelb_w: number; hot_d: number; hot_w: number
  pin_d: number; pin_w: number; pout_d: number; pout_w: number
  rate_d: number | null; va_in_w: number; va_out_w: number
}
interface LaborWeek {
  week_start: string; week_end: string
  labor_dollars: number; labor_hours: number; headcount: number; avg_hours: number; over40: number
  total_sales: number; custom_sales: number; retail_sales: number; throughput_lbs: number
  labor_pct: number; dollars_per_lb: number
}

// ── Shared bits ───────────────────────────────────────────────────────────────
function StatTile({ label, value, unit, sub, hero, accent }: {
  label: string; value: string; unit?: string; sub?: string; hero?: boolean; accent?: string
}) {
  return (
    <div style={{
      background: C.dark, border: '1px solid rgba(166,120,90,0.18)',
      borderLeft: accent ? `4px solid ${accent}` : '1px solid rgba(166,120,90,0.18)',
      borderRadius: 4, padding: '1rem 1.25rem', flex: '1 1 160px', minWidth: 150,
    }}>
      <div style={{ fontSize: '0.72rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.35rem' }}>
        {label}
      </div>
      <div style={{ fontSize: hero ? '2.2rem' : '1.6rem', fontWeight: 600, color: C.cream, lineHeight: 1.1 }}>
        {value}{unit && <span style={{ fontSize: '0.9rem', fontWeight: 600, color: C.tan, marginLeft: '0.35rem' }}>{unit}</span>}
      </div>
      {sub && <div style={{ fontSize: '0.72rem', color: C.lightBrown, marginTop: '0.35rem' }}>{sub}</div>}
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: '0.72rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.15em', margin: '2rem 0 0.5rem' }}>
      {children}
    </div>
  )
}

function ErrorBox({ msg }: { msg: string }) {
  return (
    <div style={{ background: C.dark, border: '1px solid #E8883A', borderRadius: 4, padding: '1rem', color: '#E8883A', fontSize: '0.85rem' }}>
      {msg}
    </div>
  )
}

// ── Break-even chart ──────────────────────────────────────────────────────────
// x = monthly revenue, y = dollars. Income line (y = x), cost line
// (y = overheads + variable rate · x), flat overheads line, one dot per
// actual month at (its revenue, its actual total cost). Dots under the
// income line are profitable months.
function BreakEvenChart({ pnl }: { pnl: PnlData }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(900)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(entries => setWidth(entries[0].contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const M = { top: 16, right: 18, bottom: 34, left: 58 }
  const H = 300
  const plotW = Math.max(width - M.left - M.right, 50)
  const plotH = H - M.top - M.bottom

  const g = useMemo(() => {
    const be = pnl.breakEvenMonthly ?? 0
    const maxRev = Math.max(...pnl.months.map(m => m.income), be)
    const xMax = niceCeil(maxRev * 1.15)
    const cost = (x: number) => pnl.fixedMonthly + pnl.variableRate * x
    const maxY = Math.max(xMax, cost(xMax), ...pnl.months.map(m => m.cogs + m.expenses))
    const yTicks = niceTicks(maxY)
    const yMax = yTicks[yTicks.length - 1]
    const xTicks = niceTicks(xMax)
    const X = (v: number) => M.left + (v / xMax) * plotW
    const Y = (v: number) => M.top + plotH - (v / yMax) * plotH
    return { be, xMax, yMax, xTicks: xTicks.filter(t => t <= xMax), yTicks, X, Y, cost }
  }, [pnl, plotW, plotH])

  return (
    <div ref={wrapRef} style={{ background: C.dark, border: '1px solid rgba(166,120,90,0.18)', borderRadius: 4, padding: '1rem' }}>
      <div style={{ display: 'flex', gap: '1.25rem', flexWrap: 'wrap', fontSize: '0.72rem', color: C.tan, marginBottom: '0.5rem' }}>
        <span><span style={{ display: 'inline-block', width: 18, height: 3, background: INCOME_COLOR, verticalAlign: 'middle', marginRight: 6 }} />Income</span>
        <span><span style={{ display: 'inline-block', width: 18, height: 3, background: COST_COLOR, verticalAlign: 'middle', marginRight: 6 }} />Opex (overheads + variable)</span>
        <span><span style={{ display: 'inline-block', width: 18, height: 0, borderTop: `2px dashed ${C.lightBrown}`, verticalAlign: 'middle', marginRight: 6 }} />Overheads</span>
        <span><span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 9, background: C.cream, verticalAlign: 'middle', marginRight: 6 }} />Actual months</span>
        <span><span style={{ display: 'inline-block', width: 9, height: 9, background: WARN_COLOR, transform: 'rotate(45deg)', verticalAlign: 'middle', marginRight: 6 }} />Break-even</span>
      </div>
      <svg width={width - 34} height={H} role="img" aria-label="Break-even chart: income and cost lines by monthly revenue with actual months plotted">
        {g.yTicks.map(t => (
          <g key={`y${t}`}>
            <line x1={M.left} x2={M.left + plotW} y1={g.Y(t)} y2={g.Y(t)} stroke={GRID} />
            <text x={M.left - 8} y={g.Y(t) + 4} textAnchor="end" fontSize={11} fill={C.lightBrown}>{usdK(t)}</text>
          </g>
        ))}
        {g.xTicks.map(t => (
          <text key={`x${t}`} x={g.X(t)} y={M.top + plotH + 18} textAnchor="middle" fontSize={11} fill={C.lightBrown}>{usdK(t)}</text>
        ))}
        <text x={M.left + plotW / 2} y={H - 2} textAnchor="middle" fontSize={11} fill={C.lightBrown}>monthly revenue</text>

        {/* profit wedge: between income and cost lines, right of break-even */}
        {g.be > 0 && g.be < g.xMax && (
          <path
            d={`M${g.X(g.be)},${g.Y(g.be)} L${g.X(g.xMax)},${g.Y(g.xMax)} L${g.X(g.xMax)},${g.Y(g.cost(g.xMax))} Z`}
            fill="rgba(62,157,99,0.12)"
          />
        )}

        <line x1={g.X(0)} y1={g.Y(g.cost(0))} x2={g.X(g.xMax)} y2={g.Y(g.cost(g.xMax))} stroke={COST_COLOR} strokeWidth={2} />
        <line x1={g.X(0)} y1={g.Y(pnl.fixedMonthly)} x2={g.X(g.xMax)} y2={g.Y(pnl.fixedMonthly)} stroke={C.lightBrown} strokeWidth={1.5} strokeDasharray="5 4" />
        <line x1={g.X(0)} y1={g.Y(0)} x2={g.X(Math.min(g.xMax, g.yMax))} y2={g.Y(Math.min(g.xMax, g.yMax))} stroke={INCOME_COLOR} strokeWidth={2} />

        {pnl.months.map(m => {
          const costY = m.cogs + m.expenses
          return (
            <circle key={m.month} cx={g.X(m.income)} cy={g.Y(costY)} r={4.5}
              fill={m.net >= 0 ? C.cream : COST_COLOR} stroke={C.dark} strokeWidth={1.5}>
              <title>{`${monthLabel(m.month)} — revenue ${usd(m.income)}, cost ${usd(costY)}, net ${m.net >= 0 ? '+' : '−'}${usd(Math.abs(m.net))}`}</title>
            </circle>
          )
        })}

        {g.be > 0 && g.be <= g.xMax && (
          <g transform={`translate(${g.X(g.be)},${g.Y(g.be)})`}>
            <rect x={-5} y={-5} width={10} height={10} transform="rotate(45)" fill={WARN_COLOR} stroke={C.dark} strokeWidth={1.5}>
              <title>{`Break-even: ${usd(g.be)} revenue per month`}</title>
            </rect>
          </g>
        )}
      </svg>
      <div style={{ fontSize: '0.72rem', color: C.lightBrown, marginTop: '0.25rem' }}>
        Dots are the last 12 actual months (cream = profitable, orange = loss). Hover a dot for the month&apos;s numbers.
      </div>
    </div>
  )
}

// ── WAR metric tile ───────────────────────────────────────────────────────────
function WarTile({ label, day, week, unit }: { label: string; day: number | null; week: number; unit: string }) {
  const dim = week <= 0
  return (
    <div style={{
      background: C.dark, border: '1px solid rgba(166,120,90,0.18)', borderRadius: 4,
      padding: '0.75rem 1rem', flex: '1 1 150px', minWidth: 140, opacity: dim ? 0.45 : 1,
    }}>
      <div style={{ fontSize: '0.68rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.3rem' }}>
        {label}
      </div>
      <div style={{ fontSize: '1.25rem', fontWeight: 600, color: C.cream }}>
        {day === null ? '—' : fmt(day)}<span style={{ color: C.tan, fontWeight: 400 }}> / {fmt(week)}</span>
        <span style={{ fontSize: '0.75rem', fontWeight: 400, color: C.lightBrown, marginLeft: '0.3rem' }}>{unit}</span>
      </div>
      <div style={{ fontSize: '0.65rem', color: C.lightBrown }}>today / week</div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function ExecPage() {
  const [authed, setAuthed] = useState<boolean | null>(null)
  const [pass, setPass] = useState('')
  const [loginError, setLoginError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [pnl, setPnl] = useState<PnlData | null>(null)
  const [overview, setOverview] = useState<OverviewData | null>(null)
  const [war, setWar] = useState<WarData | null>(null)
  const [labor, setLabor] = useState<LaborWeek[] | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const loadAll = () => {
    const grab = <T,>(url: string, set: (v: T) => void, key: string) =>
      fetch(url).then(r => r.json()).then(d => {
        if (d.error) setErrors(e => ({ ...e, [key]: String(d.message ?? d.error) }))
        else set(d as T)
      }).catch(() => setErrors(e => ({ ...e, [key]: 'Request failed' })))
    grab<PnlData>('/api/exec/pnl', setPnl, 'pnl')
    grab<OverviewData>('/api/exec/overview', setOverview, 'overview')
    grab<WarData>('/api/exec/war', setWar, 'war')
    grab<{ weeks: LaborWeek[] }>('/api/exec/labor', d => setLabor(d.weeks), 'labor')
  }

  useEffect(() => {
    fetch('/api/exec/session').then(r => r.json()).then(d => {
      setAuthed(Boolean(d.authed))
      if (d.authed) loadAll()
    }).catch(() => setAuthed(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const login = async () => {
    if (!pass.trim() || busy) return
    setBusy(true); setLoginError(null)
    try {
      const res = await fetch('/api/exec/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pass: pass.trim() }),
      })
      if (res.ok) { setAuthed(true); setPass(''); loadAll() }
      else setLoginError((await res.json()).error ?? 'Wrong passphrase')
    } catch { setLoginError('Request failed') }
    setBusy(false)
  }

  const logout = async () => {
    await fetch('/api/exec/login', { method: 'DELETE' })
    setAuthed(false); setPnl(null); setOverview(null); setWar(null); setLabor(null); setErrors({})
  }

  const latestLabor = labor?.[0] ?? null

  return (
    <div style={{ minHeight: '100vh', background: C.darkBrown }}>
      <header style={{
        background: C.dark, borderBottom: '1px solid rgba(166,120,90,0.3)',
        padding: '0 2rem', height: '72px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <Link href="/" style={{ color: C.lightBrown, textDecoration: 'none', fontSize: '0.82rem' }}>← Dashboard</Link>
          <span style={{ color: 'rgba(166,120,90,0.3)' }}>|</span>
          <div>
            <h1 style={{ fontFamily: 'Georgia, serif', fontSize: '1.1rem', fontWeight: 700, color: C.cream, textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0 }}>
              Executive
            </h1>
            <p style={{ fontSize: '0.68rem', color: C.lightBrown, letterSpacing: '0.15em', textTransform: 'uppercase', margin: 0 }}>
              Cash · break-even · ops · labor
            </p>
          </div>
        </div>
        {authed && (
          <button onClick={logout} style={{
            background: 'transparent', border: '1px solid rgba(166,120,90,0.4)', borderRadius: 4,
            color: C.lightBrown, fontSize: '0.75rem', padding: '0.4rem 0.9rem', cursor: 'pointer',
          }}>
            Sign out
          </button>
        )}
      </header>

      {authed === null && (
        <main style={{ padding: '4rem 2rem', textAlign: 'center', color: C.lightBrown }}>Checking access…</main>
      )}

      {authed === false && (
        <main style={{ padding: '4rem 2rem', display: 'flex', justifyContent: 'center' }}>
          <div style={{
            background: C.dark, border: '1px solid rgba(166,120,90,0.3)', borderRadius: 4,
            padding: '2rem', width: '100%', maxWidth: 380,
          }}>
            <div style={{ fontSize: '0.72rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: '1rem' }}>
              Executive access
            </div>
            <input
              type="password" value={pass} autoFocus
              onChange={e => setPass(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && login()}
              placeholder="Passphrase"
              style={{
                width: '100%', boxSizing: 'border-box', background: C.darkBrown, color: C.cream,
                border: '1px solid rgba(166,120,90,0.4)', borderRadius: 4,
                padding: '0.7rem 0.9rem', fontSize: '1rem', marginBottom: '0.75rem',
              }}
            />
            <button onClick={login} disabled={busy} style={{
              width: '100%', background: C.medBrown, border: 'none', borderRadius: 4,
              color: C.cream, fontSize: '0.9rem', fontWeight: 600, padding: '0.7rem',
              cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.7 : 1,
            }}>
              {busy ? 'Checking…' : 'Open the suite'}
            </button>
            {loginError && <div style={{ color: '#E8883A', fontSize: '0.8rem', marginTop: '0.75rem' }}>{loginError}</div>}
          </div>
        </main>
      )}

      {authed && (
        <main style={{ padding: '2rem', maxWidth: '1100px', margin: '0 auto', boxSizing: 'border-box' }}>

          <SectionLabel>Money right now</SectionLabel>
          {errors.overview ? <ErrorBox msg={errors.overview} /> : (
            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
              <StatTile hero label="Cash in bank" value={overview ? usd(overview.cash) : '—'} accent={INCOME_COLOR}
                sub={overview ? `as of ${overview.asOf}` : undefined} />
              <StatTile label="Cash + receivables" value={overview ? usd(overview.cash + overview.accountsReceivable) : '—'} />
              <StatTile label="Receivables" value={overview ? usd(overview.accountsReceivable) : '—'} />
              <StatTile label="Open invoices" value={overview ? usd(overview.openInvoices.balance) : '—'}
                sub={overview ? `${overview.openInvoices.count} unpaid` : undefined} />
            </div>
          )}
          {overview && overview.openInvoices.top.length > 0 && (
            <div style={{ background: C.dark, border: '1px solid rgba(166,120,90,0.18)', borderRadius: 4, padding: '0.75rem 1.25rem', marginTop: '1rem' }}>
              <div style={{ fontSize: '0.68rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.5rem' }}>
                Biggest open balances
              </div>
              {overview.openInvoices.top.map(inv => (
                <div key={inv.docNumber} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', color: C.tan, padding: '0.2rem 0' }}>
                  <span>{inv.customerName} <span style={{ color: C.lightBrown }}>#{inv.docNumber} · {inv.txnDate}</span></span>
                  <span style={{ color: C.cream, fontWeight: 600 }}>{usd(inv.balance)}</span>
                </div>
              ))}
            </div>
          )}

          <SectionLabel>Break-even — trailing 12 months</SectionLabel>
          {errors.pnl ? <ErrorBox msg={errors.pnl} /> : !pnl ? (
            <div style={{ color: C.lightBrown, fontSize: '0.85rem' }}>Loading QuickBooks P&amp;L…</div>
          ) : (
            <>
              <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
                <StatTile label="Break-even revenue" value={pnl.breakEvenMonthly ? usd(pnl.breakEvenMonthly) : '—'} unit="/mo"
                  accent={WARN_COLOR} sub="income = costs above this" />
                <StatTile label="Avg revenue" value={usd(pnl.avgMonthlyIncome)} unit="/mo"
                  accent={pnl.breakEvenMonthly && pnl.avgMonthlyIncome >= pnl.breakEvenMonthly ? INCOME_COLOR : COST_COLOR} />
                <StatTile label="Overheads" value={usd(pnl.fixedMonthly)} unit="/mo" sub="fixed operating expenses" />
                <StatTile label="Variable cost rate" value={`${(pnl.variableRate * 100).toFixed(1)}%`} sub="COGS per revenue dollar" />
                <StatTile label="Net, 12 months" value={`${pnl.totals.net < 0 ? '−' : '+'}${usd(Math.abs(pnl.totals.net))}`}
                  accent={pnl.totals.net >= 0 ? INCOME_COLOR : COST_COLOR} />
              </div>
              <BreakEvenChart pnl={pnl} />
            </>
          )}

          <SectionLabel>Operations — {war ? `${war.today} (week since ${war.week_since})` : 'this week'}</SectionLabel>
          {errors.war ? <ErrorBox msg={errors.war} /> : !war ? (
            <div style={{ color: C.lightBrown, fontSize: '0.85rem' }}>Loading ops…</div>
          ) : (
            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
              <WarTile label="Carcasses in" day={war.recv_in_d} week={war.recv_in_w} unit="hd" />
              <WarTile label="Carcasses out" day={war.harv_out_d} week={war.harv_out_w} unit="hd" />
              <WarTile label="Live lbs in" day={war.livelb_d} week={war.livelb_w} unit="lb" />
              <WarTile label="Hot carcass" day={war.hot_d} week={war.hot_w} unit="lb" />
              <WarTile label="Processing in" day={war.pin_d} week={war.pin_w} unit="lb" />
              <WarTile label="Processing out" day={war.pout_d} week={war.pout_w} unit="lb" />
              <div style={{
                background: C.dark, border: '1px solid rgba(166,120,90,0.18)', borderRadius: 4,
                padding: '0.75rem 1rem', flex: '1 1 150px', minWidth: 140, opacity: war.rate_d ? 1 : 0.45,
              }}>
                <div style={{ fontSize: '0.68rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.3rem' }}>
                  Run rate
                </div>
                <div style={{ fontSize: '1.25rem', fontWeight: 600, color: C.cream }}>
                  {war.rate_d ? fmt(war.rate_d) : '—'}
                  <span style={{ fontSize: '0.75rem', fontWeight: 400, color: C.lightBrown, marginLeft: '0.3rem' }}>lb/hr</span>
                </div>
                <div style={{ fontSize: '0.65rem', color: C.lightBrown }}>today, scan to scan</div>
              </div>
              <WarTile label="Value add in" day={null} week={war.va_in_w} unit="lb" />
              <WarTile label="Value add out" day={null} week={war.va_out_w} unit="lb" />
            </div>
          )}

          <SectionLabel>Labor efficiency — weekly</SectionLabel>
          {errors.labor ? <ErrorBox msg={errors.labor} /> : !labor ? (
            <div style={{ color: C.lightBrown, fontSize: '0.85rem' }}>Loading…</div>
          ) : labor.length === 0 ? (
            <div style={{ color: C.lightBrown, fontSize: '0.85rem' }}>
              No labor weeks recorded yet — the Thursday labor report fills this in.
            </div>
          ) : (
            <>
              {latestLabor && (
                <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
                  <StatTile hero label="Labor % of invoiced" value={`${Math.round(latestLabor.labor_pct)}%`}
                    accent={latestLabor.labor_pct <= 33 ? INCOME_COLOR : COST_COLOR}
                    sub={`target 33% · week of ${latestLabor.week_start}`} />
                  <StatTile label="Labor $/lb processed" value={`$${Number(latestLabor.dollars_per_lb).toFixed(2)}`} />
                  <StatTile label="Payroll" value={usd(latestLabor.labor_dollars)} sub={`${fmt(latestLabor.labor_hours)} hours`} />
                  <StatTile label="Invoiced" value={usd(latestLabor.total_sales)}
                    sub={`custom ${usd(latestLabor.custom_sales)} · retail ${usd(latestLabor.retail_sales)}`} />
                  <StatTile label="Crew" value={String(latestLabor.headcount)}
                    sub={`avg ${Math.round(latestLabor.avg_hours)} hr · ${latestLabor.over40} over 40`} />
                </div>
              )}
              {labor.length > 1 && (
                <div style={{ background: C.dark, border: '1px solid rgba(166,120,90,0.18)', borderRadius: 4, padding: '0.75rem 1.25rem', overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', color: C.tan }}>
                    <thead>
                      <tr style={{ color: C.lightBrown, textTransform: 'uppercase', fontSize: '0.65rem', letterSpacing: '0.08em' }}>
                        <th style={{ textAlign: 'left', padding: '0.35rem 0.5rem' }}>Week</th>
                        <th style={{ textAlign: 'right', padding: '0.35rem 0.5rem' }}>Invoiced</th>
                        <th style={{ textAlign: 'right', padding: '0.35rem 0.5rem' }}>Payroll</th>
                        <th style={{ textAlign: 'right', padding: '0.35rem 0.5rem' }}>Labor %</th>
                        <th style={{ textAlign: 'right', padding: '0.35rem 0.5rem' }}>$/lb</th>
                        <th style={{ textAlign: 'right', padding: '0.35rem 0.5rem' }}>Lbs</th>
                      </tr>
                    </thead>
                    <tbody>
                      {labor.map(w => (
                        <tr key={w.week_start} style={{ borderTop: '1px solid rgba(166,120,90,0.12)' }}>
                          <td style={{ padding: '0.35rem 0.5rem' }}>{w.week_start}</td>
                          <td style={{ textAlign: 'right', padding: '0.35rem 0.5rem' }}>{usd(w.total_sales)}</td>
                          <td style={{ textAlign: 'right', padding: '0.35rem 0.5rem' }}>{usd(w.labor_dollars)}</td>
                          <td style={{ textAlign: 'right', padding: '0.35rem 0.5rem', color: w.labor_pct <= 33 ? INCOME_COLOR : COST_COLOR, fontWeight: 600 }}>
                            {Math.round(w.labor_pct)}%
                          </td>
                          <td style={{ textAlign: 'right', padding: '0.35rem 0.5rem' }}>${Number(w.dollars_per_lb).toFixed(2)}</td>
                          <td style={{ textAlign: 'right', padding: '0.35rem 0.5rem' }}>{fmt(w.throughput_lbs)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          <div style={{ height: '3rem' }} />
        </main>
      )}
    </div>
  )
}
