/** Emoji, die einem Gesicht folgen können. Reihenfolge = Position im Atlas. */
export const STICKERS = ['😎', '🤡', '🐶', '🐱', '🙈', '🎃', '👽', '🤖', '😂', '🥳', '🐸', '🙂'] as const

export const ATLAS_GRID = 4
export const ATLAS_CELL = 128
/** Sticker etwas größer als die Gesichtsellipse */
export const STICKER_SCALE = 1.1

export function stickerIndex(emoji: string): number {
  const i = (STICKERS as readonly string[]).indexOf(emoji)
  return i < 0 ? 0 : i
}

let atlas: HTMLCanvasElement | null = null

/**
 * Alle Sticker als 4×4-Raster auf einem Canvas (für die WebGL-Textur).
 * Zelle i liegt in Spalte i % 4, Zeile ⌊i / 4⌋ (von oben).
 */
export function stickerAtlas(): HTMLCanvasElement {
  if (atlas) return atlas
  const c = document.createElement('canvas')
  c.width = c.height = ATLAS_GRID * ATLAS_CELL
  const ctx = c.getContext('2d')!
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `${Math.round(ATLAS_CELL * 0.82)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`
  STICKERS.forEach((s, i) => {
    const x = (i % ATLAS_GRID) * ATLAS_CELL + ATLAS_CELL / 2
    const y = Math.floor(i / ATLAS_GRID) * ATLAS_CELL + ATLAS_CELL / 2
    ctx.fillText(s, x, y + ATLAS_CELL * 0.04)
  })
  atlas = c
  return c
}

/** Sticker-Quadrat (Kantenlänge in Pixeln) für eine Gesichtsellipse in einem Bild der Größe w×h. */
export function stickerSize(rx: number, ry: number, w: number, h: number): number {
  return Math.max(2 * rx * w, 2 * ry * h) * STICKER_SCALE
}
