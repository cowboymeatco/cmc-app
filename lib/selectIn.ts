// Ask for a long list of ids in batches, because PostgREST puts them in the URL.
//
// `.in('col', ids)` becomes `?col=in.(uuid,uuid,...)` on a GET, and the request
// line is capped at 16 KB. A uuid costs 39 bytes with its comma, so the cap
// lands at roughly 415 ids — and then the call doesn't come back as a tidy
// PostgREST error, it throws `TypeError: fetch failed` from under the client,
// which reads like the database is down.
//
// That is exactly what happened to /api/exec/revenue (Charlie, 2026-09-21).
// Its 120-day lookback crossed 400 carcasses and the whole revenue panel
// started 500ing: 386 ids answered fine, 414 blew up. Nobody changed the code
// — the plant just killed more animals. Anything that feeds `.in()` from a
// date window has the same fuse burning.
//
// 150 keeps each request near 6 KB, well inside the cap with room for the rest
// of the query string.
export const IN_BATCH = 150

interface Result<T> { data: T[] | null; error: { message: string } | null }

/** Run `query` once per batch of ids and concatenate the rows. An empty list
 *  asks nothing at all rather than sending `in.()`. */
export async function selectIn<T>(
  ids: string[],
  query: (batch: string[]) => PromiseLike<Result<T>>,
  batchSize: number = IN_BATCH,
): Promise<T[]> {
  if (!ids.length) return []
  const batches: string[][] = []
  for (let i = 0; i < ids.length; i += batchSize) batches.push(ids.slice(i, i + batchSize))

  const results = await Promise.all(batches.map(b => query(b)))
  const out: T[] = []
  for (const r of results) {
    if (r.error) throw new Error(r.error.message)
    if (r.data) out.push(...r.data)
  }
  return out
}
