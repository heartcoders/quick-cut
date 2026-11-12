import { describe, expect, it } from 'vitest'
import { clampZoom, classifyCamera, dragToZoom, fourByThreeCandidates, lensesFor, MAX_DRAG_ZOOM, type CameraDevice } from './camera'

function devices(labels: string[]): CameraDevice[] {
  return labels.map((label, i) => ({ id: `id${i}`, label, ...classifyCamera(label) }))
}

describe('classifyCamera', () => {
  it.each([
    ['Frontkamera', 'user', 'wide', false],
    ['Rückkamera', 'environment', 'wide', false],
    ['Rückseitige Ultraweitwinkelkamera', 'environment', 'ultra', false],
    ['Rückseitige Teleobjektivkamera', 'environment', 'tele', false],
    ['Rückseitige Dual-Weitwinkelkamera', 'environment', 'wide', true],
    ['Rückseitige Triple-Kamera', 'environment', 'wide', true],
    ['Front Camera', 'user', 'wide', false],
    ['Back Ultra Wide Camera', 'environment', 'ultra', false],
    ['Back Telephoto Camera', 'environment', 'tele', false],
    ['Back Dual Camera', 'environment', 'wide', true],
    ['camera2 1, facing front', 'user', 'wide', false],
    ['FaceTime HD Camera', null, 'wide', false],
  ] as const)('%s', (label, facing, lens, virtual) => {
    expect(classifyCamera(label)).toEqual({ facing, lens, virtual })
  })
})

describe('lensesFor', () => {
  const iphonePro = devices([
    'Frontkamera',
    'Rückseitige Triple-Kamera',
    'Rückseitige Dual-Weitwinkelkamera',
    'Rückseitige Teleobjektivkamera',
    'Rückkamera',
    'Rückseitige Ultraweitwinkelkamera',
  ])

  it('sortiert Rückseite weit → tele und lässt virtuelle Kameras weg', () => {
    expect(lensesFor(iphonePro, 'environment').map((d) => d.label)).toEqual([
      'Rückseitige Ultraweitwinkelkamera',
      'Rückkamera',
      'Rückseitige Teleobjektivkamera',
    ])
  })

  it('Vorderseite hat nur ein Objektiv', () => {
    expect(lensesFor(iphonePro, 'user').map((d) => d.label)).toEqual(['Frontkamera'])
  })

  it('Vorderseite mit Ultraweit (iPhone 17 Pro): ultra vor wide', () => {
    const list = devices(['Frontkamera', 'Vorderseitige Ultraweitwinkelkamera', 'Rückkamera'])
    expect(lensesFor(list, 'user').map((d) => d.lens)).toEqual(['ultra', 'wide'])
  })
})

describe('fourByThreeCandidates', () => {
  it('Hochformat 16:9 → 4:3-Größen im Hochformat, größte zuerst', () => {
    expect(fourByThreeCandidates(1080, 1920)[0]).toEqual({ width: 1440, height: 1920 })
    expect(fourByThreeCandidates(1080, 1920).every((c) => c.width < c.height)).toBe(true)
  })

  it('Querformat 16:9 → 4:3-Größen im Querformat', () => {
    expect(fourByThreeCandidates(1920, 1080)[0]).toEqual({ width: 1920, height: 1440 })
  })

  it('schon 4:3 oder unbekannt → nichts tun', () => {
    expect(fourByThreeCandidates(1440, 1920)).toEqual([])
    expect(fourByThreeCandidates(0, 0)).toEqual([])
  })
})

describe('Zoom', () => {
  it('clampZoom hält den Bereich ein', () => {
    expect(clampZoom(0.5, { min: 1, max: 5 })).toBe(1)
    expect(clampZoom(3, { min: 1, max: 5 })).toBe(3)
    expect(clampZoom(9, { min: 1, max: 5 })).toBe(5)
  })

  it('dragToZoom: 0 → Ausgangszoom, 1 → Maximum der Geste', () => {
    expect(dragToZoom(0, 1, 16)).toBe(1)
    expect(dragToZoom(1, 1, 16)).toBeCloseTo(MAX_DRAG_ZOOM)
    expect(dragToZoom(1, 1, 3)).toBeCloseTo(3)
    expect(dragToZoom(-1, 2, 16)).toBe(2)
  })

  it('dragToZoom steigt monoton und exponentiell (Mitte = geometrisches Mittel)', () => {
    const steps = [0, 0.25, 0.5, 0.75, 1].map((p) => dragToZoom(p, 1, 16))
    steps.slice(1).forEach((z, i) => expect(z).toBeGreaterThan(steps[i]!))
    expect(dragToZoom(0.5, 1, 16)).toBeCloseTo(Math.sqrt(MAX_DRAG_ZOOM))
  })

  it('dragToZoom ab höherem Ausgangszoom zoomt nie heraus', () => {
    expect(dragToZoom(1, 10, 16)).toBe(10)
  })
})
