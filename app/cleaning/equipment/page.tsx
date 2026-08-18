'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { C, TAP, CleaningHeader, cardStyle } from '../ui'

// Browse equipment by area — the way someone standing in front of a machine
// finds its procedure. No QR tags needed; those can come later and land on the
// same screens.

interface Equip { id: string; name: string; make_model: string | null; active: boolean }
interface Area  { id: string; name: string; cleaning_equipment: Equip[] }

export default function EquipmentBrowser() {
  const [areas, setAreas]     = useState<Area[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen]       = useState<Set<string>>(new Set())

  useEffect(() => {
    fetch('/api/cleaning/areas')
      .then(r => r.json())
      .then(d => {
        const rows: Area[] = Array.isArray(d) ? d : []
        setAreas(rows)
        // One area with equipment? Open it — no reason to make them tap.
        const withKit = rows.filter(a => a.cleaning_equipment.length > 0)
        if (withKit.length === 1) setOpen(new Set([withKit[0].id]))
      })
      .catch(() => setAreas([]))
      .finally(() => setLoading(false))
  }, [])

  const total = areas.reduce((n, a) => n + a.cleaning_equipment.length, 0)

  return (
    <div style={{ paddingBottom: 60 }}>
      <CleaningHeader title="Equipment" back="/cleaning" />

      <div style={{ padding: 16, maxWidth: 720, margin: '0 auto' }}>
        {loading && <p style={{ color: C.tan }}>Loading…</p>}

        {!loading && total === 0 && (
          <div style={{ ...cardStyle, textAlign: 'center' }}>
            <div style={{ fontSize: 32, marginBottom: 10 }}>🔧</div>
            <p style={{ color: C.cream, fontSize: 16, marginBottom: 8 }}>
              No equipment written up yet
            </p>
            <p style={{ color: C.tan, fontSize: 14, marginBottom: 16, lineHeight: 1.5 }}>
              Add a machine and its teardown steps, and it shows up here for the crew.
              Photos of how the parts go back together are the most useful thing you
              can put on it.
            </p>
            <Link
              href="/cleaning/admin"
              style={{
                display: 'inline-block', background: C.medBrown, color: C.cream,
                padding: '12px 20px', borderRadius: 8, textDecoration: 'none',
                fontSize: 15, fontWeight: 700,
              }}
            >
              Add equipment
            </Link>
          </div>
        )}

        {areas.filter(a => a.cleaning_equipment.length > 0).map(area => {
          const isOpen = open.has(area.id)
          return (
            <div key={area.id} style={{ marginBottom: 10 }}>
              <button
                onClick={() => setOpen(prev => {
                  const next = new Set(prev)
                  if (next.has(area.id)) next.delete(area.id); else next.add(area.id)
                  return next
                })}
                style={{
                  width: '100%', minHeight: TAP, background: C.dark,
                  border: `1px solid ${C.medBrown}`, borderRadius: 10,
                  color: C.cream, padding: '10px 14px', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left',
                }}
              >
                <span style={{ color: C.tan }}>{isOpen ? '▾' : '▸'}</span>
                <span style={{ flex: 1, fontSize: 16, fontWeight: 700 }}>{area.name}</span>
                <span style={{ color: C.tan, fontSize: 13 }}>
                  {area.cleaning_equipment.length}
                </span>
              </button>

              {isOpen && (
                <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {area.cleaning_equipment.map(e => (
                    <Link
                      key={e.id}
                      href={`/cleaning/equipment/${e.id}`}
                      style={{ textDecoration: 'none' }}
                    >
                      <div style={{
                        ...cardStyle, minHeight: TAP, display: 'flex',
                        alignItems: 'center', gap: 12,
                      }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ color: C.cream, fontSize: 16, fontWeight: 600 }}>
                            {e.name}
                          </div>
                          {e.make_model && (
                            <div style={{ color: C.tan, fontSize: 12 }}>{e.make_model}</div>
                          )}
                        </div>
                        <span style={{ color: C.tan, fontSize: 22 }}>›</span>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
