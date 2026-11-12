import { describe, expect, it } from 'vitest'
import { fadeCurve, scheduleProjectAudio, scheduleTimelineAudio, type AudioCtxLike } from './audioSchedule'

interface Rec {
  start?: [number, number, number]
  value?: number
  set?: [number, number]
  ramps: [number, number][]
  curves: { fadeIn: boolean; at: number; dur: number; first: number; last: number }[]
}

function fakeCtx(currentTime = 10) {
  const recs: Rec[] = []
  const ctx: AudioCtxLike = {
    currentTime,
    createBufferSource() {
      const r: Rec = { curves: [], ramps: [] }
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
          set value(v: number) {
            r.value = v
          },
          setValueCurveAtTime: (c: Float32Array, at: number, dur: number) =>
            r.curves.push({ fadeIn: c[0]! < c[c.length - 1]!, at, dur, first: c[0]!, last: c[c.length - 1]! }),
          setValueAtTime: (v: number, at: number) => (r.set = [v, at]),
          linearRampToValueAtTime: (v: number, at: number) => r.ramps.push([v, at]),
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

describe('Lautstärke pro Clip', () => {
  it('skaliert Gain und Blendkurven, stumme Clips bekommen keine Quelle', () => {
    const { ctx, recs } = fakeCtx(0)
    scheduleTimelineAudio(
      ctx,
      {} as AudioNode,
      [
        { ...clip(4), volume: 0.5 },
        { ...clip(4), volume: 0 },
        { ...clip(4), volume: 0.8 },
      ],
      [buf, buf, buf],
      [{ type: 'crossfade', duration: 1 }, { type: 'none', duration: 0 }],
    )
    expect(recs).toHaveLength(2)
    expect(recs[0]!.value).toBe(0.5)
    expect(recs[0]!.curves[0]).toMatchObject({ fadeIn: false, first: 0.5 })
    expect(recs[1]!.value).toBe(0.8)
    expect(recs[1]!.start).toEqual([7, 0, 4])
  })
})

describe('scheduleProjectAudio', () => {
  const audioBuf = (duration: number) => ({ duration }) as AudioBuffer

  it('Musik startet bei offset + fromTime und endet mit dem Video', () => {
    const { ctx, recs } = fakeCtx(5)
    scheduleProjectAudio(
      ctx,
      {} as AudioNode,
      {
        clips: [clip(10)],
        clipBuffers: [null],
        transitions: [],
        music: { buffer: audioBuf(120), offset: 30, volume: 0.6, fadeOut: true, duck: false },
      },
      { fromTime: 2 },
    )
    expect(recs).toHaveLength(1)
    expect(recs[0]!.start).toEqual([5, 32, 8])
    // Einblenden (offset > 0) ist bei t = 2 schon vorbei
    expect(recs[0]!.set).toEqual([0.6, 5])
    // Ausblenden: letzte 2 s → bei Kontextzeit 5 + (10 − 2) auf 0
    expect(recs[0]!.ramps.at(-1)).toEqual([0, 13])
  })

  it('Voiceover berücksichtigt start, skip und fromTime; Ducking senkt die Musik', () => {
    const { ctx, recs } = fakeCtx(0)
    scheduleProjectAudio(
      ctx,
      {} as AudioNode,
      {
        clips: [clip(10)],
        clipBuffers: [null],
        transitions: [],
        music: { buffer: audioBuf(60), offset: 0, volume: 1, fadeOut: false, duck: true },
        // Aufnahme: 0,5 s Vorlauf, Sprache 1…3 s der Aufnahme → Timeline 0,5…2,5
        voiceover: { buffer: audioBuf(9), start: 0, skip: 0.5, volume: 0.9, segments: [{ start: 1, end: 3 }] },
      },
      { fromTime: 1 },
    )
    const [music, vo] = recs
    expect(vo!.start).toEqual([0, 1.5, 7.5])
    expect(vo!.value).toBe(0.9)
    // bei Timeline 1 wird schon gesprochen → Musik abgesenkt
    expect(music!.set![0]).toBeCloseTo(0.3)
    expect(music!.ramps.some(([v]) => v === 1)).toBe(true)
  })

  it('Voiceover, das später einsetzt, startet zeitversetzt', () => {
    const { ctx, recs } = fakeCtx(0)
    scheduleProjectAudio(ctx, {} as AudioNode, {
      clips: [clip(10)],
      clipBuffers: [null],
      transitions: [],
      voiceover: { buffer: audioBuf(20), start: 0.2, skip: 0, volume: 1, segments: [] },
    })
    // auf Videolänge begrenzt
    expect(recs[0]!.start).toEqual([0.2, 0, 9.8])
  })
})
