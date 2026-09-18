/** Reorder `items` to follow `ids`. Unknown ids ignored; missing items appended. */
export function reorderByIds<T extends { id: string }>(items: T[], ids: readonly string[]): T[] {
  const map = new Map(items.map((item) => [item.id, item]))
  const next: T[] = []
  const seen = new Set<string>()
  for (const id of ids) {
    if (seen.has(id)) continue
    const item = map.get(id)
    if (!item) continue
    next.push(item)
    seen.add(id)
  }
  if (next.length === 0) return items
  for (const item of items) {
    if (!seen.has(item.id)) next.push(item)
  }
  return next
}

/** Move `fromId` before/after `toId`. Identity when ids match or are missing. */
export function moveId(
  ids: readonly string[],
  fromId: string,
  toId: string,
  place: 'before' | 'after'
): string[] {
  if (fromId === toId) return [...ids]
  const from = ids.indexOf(fromId)
  const to = ids.indexOf(toId)
  if (from < 0 || to < 0) return [...ids]
  const next = ids.filter((id) => id !== fromId)
  let insert = next.indexOf(toId)
  if (insert < 0) return [...ids]
  if (place === 'after') insert++
  next.splice(insert, 0, fromId)
  return next
}
