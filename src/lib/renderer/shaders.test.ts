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

  it('Gesichter-Uniforms für beide Seiten', () => {
    for (const u of ['uFaceA', 'uFaceFxA', 'uFaceNA', 'uStickers']) expect(COVER_FRAGMENT).toContain(u)
    const src = transitionFragment('slide')
    for (const u of ['uFaceB', 'uFaceFxB', 'uFaceNB']) expect(src).toContain(u)
    // MAX_FACES muss vor den Array-Uniforms definiert sein.
    expect(src.indexOf('#define MAX_FACES')).toBeLessThan(src.indexOf('uFaceA['))
  })

  it('nur ASCII im GLSL-Quelltext', () => {
    for (const src of [COVER_FRAGMENT, transitionFragment('wipe')]) expect(src).toMatch(/^[\x00-\x7f]*$/)
  })
})
