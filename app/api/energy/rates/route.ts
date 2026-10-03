export const runtime = 'nodejs'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

// What a kWh costs us — see lib/energy.
//   POST   /api/energy/rates      → file a rate off a utility bill
//   DELETE /api/energy/rates?id=  → remove one
//
// Rates are dated rather than overwritten, so a reading costed last winter
// stays explainable after the utility changes its tariff.

const num = (v: unknown): number | null => {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[$,\s]/g, ''))
  return Number.isFinite(n) ? n : null
}

export async function POST(req: NextRequest) {
  const b = await req.json() as Record<string, unknown>

  const rate = num(b.rate_per_kwh)
  if (rate == null || rate < 0) return NextResponse.json({ error: 'Enter the $/kWh.' }, { status: 400 })
  // A whole-dollar "rate" is almost certainly the bill total typed in the
  // wrong box. Utility rates in this part of the country are cents, not dollars.
  if (rate > 2) return NextResponse.json({ error: 'That rate looks like dollars, not $/kWh. Divide the bill total by its kWh.' }, { status: 400 })

  const effective = String(b.effective_on ?? '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effective)) return NextResponse.json({ error: 'Give the date the rate applies from.' }, { status: 400 })

  const demand = num(b.demand_per_kw)
  if (demand != null && demand < 0) return NextResponse.json({ error: 'Demand charge can’t be negative.' }, { status: 400 })

  const { data, error } = await supabaseAdmin
    .from('energy_rates')
    .insert([{
      effective_on:  effective,
      rate_per_kwh:  rate,
      demand_per_kw: demand,
      utility:       typeof b.utility     === 'string' && b.utility.trim()     ? b.utility.trim()     : null,
      source:        typeof b.source      === 'string' && b.source.trim()      ? b.source.trim()      : null,
      recorded_by:   typeof b.recorded_by === 'string' && b.recorded_by.trim() ? b.recorded_by.trim() : null,
    }])
    .select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(req: NextRequest) {
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const { error } = await supabaseAdmin.from('energy_rates').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
