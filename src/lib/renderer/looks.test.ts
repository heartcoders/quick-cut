import { describe, expect, it } from 'vitest'
import { DEFAULT_LOOK } from '../project/types'
import { canvasFilter, FILTER_IDS, FILTERS, gradeOf, IDENTITY, isNeutral, lookUniforms, normalizeLook } from './looks'

describe('looks', () => {
  it('DEFAULT_LOOK ist neutral, ein fehlender Look auch', () => {
    expect(isNeutral(DEFAULT_LOOK)).toBe(true)
    expect(isNeutral(undefined)).toBe(true)
    expect(isNeutral({ ...DEFAULT_LOOK, filter: 'warm', amount: 0 })).toBe(true)
    expect(isNeutral({ ...DEFAULT_LOOK, filter: 'warm' })).toBe(false)
    expect(isNeutral({ ...DEFAULT_LOOK, grain: 0.2 })).toBe(false)
  })

  it('jeder Filter hat Label und vollständige Parameter', () => {
    expect(FILTER_IDS).toContain('none')
    for (const id of FILTER_IDS) {
      expect(FILTERS[id].label).toBeTruthy()
      expect(Object.keys(FILTERS[id].params).sort()).toEqual(Object.keys(IDENTITY).sort())
    }
  })

  it('amount mischt gegen die Identität', () => {
    expect(gradeOf({ ...DEFAULT_LOOK, filter: 'noir', amount: 0 })).toEqual(IDENTITY)
    expect(gradeOf({ ...DEFAULT_LOOK, filter: 'mono', amount: 1 }).saturation).toBe(0)
    expect(gradeOf({ ...DEFAULT_LOOK, filter: 'mono', amount: 0.5 }).saturation).toBeCloseTo(0.5)
  })

  it('lookUniforms liefert bei neutralem Look Identität und keine Effekte', () => {
    const u = lookUniforms(DEFAULT_LOOK)
    expect(u.grade).toEqual([1, 1, 0, 0])
    expect(u.grade2).toEqual([0, 0, 0, 0])
    expect(u.fx).toEqual([0, 0, 0, 0])
    expect(lookUniforms({ ...DEFAULT_LOOK, grain: 0.3, vhs: 1 }).fx).toEqual([0.3, 0, 1, 0])
  })

  it('canvasFilter: neutral → none, sonst CSS-Filter', () => {
    expect(canvasFilter(DEFAULT_LOOK)).toBe('none')
    expect(canvasFilter({ ...DEFAULT_LOOK, grain: 1 })).toBe('none')
    expect(canvasFilter({ ...DEFAULT_LOOK, filter: 'mono' })).toContain('saturate(0)')
    expect(canvasFilter({ ...DEFAULT_LOOK, filter: 'warm' })).toContain('sepia(')
  })

  it('normalizeLook ergänzt fehlende Felder und klemmt Werte', () => {
    expect(normalizeLook(undefined)).toEqual(DEFAULT_LOOK)
    const l = normalizeLook({ filter: 'bogus' as never, amount: 2, grain: -1, vhs: Number.NaN })
    expect(l).toEqual({ ...DEFAULT_LOOK, filter: 'none', amount: 1, grain: 0, vhs: 0 })
  })
})
