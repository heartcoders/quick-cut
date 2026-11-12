import { describe, expect, it } from 'vitest'
import { LEAD_MAX, LEAD_MIN, nextLead } from './frameLoop'

describe('nextLead', () => {
  it('nähert sich der gemessenen Anlaufzeit an', () => {
    let lead = 0.12
    for (let i = 0; i < 10; i++) lead = nextLead(lead, 0.05)
    expect(lead).toBeCloseTo(0.05, 2)
  })
  it('bleibt in den Grenzen', () => {
    expect(nextLead(0.12, 5)).toBe(LEAD_MAX)
    expect(nextLead(0.03, 0)).toBe(LEAD_MIN)
  })
})
