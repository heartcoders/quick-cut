import { describe, expect, it } from 'vitest'
import { DEFAULT_FACES } from '../project/types'
import { facesFor, MAX_FACES, renderFaces, withFaces } from './place'
import { normalizeFaces } from './settings'
import type { FaceTrackEntry } from './track'

const track = (id: number, r = 0.1): FaceTrackEntry => ({
  id,
  samples: [
    [0, 0.5, 0.5, r, r],
    [1, 0.5, 0.5, r, r],
  ],
})

describe('renderFaces', () => {
  it('aus, ohne Tracks oder alle ausgenommen → nichts', () => {
    expect(renderFaces({ ...DEFAULT_FACES, mode: 'off' }, [track(1)])).toBeUndefined()
    expect(renderFaces({ ...DEFAULT_FACES, mode: 'blur' }, [])).toBeUndefined()
    expect(renderFaces({ ...DEFAULT_FACES, mode: 'blur', excluded: [1] }, [track(1)])).toBeUndefined()
  })

  it('filtert ausgenommene Gesichter und kodiert Modus und Sticker', () => {
    const fx = renderFaces({ ...DEFAULT_FACES, mode: 'sticker', sticker: '🤡', excluded: [2] }, [track(1), track(2)])
    expect(fx!.tracks.map((t) => t.id)).toEqual([1])
    expect(fx!.mode).toBe(3)
    expect(fx!.sticker).toBe(1)
  })
})

describe('facesFor / withFaces', () => {
  it('begrenzt auf MAX_FACES, größte zuerst', () => {
    const tracks = Array.from({ length: MAX_FACES + 2 }, (_, i) => track(i + 1, 0.01 * (i + 1)))
    const fx = renderFaces({ ...DEFAULT_FACES, mode: 'blur' }, tracks)
    const faces = facesFor(fx, 0.5)
    expect(faces).toHaveLength(MAX_FACES)
    expect(faces[0]!.rx).toBeCloseTo(0.01 * (MAX_FACES + 2))
  })

  it('withFaces lässt Placement ohne Gesichter unverändert', () => {
    const p = { rotation: 0, panX: 0.5, panY: 0.5 }
    expect(withFaces(p, 0)).toBe(p)
    const fx = renderFaces({ ...DEFAULT_FACES, mode: 'pixel' }, [track(1)])
    expect(withFaces({ ...p, faceFx: fx }, 0.5).faces).toHaveLength(1)
    expect(withFaces({ ...p, faceFx: fx }, 5).faces).toBeUndefined()
  })
})

describe('normalizeFaces', () => {
  it('ergänzt und klemmt', () => {
    expect(normalizeFaces(undefined)).toEqual(DEFAULT_FACES)
    const f = normalizeFaces({ mode: 'x' as never, strength: 3, sticker: '🍕', excluded: [2, 2, 1.5 as never] })
    expect(f).toEqual({ mode: 'off', strength: 1, sticker: DEFAULT_FACES.sticker, excluded: [2] })
  })
})
