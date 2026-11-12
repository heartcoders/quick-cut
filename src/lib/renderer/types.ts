import type { AspectRatio } from '../project/types'

export interface RenderClip {
  url: string
  duration: number
  trimStart: number
  trimEnd: number
  rotation: number
}

export interface RenderProject {
  clips: RenderClip[]
  outputAspect: AspectRatio
}

/**
 * Der Renderer kennt keine UI: Er bekommt das Projekt und zeichnet Frames
 * auf sein eigenes Canvas. Vorschau und Export nutzen dieselbe Instanz.
 */
export interface Renderer {
  readonly canvas: HTMLCanvasElement
  readonly totalDuration: number
  readonly kind: 'webgl2' | 'canvas2d'
  load(project: RenderProject): Promise<void>
  /** Zeichnet den Frame zur Gesamtzeit t (seekt ein internes Video). */
  renderFrame(t: number): Promise<void>
  /** Zielgröße passend zum Format setzen. */
  setOutput(aspect: AspectRatio): void
  /** Zeichnet den aktuellen Frame eines spielenden Videos (Echtzeit-Pfad). */
  drawVideo(video: HTMLVideoElement, rotation?: number): void
  clear(): void
  dispose(): void
}
