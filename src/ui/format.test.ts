import { describe, expect, it } from 'vitest'
import { formatClock, formatPrecise, formatShort } from './format'

describe('format', () => {
  it('formatClock', () => {
    expect(formatClock(7.9)).toBe('0:07')
    expect(formatClock(75)).toBe('1:15')
  })
  it('formatShort', () => {
    expect(formatShort(3.46)).toBe('3,5 s')
    expect(formatShort(75)).toBe('1:15')
  })
  it('formatPrecise', () => {
    expect(formatPrecise(3.46)).toBe('3,5 s')
    expect(formatPrecise(63.4)).toBe('1:03,4')
    expect(formatPrecise(60)).toBe('1:00,0')
    expect(formatPrecise(-1)).toBe('0,0 s')
  })
})
