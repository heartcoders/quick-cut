import { describe, expect, it } from 'vitest'
import { dragProgress, initialMachine, transition, type ButtonEvent, type MachineState } from './recordButtonMachine'

function run(events: ButtonEvent[], start: MachineState = initialMachine) {
  let m = start
  const effects: string[] = []
  for (const e of events) {
    const r = transition(m, e)
    m = r.next
    if (r.effect) effects.push(r.effect)
  }
  return { state: m.state, effects }
}

describe('recordButtonMachine (Tabelle aus dem Handover)', () => {
  it('idle + down → Aufnahme starten, pressing', () => {
    expect(run([{ type: 'down', at: 0 }])).toEqual({ state: 'pressing', effects: ['start'] })
  })
  it('pressing + up nach < 300 ms → weiter aufnehmen (recording-tap)', () => {
    expect(run([{ type: 'down', at: 0 }, { type: 'up', at: 299 }])).toEqual({
      state: 'recording-tap',
      effects: ['start'],
    })
  })
  it('pressing + up nach ≥ 300 ms → stoppen, idle', () => {
    expect(run([{ type: 'down', at: 0 }, { type: 'up', at: 300 }])).toEqual({
      state: 'idle',
      effects: ['start', 'stop'],
    })
  })
  it('pressing + pointercancel → stoppen, idle', () => {
    expect(run([{ type: 'down', at: 0 }, { type: 'cancel' }])).toEqual({
      state: 'idle',
      effects: ['start', 'stop'],
    })
  })
  it('recording-tap + down → stoppen, idle; das folgende up wird ignoriert', () => {
    expect(
      run([
        { type: 'down', at: 0 },
        { type: 'up', at: 100 },
        { type: 'down', at: 5000 },
        { type: 'up', at: 5100 },
      ]),
    ).toEqual({ state: 'idle', effects: ['start', 'stop'] })
  })
  it.each([
    ['pressing', [{ type: 'down', at: 0 }]],
    ['recording-tap', [{ type: 'down', at: 0 }, { type: 'up', at: 10 }]],
  ] as const)('%s + interrupt (App im Hintergrund) → stoppen, idle', (_name, before) => {
    const r = run([...before, { type: 'interrupt' }])
    expect(r).toEqual({ state: 'idle', effects: ['start', 'stop'] })
  })
  it('idle ignoriert up, cancel und interrupt', () => {
    expect(run([{ type: 'up', at: 0 }, { type: 'cancel' }, { type: 'interrupt' }])).toEqual({
      state: 'idle',
      effects: [],
    })
  })
  it('zweites down während pressing (Multitouch) wird ignoriert', () => {
    expect(run([{ type: 'down', at: 0 }, { type: 'down', at: 50 }])).toEqual({
      state: 'pressing',
      effects: ['start'],
    })
  })
  it('recording-tap ignoriert cancel', () => {
    expect(run([{ type: 'down', at: 0 }, { type: 'up', at: 10 }, { type: 'cancel' }]).state).toBe(
      'recording-tap',
    )
  })
  it('mehrere Clips hintereinander', () => {
    const r = run([
      { type: 'down', at: 0 },
      { type: 'up', at: 1000 }, // Halten
      { type: 'down', at: 2000 },
      { type: 'up', at: 2050 }, // Tippen
      { type: 'down', at: 4000 }, // Tippen beendet
      { type: 'up', at: 4050 },
    ])
    expect(r).toEqual({ state: 'idle', effects: ['start', 'stop', 'start', 'stop'] })
  })
})

describe('dragProgress (Halten + Wischen = Zoom)', () => {
  it('Totzone: leichtes Verrutschen zoomt nicht', () => {
    expect(dragProgress(0, 800)).toBe(0)
    expect(dragProgress(10, 800)).toBe(0)
    expect(dragProgress(-50, 800)).toBe(0)
  })

  it('wächst mit der Strecke nach oben und endet bei 1', () => {
    expect(dragProgress(12 + 160, 800)).toBeCloseTo(0.5)
    expect(dragProgress(12 + 320, 800)).toBe(1)
    expect(dragProgress(2000, 800)).toBe(1)
  })
})
