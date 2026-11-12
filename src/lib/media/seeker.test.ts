import { describe, expect, it } from 'vitest'
import { createSeeker } from './seeker'

class FakeVideo extends EventTarget {
  sets: number[] = []
  #t = 0
  get currentTime() {
    return this.#t
  }
  set currentTime(v: number) {
    this.#t = v
    this.sets.push(v)
  }
  finishSeek() {
    this.dispatchEvent(new Event('seeked'))
  }
}

describe('createSeeker', () => {
  it('höchstens ein Seek gleichzeitig, der letzte Wunsch gewinnt', () => {
    const v = new FakeVideo()
    const s = createSeeker(v)
    s.request(1)
    s.request(2)
    s.request(3)
    expect(v.sets).toEqual([1])
    v.finishSeek()
    expect(v.sets).toEqual([1, 3])
    v.finishSeek()
    expect(v.sets).toEqual([1, 3])
    s.request(4)
    expect(v.sets).toEqual([1, 3, 4])
  })

  it('dispose verwirft ausstehende Seeks', () => {
    const v = new FakeVideo()
    const s = createSeeker(v)
    s.request(1)
    s.request(2)
    s.dispose()
    v.finishSeek()
    expect(v.sets).toEqual([1])
  })
})
