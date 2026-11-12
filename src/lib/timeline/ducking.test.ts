import { describe, expect, it } from 'vitest'
import { fadeOutDuration, gainAt, musicGainPoints, speechSegments } from './ducking'

const SR = 1000

/** Signal aus [Dauer, Amplitude]-Abschnitten (Rechteck ±a). */
function signal(parts: [number, number][]): Float32Array {
  const out: number[] = []
  for (const [dur, a] of parts) for (let i = 0; i < dur * SR; i++) out.push(i % 2 ? a : -a)
  return Float32Array.from(out)
}

describe('speechSegments', () => {
  it('findet einen Sprachabschnitt mit Haltezeit', () => {
    const segs = speechSegments([signal([[1, 0], [2, 0.5], [2, 0]])], SR)
    expect(segs).toHaveLength(1)
    expect(segs[0]!.start).toBeCloseTo(1, 1)
    expect(segs[0]!.end).toBeCloseTo(3.3, 1)
  })

  it('überbrückt kurze Pausen, trennt lange', () => {
    const short = speechSegments([signal([[1, 0.5], [0.1, 0], [1, 0.5]])], SR)
    expect(short).toHaveLength(1)
    const long = speechSegments([signal([[1, 0.5], [2, 0], [1, 0.5]])], SR)
    expect(long).toHaveLength(2)
  })

  it('Stille und Rauschen unter der Mindestschwelle → keine Abschnitte', () => {
    expect(speechSegments([signal([[3, 0.001]])], SR)).toEqual([])
    expect(speechSegments([], SR)).toEqual([])
  })
})

describe('musicGainPoints / gainAt', () => {
  it('ohne Optionen konstant auf der Lautstärke', () => {
    const p = musicGainPoints({ total: 10, volume: 0.6 })
    expect(p).toEqual([
      [0, 0.6],
      [10, 0.6],
    ])
  })

  it('Einblenden und Ausblenden', () => {
    const p = musicGainPoints({ total: 10, volume: 1, fadeIn: 0.4, fadeOut: true })
    expect(gainAt(p, 0)).toBe(0)
    expect(gainAt(p, 0.2)).toBeCloseTo(0.5)
    expect(gainAt(p, 5)).toBe(1)
    expect(gainAt(p, 9)).toBeCloseTo(0.5)
    expect(gainAt(p, 10)).toBe(0)
  })

  it('Ausblenden bei kurzen Videos höchstens ein Viertel', () => {
    expect(fadeOutDuration(4)).toBe(1)
    expect(fadeOutDuration(30)).toBe(2)
  })

  it('Ducking senkt während der Sprache ab und erholt sich danach', () => {
    const p = musicGainPoints({ total: 10, volume: 0.5, segments: [{ start: 3, end: 5 }] })
    expect(gainAt(p, 2)).toBe(0.5)
    expect(gainAt(p, 4)).toBeCloseTo(0.15)
    expect(gainAt(p, 5.25)).toBeCloseTo(0.325)
    expect(gainAt(p, 6)).toBe(0.5)
  })

  it('gainAt außerhalb der Stützpunkte konstant', () => {
    const p: [number, number][] = [
      [1, 0.2],
      [2, 0.4],
    ]
    expect(gainAt(p, 0)).toBe(0.2)
    expect(gainAt(p, 1.5)).toBeCloseTo(0.3)
    expect(gainAt(p, 3)).toBe(0.4)
  })
})
