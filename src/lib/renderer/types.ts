import type { RenderFaces } from '../faces/place'
import type { AspectRatio, ClipLook } from '../project/types'
import type { TransitionSpec, TransitionType } from '../timeline/timeline'
import type { FrameSource, Placement } from './geometry'

export type { FrameSource, Placement }

export interface RenderClip {
  url: string
  /** Schlüssel des Original-Blobs (Export v2 dekodiert direkt aus der Datei). */
  blobKey?: string
  duration: number
  trimStart: number
  trimEnd: number
  rotation: number
  /** Ausschnitt-Position 0…1 (0.5 = mittig). */
  panX: number
  panY: number
  look: ClipLook
  /** Lautstärke des Clip-Tons 0…1 */
  volume: number
  /** Gesichter-Effekt (nur gesetzt, wenn aktiv und Gesichter erkannt). */
  faceFx?: RenderFaces
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
  /** Freie Zielgröße (z. B. Look-Vorschau in Videogröße). */
  setSize(width: number, height: number): void
  /** Timeline-Zeit in Sekunden für zeitabhängige Effekte (Korn, VHS, Glitch). */
  setTime(t: number): void
  /** Zeichnet den aktuellen Frame eines Videos oder eines dekodierten Frames. */
  drawVideo(video: FrameSource, place?: Placement): void
  /** Übergang zwischen zwei spielenden Videos, p = 0…1. */
  drawTransition(
    from: FrameSource,
    to: FrameSource,
    p: number,
    type: TransitionType,
    placeFrom?: Placement,
    placeTo?: Placement,
  ): void
  clear(): void
  dispose(): void
}
