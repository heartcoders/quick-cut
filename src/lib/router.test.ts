import { describe, expect, it } from 'vitest'
import { parseHash, toHash, type Location } from './router.svelte'

describe('parseHash', () => {
  it.each<[string, Location]>([
    ['', { route: 'home', projectId: null }],
    ['#', { route: 'home', projectId: null }],
    ['#/', { route: 'home', projectId: null }],
    ['#/settings', { route: 'settings', projectId: null }],
    ['#/p/abc/record', { route: 'record', projectId: 'abc' }],
    ['#/p/abc/cut', { route: 'cut', projectId: 'abc' }],
    ['#p/abc/export?x=1', { route: 'export', projectId: 'abc' }],
    ['#/p/abc', { route: 'cut', projectId: 'abc' }],
    ['#/p/abc/unknown', { route: 'cut', projectId: 'abc' }],
    ['#/p/', { route: 'home', projectId: null }],
    // alte Links aus der Zeit mit nur einem Projekt
    ['#/record', { route: 'home', projectId: null }],
    ['#/cut', { route: 'home', projectId: null }],
    ['#/unknown', { route: 'home', projectId: null }],
  ])('%s', (hash, loc) => {
    expect(parseHash(hash)).toEqual(loc)
  })
})

describe('toHash', () => {
  it.each<Location>([
    { route: 'home', projectId: null },
    { route: 'settings', projectId: null },
    { route: 'record', projectId: 'a-1' },
    { route: 'export', projectId: 'x y' },
  ])('ist die Umkehrung von parseHash: %o', (loc) => {
    expect(parseHash(toHash(loc))).toEqual(loc)
  })
})
