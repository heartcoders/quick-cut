/** Verschiebt ein Element (immutabel). */
export function arrayMove<T>(arr: readonly T[], from: number, to: number): T[] {
  const out = arr.slice()
  if (from === to || from < 0 || from >= arr.length) return out
  const [item] = out.splice(from, 1)
  out.splice(Math.max(0, Math.min(to, out.length)), 0, item as T)
  return out
}

/**
 * Zielposition beim Ziehen: Anzahl der *anderen* Kacheln, deren Mitte links
 * vom Finger liegt. `centers` sind die Mittelpunkte in Ruhelage.
 */
export function targetIndex(pointerX: number, centers: readonly number[], fromIndex: number): number {
  let n = 0
  for (const [i, c] of centers.entries()) {
    if (i !== fromIndex && c < pointerX) n++
  }
  return n
}
