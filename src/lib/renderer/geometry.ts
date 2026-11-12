import type { AspectRatio } from '../project/types'

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

/**
 * „Cover“: Ziel vollständig füllen, mittig zuschneiden.
 * Bei 90°/270° Rotation sind Breite und Höhe der Quelle vertauscht.
 */
export function coverCrop(
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
  rotation = 0,
): Cover {
  const swap = Math.abs(rotation) % 180 === 90
  const ew = swap ? srcH : srcW
  const eh = swap ? srcW : srcH
  if (!ew || !eh || !dstW || !dstH) return { scale: 1, uvScale: [1, 1], uvOffset: [0, 0] }
  const scale = Math.max(dstW / ew, dstH / eh)
  const sx = dstW / scale / ew
  const sy = dstH / scale / eh
  return { scale, uvScale: [sx, sy], uvOffset: [(1 - sx) / 2, (1 - sy) / 2] }
}

/** Smoothstep-Easing – identisch zum Slide-Shader. */
export function easeInOut(p: number): number {
  return p * p * (3 - 2 * p)
}
