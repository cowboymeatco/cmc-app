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
interface CostAccount {
  name: string
  section: 'cogs' | 'expenses'
  bucket: 'fixed' | 'variable'
  overridden: boolean
  total: number
}
interface PnlData {
  start: string
  end: string
  months: PnlMonth[]
  monthCount: number
  totals: { income: number; cogs: number; expenses: number; net: number }
  accounts: CostAccount[]
  variableRate: number
  fixedMonthly: number
  breakEvenMonthly: number | null
  avgMonthlyIncome: number
}

// ── Period presets for the financial section ──────────────────────────────────
// All date math in local time — this app is used in one timezone.
function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const PERIODS = [
  { key: 'ttm', label: 'Trailing 12 months' },
  { key: 'ytd', label: 'Year to date' },
  { key: 'qtr', label: 'This quarter' },
  { key: 'lastqtr', label: 'Last quarter' },
  { key: 'mo', label: 'This month' },
  { key: 'lastmo', label: 'Last month' },
] as const
type PeriodKey = (typeof PERIODS)[number]['key']

function periodRange(key: PeriodKey): { start: string; end: string } {
  const now = new Date()
  const y = now.getFullYear(), m = now.getMonth()
  const q = Math.floor(m / 3)
  switch (key) {
    case 'ytd':     return { start: isoDate(new Date(y, 0, 1)), end: isoDate(now) }
    case 'qtr':     return { start: isoDate(new Date(y, q * 3, 1)), end: isoDate(now) }
    case 'lastqtr': return { start: isoDate(new Date(y, (q - 1) * 3, 1)), end: isoDate(new Date(y, q * 3, 0)) }
    case 'mo':      return { start: isoDate(new Date(y, m, 1)), end: isoDate(now) }
    case 'lastmo':  return { start: isoDate(new Date(y, m - 1, 1)), end: isoDate(new Date(y, m, 0)) }
    default:        return { start: isoDate(new Date(y, m - 11, 1)), end: isoDate(now) }
  }
}
interface OverviewData {
  asOf: string
  cash: number
  accountsReceivable: number
  openInvoices: { count: number; balance: number; top: { docNumber: string; customerName: string; balance: number; txnDate: string }[] }
}
interface RiskInvoice {
  docNumber: string
  customerName: string
  balance: number
  txnDate: string
  dueDate: string | null
  ageDays: number
  risk: 'held' | 'released' | 'unknown'
  inferred: boolean
  atBakerStorage: boolean
  lastSession: string | null
}
interface ReceivablesData {
  asOf: string
  coverageStart: string | null
  total: { count: number; balance: number }
  held: { count: number; balance: number }
  released: { count: number; balance: number }
  unknown: { count: number; balance: number }
  atRisk: RiskInvoice[]
  unknownTop: RiskInvoice[]
}
interface WarData {
  today: string; week_since: string
  recv_in_d: number; recv_in_w: number; harv_out_d: number; harv_out_w: number
  // Distinct carcasses scanned onto the rail — see exec_war_metrics().
  cut_out_d: number; cut_out_w: number
  livelb_d: number; livelb_w: number; hot_d: number; hot_w: number
  pin_d: number; pin_w: number; pout_d: number; pout_w: number
  rate_d: number | null; cooks_d: number; cooks_w: number
}
interface TurnoverSpecies {
  species: string
  head: number
  matched: number
  medianDays: number | null
  fastest: number | null
  slowest: number | null
  paidCount: number
  openCount: number
  medianPaidDays: number | null
  medianCollectDays: number | null
  paidFastest: number | null
  paidSlowest: number | null
}
interface TurnoverData {
  asOf: string; since: string; months: number; windowDays: number
  overall: {
    medianDays: number | null; medianPaidDays: number | null; medianCollectDays: number | null
    paidCount: number; openCount: number; invoicesRead: number; paymentsRead: number
  } | null
  coverage: { carcasses: number; withCustomer: number; matched: number; ambiguous: number; unmatched: number }
  species: TurnoverSpecies[]
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
// (y = overheads + variable rate · x), flat overheads line, the break-even
// diamond, and one dot for where the selected period actually sits (its
// average month). The individual month dots crowd the picture, so they stay
// behind the "Show each month" toggle; shown, a dot under the income line is
// a profitable month.
function BreakEvenChart({ pnl, periodLabel }: { pnl: PnlData; periodLabel: string }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(900)
  const [showMonths, setShowMonths] = useState(false)

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
    // Where the selected period sits: its average month, revenue vs actual cost.
    const n = Math.max(pnl.monthCount, 1)
    const here = { income: pnl.totals.income / n, cost: (pnl.totals.cogs + pnl.totals.expenses) / n }
    const monthIncomes = showMonths ? pnl.months.map(m => m.income) : []
    const monthCosts = showMonths ? pnl.months.map(m => m.cogs + m.expenses) : []
    const maxRev = Math.max(be, here.income, ...monthIncomes)
    const xMax = niceCeil(maxRev * 1.15)
    const cost = (x: number) => pnl.fixedMonthly + pnl.variableRate * x
    const maxY = Math.max(xMax, cost(xMax), here.cost, ...monthCosts)
    const yTicks = niceTicks(maxY)
    const yMax = yTicks[yTicks.length - 1]
    const xTicks = niceTicks(xMax)
    const X = (v: number) => M.left + (v / xMax) * plotW
    const Y = (v: number) => M.top + plotH - (v / yMax) * plotH
    return { be, here, xMax, yMax, xTicks: xTicks.filter(t => t <= xMax), yTicks, X, Y, cost }
  }, [pnl, plotW, plotH, showMonths])

  return (
    <div ref={wrapRef} style={{ background: C.dark, border: '1px solid rgba(166,120,90,0.18)', borderRadius: 4, padding: '1rem' }}>
      <div style={{ display: 'flex', gap: '1.25rem', flexWrap: 'wrap', alignItems: 'center', fontSize: '0.72rem', color: C.tan, marginBottom: '0.5rem' }}>
        <span><span style={{ display: 'inline-block', width: 9, height: 9, background: WARN_COLOR, transform: 'rotate(45deg)', verticalAlign: 'middle', marginRight: 6 }} />Break-even</span>
        <span><span style={{ display: 'inline-block', width: 11, height: 11, borderRadius: 11, background: C.cream, verticalAlign: 'middle', marginRight: 6 }} />{periodLabel}</span>
        <span><span style={{ display: 'inline-block', width: 18, height: 3, background: INCOME_COLOR, verticalAlign: 'middle', marginRight: 6 }} />Income</span>
        <span><span style={{ display: 'inline-block', width: 18, height: 3, background: COST_COLOR, verticalAlign: 'middle', marginRight: 6 }} />Opex (overheads + variable)</span>
        <span><span style={{ display: 'inline-block', width: 18, height: 0, borderTop: `2px dashed ${C.lightBrown}`, verticalAlign: 'middle', marginRight: 6 }} />Overheads</span>
        <label style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, color: C.lightBrown, cursor: 'pointer' }}>
          <input type="checkbox" checked={showMonths} onChange={e => setShowMonths(e.target.checked)} />
          Show each month
        </label>
      </div>
      <svg width={width - 34} height={H} role="img" aria-label="Break-even chart: income and cost lines by monthly revenue, with the break-even point and the selected period's average month plotted">
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

        {showMonths && pnl.months.map(m => {
          const costY = m.cogs + m.expenses
          return (
            <circle key={m.month} cx={g.X(m.income)} cy={g.Y(costY)} r={4}
              fill={m.net >= 0 ? 'rgba(242,232,217,0.55)' : 'rgba(206,106,32,0.55)'} stroke={C.dark} strokeWidth={1.5}>
              <title>{`${monthLabel(m.month)} — revenue ${usd(m.income)}, cost ${usd(costY)}, net ${m.net >= 0 ? '+' : '−'}${usd(Math.abs(m.net))}`}</title>
            </circle>
          )
        })}

        {/* where the selected period sits — its average month */}
        <circle cx={g.X(g.here.income)} cy={g.Y(g.here.cost)} r={7}
          fill={g.here.income >= g.here.cost ? C.cream : COST_COLOR} stroke={C.dark} strokeWidth={2}>
          <title>{`${periodLabel} — average month: revenue ${usd(g.here.income)}, cost ${usd(g.here.cost)}, net ${g.here.income >= g.here.cost ? '+' : '−'}${usd(Math.abs(g.here.income - g.here.cost))}`}</title>
        </circle>

        {g.be > 0 && g.be <= g.xMax && (
          <g transform={`translate(${g.X(g.be)},${g.Y(g.be)})`}>
            <rect x={-5} y={-5} width={10} height={10} transform="rotate(45)" fill={WARN_COLOR} stroke={C.dark} strokeWidth={1.5}>
              <title>{`Break-even: ${usd(g.be)} revenue per month`}</title>
            </rect>
          </g>
        )}
      </svg>
      <div style={{ fontSize: '0.72rem', color: C.lightBrown, marginTop: '0.25rem' }}>
        The big dot is the average month of the selected period — left of the diamond is a loss, right of it is a profit.
        {showMonths
          ? ` Faded dots are the ${pnl.months.length} individual month${pnl.months.length === 1 ? '' : 's'} (cream = profitable, orange = loss). Hover any dot for its numbers.`
          : ' Tick “Show each month” to plot the individual months behind it.'}
      </div>
    </div>
  )
}

