import type { AspectRatio } from '../project/types'
import type { TransitionSpec, TransitionType } from '../timeline/timeline'

export interface RenderClip {
  url: string
  duration: number
  trimStart: number
  trimEnd: number
  rotation: number
}

export interface RenderProject {
  clips: RenderClip[]
  /** Länge clips.length − 1 */
  transitions: TransitionSpec[]
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
  /** Übergang zwischen zwei spielenden Videos, p = 0…1. */
  drawTransition(
    from: HTMLVideoElement,
    to: HTMLVideoElement,
    p: number,
    type: TransitionType,
    rotFrom?: number,
    rotTo?: number,
  ): void
  clear(): void
  dispose(): void
}
