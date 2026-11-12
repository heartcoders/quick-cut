import { describe, expect, it } from 'vitest'
import { parseSettings } from './settings.svelte'

describe('parseSettings', () => {
  it.each([
    [null, 'last'],
    ['', 'last'],
    ['kaputt', 'last'],
    ['{"defaultFacing":"user"}', 'user'],
    ['{"defaultFacing":"environment"}', 'environment'],
    ['{"defaultFacing":"seitlich"}', 'last'],
  ])('%s → %s', (raw, facing) => {
    expect(parseSettings(raw).defaultFacing).toBe(facing)
  })
})
