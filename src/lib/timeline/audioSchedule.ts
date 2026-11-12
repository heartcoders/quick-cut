import {
  clipStartTimes,
  effectiveDurations,
  equalPowerGains,
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

/** Kurvenwerte für p0…p1 einer Equal-Power-Blende. */
export function fadeCurve(fadeIn: boolean, p0 = 0, p1 = 1, steps = 32): Float32Array {
  const c = new Float32Array(steps)
  for (let i = 0; i < steps; i++) {
    const p = p0 + ((p1 - p0) * i) / (steps - 1)
    const [out, inn] = equalPowerGains(p)
    c[i] = fadeIn ? inn : out
  }
  return c
}

/**
 * Plant den Ton der ganzen Timeline: je Clip eine AudioBufferSource mit
 * Trim-Offset und Equal-Power-Blenden an den Übergängen. Gleiche Logik für
 * Live-Wiedergabe (AudioContext) und Export v2 (OfflineAudioContext).
 * Clips ohne Puffer (keine Tonspur) bleiben stumm.
 */
export function scheduleTimelineAudio(
  ctx: AudioCtxLike,
  dest: AudioNode,
  clips: readonly TrimmedClip[],
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
    if (!buffer) continue
    const start = starts[i]!
    const len = trimmedLength(clip)
    const end = start + len
    if (end <= fromTime) continue

    const skip = Math.max(0, fromTime - start) // bereits vergangene Sekunden dieses Clips
    const src = ctx.createBufferSource()
    src.buffer = buffer
    const gain = ctx.createGain()
    src.connect(gain)
    gain.connect(dest)

    const dIn = i > 0 ? (d[i - 1] ?? 0) : 0
    const dOut = d[i] ?? 0
    // Einblenden: [start, start + dIn]
    if (dIn > 0 && start + dIn > fromTime) {
      const p0 = Math.max(0, (fromTime - start) / dIn)
      const segStart = Math.max(start, fromTime)
      gain.gain.setValueCurveAtTime(fadeCurve(true, p0, 1), at(segStart), start + dIn - segStart)
    }
    // Ausblenden: [end − dOut, end]
    if (dOut > 0 && end > fromTime) {
      const fadeStart = end - dOut
      const p0 = Math.max(0, (fromTime - fadeStart) / dOut)
      const segStart = Math.max(fadeStart, fromTime)
      gain.gain.setValueCurveAtTime(fadeCurve(false, p0, 1), at(segStart), end - segStart)
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
