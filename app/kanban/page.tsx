'use client'
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import type { Item, Signal, Vendor } from '@/lib/kanban'
import { C, Banner, KanbanHeader, WhoField, useWho } from './ui'
import BoardTab from './BoardTab'
import OrderSheetTab from './OrderSheetTab'
import CardsTab from './CardsTab'
import VendorsTab from './VendorsTab'
import HealthTab from './HealthTab'

// ══════════════════════════════════════════════════════════════════════════════
// KANBAN ORDERING
//
// Charlie, 2026-09-27: "build my whole Kanban system for ordering — price,
// vendor info, ordering info, lead times and anything else lean manufacturing
// calls for."
//
//   Board        the loop at a glance: pulled → on order → received, and
//                everything still sitting full on the shelf
//   Order sheet  pulled cards grouped by vendor — one call, one email, one PO
//   Cards        the card catalog: what one card orders, where it lives,
//                price, vendor, lead time, sizing
//   Vendors      who we buy from and how they take an order
//   Health       is the loop working: stockouts, actual vs planned lead time,
//                on-time %, spend, cards sized wrong
// ══════════════════════════════════════════════════════════════════════════════

export interface KanbanData { items: Item[]; vendors: Vendor[]; signals: Signal[] }
export interface TabProps {
  data: KanbanData
  who: string
  reload: () => Promise<void>
  setError: (e: string | null) => void
}

const TABS = [
  { key: 'board',   label: 'Board' },
  { key: 'order',   label: 'Order sheet' },
  { key: 'cards',   label: 'Cards' },
  { key: 'vendors', label: 'Vendors' },
  { key: 'health',  label: 'Health' },
] as const
type TabKey = typeof TABS[number]['key']

const TAB_KEY = 'kanbanTab'

export default function KanbanPage() {
  const [who, setWho] = useWho()
  const [tab, setTabState] = useState<TabKey>('board')
  const [data, setData] = useState<KanbanData | null>(null)
  const [error, setError] = useState<string | null>(null)

  const setTab = (t: TabKey) => {
    setTabState(t)
    try { localStorage.setItem(TAB_KEY, t) } catch { /* private browsing */ }
  }

  const reload = useCallback(async () => {
    try {
      const res = await fetch('/api/kanban?all=1', { cache: 'no-store' })
      const body = await res.json()
      if (!res.ok) { setError(body?.error ?? 'Could not load the board'); return }
      setData(body)
    } catch {
      setError('No signal — could not load the board.')
    }
  }, [])

  useEffect(() => {
    let saved: string | null = null
    try { saved = localStorage.getItem(TAB_KEY) } catch { /* private browsing */ }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- restoring a remembered tab after mount; reading it during render would mismatch the server HTML
    if (saved && TABS.some(t => t.key === saved)) setTabState(saved as TabKey)
    reload()
  }, [reload])

  const pulled = data?.signals.filter(s => s.status === 'pulled').length ?? 0
  const tabProps: TabProps | null = data ? { data, who, reload, setError } : null

  return (
    <div style={{ minHeight: '100vh', background: C.darkBrown, paddingBottom: 60 }}>
      <KanbanHeader
        title="Supplies"
        right={
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Link href="/kanban/print" style={{ color: C.tan, fontSize: 13, textDecoration: 'none', border: `1px solid ${C.medBrown}`, borderRadius: 8, padding: '9px 12px' }}>
              🖨 Print cards
            </Link>
            <WhoField who={who} setWho={setWho} />
          </div>
        }
      />

      <nav style={{ display: 'flex', gap: 4, padding: '10px 16px 0', overflowX: 'auto', borderBottom: `1px solid ${C.medBrown}`, background: C.dark }}>
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              background: tab === t.key ? C.darkBrown : 'transparent',
              borderTop: `1px solid ${tab === t.key ? C.medBrown : 'transparent'}`,
              borderLeft: `1px solid ${tab === t.key ? C.medBrown : 'transparent'}`,
              borderRight: `1px solid ${tab === t.key ? C.medBrown : 'transparent'}`,
              borderBottom: 'none', borderRadius: '8px 8px 0 0',
              color: tab === t.key ? C.cream : C.tan, fontSize: 15, fontWeight: 600,
              padding: '10px 16px', cursor: 'pointer', whiteSpace: 'nowrap',
            }}
          >
            {t.label}
            {t.key === 'order' && pulled > 0 && (
              <span style={{ marginLeft: 6, background: C.amber, color: C.dark, borderRadius: 99, fontSize: 11, padding: '1px 7px', fontWeight: 800 }}>
                {pulled}
              </span>
            )}
          </button>
        ))}
      </nav>

      <main style={{ padding: 16, maxWidth: 1400, margin: '0 auto' }}>
        {error && (
          <div onClick={() => setError(null)} style={{ cursor: 'pointer' }}>
            <Banner tone="error">{error} <span style={{ color: C.tan, fontSize: 12 }}>(tap to dismiss)</span></Banner>
          </div>
        )}
        {!who.trim() && (
          <Banner tone="info">Type your name in the top corner — every pull, order and receipt gets stamped with it.</Banner>
        )}
        {!tabProps && !error && <p style={{ color: C.tan }}>Loading…</p>}
        {tabProps && tab === 'board'   && <BoardTab {...tabProps} goOrder={() => setTab('order')} />}
        {tabProps && tab === 'order'   && <OrderSheetTab {...tabProps} />}
        {tabProps && tab === 'cards'   && <CardsTab {...tabProps} />}
        {tabProps && tab === 'vendors' && <VendorsTab {...tabProps} />}
        {tabProps && tab === 'health'  && <HealthTab {...tabProps} />}
      </main>
    </div>
  )
}
