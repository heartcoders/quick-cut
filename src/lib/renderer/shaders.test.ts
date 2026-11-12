import { describe, expect, it } from 'vitest'
import { COVER_FRAGMENT, TRANSITIONS, transitionFragment } from './shaders'

// jsdom hat kein WebGL: nur prüfen, dass der Look-Block überall eingebunden ist.
describe('shaders', () => {
  it('Cover-Shader wendet den Look an', () => {
    expect(COVER_FRAGMENT).toContain('sampleLook(uFrom')
    for (const u of ['uGradeA', 'uGrade2A', 'uFxA', 'uTime', 'uRes']) expect(COVER_FRAGMENT).toContain(u)
  })

  it('Übergänge wenden den Look auf beide Seiten an', () => {
    for (const type of Object.keys(TRANSITIONS) as (keyof typeof TRANSITIONS)[]) {
      const src = transitionFragment(type)
      expect(src).toContain('sampleLook(uFrom')
      expect(src).toContain('sampleLook(uTo')
      for (const u of ['uGradeB', 'uGrade2B', 'uFxB']) expect(src).toContain(u)
    }
  })
})
