// PLUs that are the same product to the scanner.
//
// Charlie, 2026-10-28: "Why is the ground beef not syncing on Roberts order?"
// The order line said PLU 204 (85% Lean Ground Beef) and the six packages in
// his box said PLU 100 (Ground Beef). Both are ground beef. 204 is a Clover
// price group — a register item that exists so the till can charge a lean
// ratio — and it never prints on the Hobart scale, so no label will ever
// carry it. The scan-to-order match keyed on the raw PLU, 100 ≠ 204, and the
// line sat at zero while the meat sat in the box.
//
// Each group below is "a scan of any of these fills a line for any of these".
// Match on pluMatchKey() instead of the raw number and the register-only PLUs
// resolve to the scale PLU the crew actually scans.
//
// The register-only PLUs are also kept out of the order-entry picker (see
// isRegisterOnlyPlu), so new orders pick the scale PLU to begin with; the
// alias is for the lines already written and for anyone who types the number.

const ALIAS_GROUPS: string[][] = [
  // The scale labels every lean ratio as plain GROUND BEEF; the ratio PLUs
  // (80/20, 70/30, 85/15) are Clover price groups.
  ['100', '202', '203', '204'],
  // GROUND BEEF PATTIES at the register; the scale prints the stack/box PLU.
  ['205', '168', '169', '170', '171', '172', '173', '195', '196'],
]

const KEY_OF = new Map<string, string>()
for (const group of ALIAS_GROUPS) {
  const key = `alias:${group[0]}`
  for (const plu of group) KEY_OF.set(plu, key)
}

/** The key two PLUs must share to count as the same product on an order.
 *  A PLU with no alias is its own key; null/empty stays ''. */
export function pluMatchKey(plu: string | null | undefined): string {
  const p = (plu ?? '').trim()
  if (!p) return ''
  return KEY_OF.get(p) ?? p
}

/** A PLU that lives only on the register (a Clover price group), never on the
 *  scale. Nothing the crew scans will carry its number, so it should not be
 *  offered when a line is put on a retail order. */
export function isRegisterOnlyPlu(p: { raw_data?: unknown }): boolean {
  const raw = p.raw_data
  if (!raw || typeof raw !== 'object') return false
  return (raw as { created_by?: unknown }).created_by === 'clover-price-groups'
}
