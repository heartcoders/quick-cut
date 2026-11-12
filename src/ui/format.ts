/** 7.3 → "0:07", 75 → "1:15" */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** Kurze Dauer für Clip-Kacheln: 3.46 → "3,5 s", 75 → "1:15" */
export function formatShort(seconds: number): string {
  return seconds < 60 ? `${seconds.toFixed(1).replace('.', ',')} s` : formatClock(seconds)
}

/** Zehntelgenau: 3.46 → "3,5 s", 63.4 → "1:03,4" */
export function formatPrecise(seconds: number): string {
  const s = Math.max(0, Math.round(seconds * 10) / 10)
  if (s < 60) return `${s.toFixed(1).replace('.', ',')} s`
  const m = Math.floor(s / 60)
  const rest = (s - m * 60).toFixed(1).replace('.', ',').padStart(4, '0')
  return `${m}:${rest}`
}
