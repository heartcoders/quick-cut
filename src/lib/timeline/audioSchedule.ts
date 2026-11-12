import { gainAt, musicGainPoints, speechSegments, type Segment } from './ducking'
import {
  clipStartTimes,
  effectiveDurations,
  equalPowerGains,
  totalDuration,
  trimmedLength,
  type TransitionSpec,
  type TrimmedClip,
} from './timeline'

/** Minimal benötigter Teil eines (Offline)AudioContext – erleichtert Tests. */
export interface AudioCtxLike {
  readonly currentTime: number
  createBufferSource(): AudioBufferSourceNode
  createGain(): GainNode
}

export interface ScheduleOptions {
  /** Timeline-Zeit, ab der gespielt wird (z. B. Übergangs-Vorschau). */
  fromTime?: number
  /** Kontextzeit, zu der `fromTime` erklingen soll. */
  when?: number
}

/** Clip mit optionaler Lautstärke (0…1, fehlt = 1). */
export interface AudioClip extends TrimmedClip {
  volume?: number
}

/** Kurvenwerte für p0…p1 einer Equal-Power-Blende, mit `scale` multipliziert. */
export function fadeCurve(fadeIn: boolean, p0 = 0, p1 = 1, steps = 32, scale = 1): Float32Array {
  const c = new Float32Array(steps)
  for (let i = 0; i < steps; i++) {
    const p = p0 + ((p1 - p0) * i) / (steps - 1)
    const [out, inn] = equalPowerGains(p)
    c[i] = (fadeIn ? inn : out) * scale
  }
  return c
}

const volumeOf = (c: AudioClip) => Math.min(1, Math.max(0, c.volume ?? 1))

/**
 * Plant den Ton der ganzen Timeline: je Clip eine AudioBufferSource mit
 * Trim-Offset und Equal-Power-Blenden an den Übergängen. Gleiche Logik für
 * Live-Wiedergabe (AudioContext) und Export v2 (OfflineAudioContext).
 * Clips ohne Puffer (keine Tonspur) bleiben stumm.
 */
export function scheduleTimelineAudio(
  ctx: AudioCtxLike,
  dest: AudioNode,
  clips: readonly AudioClip[],
  buffers: readonly (AudioBuffer | null)[],
  transitions: readonly TransitionSpec[],
  { fromTime = 0, when = ctx.currentTime }: ScheduleOptions = {},
): { stop(): void } {
  const starts = clipStartTimes(clips, transitions)
  const d = effectiveDurations(clips, transitions)
  const sources: AudioBufferSourceNode[] = []
  const at = (t: number) => when + Math.max(0, t - fromTime)

  for (const [i, clip] of clips.entries()) {
    const buffer = buffers[i]
    const vol = volumeOf(clip)
    if (!buffer || vol <= 0) continue
    const start = starts[i]!
    const len = trimmedLength(clip)
    const end = start + len
    if (end <= fromTime) continue

    const skip = Math.max(0, fromTime - start) // bereits vergangene Sekunden dieses Clips
    const src = ctx.createBufferSource()
    src.buffer = buffer
    const gain = ctx.createGain()
    gain.gain.value = vol
    src.connect(gain)
    gain.connect(dest)

    const dIn = i > 0 ? (d[i - 1] ?? 0) : 0
    const dOut = d[i] ?? 0
    // Einblenden: [start, start + dIn]
    if (dIn > 0 && start + dIn > fromTime) {
      const p0 = Math.max(0, (fromTime - start) / dIn)
      const segStart = Math.max(start, fromTime)
      gain.gain.setValueCurveAtTime(fadeCurve(true, p0, 1, 32, vol), at(segStart), start + dIn - segStart)
    }
    // Ausblenden: [end − dOut, end]
    if (dOut > 0 && end > fromTime) {
      const fadeStart = end - dOut
      const p0 = Math.max(0, (fromTime - fadeStart) / dOut)
      const segStart = Math.max(fadeStart, fromTime)
      gain.gain.setValueCurveAtTime(fadeCurve(false, p0, 1, 32, vol), at(segStart), end - segStart)
    }
    src.start(at(start), clip.trimStart + skip, len - skip)
    sources.push(src)
  }

  return {
    stop() {
      for (const s of sources) {
        try {
          s.stop()
        } catch {
          /* noch nicht gestartet oder schon beendet */
        }
        s.disconnect()
      }
    },
  }
}

