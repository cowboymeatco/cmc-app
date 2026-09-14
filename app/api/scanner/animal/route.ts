export const runtime = 'edge'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { coolerAnimals, resolveAnimal } from '@/lib/sessionLinks'
import { isoDate } from '@/lib/dates'

// GET /api/scanner/animal?code=26252-653        → the animal behind a carcass tag or CI- card code
// GET /api/scanner/animal?cooler=1&date=YYYY-MM-DD → what's hanging, today's cut schedule first
//
// Feeds New Session on /scanner: start from the animal, and the name follows
// (lib/sessionLinks.ts).
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams
  if (q.get('cooler')) {
    return NextResponse.json({ animals: await coolerAnimals(q.get('date') || isoDate()) })
  }
  const code = q.get('code')
  if (!code) return NextResponse.json({ error: 'code required' }, { status: 400 })
  return NextResponse.json(await resolveAnimal(code))
}
