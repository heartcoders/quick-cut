import type { ClipFaces } from '../project/types'
import type { Placement } from '../renderer/geometry'
import { stickerIndex } from './stickers'
import { facesAt, type FaceTrackEntry } from './track'

/** Höchstzahl gleichzeitig bearbeiteter Gesichter (Shader-Uniform-Arrays). */
export const MAX_FACES = 6

export const FACE_MODE_CODE = { blur: 1, pixel: 2, sticker: 3 } as const

/** Was der Renderer pro Gesicht und Frame braucht (aufrechte, normierte Koordinaten). */
export interface FaceDraw {
  cx: number
  cy: number
  rx: number
  ry: number
  mode: 1 | 2 | 3
  strength: number
  sticker: number
}

/** Gesichter-Effekt eines Clips für den Renderer: Tracks ohne ausgenommene Gesichter. */
export interface RenderFaces {
  mode: 1 | 2 | 3
  strength: number
  sticker: number
  tracks: FaceTrackEntry[]
}

export function renderFaces(settings: ClipFaces | undefined, tracks: FaceTrackEntry[] | null | undefined): RenderFaces | undefined {
  if (!settings || settings.mode === 'off' || !tracks?.length) return undefined
  const excluded = new Set(settings.excluded)
  const kept = tracks.filter((t) => !excluded.has(t.id))
  if (kept.length === 0) return undefined
  return {
    mode: FACE_MODE_CODE[settings.mode],
    strength: settings.strength,
    sticker: stickerIndex(settings.sticker),
    tracks: kept,
  }
}

export function facesFor(fx: RenderFaces | undefined, localTime: number): FaceDraw[] {
  if (!fx) return []
  return facesAt(fx.tracks, localTime)
    .sort((a, b) => b.rx * b.ry - a.rx * a.ry) // bei Überzahl die größten zuerst
    .slice(0, MAX_FACES)
    .map((f) => ({ cx: f.cx, cy: f.cy, rx: f.rx, ry: f.ry, mode: fx.mode, strength: fx.strength, sticker: fx.sticker }))
}

/** Placement eines Clips plus seine Gesichter zur lokalen Clip-Zeit. */
export function withFaces<T extends Placement & { faceFx?: RenderFaces }>(clip: T, localTime: number): Placement {
  const faces = facesFor(clip.faceFx, localTime)
  return faces.length ? { ...clip, faces } : clip
}
