import { DEFAULT_FACES, type ClipFaces, type FaceMode } from '../project/types'
import { STICKERS } from './stickers'

const MODES: FaceMode[] = ['off', 'blur', 'pixel', 'sticker']
const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : DEFAULT_FACES.strength)

/** Ergänzt fehlende Felder und klemmt die Werte (alte Projekte, Fremddaten). */
export function normalizeFaces(f?: Partial<ClipFaces> | null): ClipFaces {
  const v = { ...DEFAULT_FACES, ...f }
  return {
    mode: MODES.includes(v.mode) ? v.mode : 'off',
    strength: clamp01(v.strength),
    sticker: (STICKERS as readonly string[]).includes(v.sticker) ? v.sticker : DEFAULT_FACES.sticker,
    excluded: Array.isArray(v.excluded) ? [...new Set(v.excluded.filter((n) => Number.isInteger(n)))] : [],
  }
}

export function facesOn(f?: ClipFaces | null): boolean {
  return !!f && f.mode !== 'off'
}
