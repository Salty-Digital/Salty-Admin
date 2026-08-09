/**
 * Server-side, in-memory row sorting for fully-loaded (non-paginated) tables that pair
 * with the URL-driven <SortLink> header. Reads `sort`/`dir` from the page's searchParams;
 * when no known sort key is set, falls back to `fallback` (typically newest-first).
 * Nulls always sort last; strings compare numerically-aware.
 */
export type SortAccessors<T> = Record<string, (row: T) => string | number | null | undefined>

export function sortRows<T>(
  rows: T[],
  accessors: SortAccessors<T>,
  sort: string,
  dir: string,
  fallback?: (row: T) => number,
): T[] {
  const acc = accessors[sort]
  if (!acc) {
    return fallback ? [...rows].sort((a, b) => fallback(b) - fallback(a)) : rows
  }
  const m = dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const x = acc(a)
    const y = acc(b)
    if (x == null && y == null) return 0
    if (x == null) return 1
    if (y == null) return -1
    if (typeof x === 'number' && typeof y === 'number') return (x - y) * m
    return String(x).localeCompare(String(y), undefined, { numeric: true }) * m
  })
}