// ── Receivables risk: is the meat still behind the money? ────────────────────
function RiskTable({ rows, caption }: { rows: RiskInvoice[]; caption: string }) {
  if (rows.length === 0) return null
  return (
    <div style={{ background: C.dark, border: '1px solid rgba(166,120,90,0.18)', borderRadius: 4, padding: '0.75rem 1.25rem', marginTop: '1rem', overflowX: 'auto' }}>
      <div style={{ fontSize: '0.68rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.5rem' }}>
        {caption}
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', color: C.tan }}>
        <thead>
          <tr style={{ color: C.lightBrown, textTransform: 'uppercase', fontSize: '0.65rem', letterSpacing: '0.08em' }}>
            <th style={{ textAlign: 'left', padding: '0.35rem 0.5rem' }}>Customer</th>
            <th style={{ textAlign: 'left', padding: '0.35rem 0.5rem' }}>Invoice</th>
            <th style={{ textAlign: 'right', padding: '0.35rem 0.5rem' }}>Age</th>
            <th style={{ textAlign: 'right', padding: '0.35rem 0.5rem' }}>Balance</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.docNumber} style={{ borderTop: '1px solid rgba(166,120,90,0.12)' }}>
              <td style={{ padding: '0.35rem 0.5rem' }}>
                {r.customerName}
                {r.atBakerStorage && <span style={{ color: WARN_COLOR, fontSize: '0.68rem', marginLeft: 6 }}>at Baker storage</span>}
                {r.inferred && <span style={{ color: C.lightBrown, fontSize: '0.68rem', marginLeft: 6 }}>pre-scanner</span>}
              </td>
              <td style={{ padding: '0.35rem 0.5rem', color: C.lightBrown }}>#{r.docNumber} · {r.txnDate}</td>
              <td style={{ textAlign: 'right', padding: '0.35rem 0.5rem', color: r.ageDays > 60 ? COST_COLOR : C.tan, fontWeight: r.ageDays > 60 ? 600 : 400 }}>
                {r.ageDays}d
              </td>
              <td style={{ textAlign: 'right', padding: '0.35rem 0.5rem', color: C.cream, fontWeight: 600 }}>{usd(r.balance)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Cost bucket board: drag an account between overheads and variable ────────
function BucketBoard({ accounts, monthCount, onMove }: {
  accounts: CostAccount[]
  monthCount: number
  onMove: (account: string, bucket: 'fixed' | 'variable' | null) => void
}) {
  const [dragging, setDragging] = useState<string | null>(null)
  const [overCol, setOverCol] = useState<'fixed' | 'variable' | null>(null)

  const col = (bucket: 'fixed' | 'variable', title: string, sub: string) => {
    const rows = accounts.filter(a => a.bucket === bucket)
    const colTotal = rows.reduce((s, a) => s + a.total, 0)
    return (
      <div
        onDragOver={e => { e.preventDefault(); setOverCol(bucket) }}
        onDragLeave={() => setOverCol(c => (c === bucket ? null : c))}
        onDrop={e => {
          e.preventDefault()
          const name = e.dataTransfer.getData('text/plain')
          setOverCol(null); setDragging(null)
          if (name) onMove(name, bucket)
        }}
        style={{
          flex: '1 1 320px', minWidth: 300, background: C.dark, borderRadius: 4,
          border: overCol === bucket ? `1px dashed ${C.tan}` : '1px solid rgba(166,120,90,0.18)',
          padding: '0.9rem 1rem',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.2rem' }}>
          <span style={{ fontSize: '0.72rem', color: C.cream, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{title}</span>
          <span style={{ fontSize: '0.8rem', color: C.tan, fontWeight: 600 }}>{usd(colTotal / Math.max(monthCount, 1))}/mo</span>
        </div>
        <div style={{ fontSize: '0.66rem', color: C.lightBrown, marginBottom: '0.6rem' }}>{sub}</div>
        {rows.map(a => (
          <div
            key={a.name}
            draggable
            onDragStart={e => { e.dataTransfer.setData('text/plain', a.name); setDragging(a.name) }}
            onDragEnd={() => { setDragging(null); setOverCol(null) }}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '0.32rem 0.5rem',
              borderTop: '1px solid rgba(166,120,90,0.12)', cursor: 'grab',
              opacity: dragging === a.name ? 0.4 : 1, fontSize: '0.8rem',
            }}
          >
            <span style={{ color: C.lightBrown }}>⋮⋮</span>
            <span style={{ flex: 1, color: C.tan, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={a.name}>
              {a.name}
              {a.overridden && (
                <button onClick={() => onMove(a.name, null)}
                  title="Back to its QuickBooks default"
                  style={{ background: 'transparent', border: 'none', color: WARN_COLOR, fontSize: '0.65rem', cursor: 'pointer', marginLeft: 6, padding: 0 }}>
                  moved · reset
                </button>
              )}
            </span>
            <span style={{ color: C.cream, fontWeight: 600, whiteSpace: 'nowrap' }}>{usd(a.total / Math.max(monthCount, 1))}<span style={{ color: C.lightBrown, fontWeight: 400 }}>/mo</span></span>
            <button
              onClick={() => onMove(a.name, bucket === 'fixed' ? 'variable' : 'fixed')}
              title={bucket === 'fixed' ? 'Move to variable' : 'Move to overheads'}
              style={{ background: 'transparent', border: '1px solid rgba(166,120,90,0.35)', borderRadius: 4, color: C.lightBrown, fontSize: '0.7rem', cursor: 'pointer', padding: '0.1rem 0.4rem' }}
            >
              {bucket === 'fixed' ? '→' : '←'}
            </button>
          </div>
        ))}
        {rows.length === 0 && <div style={{ fontSize: '0.75rem', color: C.lightBrown, padding: '0.5rem' }}>Drop accounts here</div>}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
      {col('fixed', 'Overheads (fixed)', 'The flat line — paid whether or not product moves. Drag or use the arrows to re-file.')}
      {col('variable', 'Variable (scales with revenue)', 'The slope on the opex line — costs that rise with volume.')}
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
  const [receivables, setReceivables] = useState<ReceivablesData | null>(null)
  const [war, setWar] = useState<WarData | null>(null)
  const [labor, setLabor] = useState<LaborWeek[] | null>(null)
  const [turnover, setTurnover] = useState<TurnoverData | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const [period, setPeriod] = useState<PeriodKey>('ttm')

  const grab = <T,>(url: string, set: (v: T) => void, key: string) =>
    fetch(url).then(r => r.json()).then(d => {
      if (d.error) setErrors(e => ({ ...e, [key]: String(d.message ?? d.error) }))
      else {
        setErrors(e => { const next = { ...e }; delete next[key]; return next })
        set(d as T)
      }
    }).catch(() => setErrors(e => ({ ...e, [key]: 'Request failed' })))

  const loadPnl = (p: PeriodKey) => {
    const { start, end } = periodRange(p)
    return grab<PnlData>(`/api/exec/pnl?start=${start}&end=${end}`, setPnl, 'pnl')
  }

  const loadAll = () => {
    loadPnl(period)
    grab<OverviewData>('/api/exec/overview', setOverview, 'overview')
    grab<ReceivablesData>('/api/exec/receivables', setReceivables, 'receivables')
    grab<WarData>('/api/exec/war', setWar, 'war')
    grab<{ weeks: LaborWeek[] }>('/api/exec/labor', d => setLabor(d.weeks), 'labor')
    grab<TurnoverData>('/api/exec/turnover?months=12', setTurnover, 'turnover')
  }

  const changePeriod = (p: PeriodKey) => {
    setPeriod(p)
    setPnl(null)
    loadPnl(p)
  }

  const moveBucket = async (account: string, bucket: 'fixed' | 'variable' | null) => {
    await fetch('/api/exec/buckets', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account, bucket }),
    })
    loadPnl(period)
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
          <SectionLabel>Receivables risk — is the meat still behind the money?</SectionLabel>
          {errors.receivables ? <ErrorBox msg={errors.receivables} /> : !receivables ? (
            <div style={{ color: C.lightBrown, fontSize: '0.85rem' }}>Matching invoices to product on hand…</div>
          ) : (
            <>
              <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                <StatTile hero label="Released &amp; unpaid" value={usd(receivables.released.balance)}
                  accent={receivables.released.balance > 0 ? COST_COLOR : INCOME_COLOR}
                  sub={`${receivables.released.count} invoice${receivables.released.count === 1 ? '' : 's'} · product gone, unsecured`} />
                <StatTile label="Held (product on site)" value={usd(receivables.held.balance)} accent={INCOME_COLOR}
                  sub={`${receivables.held.count} invoice${receivables.held.count === 1 ? '' : 's'} · we still hold the collateral`} />
                <StatTile label="Unmatched" value={usd(receivables.unknown.balance)}
                  sub={`${receivables.unknown.count} invoice${receivables.unknown.count === 1 ? '' : 's'} · no session found by name`} />
              </div>
              <div style={{ fontSize: '0.75rem', color: C.lightBrown, marginTop: '0.6rem' }}>
                Invoices written before the scanner started keeping sessions{receivables.coverageStart ? ` (${receivables.coverageStart})` : ''} can&apos;t
                be matched, so they&apos;re counted as released and tagged <span style={{ color: C.tan }}>pre-scanner</span> — that product is long gone.
              </div>
              <div style={{ fontSize: '0.75rem', color: C.lightBrown, marginTop: '0.6rem' }}>
                While a customer&apos;s meat sits in the cooler, a processor&apos;s lien secures the invoice. Once the boxes leave, the same
                dollars ride on goodwill alone — that&apos;s the released number, and it&apos;s where bad debt comes from.
                Matching is by customer name against processing sessions; unmatched invoices are never guessed into a bucket.
              </div>
              <RiskTable rows={receivables.atRisk} caption="At risk — released, still unpaid (biggest first)" />
              <RiskTable rows={receivables.unknownTop} caption="Unmatched — no processing session found for this name" />
            </>
          )}

          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
            <SectionLabel>Break-even — {PERIODS.find(p => p.key === period)?.label.toLowerCase()}</SectionLabel>
            <select
              value={period}
              onChange={e => changePeriod(e.target.value as PeriodKey)}
              style={{
                background: C.dark, color: C.cream, border: '1px solid rgba(166,120,90,0.4)',
                borderRadius: 4, fontSize: '0.8rem', padding: '0.35rem 0.6rem',
              }}
            >
              {PERIODS.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
          </div>
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
                <StatTile label="Variable cost rate" value={`${(pnl.variableRate * 100).toFixed(1)}%`} sub="per revenue dollar" />
                <StatTile label={`Net, ${pnl.monthCount} mo`} value={`${pnl.totals.net < 0 ? '−' : '+'}${usd(Math.abs(pnl.totals.net))}`}
                  accent={pnl.totals.net >= 0 ? INCOME_COLOR : COST_COLOR} />
              </div>
              <BreakEvenChart pnl={pnl} periodLabel={PERIODS.find(p => p.key === period)?.label ?? 'Selected period'} />

              <SectionLabel>Cost buckets — what&apos;s behind the lines</SectionLabel>
              <div style={{ fontSize: '0.78rem', color: C.lightBrown, margin: '0 0 0.75rem' }}>
                Every cost account in the period, biggest first. Overheads set the flat line; variable sets the slope.
                Disagree with a filing? Drag it (or tap the arrow) — the break-even math re-runs and your call sticks.
              </div>
              <BucketBoard accounts={pnl.accounts} monthCount={pnl.monthCount} onMove={moveBucket} />
            </>
          )}

          <SectionLabel>Operations — {war ? `${war.today} (week since ${war.week_since})` : 'this week'}</SectionLabel>
          {errors.war ? <ErrorBox msg={errors.war} /> : !war ? (
            <div style={{ color: C.lightBrown, fontSize: '0.85rem' }}>Loading ops…</div>
          ) : (
            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
              {/* Named for what they COUNT, not for a direction. "Carcasses in /
                  out" read as product arriving and leaving the plant, so a
                  Friday with no kill on it looked like nothing was going out
                  while the floor was packing beef all day (Charlie,
                  2026-08-21). These three are the animal's journey in order:
                  received live, killed, then broken. */}
              <WarTile label="Animals received" day={war.recv_in_d} week={war.recv_in_w} unit="hd" />
              <WarTile label="Harvested" day={war.harv_out_d} week={war.harv_out_w} unit="hd" />
              <WarTile label="Carcasses cut" day={war.cut_out_d} week={war.cut_out_w} unit="hd" />
              <WarTile label="Live weight" day={war.livelb_d} week={war.livelb_w} unit="lb" />
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
              <WarTile label="Smokehouse cooks" day={war.cooks_d} week={war.cooks_w} unit="loads" />
            </div>
          )}

          {/* Kill to invoice to cash. How long the plant's money sits inside an
              animal before anyone asks for it back, and then how long before it
              actually arrives (Charlie, 2026-08-22 and 2026-08-24). */}
          <SectionLabel>Turnover — slaughter to invoice to paid{turnover ? `, last ${turnover.months} months` : ''}</SectionLabel>
          {errors.turnover ? <ErrorBox msg={errors.turnover} /> : !turnover ? (
            <div style={{ color: C.lightBrown, fontSize: '0.85rem' }}>Reading invoices…</div>
          ) : turnover.coverage.matched === 0 ? (
            <div style={{ color: C.lightBrown, fontSize: '0.85rem' }}>
              No carcass in the last {turnover.months} months could be matched to an invoice yet.
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
                {turnover.overall?.medianPaidDays != null && (
                  <StatTile
                    hero
                    label="Kill to money in the door"
                    value={String(turnover.overall.medianPaidDays)}
                    unit="days"
                    sub={`median across ${turnover.overall.paidCount} paid-off carcasses`}
                    accent={INCOME_COLOR}
                  />
                )}
                {turnover.overall?.medianDays != null && (
                  <StatTile
                    label="Kill to invoice"
                    value={String(turnover.overall.medianDays)}
                    unit="days"
                    sub={`${turnover.coverage.matched} carcasses matched`}
                  />
                )}
                {turnover.overall?.medianCollectDays != null && (
                  <StatTile
                    label="Invoice to payment"
                    value={String(turnover.overall.medianCollectDays)}
                    unit="days"
                    sub="how long the ask sits before it clears"
                  />
                )}
                {turnover.overall && turnover.overall.openCount > 0 && (
                  <StatTile
                    label="Still unpaid"
                    value={String(turnover.overall.openCount)}
                    unit={turnover.overall.openCount === 1 ? 'carcass' : 'carcasses'}
                    sub="invoiced, money not in yet"
                    accent={COST_COLOR}
                  />
                )}
              </div>

              <div style={{
                background: C.dark, border: '1px solid rgba(166,120,90,0.18)',
                borderRadius: 4, padding: '0.75rem 1.25rem', overflowX: 'auto',
              }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', color: C.tan }}>
                  <thead>
                    <tr style={{ color: C.lightBrown, textTransform: 'uppercase', fontSize: '0.65rem', letterSpacing: '0.08em' }}>
                      <th style={{ textAlign: 'left',  padding: '0.35rem 0.5rem' }}>Species</th>
                      <th style={{ textAlign: 'right', padding: '0.35rem 0.5rem' }}>Head</th>
                      <th style={{ textAlign: 'right', padding: '0.35rem 0.5rem' }}>Matched</th>
                      <th style={{ textAlign: 'right', padding: '0.35rem 0.5rem' }}>To invoice</th>
                      <th style={{ textAlign: 'right', padding: '0.35rem 0.5rem' }}>To paid</th>
                      <th style={{ textAlign: 'right', padding: '0.35rem 0.5rem' }}>Invoice &rarr; paid</th>
                      <th style={{ textAlign: 'right', padding: '0.35rem 0.5rem' }}>Unpaid</th>
                    </tr>
                  </thead>
                  <tbody>
                    {turnover.species.filter(sp => sp.matched > 0).map(sp => (
                      <tr key={sp.species} style={{ borderTop: '1px solid rgba(166,120,90,0.12)' }}>
                        <td style={{ padding: '0.35rem 0.5rem', color: C.cream }}>{sp.species}</td>
                        <td style={{ textAlign: 'right', padding: '0.35rem 0.5rem' }}>{sp.head}</td>
                        <td style={{ textAlign: 'right', padding: '0.35rem 0.5rem' }}>{sp.matched}</td>
                        <td style={{ textAlign: 'right', padding: '0.35rem 0.5rem' }}>
                          {sp.medianDays} d
                          <span style={{ color: C.lightBrown, fontSize: '0.7rem' }}> ({sp.fastest}&ndash;{sp.slowest})</span>
                        </td>
                        <td style={{ textAlign: 'right', padding: '0.35rem 0.5rem', color: INCOME_COLOR, fontWeight: 600 }}>
                          {sp.medianPaidDays != null ? `${sp.medianPaidDays} d` : '—'}
                          {sp.medianPaidDays != null && (
                            <span style={{ color: C.lightBrown, fontWeight: 400, fontSize: '0.7rem' }}>
                              {' '}({sp.paidFastest}&ndash;{sp.paidSlowest}, n={sp.paidCount})
                            </span>
                          )}
                        </td>
                        <td style={{ textAlign: 'right', padding: '0.35rem 0.5rem' }}>
                          {sp.medianCollectDays != null ? `${sp.medianCollectDays} d` : '—'}
                        </td>
                        <td style={{
                          textAlign: 'right', padding: '0.35rem 0.5rem',
                          color: sp.openCount > 0 ? COST_COLOR : C.lightBrown,
                        }}>
                          {sp.openCount || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* Say what the number rests on. A median over 59% of the
                  billable animals is worth having; a median presented as if it
                  covered all of them is not. */}
              <div style={{ fontSize: '0.72rem', color: C.lightBrown, marginTop: '0.6rem', lineHeight: 1.6 }}>
                Days from kill to the first invoice to that animal&apos;s buyer, and on to the day
                that invoice finished being paid. An invoice still carrying a balance counts as
                unpaid rather than being averaged in as though the money had landed.
                Matched {turnover.coverage.matched} of the {turnover.coverage.withCustomer} carcasses
                that had a named cut customer
                {turnover.coverage.carcasses > turnover.coverage.withCustomer && (
                  <> (of {turnover.coverage.carcasses} killed — the rest carry no buyer, so nothing to bill against)</>
                )}.
                {turnover.coverage.ambiguous > 0 && (
                  <> {turnover.coverage.ambiguous} left out for being billed too often to tell which invoice was the animal.</>
                )}
                {' '}QuickBooks and the kill floor share no id, so buyers are matched by name —
                linking a customer to QuickBooks on Processing → QuickBooks makes their animals count here exactly.
              </div>
            </>
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
