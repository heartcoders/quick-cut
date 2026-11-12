/**
 * Export v2: WebCodecs + Mediabunny. Der Renderer zeichnet Frame für Frame mit
 * festen Zeitstempeln (t = i / fps) – unabhängig von der Echtzeit –, Mediabunny
 * dekodiert die Clips (Hardware-Decoder, Rotation wird angewendet) und schreibt
 * H.264 + AAC in eine MP4-Datei. Ton kommt aus einem OfflineAudioContext.
 *
 * Mediabunny wird erst beim Export per import() geladen (eigenes Chunk).
 */
import * as db from '../project/db'
import type { AspectRatio } from '../project/types'
import { EXPORT_FPS, outputSize } from '../renderer/geometry'
import type { RenderClip, Renderer } from '../renderer/types'
import {
  clipStartTimes,
  effectiveDurations,
  equalPowerGains,
  resolveFrame,
  totalDuration,
  trimmedLength,
  type TransitionSpec,
} from '../timeline/timeline'
import { EXPORT_VIDEO_BITRATE, RenderCancelled, type RenderResult } from './exportV1'

const AUDIO_SAMPLE_RATE = 48_000
const AUDIO_BITRATE = 128_000

type Mediabunny = typeof import('mediabunny')
let mbPromise: Promise<Mediabunny> | null = null
const loadMediabunny = () => (mbPromise ??= import('mediabunny'))

/** Kann dieses Gerät schnell exportieren? Sonst Export v1 (Echtzeit). */
export async function supportsExportV2(aspect: AspectRatio): Promise<boolean> {
  if (
    typeof VideoEncoder === 'undefined' ||
    typeof VideoDecoder === 'undefined' ||
    typeof AudioEncoder === 'undefined' ||
    typeof OfflineAudioContext === 'undefined'
  ) {
    return false
  }
  try {
    const mb = await loadMediabunny()
    const { width, height } = outputSize(aspect)
    const [video, audio] = await Promise.all([
      mb.canEncodeVideo('avc', { width, height, bitrate: EXPORT_VIDEO_BITRATE, frameRate: EXPORT_FPS }),
      mb.canEncodeAudio('aac', { numberOfChannels: 2, sampleRate: AUDIO_SAMPLE_RATE, bitrate: AUDIO_BITRATE }),
    ])
    return video && audio
  } catch (err) {
    console.warn('Export v2 nicht verfügbar', err)
    return false
  }
}

export interface ExportV2Options {
  clips: RenderClip[]
  transitions: TransitionSpec[]
  aspect: AspectRatio
  renderer: Renderer
  signal: AbortSignal
  onProgress?: (t: number) => void
}

/** Equal-Power-Kurve für setValueCurveAtTime (ein- bzw. ausblenden). */
function fadeCurve(fadeIn: boolean, steps = 64): Float32Array {
  const c = new Float32Array(steps)
  for (let i = 0; i < steps; i++) {
    const [out, inn] = equalPowerGains(i / (steps - 1))
    c[i] = fadeIn ? inn : out
  }
  return c
}

/**
 * Ton der ganzen Timeline offline mischen – inkl. Überblendungen, gleiche
 * Kurven wie in der Echtzeit-Vorschau. Clips ohne (dekodierbaren) Ton bleiben stumm.
 */
async function renderAudio(
  clips: RenderClip[],
  transitions: TransitionSpec[],
  blobs: Blob[],
  total: number,
  signal: AbortSignal,
): Promise<AudioBuffer | null> {
  const ctx = new OfflineAudioContext(2, Math.max(1, Math.ceil(total * AUDIO_SAMPLE_RATE)), AUDIO_SAMPLE_RATE)
  const starts = clipStartTimes(clips, transitions)
  const d = effectiveDurations(clips, transitions)
  let any = false

  for (const [i, clip] of clips.entries()) {
    if (signal.aborted) throw new RenderCancelled()
    let decoded: AudioBuffer
    try {
      decoded = await ctx.decodeAudioData(await blobs[i]!.arrayBuffer())
    } catch {
      continue // keine Tonspur
    }
    any = true
    const len = trimmedLength(clip)
    const start = starts[i]!
    const src = ctx.createBufferSource()
    src.buffer = decoded
    const gain = ctx.createGain()
    src.connect(gain).connect(ctx.destination)
    const dIn = i > 0 ? (d[i - 1] ?? 0) : 0
    const dOut = d[i] ?? 0
    if (dIn > 0) gain.gain.setValueCurveAtTime(fadeCurve(true), start, dIn)
    if (dOut > 0) gain.gain.setValueCurveAtTime(fadeCurve(false), start + len - dOut, dOut)
    src.start(start, clip.trimStart, len)
  }
  return any ? ctx.startRendering() : null
}