export interface MusicInput {
  buffer: AudioBuffer
  offset: number
  volume: number
  fadeOut: boolean
  duck: boolean
}

export interface VoiceInput {
  buffer: AudioBuffer
  start: number
  skip: number
  volume: number
  /** Sprachabschnitte relativ zum Anfang der Aufnahme; fehlt = aus dem Puffer berechnen */
  segments?: readonly Segment[]
}

export interface ProjectAudioInput {
  clips: readonly AudioClip[]
  clipBuffers: readonly (AudioBuffer | null)[]
  transitions: readonly TransitionSpec[]
  music?: MusicInput | null
  voiceover?: VoiceInput | null
}

/** Einblenden der Musik, wenn sie mitten im Song einsetzt (s). */
export const MUSIC_FADE_IN = 0.4

const segmentCache = new WeakMap<AudioBuffer, Segment[]>()

/** Sprachabschnitte einer Aufnahme (gecacht je Puffer). */
export function speechOf(buffer: AudioBuffer): Segment[] {
  let segs = segmentCache.get(buffer)
  if (!segs) {
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i))
    segs = speechSegments(channels, buffer.sampleRate)
    segmentCache.set(buffer, segs)
  }
  return segs
}

/** Sprachabschnitte in Timeline-Zeit (Aufnahme beginnt bei `start`, ab `skip`). */
export function voiceSegmentsInTimeline(vo: VoiceInput, total: number): Segment[] {
  const segs = vo.segments ?? speechOf(vo.buffer)
  const shift = vo.start - vo.skip
  return segs
    .map((s) => ({ start: Math.max(vo.start, s.start + shift), end: Math.min(total, s.end + shift) }))
    .filter((s) => s.end > s.start)
}

/**
 * Ton des ganzen Projekts: Clips (mit Lautstärke und Blenden), Hintergrundmusik
 * (Startpunkt, Ein-/Ausblenden, Ducking) und Voiceover. Gleiche Planung für
 * Live-Wiedergabe und Offline-Export.
 */
export function scheduleProjectAudio(
  ctx: AudioCtxLike,
  dest: AudioNode,
  input: ProjectAudioInput,
  { fromTime = 0, when = ctx.currentTime }: ScheduleOptions = {},
): { stop(): void } {
  const parts = [scheduleTimelineAudio(ctx, dest, input.clips, input.clipBuffers, input.transitions, { fromTime, when })]
  const sources: AudioBufferSourceNode[] = []
  const total = totalDuration(input.clips, input.transitions)
  const at = (t: number) => when + Math.max(0, t - fromTime)
  const { music, voiceover: vo } = input

  if (music && music.volume > 0) {
    const len = Math.min(total, music.buffer.duration - music.offset)
    if (len > fromTime) {
      const points = musicGainPoints({
        total,
        volume: music.volume,
        fadeIn: music.offset > 0 ? MUSIC_FADE_IN : 0,
        fadeOut: music.fadeOut,
        segments: music.duck && vo && vo.volume > 0 ? voiceSegmentsInTimeline(vo, total) : [],
      })
      const src = ctx.createBufferSource()
      src.buffer = music.buffer
      const gain = ctx.createGain()
      src.connect(gain)
      gain.connect(dest)
      gain.gain.setValueAtTime(gainAt(points, fromTime), when)
      for (const [t, v] of points) if (t > fromTime) gain.gain.linearRampToValueAtTime(v, at(t))
      src.start(when, music.offset + fromTime, len - fromTime)
      sources.push(src)
    }
  }

  if (vo && vo.volume > 0) {
    const len = Math.min(vo.buffer.duration - vo.skip, total - vo.start)
    const end = vo.start + len
    if (len > 0 && end > fromTime) {
      const past = Math.max(0, fromTime - vo.start)
      const src = ctx.createBufferSource()
      src.buffer = vo.buffer
      const gain = ctx.createGain()
      gain.gain.value = vo.volume
      src.connect(gain)
      gain.connect(dest)
      src.start(at(vo.start), vo.skip + past, len - past)
      sources.push(src)
    }
  }

  return {
    stop() {
      for (const p of parts) p.stop()
      for (const s of sources) {
        try {
          s.stop()
        } catch {
          /* noch nicht gestartet oder schon beendet */
        }
        s.disconnect()
      }
    },
  }
}
