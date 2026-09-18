export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { buildCutSections, type CutSection } from '@/lib/cutRoomCard'
import { calcDaysHanging } from '@/lib/cutSchedule'

// What a wall TV should be showing right now.
//
// One request per screen, answered whole: the screen's own config, the channel
// it follows, and the card that channel is pointed at, already reduced to
// primal sections. The TVs poll this on a timer — a browser window left open on
// an HDMI-exported display has nobody to press refresh, and it has to come back
// by itself after the laptop sleeps or the plant's wifi drops.
//
// The day's queue is NOT served here. /cut-schedule already assembles it in
// lib/cutSchedule from half a dozen endpoints, and the TV runs that same code
// client-side — one assembly of the rail order for the crew's phones and the
// wall both, rather than a second one here that could disagree with it.

export const dynamic = 'force-dynamic'

interface ChannelRow {
  channel: string
  cutting_instruction_id: string | null
  harvest_log_id: string | null
  customer_name: string
  session_date: string | null
  updated_at: string
  updated_by: string
}

interface ScreenRow {
  screen: string
  label: string
  view: string
  channel: string
  sort: number
}

export interface DisplayCard {
  cutting_instruction_id: string
  customer_name: string
  species: string
  portion: string
  sections: CutSection[]
  /** Grinding the whole animal answers every primal at once — the screens say
   *  so as a band instead of showing the sections it silences. */
  grind_whole: boolean
  notes: string
}

export interface DisplayCarcass {
  carcass_tag: string
  species: string
  harvest_date: string
  hot_carcass_weight_lbs: number | null
  days_hanging: number
}

// GET /api/display              — every screen and channel (the control board)
// GET /api/display?screen=cut1  — one screen, resolved and ready to render
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const screenId = searchParams.get('screen')

  const [{ data: screenData }, { data: channelData }] = await Promise.all([
    supabase.from('display_screens').select('*').order('sort', { ascending: true }),
    supabase.from('display_channels').select('*'),
  ])
  const screens  = (screenData  ?? []) as ScreenRow[]
  const channels = (channelData ?? []) as ChannelRow[]

  if (!screenId) return NextResponse.json({ screens, channels })

  const screen = screens.find(s => s.screen === screenId)
  // An unknown screen is a typo in a browser bar on a machine with no keyboard
  // — say which ones exist rather than leaving a blank TV on the wall.
  if (!screen) {
    return NextResponse.json(
      { error: 'unknown screen', known: screens.map(s => s.screen) },
      { status: 404 },
    )
  }

  const channel = channels.find(c => c.channel === screen.channel) ?? null
  // Just this screen. The TVs poll every few seconds and none of them render
  // the roster — shipping it 17,000 times a day would be for nobody.
  const payload = { screen, channel, card: null as DisplayCard | null, carcass: null as DisplayCarcass | null }

  if (!channel) return NextResponse.json(payload)

  // An animal can be on the table before anyone has linked its card, so the
  // carcass is looked up on its own account — the tag and hanging weight are
  // worth putting on the wall even when the instructions aren't there yet, and
  // a screen that says "Tag 06, no cut card" is a job somebody can go fix.
  const { data: ci } = channel.cutting_instruction_id
    ? await supabase
        .from('cutting_instructions')
        .select('id, data, customer_name, species')
        .eq('id', channel.cutting_instruction_id)
        .maybeSingle()
    : { data: null }

  if (ci?.data) {
    const d = ci.data as Record<string, unknown>
    // v1 cards keep species in data, v2 in the column (see speciesOf on the
    // cutting-instructions page) — the wall must not read "Beef" off a hog.
    const species = String((d.species as string) ?? ci.species ?? 'Beef')
    payload.card = {
      cutting_instruction_id: ci.id as string,
      // The channel's snapshot wins: it is what the person setting the board
      // saw, and the card's own name can be mid-edit in the office.
      customer_name: channel.customer_name || String(ci.customer_name ?? ''),
      species,
      portion: String((d.portion as string) ?? ''),
      sections: buildCutSections(d, species),
      grind_whole: Boolean(d.grindWhole),
      notes: String((d.notes as string) ?? ''),
    }
  }

  if (channel.harvest_log_id) {
    const { data: hl } = await supabase
      .from('harvest_log')
      .select('carcass_tag, species, harvest_date, hot_carcass_weight_lbs')
      .eq('id', channel.harvest_log_id)
      .maybeSingle()
    if (hl) {
      payload.carcass = {
        carcass_tag: String(hl.carcass_tag ?? ''),
        species: String(hl.species ?? ''),
        harvest_date: String(hl.harvest_date ?? ''),
        hot_carcass_weight_lbs: hl.hot_carcass_weight_lbs as number | null,
        days_hanging: hl.harvest_date ? calcDaysHanging(String(hl.harvest_date)) : 0,
      }
    }
  }

  return NextResponse.json(payload)
}

// POST /api/display
//   { action: 'channel', channel, cutting_instruction_id?, harvest_log_id?,
//     customer_name?, session_date?, updated_by? }  — point a channel at an animal
//   { action: 'view',    screen, view }             — change what one TV renders
//
// Clearing is explicit: pass cutting_instruction_id: null to empty a channel.
// An omitted field is left alone, so the scanner can update the kiosk's session
// without having to restate the card it already resolved.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'body required' }, { status: 400 })
  }
  const b = body as Record<string, unknown>

  if (b.action === 'view') {
    const screen = typeof b.screen === 'string' ? b.screen : ''
    const view   = typeof b.view === 'string' ? b.view : ''
    if (!screen || !['primals', 'queue', 'grind', 'split'].includes(view)) {
      return NextResponse.json({ error: 'screen and a known view required' }, { status: 400 })
    }
    const { error } = await supabase
      .from('display_screens')
      .update({ view, updated_at: new Date().toISOString() })
      .eq('screen', screen)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (b.action === 'channel') {
    const channel = typeof b.channel === 'string' ? b.channel : ''
    if (!channel) return NextResponse.json({ error: 'channel required' }, { status: 400 })

    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
      updated_by: typeof b.updated_by === 'string' ? b.updated_by.slice(0, 64) : '',
    }
    // `null` means clear, `undefined` means don't touch — so the two have to be
    // told apart by presence, not by falsiness.
    if ('cutting_instruction_id' in b) patch.cutting_instruction_id = b.cutting_instruction_id ?? null
    if ('harvest_log_id' in b)         patch.harvest_log_id         = b.harvest_log_id ?? null
    if ('customer_name' in b)          patch.customer_name          = String(b.customer_name ?? '').slice(0, 200)
    if ('session_date' in b)           patch.session_date           = b.session_date ?? null

    const { error } = await supabase.from('display_channels').update(patch).eq('channel', channel)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'unknown action' }, { status: 400 })
}