interface ClipDecoder {
  next(): Promise<HTMLCanvasElement | OffscreenCanvas | null>
  close(): Promise<void>
}

export async function exportV2(opts: ExportV2Options): Promise<RenderResult> {
  const { clips, transitions, renderer, signal } = opts
  const mb = await loadMediabunny()
  const check = () => {
    if (signal.aborted) throw new RenderCancelled()
  }

  const blobs = await Promise.all(
    clips.map(async (c) => {
      const b = c.blobKey ? await db.getBlob(c.blobKey) : undefined
      if (!b) throw new Error('Clip-Datei nicht gefunden')
      return b
    }),
  )
  check()

  renderer.setOutput(opts.aspect)
  const total = totalDuration(clips, transitions)
  const frameCount = Math.max(1, Math.round(total * EXPORT_FPS))

  // Plan: welcher Clip zeigt in welchem Ausgabeframe welche lokale Zeit?
  const plan = Array.from({ length: frameCount }, (_, i) => resolveFrame(clips, transitions, i / EXPORT_FPS))
  const timestamps: number[][] = clips.map(() => [])
  for (const f of plan) {
    if (!f) continue
    timestamps[f.from.index]!.push(f.from.localTime)
    if (f.to) timestamps[f.to.index]!.push(f.to.localTime)
  }

  const audio = await renderAudio(clips, transitions, blobs, total, signal)
  check()

  const target = new mb.BufferTarget()
  const output = new mb.Output({ format: new mb.Mp4OutputFormat({ fastStart: 'in-memory' }), target })
  const videoSource = new mb.CanvasSource(renderer.canvas as HTMLCanvasElement, {
    codec: 'avc',
    quality: new mb.Quality({ bitrate: EXPORT_VIDEO_BITRATE }),
  })
  output.addVideoTrack(videoSource, { frameRate: EXPORT_FPS })
  const audioSource = audio
    ? new mb.AudioBufferSource({ codec: 'aac', quality: new mb.Quality({ bitrate: AUDIO_BITRATE }) })
    : null
  if (audioSource) output.addAudioTrack(audioSource)

  // Dekoder je Clip erst bei Bedarf öffnen und nach dem letzten Frame schließen.
  const decoders = new Map<number, ClipDecoder>()
  const remaining = timestamps.map((t) => t.length)
  const lastFrame = new Map<number, HTMLCanvasElement | OffscreenCanvas>()

  const open = async (index: number): Promise<ClipDecoder> => {
    const input = new mb.Input({ source: new mb.BlobSource(blobs[index]!), formats: mb.ALL_FORMATS })
    const track = await input.getPrimaryVideoTrack()
    if (!track) throw new Error('Clip ohne Videospur')
    // poolSize: Canvas-Ringpuffer – der Renderer lädt jeden Frame sofort hoch.
    const sink = new mb.CanvasSink(track, { poolSize: 3 })
    const it = sink.canvasesAtTimestamps(timestamps[index]!)
    return {
      async next() {
        const r = await it.next()
        return r.done || !r.value ? null : r.value.canvas
      },
      async close() {
        await it.return(undefined)
        input.dispose()
      },
    }
  }

  const frameOf = async (index: number) => {
    let dec = decoders.get(index)
    if (!dec) {
      dec = await open(index)
      decoders.set(index, dec)
    }
    // Vor dem ersten Frame (null) den letzten bekannten Frame weiterverwenden.
    const canvas = (await dec.next()) ?? lastFrame.get(index) ?? null
    if (canvas) lastFrame.set(index, canvas)
    if (--remaining[index]! <= 0) {
      decoders.delete(index)
      await dec.close()
    }
    return canvas
  }

  try {
    await output.start()
    if (audioSource && audio) await audioSource.add(audio)

    for (let i = 0; i < frameCount; i++) {
      check()
      const f = plan[i]
      if (f) {
        const from = await frameOf(f.from.index)
        const to = f.to ? await frameOf(f.to.index) : null
        if (from && to) renderer.drawTransition(from, to, f.p, f.type)
        else if (from) renderer.drawVideo(from)
        else if (to) renderer.drawVideo(to)
      }
      await videoSource.add(i / EXPORT_FPS, 1 / EXPORT_FPS)
      opts.onProgress?.(Math.min(total, (i + 1) / EXPORT_FPS))
    }
    check()
    await output.finalize()
  } catch (err) {
    if (output.state !== 'finalized' && output.state !== 'canceled') await output.cancel().catch(() => {})
    throw err
  } finally {
    await Promise.all([...decoders.values()].map((d) => d.close().catch(() => {})))
  }

  if (!target.buffer) throw new Error('Export ergab keine Datei')
  return { blob: new Blob([target.buffer], { type: 'video/mp4' }), mimeType: 'video/mp4' }
}
