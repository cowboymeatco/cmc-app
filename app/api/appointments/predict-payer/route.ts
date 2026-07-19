export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

// GET /api/appointments/predict-payer?customer=NAME&producer=NAME
//
// Predicts payment_responsibility for a new appointment portion from history.
// The customer's own past portions win (Art's Tires always pays for their
// own beef), falling back to the pattern across the producer's customers
// (everyone on Bob Gray's appointments is producer-paid).
//
// Only explicit payment_responsibility values vote. Records saved before the
// field existed read as producer-pays for billing, but they say nothing about
// intent — counting them would drown out the real pattern.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const customer = searchParams.get('customer')?.trim().toLowerCase() ?? ''
  const producer = searchParams.get('producer')?.trim().toLowerCase() ?? ''
  if (!customer && !producer) return NextResponse.json({ prediction: null, basis: null, samples: 0 })

  // Names are free-ish text (case varies), so matching happens here rather
  // than in a jsonb containment filter. ~200 rows — a full read is cheap.
  const { data, error } = await supabase
    .from('harvest_appointments')
    .select('source, customers')
    .limit(2000)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const customerVotes = { producer: 0, customer: 0 }
  const producerVotes = { producer: 0, customer: 0 }
  for (const row of data ?? []) {
    const rowSource = typeof row.source === 'string' ? row.source.trim().toLowerCase() : ''
    const entries = Array.isArray(row.customers) ? row.customers : []
    for (const c of entries) {
      const raw = c?.payment_responsibility
      const pays: 'producer' | 'customer' | null = raw === 'producer' ? 'producer' : raw === 'customer' ? 'customer' : null
      if (!pays) continue
      const name = typeof c?.customer_name === 'string' ? c.customer_name.trim().toLowerCase() : ''
      if (customer && name && name === customer) customerVotes[pays]++
      if (producer && rowSource && rowSource === producer) producerVotes[pays]++
    }
  }

  const decide = (v: { producer: number; customer: number }) =>
    v.producer === v.customer ? null : v.producer > v.customer ? ('producer' as const) : ('customer' as const)

  const fromCustomer = decide(customerVotes)
  if (fromCustomer) {
    return NextResponse.json({ prediction: fromCustomer, basis: 'customer', samples: customerVotes.producer + customerVotes.customer })
  }
  const fromProducer = decide(producerVotes)
  if (fromProducer) {
    return NextResponse.json({ prediction: fromProducer, basis: 'producer', samples: producerVotes.producer + producerVotes.customer })
  }
  return NextResponse.json({ prediction: null, basis: null, samples: 0 })
}
