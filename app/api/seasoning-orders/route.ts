export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
// Recipes and supplies are under RLS with no policies — service role only.
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { supabase } from '@/lib/supabase'
import { buildSeasoningPlan, type FlavorRow, type RecipeRow, type SupplyRow, type BlendLineRow } from '@/lib/seasoningOrders'
import type { ApptRow, SheetRow } from '@/lib/smokehouseBook'
import { isoDate, addDaysISO } from '@/lib/dates'

export const dynamic = 'force-dynamic'

// GET /api/seasoning-orders?days=28&back=21 — seasoning and cure the booked
// kills will use, against the shelf. `back` reaches into kills already done
// whose trim may not be made into product yet (beef hangs ~2 weeks, and a card is often linked at the kill, not before).
export async function GET(req: NextRequest) {
  const sp = new URL(req.url).searchParams
  const days = Math.min(180, Math.max(1, parseInt(sp.get('days') ?? '28', 10) || 28))
  const back = Math.min(60, Math.max(0, parseInt(sp.get('back') ?? '21', 10) || 0))
  const today = isoDate()
  const from  = addDaysISO(today, -back)
  const to    = addDaysISO(today, days)

  const [appts, sheets, flavors, recipes, supplies, lines] = await Promise.all([
    supabase.from('harvest_appointments').select('id, harvest_date, species, head_count, status')
      .gte('harvest_date', from).lte('harvest_date', to),
    supabase.from('cutting_instructions').select('id, species, data, appointment_id').neq('status', 'archived'),
    supabase.from('wizard_flavors').select('id, product, val, label').eq('active', true),
    supabaseAdmin.from('smokehouse_recipes').select('wizard_flavor_id, seasoning_id, seasoning_lb_per_100, cure_id, cure_oz_per_100'),
    supabaseAdmin.from('smokehouse_supplies').select('*'),
    supabaseAdmin.from('smokehouse_blend_lines').select('blend_id, ingredient_id, pct'),
  ])
  const err = appts.error ?? sheets.error ?? flavors.error ?? recipes.error ?? supplies.error ?? lines.error
  if (err) return NextResponse.json({ error: err.message }, { status: 500 })

  const plan = buildSeasoningPlan({
    appts: ((appts.data ?? []) as ApptRow[]).filter(a => !/cancel/i.test(a.status ?? '')),
    sheets: (sheets.data ?? []) as SheetRow[],
    flavors: (flavors.data ?? []) as FlavorRow[],
    recipes: (recipes.data ?? []) as RecipeRow[],
    supplies: (supplies.data ?? []) as SupplyRow[],
    blendLines: (lines.data ?? []) as BlendLineRow[],
    from, to, today,
  })
  return NextResponse.json({ ...plan, today, days, back })
}
