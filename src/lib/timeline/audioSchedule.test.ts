import { describe, expect, it } from 'vitest'
import { fadeCurve, scheduleTimelineAudio, type AudioCtxLike } from './audioSchedule'

interface Rec {
  start?: [number, number, number]
  curves: { fadeIn: boolean; at: number; dur: number; first: number; last: number }[]
}

function fakeCtx(currentTime = 10) {
  const recs: Rec[] = []
  const ctx: AudioCtxLike = {
    currentTime,
    createBufferSource() {
      const r: Rec = { curves: [] }
      recs.push(r)
      return {
        buffer: null,
        connect: () => {},
        disconnect: () => {},
        start: (when: number, offset: number, dur: number) => (r.start = [when, offset, dur]),
        stop: () => {},
      } as unknown as AudioBufferSourceNode
    },
    createGain() {
      const r = recs.at(-1)!
      return {
        connect: () => {},
        gain: {
          setValueCurveAtTime: (c: Float32Array, at: number, dur: number) =>
            r.curves.push({ fadeIn: c[0]! < c[c.length - 1]!, at, dur, first: c[0]!, last: c[c.length - 1]! }),
        },
      } as unknown as GainNode
    },
  }
  return { ctx, recs }
}

const buf = {} as AudioBuffer
const clip = (duration: number, trimStart = 0, trimEnd = duration) => ({ duration, trimStart, trimEnd })

describe('scheduleTimelineAudio', () => {
  it('harte Schnitte: Clips nacheinander mit Trim-Offset', () => {
    const { ctx, recs } = fakeCtx(10)
    scheduleTimelineAudio(ctx, {} as AudioNode, [clip(5, 1, 3), clip(4)], [buf, buf], [])
    expect(recs.map((r) => r.start)).toEqual([
      [10, 1, 2],
      [12, 0, 4],
    ])
    expect(recs.every((r) => r.curves.length === 0)).toBe(true)
  })

  it('Übergang: überlappende Starts und Equal-Power-Kurven', () => {
    const { ctx, recs } = fakeCtx(0)
    scheduleTimelineAudio(ctx, {} as AudioNode, [clip(4), clip(4)], [buf, buf], [{ type: 'crossfade', duration: 1 }])
    expect(recs[0]!.start).toEqual([0, 0, 4])
    expect(recs[1]!.start).toEqual([3, 0, 4])
    expect(recs[0]!.curves).toEqual([{ fadeIn: false, at: 3, dur: 1, first: 1, last: expect.closeTo(0) }])
    expect(recs[1]!.curves[0]).toMatchObject({ fadeIn: true, at: 3, dur: 1, first: 0, last: 1 })
  })

  it('Start mitten in der Timeline (fromTime) – auch mitten im Übergang', () => {
    const { ctx, recs } = fakeCtx(5)
    scheduleTimelineAudio(ctx, {} as AudioNode, [clip(4), clip(4)], [buf, buf], [{ type: 'crossfade', duration: 1 }], {
      fromTime: 3.5,
    })
    expect(recs[0]!.start).toEqual([5, 3.5, 0.5])
    expect(recs[1]!.start).toEqual([5, 0.5, 3.5])
    expect(recs[0]!.curves[0]).toMatchObject({ at: 5, dur: 0.5, first: expect.closeTo(Math.SQRT1_2) })
    expect(recs[1]!.curves[0]).toMatchObject({ at: 5, dur: 0.5, first: expect.closeTo(Math.SQRT1_2), last: 1 })
  })

  it('Clips ohne Ton und bereits vergangene Clips werden übersprungen', () => {
    const { ctx, recs } = fakeCtx(0)
    scheduleTimelineAudio(ctx, {} as AudioNode, [clip(2), clip(2), clip(2)], [buf, null, buf], [], { fromTime: 2.5 })
    expect(recs.map((r) => r.start)).toEqual([[1.5, 0, 2]])
  })

  it('fadeCurve', () => {
    expect(fadeCurve(true)[0]).toBe(0)
    expect(fadeCurve(false)[0]).toBe(1)
  })
})
