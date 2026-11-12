import { DEFAULT_LOOK, type ClipLook, type FilterId } from '../project/types'

/** Generische Farbparameter. Identität: saturation 1, contrast 1, Rest 0. */
export interface GradeParams {
  saturation: number
  contrast: number
  /** additiv, −1…1 */
  brightness: number
  /** −1 (kühl) … 1 (warm) */
  temperature: number
  /** −1 (magenta) … 1 (grün) */
  tint: number
  /** hebt die Schwarzwerte an, 0…1 */
  fade: number
  sepia: number
}

export const IDENTITY: GradeParams = {
  saturation: 1,
  contrast: 1,
  brightness: 0,
  temperature: 0,
  tint: 0,
  fade: 0,
  sepia: 0,
}

export const FILTERS: Record<FilterId, { label: string; params: GradeParams }> = {
  none: { label: 'Original', params: IDENTITY },
  warm: { label: 'Warm', params: { ...IDENTITY, temperature: 0.4, saturation: 1.1, contrast: 1.05 } },
  cool: { label: 'Kühl', params: { ...IDENTITY, temperature: -0.4, tint: 0.05, saturation: 0.95 } },
  vivid: { label: 'Kräftig', params: { ...IDENTITY, saturation: 1.45, contrast: 1.15 } },
  fade: { label: 'Verblasst', params: { ...IDENTITY, fade: 0.6, saturation: 0.75, contrast: 0.9, brightness: 0.02 } },
  retro: {
    label: 'Retro',
    params: { ...IDENTITY, sepia: 0.35, fade: 0.3, temperature: 0.15, saturation: 0.85, contrast: 1.05 },
  },
  mono: { label: 'S/W', params: { ...IDENTITY, saturation: 0, contrast: 1.05 } },
  noir: { label: 'Noir', params: { ...IDENTITY, saturation: 0, contrast: 1.45, brightness: -0.05 } },
}

export const FILTER_IDS = Object.keys(FILTERS) as FilterId[]

export const EFFECTS = [
  { key: 'grain', label: 'Filmkorn' },
  { key: 'vignette', label: 'Vignette' },
  { key: 'vhs', label: 'VHS' },
  { key: 'glitch', label: 'Glitch' },
] as const satisfies readonly { key: keyof ClipLook; label: string }[]

export type EffectKey = (typeof EFFECTS)[number]['key']

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0)

/** Ergänzt fehlende Felder (alte Projekte) und klemmt alle Stärken auf 0…1. */
export function normalizeLook(look?: Partial<ClipLook> | null): ClipLook {
  const l = { ...DEFAULT_LOOK, ...look }
  return {
    filter: l.filter in FILTERS ? l.filter : 'none',
    amount: clamp01(l.amount),
    grain: clamp01(l.grain),
    vignette: clamp01(l.vignette),
    vhs: clamp01(l.vhs),
    glitch: clamp01(l.glitch),
  }
}

/** true = Look ändert nichts am Bild. */
export function isNeutral(look?: ClipLook | null): boolean {
  if (!look) return true
  const filterOff = look.filter === 'none' || look.amount <= 0
  return filterOff && look.grain <= 0 && look.vignette <= 0 && look.vhs <= 0 && look.glitch <= 0
}

/** Filterparameter gegen die Identität gemischt (amount = 0 → Identität). */
export function gradeOf(look: ClipLook): GradeParams {
  const p = FILTERS[look.filter]?.params ?? IDENTITY
  const a = clamp01(look.amount)
  const out = { ...IDENTITY }
  for (const k of Object.keys(IDENTITY) as (keyof GradeParams)[]) out[k] = IDENTITY[k] + (p[k] - IDENTITY[k]) * a
  return out
}

export interface LookUniforms {
  /** saturation, contrast, brightness, temperature */
  grade: [number, number, number, number]
  /** tint, fade, sepia, 0 */
  grade2: [number, number, number, number]
  /** grain, vignette, vhs, glitch */
  fx: [number, number, number, number]
}

export function lookUniforms(look: ClipLook = DEFAULT_LOOK): LookUniforms {
  const g = gradeOf(look)
  return {
    grade: [g.saturation, g.contrast, g.brightness, g.temperature],
    grade2: [g.tint, g.fade, g.sepia, 0],
    fx: [clamp01(look.grain), clamp01(look.vignette), clamp01(look.vhs), clamp01(look.glitch)],
  }
}

const r2 = (v: number) => Math.round(v * 100) / 100

/**
 * Annäherung des Filters als CSS-/Canvas-Filter (Canvas-2D-Fallback und
 * Kachel-Vorschau). Temperatur wird über sepia bzw. hue-rotate nur grob nachgebildet.
 */
export function canvasFilter(look: ClipLook = DEFAULT_LOOK): string {
  if (look.filter === 'none' || look.amount <= 0) return 'none'
  const g = gradeOf(look)
  const parts: string[] = []
  const bright = 1 + g.brightness + g.fade * 0.08
  const contrast = g.contrast * (1 - g.fade * 0.25)
  const sepia = g.sepia + Math.max(0, g.temperature) * 0.35
  if (bright !== 1) parts.push(`brightness(${r2(bright)})`)
  if (contrast !== 1) parts.push(`contrast(${r2(contrast)})`)
  if (g.saturation !== 1) parts.push(`saturate(${r2(g.saturation)})`)
  if (sepia > 0) parts.push(`sepia(${r2(sepia)})`)
  if (g.temperature < 0) parts.push(`hue-rotate(${r2(g.temperature * -15)}deg)`)
  return parts.length ? parts.join(' ') : 'none'
}
