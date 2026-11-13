/**
 * Analysiert ein Video einmal komplett: Frames mit ANALYZE_FPS dekodieren,
 * Gesichter erkennen, über die Zeit verfolgen, pro Gesicht ein Vorschaubild.
 * Analysiert wird die ganze Datei, damit späteres Trimmen keine neue Analyse braucht.
 */
import { openVideo, seekTo } from '../media/video'
import type { FaceTrackRecord } from '../project/types'
import { detectFaces, loadDetector } from './detector'
import { boxToEllipse, Tracker, type Box } from './track'

export const ANALYZE_FPS = 10
/** Längste Kante der dekodierten Frames (Kacheln brauchen etwas Auflösung). */
const DECODE_EDGE = 1280
const THUMB = 96

export class AnalyzeCancelled extends Error {
  constructor() {
    super('Analyse abgebrochen')
  }
}

type FrameIter = AsyncIterator<{ t: number; canvas: CanvasImageSource; w: number; h: number } | null>

/** Frames per Mediabunny (WebCodecs). Liefert aufrechte Bilder. */
async function webCodecsFrames(blob: Blob, times: number[]): Promise<{ it: FrameIter; close(): void } | null> {
  if (typeof VideoDecoder === 'undefined') return null
  const mb = await import('mediabunny')
  const input = new mb.Input({ source: new mb.BlobSource(blob), formats: mb.ALL_FORMATS })
  try {
    const track = await input.getPrimaryVideoTrack()
    if (!track || !(await track.canDecode())) {
      input.dispose()
      return null
    }
    const k = Math.min(1, DECODE_EDGE / Math.max(track.displayWidth, track.displayHeight))
    const sink = new mb.CanvasSink(track, { width: Math.round(track.displayWidth * k), poolSize: 1 })
    const gen = sink.canvasesAtTimestamps(times)
    let i = 0
    const it: FrameIter = {
      async next() {
        const r = await gen.next()
        if (r.done) return { done: true, value: undefined }
        const t = times[i++]!
        const c = r.value?.canvas
        return { done: false, value: c ? { t, canvas: c, w: c.width, h: c.height } : null }
      },
    }
    return {
      it,
      close: () => {
        void gen.return(undefined)
        input.dispose()
      },
    }
  } catch (err) {
    input.dispose()
    console.warn('Analyse: WebCodecs nicht nutzbar, Fallback über <video>', err)
    return null
  }
}

/** Fallback: per Seek durch ein verstecktes Video (langsamer). */
async function seekFrames(blob: Blob, times: number[]): Promise<{ it: FrameIter; close(): void }> {
  const { loaded, ok } = await openVideo(blob)
  if (!ok) {
    loaded.dispose()
    throw new Error('Video lässt sich nicht öffnen')
  }
  const v = loaded.video
  let i = 0
  return {
    it: {
      async next() {
        if (i >= times.length) return { done: true, value: undefined }
        const t = times[i++]!
        const ok = await seekTo(v, t)
        return { done: false, value: ok ? { t, canvas: v, w: v.videoWidth, h: v.videoHeight } : null }
      },
    },
    close: () => loaded.dispose(),
  }
}

function cropThumb(src: CanvasImageSource, w: number, h: number, b: Box): HTMLCanvasElement {
  const [cx, cy, rx, ry] = boxToEllipse(b)
  const side = Math.max(rx * 2 * w, ry * 2 * h)
  const c = document.createElement('canvas')
  c.width = c.height = THUMB
  c.getContext('2d')!.drawImage(src, cx * w - side / 2, cy * h - side / 2, side, side, 0, 0, THUMB, THUMB)
  return c
}

const toJpeg = (c: HTMLCanvasElement) =>
  new Promise<Blob | null>((res) => c.toBlob((b) => res(b), 'image/jpeg', 0.8))

export async function analyzeFaces(
  blob: Blob,
  duration: number,
  onProgress: (p: number) => void,
  signal: AbortSignal,
): Promise<FaceTrackRecord> {
  await loadDetector() // Modell zuerst: Fehler früh melden
  const times: number[] = []
  for (let t = 0; t < duration; t += 1 / ANALYZE_FPS) times.push(Math.round(t * 1000) / 1000)
  if (times.length === 0) times.push(0)

  const src = (await webCodecsFrames(blob, times)) ?? (await seekFrames(blob, times))
  const tracker = new Tracker()
  const best = new Map<number, { q: number; thumb: HTMLCanvasElement }>()
  let n = 0
  try {
    for (;;) {
      if (signal.aborted) throw new AnalyzeCancelled()
      const r = await src.it.next()
      if (r.done) break
      n++
      const f = r.value
      if (f && f.w > 0 && f.h > 0) {
        const boxes = await detectFaces(f.canvas, f.w, f.h)
        const ids = tracker.push(f.t, boxes)
        boxes.forEach((b, i) => {
          // Bestes Vorschaubild: sicher erkannt und möglichst groß.
          const q = b.score * b.w * b.h
          const id = ids[i]!
          if ((best.get(id)?.q ?? -1) < q) best.set(id, { q, thumb: cropThumb(f.canvas, f.w, f.h, b) })
        })
      }
      onProgress(n / times.length)
      // UI atmen lassen
      if (n % 4 === 0) await new Promise((res) => setTimeout(res, 0))
    }
  } finally {
    src.close()
  }

  const tracks = tracker.finish()
  const thumbs: Record<number, Blob> = {}
  for (const tr of tracks) {
    const c = best.get(tr.id)?.thumb
    const b = c ? await toJpeg(c) : null
    if (b) thumbs[tr.id] = b
  }
  return { version: 1, fps: ANALYZE_FPS, tracks, thumbs }
}
