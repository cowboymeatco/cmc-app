'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import type { GameIntake } from '@/lib/types'
import { isGameTagNumber } from '@/lib/types'
import BoardTab from './BoardTab'
import IntakeTab from './IntakeTab'
import SeasonTab from './SeasonTab'
import PricingTab from './PricingTab'
import GameDetail from './GameDetail'
import { C, INPUT, BTN } from './ui'

type Tab = 'board' | 'intake' | 'season' | 'pricing'

export default function GamePage() {
  const [tab, setTab]         = useState<Tab>('board')
  const [intakes, setIntakes] = useState<GameIntake[]>([])
  const [loading, setLoading] = useState(true)
  const [openId, setOpenId]   = useState<string | null>(null)
  const [scan, setScan]       = useState('')
  const [scanErr, setScanErr] = useState('')
  const scanRef = useRef<HTMLInputElement>(null)

  const load = useCallback(() =>
    fetch('/api/game?active=1')
      .then(r => r.json())
      .then(d => setIntakes(Array.isArray(d) ? d : []))
      .catch(() => { /* board just stays as it was */ })
      .finally(() => setLoading(false)),
  [])

  useEffect(() => { load() }, [load])

  // A claim tag scanned anywhere on this page opens that animal. The tag shape
  // (WG-26-0014) is unique in the plant, so a scan needs no mode switch — the
  // box is always listening and the crew never has to aim at it.
  async function handleScan(raw: string) {
    const code = raw.trim()
    if (!code) return
    setScanErr('')
    if (!isGameTagNumber(code)) {
      setScanErr(`${code} is not a game claim tag.`)
      setScan('')
      return
    }
    const res = await fetch(`/api/game?tag=${encodeURIComponent(code.toUpperCase())}`)
    const found = res.ok ? await res.json() : null
    setScan('')
    if (found?.id) { setOpenId(found.id); setTab('board') }
    else setScanErr(`${code} is not on the board.`)
  }

  const active = intakes.length
  const ready  = intakes.filter(i => i.status === 'freezer').length
  const uncalled = intakes.filter(i => i.status === 'freezer' && !i.notified_at).length

  return (
    <div style={{ minHeight: '100vh', background: C.darkBrown, display: 'flex', flexDirection: 'column' }}>

      <header style={{
        background: C.dark, borderBottom: '1px solid rgba(166,120,90,0.3)',
        padding: '0 2rem', minHeight: 72, display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
          <Link href="/" style={{ color: C.lightBrown, textDecoration: 'none', fontSize: '1.2rem' }}>←</Link>
          <div>
            <h1 style={{
              fontFamily: 'Georgia, serif', fontSize: '1.25rem', fontWeight: 700, color: C.cream,
              letterSpacing: '0.08em', textTransform: 'uppercase', margin: 0,
            }}>
              Wild Game
            </h1>
            <p style={{
              fontSize: '0.68rem', color: C.lightBrown, letterSpacing: '0.15em',
              textTransform: 'uppercase', margin: 0,
            }}>
              Hunter drop-off · Not for sale
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '0.72rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
              In the building
            </div>
            <div style={{ fontSize: '1.1rem', color: C.cream, fontWeight: 700 }}>
              {active}
              {ready > 0 && <span style={{ color: C.green, fontSize: '0.85rem', fontWeight: 500 }}> · {ready} in freezer</span>}
              {uncalled > 0 && <span style={{ color: C.yellow, fontSize: '0.85rem', fontWeight: 500 }}> · {uncalled} not called</span>}
            </div>
          </div>
          <div>
            <input
              ref={scanRef} value={scan}
              onChange={e => setScan(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleScan(scan) }}
              placeholder="Scan claim tag…"
              style={{ ...INPUT, width: 190, fontFamily: 'monospace' }}
            />
            {scanErr && <div style={{ fontSize: '0.68rem', color: C.red, marginTop: '0.2rem' }}>{scanErr}</div>}
          </div>
        </div>
      </header>

      {/* Tabs */}
      <div style={{
        background: C.dark, borderBottom: '1px solid rgba(166,120,90,0.2)',
        padding: '0 2rem', display: 'flex', gap: '0.25rem',
      }}>
        {([['board', 'Board'], ['intake', 'Take one in'], ['season', 'Season'], ['pricing', 'Pricing']] as const).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            style={{
              ...BTN('transparent', tab === k ? C.cream : C.lightBrown),
              padding: '0.75rem 1.1rem', fontSize: '0.85rem', borderRadius: 0,
              borderBottom: tab === k ? `2px solid ${C.tan}` : '2px solid transparent',
              fontWeight: tab === k ? 700 : 500,
            }}>
            {label}
          </button>
        ))}
      </div>

      <main style={{ flex: 1, padding: '1.5rem 2rem 4rem', maxWidth: 1600, width: '100%', margin: '0 auto', boxSizing: 'border-box' }}>
        {tab === 'board' && (
          <BoardTab intakes={intakes} loading={loading} onOpen={setOpenId} onRefresh={load} />
        )}
        {tab === 'intake' && (
          <IntakeTab onSaved={() => load()} />
        )}
        {tab === 'season'  && <SeasonTab />}
        {tab === 'pricing' && <PricingTab />}
      </main>

      {openId && (
        <GameDetail id={openId} onClose={() => setOpenId(null)} onChanged={load} />
      )}
    </div>
  )
}
