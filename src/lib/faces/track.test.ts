import { describe, expect, it } from 'vitest'
import { EDGE_HOLD, facesAt, iou, nms, Tracker, type Box } from './track'

const box = (x: number, y: number, s = 0.2, score = 0.9): Box => ({ x, y, w: s, h: s, score })

describe('iou / nms', () => {
  it('iou', () => {
    expect(iou(box(0, 0), box(0, 0))).toBeCloseTo(1)
    expect(iou(box(0, 0), box(0.5, 0.5))).toBe(0)
  })

  it('nms entfernt Duplikate und behält die sicherste Box', () => {
    const out = nms([box(0.1, 0.1, 0.2, 0.6), box(0.11, 0.1, 0.2, 0.9), box(0.6, 0.6)])
    expect(out).toHaveLength(2)
    expect(out[0]!.score).toBe(0.9)
  })

  it('nms: Box in Box ist ein Duplikat', () => {
    expect(nms([box(0.1, 0.1, 0.4, 0.9), box(0.2, 0.2, 0.1, 0.8)])).toHaveLength(1)
  })
})

describe('Tracker', () => {
  it('verfolgt zwei Gesichter mit stabilen IDs', () => {
    const tr = new Tracker()
    const ids: number[][] = []
    for (let i = 0; i < 10; i++) {
      const t = i / 10
      // Reihenfolge der Erkennungen wechselt – IDs dürfen das nicht.
      const a = box(0.1 + i * 0.01, 0.2)
      const b = box(0.6 - i * 0.01, 0.3)
      ids.push(tr.push(t, i % 2 ? [b, a] : [a, b]))
    }
    for (let i = 0; i < 10; i++) {
      const [x, y] = ids[i]!
      expect(i % 2 ? [y, x] : [x, y]).toEqual([1, 2])
    }
    const tracks = tr.finish()
    expect(tracks.map((t) => t.id)).toEqual([1, 2])
    expect(tracks[0]!.samples).toHaveLength(10)
  })

  it('überbrückt kurze Lücken, beginnt nach langer Lücke neu', () => {
    const tr = new Tracker({ maxGap: 0.5 })
    for (const t of [0, 0.1, 0.2, 0.6, 0.7, 0.8]) tr.push(t, [box(0.3, 0.3)])
    expect(tr.finish()).toHaveLength(1)

    const tr2 = new Tracker({ maxGap: 0.5 })
    for (const t of [0, 0.1, 0.2, 1.5, 1.6, 1.7]) tr2.push(t, [box(0.3, 0.3)])
    expect(tr2.finish().map((t) => t.id)).toEqual([1, 2])
  })

  it('verwirft Einzelerkennungen', () => {
    const tr = new Tracker()
    tr.push(0, [box(0.3, 0.3), box(0.8, 0.8, 0.1)])
    tr.push(0.1, [box(0.3, 0.3)])
    tr.push(0.2, [box(0.3, 0.3)])
    expect(tr.finish().map((t) => t.id)).toEqual([1])
  })
})

describe('facesAt', () => {
  const tracks = [
    {
      id: 1,
      samples: [
        [0, 0.2, 0.2, 0.1, 0.1],
        [1, 0.4, 0.2, 0.2, 0.1],
      ] as [number, number, number, number, number][],
    },
  ]

  it('interpoliert den Mittelpunkt, Radius = Maximum', () => {
    const [f] = facesAt(tracks, 0.5)
    expect(f!.cx).toBeCloseTo(0.3)
    expect(f!.rx).toBeCloseTo(0.2)
  })

  it('hält kurz über die Ränder, danach nichts', () => {
    expect(facesAt(tracks, -EDGE_HOLD / 2)).toHaveLength(1)
    expect(facesAt(tracks, 1 + EDGE_HOLD / 2)[0]!.cx).toBeCloseTo(0.4)
    expect(facesAt(tracks, 1 + EDGE_HOLD * 2)).toHaveLength(0)
  })
})
