import type { AspectRatio, ClipLook } from '../project/types'

export const EXPORT_FPS = 30

/** Feste Exportgrößen (lange Kante 1920). */
export function outputSize(aspect: AspectRatio): { width: number; height: number } {
  switch (aspect) {
    case '9:16':
      return { width: 1080, height: 1920 }
    case '16:9':
      return { width: 1920, height: 1080 }
    case '1:1':
      return { width: 1080, height: 1080 }
  }
}

export interface Cover {
  /** Skalierung Quelle → Ziel (in Pixeln, bezogen auf die gedrehte Quelle). */
  scale: number
  /** Sichtbarer Ausschnitt in normierten Koordinaten der gedrehten Quelle (für den Shader). */
  uvScale: [number, number]
  uvOffset: [number, number]
}

/** Wie ein Clip ins Zielformat gelegt wird. */
export interface Placement {
  rotation: number
  /** Ausschnitt-Position 0…1 (0.5 = mittig), bezogen auf die gedrehte Quelle. */
  panX: number
  panY: number
  /** Filter und Effekte; fehlt = neutral. */
  look?: ClipLook
}

export const CENTER: Placement = { rotation: 0, panX: 0.5, panY: 0.5 }

/**
 * „Cover“: Ziel vollständig füllen und zuschneiden – standardmäßig mittig,
 * mit panX/panY (0…1) lässt sich der Ausschnitt verschieben.
 * Bei 90°/270° Rotation sind Breite und Höhe der Quelle vertauscht.
 * uvOffset gilt in Bildkoordinaten (y = 0 oben).
 */
export function coverCrop(
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
  rotation = 0,
  panX = 0.5,
  panY = 0.5,
): Cover {
  const swap = Math.abs(rotation) % 180 === 90
  const ew = swap ? srcH : srcW
  const eh = swap ? srcW : srcH
  if (!ew || !eh || !dstW || !dstH) return { scale: 1, uvScale: [1, 1], uvOffset: [0, 0] }
  const scale = Math.max(dstW / ew, dstH / eh)
  const sx = dstW / scale / ew
  const sy = dstH / scale / eh
  return { scale, uvScale: [sx, sy], uvOffset: [(1 - sx) * panX, (1 - sy) * panY] }
}

/** Smoothstep-Easing – identisch zum Slide-Shader. */
export function easeInOut(p: number): number {
  return p * p * (3 - 2 * p)
}

/** Alles, was der Renderer zeichnen kann: <video> (Echtzeit) oder dekodierte Frames (Export v2). */
export type FrameSource = HTMLVideoElement | HTMLCanvasElement | OffscreenCanvas | VideoFrame | ImageBitmap

export function sourceSize(src: FrameSource): { width: number; height: number } {
  if (typeof HTMLVideoElement !== 'undefined' && src instanceof HTMLVideoElement) {
    return { width: src.videoWidth, height: src.videoHeight }
  }
  if (typeof VideoFrame !== 'undefined' && src instanceof VideoFrame) {
    return { width: src.displayWidth, height: src.displayHeight }
  }
  return { width: (src as HTMLCanvasElement).width, height: (src as HTMLCanvasElement).height }
}

export function isFrameReady(src: FrameSource): boolean {
  if (typeof HTMLVideoElement !== 'undefined' && src instanceof HTMLVideoElement) {
    return src.readyState >= 2 && src.videoWidth > 0
  }
  const { width, height } = sourceSize(src)
  return width > 0 && height > 0
}
