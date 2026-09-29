'use client'
// The rules, in plain words, for /timekeeping.

import { BREAK_RULES, PTO_RULES } from '@/lib/timekeeping'
import { C, card, h2, td, th } from './shared'

export function PolicyTab() {
  const p: React.CSSProperties = { color: C.tan, fontSize: '0.85rem', lineHeight: 1.6, margin: '0 0 0.5rem' }
  return (
    <>
      <div style={card}>
        <h2 style={h2}>Breaks</h2>
        <table style={{ borderCollapse: 'collapse', marginBottom: '0.8rem' }}>
          <thead><tr><th style={th}>Paid hours worked</th><th style={th}>Break</th><th style={th}>Paid?</th></tr></thead>
          <tbody>
            <tr><td style={td}>{BREAK_RULES.firstPaidBreakAt}+</td><td style={td}>15-min rest break</td><td style={td}>Paid</td></tr>
            <tr><td style={td}>{BREAK_RULES.lunchAt}+</td><td style={td}>30-min lunch</td><td style={td}>Unpaid (must be fully off duty)</td></tr>
            <tr><td style={td}>{BREAK_RULES.secondPaidBreakAt}+</td><td style={td}>Second 15-min rest break</td><td style={td}>Paid</td></tr>
          </tbody>
        </table>
        <p style={p}><b style={{ color: C.cream }}>Montana law:</b> Montana doesn&apos;t require meal or rest breaks for adult employees. It follows the federal rule, so this schedule is company policy, not a legal requirement. It&apos;s a good policy, and similar to Washington&apos;s and Oregon&apos;s.</p>
        <p style={p}><b style={{ color: C.cream }}>The rules that are law</b> (federal FLSA): a break of 5–20 minutes must be paid. A lunch can be unpaid only if it&apos;s at least 30 minutes and the employee is fully relieved of duty. A lunch that runs short or gets interrupted is paid time, and the timesheet treats it that way.</p>
        <p style={p}><b style={{ color: C.cream }}>Every break is punched,</b> out and back in, same as lunch. Break time is a daily total, settled at the end of the day: 15 paid minutes per break earned, so 30 on an 8+ hour day. They can take two 15s or one 30. Anything over is <b style={{ color: C.cream }}>UPTO</b> (unpaid time off). A 10-hour shift with 37 minutes of breaks pays 30 and logs 7 minutes of UPTO. Lunch is separate. It&apos;s already unpaid, so it doesn&apos;t count as UPTO.</p>
        <p style={p}><b style={{ color: C.cream }}>To not pay the extra minutes</b>, federal rules say employees must be told ahead of time, clearly, how much paid break time they get, that running over is against the rules and can lead to discipline, and that extra time is unpaid. Put it in the handbook and have people sign it. The kiosk also says it every time someone starts a break.</p>
        <p style={p}>Each employee sees their break minutes and any UPTO on the clock when they punch out, and on their printed summary.</p>
      </div>
      <div style={card}>
        <h2 style={h2}>PTO</h2>
        <p style={p}>Every paid hour worked, overtime included, earns PTO. Year 1 is {PTO_RULES.baseAnnual} h per {PTO_RULES.fullTimeHours} worked ({(PTO_RULES.baseAnnual / PTO_RULES.fullTimeHours).toFixed(4)} per hour). Each work anniversary adds {PTO_RULES.stepPerYear} h to that rate, so it&apos;s 80 at 5 years, 120 at 10 and 160 at 15.</p>
        <p style={p}><b style={{ color: C.cream }}>Montana law:</b> earned vacation counts as wages. Use-it-or-lose-it isn&apos;t allowed, and any unused balance has to be paid out when someone leaves. A cap on how much a balance can build up <i>is</i> allowed, but we&apos;re not using caps for now.</p>
        <p style={p}>Every employee sees the PTO they earned on the time clock, and on their printed summary (e.g. an 8-hour day in year 1 earns 0.15 h).</p>
      </div>
      <div style={card}>
        <h2 style={h2}>Time off</h2>
        <p style={p}>Employees ask for time off at the iPad with their own PIN, as PTO or unpaid. They pick the days, and each day defaults to their scheduled shift. They can enter fewer hours for a partial day.</p>
        <p style={p}>A PTO request can&apos;t be for more than they have free. &ldquo;Free&rdquo; means their balance minus approved PTO that hasn&apos;t been taken yet, minus requests still waiting on a decision. That way nobody can ask for the same hours twice.</p>
        <p style={p}>You approve or deny requests on the Schedule tab. It shows who else is off those days and how many people are still working. Approved time off shows on the schedule and on their printed summary.</p>
        <p style={p}><b style={{ color: C.cream }}>Pay rules:</b> PTO hours are paid at the regular rate. They don&apos;t count toward the 40 hours for overtime, since they aren&apos;t hours worked. They also don&apos;t earn more PTO.</p>
      </div>
    </>
  )
}
