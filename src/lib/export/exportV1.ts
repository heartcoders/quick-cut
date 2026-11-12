import { SequencePlayer, type FrameState } from '../media/sequencePlayer'
import { getClipAudio } from '../media/clipAudio'
import { scheduleTimelineAudio } from '../timeline/audioSchedule'
import { clipStartTimes, type TransitionSpec } from '../timeline/timeline'
import { pickRecorderMimeType } from '../platform/mediaFormat'
import type { AspectRatio } from '../project/types'
import { EXPORT_FPS } from '../renderer/geometry'
import type { AudioGraph } from '../renderer/audioGraph'
import type { RenderClip, Renderer } from '../renderer/types'

export const EXPORT_VIDEO_BITRATE = 8_000_000
const FIRST_FRAME_TIMEOUT_MS = 10_000

export class RenderCancelled extends Error {
  constructor(reason = 'Abgebrochen') {
    super(reason)
    this.name = 'RenderCancelled'
  }
}

export interface RenderOptions {
  clips: RenderClip[]
  transitions?: TransitionSpec[]
  /** Teilbereich (z. B. Vorschau eines Übergangs); nur für record = false sinnvoll. */
  fromTime?: number
  toTime?: number
  aspect: AspectRatio
  renderer: Renderer
  videos: [HTMLVideoElement, HTMLVideoElement]
  audio: AudioGraph | null
  /** true = Export (MediaRecorder, stumm), false = Vorschau mit Ton. */
  record: boolean
  onProgress?: (t: number) => void
  /** Erster Frame ist gezeichnet (z. B. um die Vorschau umzuschalten). */
  onReady?: () => void
  /** Pro Frame: welcher Clip gerade läuft, Fortschritt im Übergang. */
  onFrame?: (f: FrameState) => void
}

export interface RenderResult {
  blob: Blob
  mimeType: string
}

export interface RenderJob {
  /** Export: Ergebnis-Blob. Vorschau: null. Abbruch: RenderCancelled. */
  done: Promise<RenderResult | null>
  cancel(reason?: string): void
}

/**
 * Export v1: Projekt in Echtzeit abspielen, jeden Frame über den Renderer
 * aufs Canvas zeichnen, Canvas + Ton per MediaRecorder aufnehmen.
 * Muss synchron aus einem Tap aufgerufen werden (iOS-Autoplay).
 */
export function startRender(opts: RenderOptions): RenderJob {
  const { clips, renderer, videos, audio, record } = opts
  // Kein clear(): Ein evtl. vorgerendertes erstes Bild bleibt stehen, bis der
  // erste echte Frame kommt. Die Aufnahme startet ohnehin erst mit onReady.
  renderer.setOutput(opts.aspect)

  let frame: FrameState | null = null
  let recorder: MediaRecorder | null = null
  let canvasTrack: MediaStreamTrack | null = null
  let finished = false
  let raf = 0
  const chunks: Blob[] = []
  const transitions = opts.transitions ?? []

  let resolveDone!: (r: RenderResult | null) => void
  let rejectDone!: (e: unknown) => void
  const done = new Promise<RenderResult | null>((res, rej) => {
    resolveDone = res
    rejectDone = rej
  })

  audio?.setSpeakers(!record)
  void audio?.resume()
  // Ton aus dekodierten Puffern (die Videos selbst sind stumm, siehe clipAudio.ts).
  const buffers = audio ? Promise.all(clips.map((c) => getClipAudio(c.blobKey))) : null
  const starts = clipStartTimes(clips, transitions)
  let scheduled: { stop(): void } | null = null

  /** Aktuelle Timeline-Zeit aus dem laufenden Video ableiten. */
  const timelineNow = (): number => {
    const f = frame
    if (!f) return opts.fromTime ?? 0
    const c = clips[f.fromIndex]!
    return starts[f.fromIndex]! + Math.max(0, f.from.currentTime - c.trimStart)
  }

  /** Ton so planen, dass er zur aktuellen Bildposition passt. */
  const startAudio = async () => {
    if (!audio || !buffers) return
    const bufs = await buffers
    if (finished) return
    scheduled = scheduleTimelineAudio(audio.ctx, audio.input, clips, bufs, transitions, {
      fromTime: timelineNow(),
      when: audio.ctx.currentTime,
    })
  }

  const drawCurrent = () => {
    const f = frame
    if (!f) return
    const rotFrom = clips[f.fromIndex]?.rotation ?? 0
    if (f.to) renderer.drawTransition(f.from, f.to, f.p, f.type, rotFrom, clips[f.fromIndex + 1]?.rotation ?? 0)
    else renderer.drawVideo(f.from, rotFrom)
  }

  const draw = () => {
    drawCurrent()
    if (!finished) raf = requestAnimationFrame(draw)
  }

  const beginRecording = () => {
    const stream = renderer.canvas.captureStream(EXPORT_FPS)
    canvasTrack = stream.getVideoTracks()[0] ?? null
    const audioTrack = audio?.stream.getAudioTracks()[0]
    if (audioTrack) stream.addTrack(audioTrack)
    const mimeType = pickRecorderMimeType()
    recorder = new MediaRecorder(stream, {
      ...(mimeType ? { mimeType } : {}),
      videoBitsPerSecond: EXPORT_VIDEO_BITRATE,
      audioBitsPerSecond: 128_000,
    })
    recorder.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data)
    recorder.onerror = (e) => fail((e as ErrorEvent).error ?? new Error('MediaRecorder-Fehler'))
    recorder.start(1000)
  }

  const cleanup = () => {
    finished = true
    cancelAnimationFrame(raf)
    clearTimeout(firstFrameTimer)
    player.stop()
    canvasTrack?.stop() // nur den Canvas-Track; der Audio-Track gehört dem Graph
    scheduled?.stop()
    scheduled = null
    audio?.setSpeakers(true)
  }

  const fail = (err: unknown) => {
    if (finished) return
    cleanup()
    if (recorder && recorder.state !== 'inactive') {
      recorder.onstop = null
      recorder.stop()
    }
    rejectDone(err)
  }

  const finish = () => {
    if (finished) return
    drawCurrent()
    cleanup()
    if (!recorder) return resolveDone(null)
    const rec = recorder as MediaRecorder
    rec.onstop = () => {
      const type = rec.mimeType || chunks[0]?.type || 'video/mp4'
      resolveDone({ blob: new Blob(chunks, { type }), mimeType: type })
    }
    rec.stop()
  }

  const player = new SequencePlayer(videos[0], videos[1], {
    onTime: (t) => {
      opts.onProgress?.(t)
      if (opts.toTime !== undefined && t >= opts.toTime) finish()
    },
    onFrame: (f) => {
      frame = f
      opts.onFrame?.(f)
    },
    onReady: () => {
      clearTimeout(firstFrameTimer)
      drawCurrent()
      void startAudio()
      opts.onReady?.()
      if (record && !recorder) {
        drawCurrent()
        try {
          beginRecording()
        } catch (err) {
          fail(err)
        }
      }
    },
    onEnd: finish,
  })

  const firstFrameTimer = setTimeout(
    () => !frame && fail(new Error('Video startet nicht (Timeout).')),
    FIRST_FRAME_TIMEOUT_MS,
  )

  player.start(clips, transitions, opts.fromTime ?? 0)
  raf = requestAnimationFrame(draw)

  return {
    done,
    cancel: (reason) => fail(new RenderCancelled(reason)),
  }
}
