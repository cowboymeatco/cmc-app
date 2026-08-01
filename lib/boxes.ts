import { supabase } from '@/lib/supabase'
import { isoDate } from '@/lib/dates'

// A box serial is CMC + YYMMDD + 4 random base-36 chars — about 1.7M per day.
// That is unlikely to collide but not rare enough to ignore at a few hundred
// boxes a day, and boxes_serial_number_unique_idx now rejects a repeat outright
// (case-insensitively, to match the ILIKE lookups that resolve it).
export const newBoxSerial = () =>
  `CMC${isoDate().slice(2).replace(/-/g, '')}${Math.random().toString(36).substring(2, 6).toUpperCase()}`

export interface NewBox {
  customer_name: string
  pack_date:     string
  box_number:    number
  is_final?:     boolean
  box_label?:    string | null
  serial_number?: string | null   // supplied serials are taken at their word
}

export type CreateBoxResult =
  | { box: Record<string, unknown>; error?: undefined }
  | { box?: undefined; error: string; status: number }

// Insert a box, redrawing the serial if it collides, so a packer never gets
// handed a failed box over a coin-flip. A caller-supplied serial is never
// redrawn — if that one is taken, that is a real conflict worth reporting.
export async function createBox(row: NewBox, attempts = 5): Promise<CreateBoxResult> {
  const { serial_number, ...rest } = row
  const fixed = typeof serial_number === 'string' && serial_number ? serial_number : null

  for (let i = 0; i < attempts; i++) {
    const { data, error } = await supabase
      .from('boxes')
      .insert([{ ...rest, is_closed: false, is_final: rest.is_final ?? false, serial_number: fixed ?? newBoxSerial() }])
      .select()
      .single()

    if (!error) return { box: data }
    // 23505 = unique_violation
    if (error.code !== '23505' || fixed) {
      return { error: error.message, status: error.code === '23505' ? 409 : 500 }
    }
  }
  return { error: 'Could not mint a unique box serial — try again.', status: 500 }
}
