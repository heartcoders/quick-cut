/**
 * Musik-Lautstärke über die Zeit: Einblenden, Ausblenden am Ende und
 * „Ducking“ (leiser, solange das Voiceover spricht). Alles reine Funktionen,
 * damit Live-Vorschau und Offline-Export dieselbe Kurve bekommen.
 */

export interface Segment {
  start: number
  end: number
}

export interface SpeechOptions {
  /** Fensterlänge für den RMS-Pegel (s) */
  window?: number
  /** so lange nach dem letzten lauten Fenster noch „spricht“ (s) */
  hold?: number
  /** Pausen darunter werden überbrückt (s) */
  mergeGap?: number
  /** absolute Mindestschwelle (RMS) */
  minLevel?: number
  /** Schwelle relativ zum lautesten Fenster */
  relative?: number
}

/** Abschnitte, in denen gesprochen wird (Zeit relativ zum Anfang der Aufnahme). */
export function speechSegments(
  channels: readonly Float32Array[],
  sampleRate: number,
  { window = 0.05, hold = 0.3, mergeGap = 0.4, minLevel = 0.01, relative = 0.15 }: SpeechOptions = {},
): Segment[] {
  const len = channels[0]?.length ?? 0
  if (!len || !sampleRate) return []
  const win = Math.max(1, Math.round(window * sampleRate))
  const levels: number[] = []
  for (let i = 0; i < len; i += win) {
    const end = Math.min(len, i + win)
    let sum = 0
    for (const ch of channels) for (let k = i; k < end; k++) sum += ch[k]! * ch[k]!
    levels.push(Math.sqrt(sum / ((end - i) * channels.length)))
  }
  const peak = Math.max(...levels)
  if (peak < minLevel) return []
  const threshold = Math.max(minLevel, peak * relative)
  const dur = len / sampleRate

  const out: Segment[] = []
  for (const [i, level] of levels.entries()) {
    if (level < threshold) continue
    const start = (i * win) / sampleRate
    const end = Math.min(dur, ((i + 1) * win) / sampleRate + hold)
    const last = out.at(-1)
    if (last && start - last.end < mergeGap) last.end = Math.max(last.end, end)
    else out.push({ start, end })
  }
  return out
}

export interface MusicGainOptions {
  /** Länge des Videos (s) */
  total: number
  volume: number
  /** Einblenden am Anfang (s), 0 = aus */
  fadeIn?: number
  /** am Ende ausblenden */
  fadeOut?: boolean
  /** Sprachabschnitte in Timeline-Zeit; leer/fehlt = kein Ducking */
  segments?: readonly Segment[]
  /** Faktor während des Sprechens */
  duckLevel?: number
  attack?: number
  release?: number
}

/** Ausblenddauer am Ende: 2 s, bei kurzen Videos höchstens ein Viertel. */
export function fadeOutDuration(total: number): number {
  return Math.min(2, total / 4)
}

/** Stützpunkte [Zeit, Gain] der Musik-Lautstärke, linear dazwischen. */
export function musicGainPoints({
  total,
  volume,
  fadeIn = 0,
  fadeOut = false,
  segments = [],
  duckLevel = 0.3,
  attack = 0.15,
  release = 0.5,
}: MusicGainOptions): [number, number][] {
  if (total <= 0) return [[0, 0]]
  const fo = fadeOut ? fadeOutDuration(total) : 0

  const fade = (t: number): number => {
    let f = 1
    if (fadeIn > 0 && t < fadeIn) f = Math.min(f, t / fadeIn)
    if (fo > 0 && t > total - fo) f = Math.min(f, (total - t) / fo)
    return Math.max(0, f)
  }
  const duck = (t: number): number => {
    let f = 1
    for (const s of segments) {
      let g = 1
      if (t >= s.start && t <= s.end) g = duckLevel
      else if (t < s.start && t > s.start - attack) g = 1 - ((1 - duckLevel) * (t - (s.start - attack))) / attack
      else if (t > s.end && t < s.end + release) g = duckLevel + ((1 - duckLevel) * (t - s.end)) / release
      f = Math.min(f, g)
    }
    return f
  }

  const times = new Set<number>([0, total])
  if (fadeIn > 0) times.add(Math.min(total, fadeIn))
  if (fo > 0) times.add(total - fo)
  for (const s of segments) for (const t of [s.start - attack, s.start, s.end, s.end + release]) times.add(t)
  return [...times]
    .filter((t) => t >= 0 && t <= total)
    .sort((a, b) => a - b)
    .map((t) => [t, volume * fade(t) * duck(t)])
}

/** Gain zur Zeit t (linear zwischen den Stützpunkten, außen konstant). */
export function gainAt(points: readonly [number, number][], t: number): number {
  if (points.length === 0) return 0
  if (t <= points[0]![0]) return points[0]![1]
  for (let i = 1; i < points.length; i++) {
    const [t1, v1] = points[i]!
    if (t <= t1) {
      const [t0, v0] = points[i - 1]!
      return t1 === t0 ? v1 : v0 + ((v1 - v0) * (t - t0)) / (t1 - t0)
    }
  }
  return points.at(-1)![1]
}
