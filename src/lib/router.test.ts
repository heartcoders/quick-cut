import { describe, expect, it } from 'vitest'
import { parseHash } from './router.svelte'

describe('parseHash', () => {
  it.each([
    ['', 'record'],
    ['#', 'record'],
    ['#/cut', 'cut'],
    ['#cut', 'cut'],
    ['#/export?x=1', 'export'],
    ['#/export/foo', 'export'],
    ['#/unknown', 'record'],
  ])('%s → %s', (hash, route) => {
    expect(parseHash(hash)).toBe(route)
  })
})
