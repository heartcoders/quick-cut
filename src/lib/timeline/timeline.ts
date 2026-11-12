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

export type TransitionType = 'none' | 'crossfade' | 'slide' | 'wipe'

export interface TransitionSpec {
  type: TransitionType
  duration: number
}

/** Ein Übergang darf höchstens halb so lang sein wie der kürzere der beiden Clips. */
export function maxTransition(a: TrimmedClip, b: TrimmedClip): number {
  return Math.floor((Math.min(trimmedLength(a), trimmedLength(b)) / 2) * 100) / 100
}

/** Tatsächliche Übergangsdauern (Länge n−1): 'none' → 0, sonst auf das Maximum begrenzt. */
export function effectiveDurations(
  clips: readonly TrimmedClip[],
  transitions: readonly TransitionSpec[] = [],
): number[] {
  const out: number[] = []
  for (let i = 0; i < clips.length - 1; i++) {
    const tr = transitions[i]
    if (!tr || tr.type === 'none' || tr.duration <= 0) out.push(0)
    else out.push(Math.min(tr.duration, maxTransition(clips[i]!, clips[i + 1]!)))
  }
  return out
}

/** Summe der getrimmten Längen minus Summe der Übergangsdauern. */
export function totalDuration(
  clips: readonly TrimmedClip[],
  transitions: readonly TransitionSpec[] = [],
): number {
  const sum = clips.reduce((s, c) => s + trimmedLength(c), 0)
  const overlap = effectiveDurations(clips, transitions).reduce((s, d) => s + d, 0)
  return round2(sum - overlap)
}

/** Startzeit jedes Clips in der Gesamt-Timeline (Übergänge überlappen). */
export function clipStartTimes(
  clips: readonly TrimmedClip[],
  transitions: readonly TransitionSpec[] = [],
): number[] {
  const d = effectiveDurations(clips, transitions)
  const out: number[] = []
  let t = 0
  for (const [i, c] of clips.entries()) {
    out.push(t)
    t += trimmedLength(c) - (d[i] ?? 0)
  }
  return out
}

export interface FrameAt {
  from: { index: number; localTime: number }
  /** Nur während eines Übergangs gesetzt. */
  to?: { index: number; localTime: number }
  /** Fortschritt des Übergangs 0…1 (0 ohne Übergang). */
  p: number
  type: TransitionType
}

/**
 * Was ist zur Gesamtzeit t zu sehen? Liegt t in einem Übergang,
 * sind zwei Clips aktiv plus Fortschritt p.
 */
export function resolveFrame(
  clips: readonly TrimmedClip[],
  transitions: readonly TransitionSpec[],
  t: number,
): FrameAt | null {
  if (clips.length === 0 || t < 0) return null
  const d = effectiveDurations(clips, transitions)
  const starts = clipStartTimes(clips, transitions)
  for (const [i, c] of clips.entries()) {
    const start = starts[i]!
    const end = start + trimmedLength(c)
    if (t >= end) continue
    const from = { index: i, localTime: c.trimStart + (t - start) }
    const di = d[i] ?? 0
    if (di > 0 && t >= end - di) {
      const next = clips[i + 1]!
      const p = clamp((t - (end - di)) / di, 0, 1)
      return {
        from,
        to: { index: i + 1, localTime: next.trimStart + (t - starts[i + 1]!) },
        p,
        type: transitions[i]!.type,
      }
    }
    return { from, p: 0, type: 'none' }
  }
  const total = totalDuration(clips, transitions)
  if (t <= total + 1e-9) {
    const index = clips.length - 1
    return { from: { index, localTime: clips[index]!.trimEnd }, p: 0, type: 'none' }
  }
  return null
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

/** Equal-Power-Überblendung: Lautheit bleibt im Übergang konstant. [alt, neu] */
export function equalPowerGains(p: number): [number, number] {
  const x = (clamp(p, 0, 1) * Math.PI) / 2
  return [Math.cos(x), Math.sin(x)]
}
