import { describe, expect, it } from 'vitest'
import { filmstripTimes } from './filmstrip'

describe('filmstripTimes', () => {
  it('verteilt gleichmäßig in der Segmentmitte', () => {
    expect(filmstripTimes(10, 5)).toEqual([1, 3, 5, 7, 9])
  })
  it('bleibt knapp vor dem Ende', () => {
    for (const t of filmstripTimes(0.3, 10)) expect(t).toBeLessThanOrEqual(0.25)
  })
})
