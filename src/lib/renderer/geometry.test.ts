import { describe, expect, it } from 'vitest'
import { coverCrop, isFrameReady, outputSize, sourceSize } from './geometry'

describe('outputSize', () => {
  it.each([
    ['9:16', 1080, 1920],
    ['16:9', 1920, 1080],
    ['1:1', 1080, 1080],
  ] as const)('%s → %ix%i', (a, w, h) => expect(outputSize(a)).toEqual({ width: w, height: h }))
})

describe('coverCrop', () => {
  it('gleiches Seitenverhältnis → kein Zuschnitt', () => {
    const c = coverCrop(720, 1280, 1080, 1920)
    expect(c.scale).toBeCloseTo(1.5)
    expect(c.uvScale).toEqual([1, 1])
    expect(c.uvOffset).toEqual([0, 0])
  })
  it('Querformat in 9:16 → links/rechts beschnitten, volle Höhe', () => {
    const c = coverCrop(1920, 1080, 1080, 1920)
    expect(c.uvScale[1]).toBeCloseTo(1)
    expect(c.uvScale[0]).toBeCloseTo((1080 / 1920) * (1080 / 1920)) // 0.316
    expect(c.uvOffset[0]).toBeCloseTo((1 - c.uvScale[0]) / 2)
    expect(c.uvOffset[1]).toBeCloseTo(0)
  })
  it('Hochformat in 16:9 → oben/unten beschnitten', () => {
    const c = coverCrop(1080, 1920, 1920, 1080)
    expect(c.uvScale[0]).toBeCloseTo(1)
    expect(c.uvScale[1]).toBeLessThan(1)
  })
  it('Hochformat in 1:1 → Mittelquadrat', () => {
    const c = coverCrop(1080, 1920, 1080, 1080)
    expect(c.uvScale).toEqual([1, 1080 / 1920])
    expect(c.scale).toBe(1)
  })
  it('Rotation 90° vertauscht die Quelle', () => {
    // Querformat-Datei mit 90° Rotation verhält sich wie Hochformat
    expect(coverCrop(1920, 1080, 1080, 1920, 90).uvScale).toEqual([1, 1])
  })
  it('pan verschiebt den Ausschnitt', () => {
    const left = coverCrop(1920, 1080, 1080, 1920, 0, 0)
    const right = coverCrop(1920, 1080, 1080, 1920, 0, 1)
    expect(left.uvOffset[0]).toBe(0)
    expect(right.uvOffset[0]).toBeCloseTo(1 - right.uvScale[0])
    const top = coverCrop(1080, 1920, 1920, 1080, 0, 0.5, 0)
    const bottom = coverCrop(1080, 1920, 1920, 1080, 0, 0.5, 1)
    expect(top.uvOffset[1]).toBe(0)
    expect(bottom.uvOffset[1]).toBeCloseTo(1 - bottom.uvScale[1])
  })
  it('pan ohne Überstand ändert nichts', () => {
    expect(coverCrop(720, 1280, 1080, 1920, 0, 0, 1).uvOffset).toEqual([0, 0])
  })
  it('ungültige Größen → neutral', () => {
    expect(coverCrop(0, 0, 1080, 1920)).toEqual({ scale: 1, uvScale: [1, 1], uvOffset: [0, 0] })
  })
})

describe('sourceSize / isFrameReady', () => {
  it('Canvas-artige Quellen', () => {
    const c = { width: 320, height: 240 } as unknown as HTMLCanvasElement
    expect(sourceSize(c)).toEqual({ width: 320, height: 240 })
    expect(isFrameReady(c)).toBe(true)
    expect(isFrameReady({ width: 0, height: 0 } as unknown as HTMLCanvasElement)).toBe(false)
  })
})
