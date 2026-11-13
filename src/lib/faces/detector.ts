/**
 * Gesichtserkennung mit MediaPipe (BlazeFace Short Range). WASM und Modell
 * liefert die App selbst aus (public/mediapipe, public/models) – kein CDN,
 * nach dem ersten Laden offline. Das Modul wird erst bei Bedarf geladen.
 */
import type { FaceDetector } from '@mediapipe/tasks-vision'
import { nms, type Box } from './track'

/** Längste Kante, auf die ein Bild bzw. eine Kachel vor der Erkennung verkleinert wird. */
const DETECT_EDGE = 640
/** Kacheln dürfen strenger sein: dort entstehen leichter Fehlerkennungen. */
const MIN_SCORE_FULL = 0.5
const MIN_SCORE_TILE = 0.6

let detectorPromise: Promise<FaceDetector> | null = null

async function create(delegate: 'GPU' | 'CPU'): Promise<FaceDetector> {
  const { FaceDetector, FilesetResolver } = await import('@mediapipe/tasks-vision')
  const base = import.meta.env.BASE_URL
  const fileset = await FilesetResolver.forVisionTasks(`${base}mediapipe`)
  return FaceDetector.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: `${base}models/blaze_face_short_range.tflite`, delegate },
    runningMode: 'IMAGE',
    minDetectionConfidence: MIN_SCORE_FULL,
  })
}

export function loadDetector(): Promise<FaceDetector> {
  detectorPromise ??= create('GPU')
    .catch((err) => {
      console.warn('Gesichtserkennung: GPU nicht nutzbar, CPU-Fallback', err)
      return create('CPU')
    })
    .catch((err) => {
      detectorPromise = null // später erneut versuchen dürfen
      throw err
    })
  return detectorPromise
}

const work = typeof document !== 'undefined' ? document.createElement('canvas') : null

/** Ausschnitt (sx, sy, sw, sh in Pixeln) verkleinert auf das Arbeits-Canvas zeichnen und erkennen. */
function detectRegion(
  det: FaceDetector,
  src: CanvasImageSource,
  W: number,
  H: number,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  minScore: number,
): Box[] {
  const k = Math.min(1, DETECT_EDGE / Math.max(sw, sh))
  const w = Math.max(1, Math.round(sw * k))
  const h = Math.max(1, Math.round(sh * k))
  const c = work!
  if (c.width !== w) c.width = w
  if (c.height !== h) c.height = h
  const ctx = c.getContext('2d', { willReadFrequently: false })!
  ctx.drawImage(src, sx, sy, sw, sh, 0, 0, w, h)
  const res = det.detect(c)
  const out: Box[] = []
  for (const d of res.detections) {
    const b = d.boundingBox
    const score = d.categories[0]?.score ?? 0
    if (!b || score < minScore) continue
    // Zurück in normierte Koordinaten des ganzen Bilds.
    out.push({
      x: (sx + b.originX / k) / W,
      y: (sy + b.originY / k) / H,
      w: b.width / k / W,
      h: b.height / k / H,
      score,
    })
  }
  return out
}

/**
 * Erkennt Gesichter im ganzen Bild und zusätzlich in 2×2 überlappenden
 * Kacheln. Das Short-Range-Modell findet kleine Gesichter (Rückkamera, mehrere
 * Personen) sonst kaum. Ergebnis: normierte Boxen (aufrechtes Bild).
 */
export async function detectFaces(src: CanvasImageSource, W: number, H: number): Promise<Box[]> {
  const det = await loadDetector()
  const boxes = detectRegion(det, src, W, H, 0, 0, W, H, MIN_SCORE_FULL)
  const tw = W * 0.6
  const th = H * 0.6
  for (const [fx, fy] of [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ] as const) {
    boxes.push(...detectRegion(det, src, W, H, fx * (W - tw), fy * (H - th), tw, th, MIN_SCORE_TILE))
  }
  return nms(boxes)
}
