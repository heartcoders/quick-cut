/** Reine Zeitberechnung – ohne DOM, ohne Store. */

export interface TrimmedClip {
  duration: number
  trimStart: number
  trimEnd: number
}

export const MIN_TRIM_SECONDS = 0.5

export function round2(t: number): number {
  return Math.round(t * 100) / 100
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

export function trimmedLength(c: TrimmedClip): number {
  return Math.max(0, c.trimEnd - c.trimStart)
}

/** Gesamtdauer ohne Übergänge (die kommen in Phase 6 dazu). */
export function totalDuration(clips: readonly TrimmedClip[]): number {
  return round2(clips.reduce((sum, c) => sum + trimmedLength(c), 0))
}

/** Startzeit jedes Clips in der Gesamt-Timeline. */
export function clipStartTimes(clips: readonly TrimmedClip[]): number[] {
  const out: number[] = []
  let t = 0
  for (const c of clips) {
    out.push(t)
    t += trimmedLength(c)
  }
  return out
}

/**
 * Welcher Clip ist zur Gesamtzeit t aktiv, und welche Zeit gilt darin?
 * An einer Grenze gehört t zum folgenden Clip; t == Gesamtdauer → letzter Clip am Ende.
 */
export function resolve(
  clips: readonly TrimmedClip[],
  t: number,
): { index: number; localTime: number } | null {
  if (clips.length === 0 || t < 0) return null
  let start = 0
  for (const [index, c] of clips.entries()) {
    const len = trimmedLength(c)
    if (t < start + len) return { index, localTime: c.trimStart + (t - start) }
    start += len
  }
  if (t <= start + 1e-9) {
    const index = clips.length - 1
    return { index, localTime: clips[index]!.trimEnd }
  }
  return null
}

export function pxToTime(x: number, width: number, duration: number): number {
  if (width <= 0 || duration <= 0) return 0
  return clamp((x / width) * duration, 0, duration)
}

export function timeToPx(t: number, width: number, duration: number): number {
  if (duration <= 0) return 0
  return clamp((t / duration) * width, 0, width)
}

export type Handle = 'start' | 'end'

/**
 * Bewegt einen Trim-Griff auf t. Griffe überkreuzen sich nicht, Mindestlänge
 * bleibt erhalten. `hitLimit` meldet, ob t begrenzt werden musste.
 */
export function moveHandle(
  clip: TrimmedClip,
  handle: Handle,
  t: number,
  minLen = MIN_TRIM_SECONDS,
): { trimStart: number; trimEnd: number; hitLimit: boolean } {
  const min = Math.min(minLen, clip.duration)
  if (handle === 'start') {
    const hi = Math.max(0, clip.trimEnd - min)
    const v = round2(clamp(t, 0, hi))
    return { trimStart: v, trimEnd: clip.trimEnd, hitLimit: t <= 0 || t >= hi }
  }
  const lo = Math.min(clip.duration, clip.trimStart + min)
  const v = round2(clamp(t, lo, clip.duration))
  return { trimStart: clip.trimStart, trimEnd: v, hitLimit: t >= clip.duration || t <= lo }
}
