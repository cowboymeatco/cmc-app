export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { generateLabel, DEFAULT_FLAGS, LabelFlags, BoxRecord, BoxScan } from '@/lib/label'
import { generateCMBLabel } from '@/lib/labelCMB'

// Central Montana Beef cases get their US Foods label (4x6, GTIN barcode)
// instead of the standard CMC box label. Sessions are named "CMB", "CMB 26181",
// "CMB Grind All", etc. Override per-print with ?format=std or ?format=cmb.
const isCMBCustomer = (name: string) => /^\s*(cmb\b|central\s+montana)/i.test(name || '')

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const box_id = searchParams.get('box_id')
  if (!box_id) return NextResponse.json({ error: 'box_id required' }, { status: 400 })

  const flags: LabelFlags = {
    usda_bug:      searchParams.get('usda')    !== '0',
    retail_exempt: searchParams.get('exempt')  === '1',
    not_for_sale:  searchParams.get('nfs')     === '1',
  }

  const [boxRes, scansRes] = await Promise.all([
    supabase.from('boxes').select('*').eq('id', box_id).single(),
    supabase.from('box_scans').select('*').eq('box_id', box_id),
  ])

  if (boxRes.error)   return NextResponse.json({ error: boxRes.error.message },   { status: 500 })
  if (scansRes.error) return NextResponse.json({ error: scansRes.error.message }, { status: 500 })

  const box   = boxRes.data   as BoxRecord
  const scans = scansRes.data as BoxScan[]

  const format = searchParams.get('format')
  const useCMB = format === 'cmb' || (isCMBCustomer(box.customer_name) && format !== 'std')
  const html   = useCMB
    ? generateCMBLabel(box, scans, { productGtin: searchParams.get('product'), lot: searchParams.get('lot') })
    : generateLabel(box, scans, flags)

  return new NextResponse(html, {
    headers: {
      'Content-Type': 'text/html;charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}
