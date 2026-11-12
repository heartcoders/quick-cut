import { describe, expect, it } from 'vitest'
import {
  clipStartTimes,
  effectiveDurations,
  equalPowerGains,
  maxTransition,
  moveHandle,
  pxToTime,
  resolve,
  resolveFrame,
  timeToPx,
  totalDuration,
} from './timeline'

const c = (duration: number, trimStart = 0, trimEnd = duration) => ({ duration, trimStart, trimEnd })

describe('totalDuration / clipStartTimes', () => {
  it('summiert getrimmte Längen', () => {
    const clips = [c(5, 1, 3), c(4), c(10, 2.5, 3)]
    expect(totalDuration(clips)).toBe(6.5)
    expect(clipStartTimes(clips)).toEqual([0, 2, 6])
  })
  it('leer → 0', () => expect(totalDuration([])).toBe(0))
})

describe('resolve', () => {
  const clips = [c(5, 1, 3), c(4)]
  it.each([
    [0, 0, 1],
    [1.5, 0, 2.5],
    [2, 1, 0], // Grenze gehört zum nächsten Clip
    [5.9, 1, 3.9],
    [6, 1, 4], // genau das Ende
  ])('t=%s → Clip %s @ %s', (t, index, local) => {
    const r = resolve(clips, t)!
    expect(r.index).toBe(index)
    expect(r.localTime).toBeCloseTo(local)
  })
  it('außerhalb → null', () => {
    expect(resolve(clips, -0.1)).toBeNull()
    expect(resolve(clips, 6.1)).toBeNull()
    expect(resolve([], 0)).toBeNull()
  })
})

describe('pxToTime / timeToPx', () => {
  it('rechnet linear und begrenzt', () => {
    expect(pxToTime(150, 300, 10)).toBe(5)
    expect(pxToTime(-20, 300, 10)).toBe(0)
    expect(pxToTime(400, 300, 10)).toBe(10)
    expect(timeToPx(2.5, 300, 10)).toBe(75)
    expect(timeToPx(20, 300, 10)).toBe(300)
  })
})

describe('moveHandle', () => {
  const clip = c(10, 2, 8)
  it('bewegt Start und rundet auf 0,01', () => {
    expect(moveHandle(clip, 'start', 3.456)).toEqual({ trimStart: 3.46, trimEnd: 8, hitLimit: false })
  })
  it('Start kann Ende nicht überholen (Mindestlänge 0,5 s)', () => {
    expect(moveHandle(clip, 'start', 9)).toEqual({ trimStart: 7.5, trimEnd: 8, hitLimit: true })
  })
  it('Start nicht unter 0', () => {
    expect(moveHandle(clip, 'start', -1)).toEqual({ trimStart: 0, trimEnd: 8, hitLimit: true })
  })
  it('Ende kann Start nicht unterschreiten', () => {
    expect(moveHandle(clip, 'end', 1)).toEqual({ trimStart: 2, trimEnd: 2.5, hitLimit: true })
  })
  it('Ende nicht über duration', () => {
    expect(moveHandle(clip, 'end', 11)).toEqual({ trimStart: 2, trimEnd: 10, hitLimit: true })
  })
  it('Clip kürzer als Mindestlänge bleibt gültig', () => {
    expect(moveHandle(c(0.3), 'start', 0.2)).toEqual({ trimStart: 0, trimEnd: 0.3, hitLimit: true })
  })
})

describe('Übergänge', () => {
  const clips = [c(4), c(6, 1, 5), c(3)] // Längen 4, 4, 3
  const tr = (type: 'none' | 'crossfade' | 'wipe', duration: number) => ({ type, duration })

  it('maxTransition = halbe Länge des kürzeren Clips', () => {
    expect(maxTransition(c(4), c(3))).toBe(1.5)
    expect(maxTransition(c(4), c(6, 1, 2))).toBe(0.5)
  })

  it('Gesamtdauer = Summe − Übergänge (Formel aus dem Handover)', () => {
    const t = [tr('crossfade', 0.5), tr('wipe', 0.8)]
    expect(totalDuration(clips, t)).toBe(11 - 1.3)
    expect(clipStartTimes(clips, t)).toEqual([0, 3.5, 6.7])
  })

  it("'none' und fehlende Übergänge zählen nicht", () => {
    expect(totalDuration(clips, [tr('none', 1)])).toBe(11)
    expect(totalDuration(clips)).toBe(11)
  })

  it('zu lange Übergänge werden begrenzt', () => {
    expect(effectiveDurations(clips, [tr('crossfade', 5), tr('wipe', 5)])).toEqual([2, 1.5])
  })

  describe('resolveFrame', () => {
    const t = [tr('crossfade', 1), tr('none', 0)]
    // Clip 0: 0–4, Übergang 3–4, Clip 1: 3–7 (lokal 1–5), Clip 2: 7–10
    it('vor dem Übergang nur Clip 0', () => {
      expect(resolveFrame(clips, t, 2)).toEqual({ from: { index: 0, localTime: 2 }, p: 0, type: 'none' })
    })
    it('in der Mitte des Übergangs: beide Clips, p = 0,5', () => {
      const f = resolveFrame(clips, t, 3.5)!
      expect(f.from).toEqual({ index: 0, localTime: 3.5 })
      expect(f.to).toEqual({ index: 1, localTime: 1.5 })
      expect(f.p).toBeCloseTo(0.5)
      expect(f.type).toBe('crossfade')
    })
    it('Beginn des Übergangs p = 0', () => {
      expect(resolveFrame(clips, t, 3)!.p).toBe(0)
      expect(resolveFrame(clips, t, 3)!.to?.index).toBe(1)
    })
    it('nach dem Übergang nur Clip 1', () => {
      expect(resolveFrame(clips, t, 4)).toEqual({ from: { index: 1, localTime: 2 }, p: 0, type: 'none' })
    })
    it('harter Schnitt zu Clip 2 und Ende', () => {
      expect(resolveFrame(clips, t, 7)!.from).toEqual({ index: 2, localTime: 0 })
      expect(resolveFrame(clips, t, 10)!.from).toEqual({ index: 2, localTime: 3 })
      expect(resolveFrame(clips, t, 10.1)).toBeNull()
    })
  })
})

describe('equalPowerGains', () => {
  it('Start, Mitte, Ende', () => {
    expect(equalPowerGains(0)).toEqual([1, 0])
    const [a, b] = equalPowerGains(0.5)
    expect(a).toBeCloseTo(Math.SQRT1_2)
    expect(a * a + b * b).toBeCloseTo(1)
    expect(equalPowerGains(1)[0]).toBeCloseTo(0)
  })
})
