import { describe, expect, it } from 'vitest'
import { arrayMove, targetIndex } from './reorder'

describe('arrayMove', () => {
  it('nach rechts / links / gleich', () => {
    expect(arrayMove(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd'])
    expect(arrayMove(['a', 'b', 'c', 'd'], 3, 0)).toEqual(['d', 'a', 'b', 'c'])
    expect(arrayMove(['a', 'b'], 1, 1)).toEqual(['a', 'b'])
    expect(arrayMove(['a', 'b'], 0, 9)).toEqual(['b', 'a'])
  })
})

describe('targetIndex', () => {
  const centers = [25, 85, 145, 205] // Kacheln je 60 px
  it('bleibt, solange der Finger nicht über eine Nachbarmitte geht', () => {
    expect(targetIndex(30, centers, 0)).toBe(0)
    expect(targetIndex(80, centers, 0)).toBe(0)
  })
  it('springt hinter die Nachbarn, deren Mitte überquert ist', () => {
    expect(targetIndex(90, centers, 0)).toBe(1)
    expect(targetIndex(210, centers, 0)).toBe(3)
    expect(targetIndex(10, centers, 3)).toBe(0)
    expect(targetIndex(100, centers, 3)).toBe(2)
  })
})
