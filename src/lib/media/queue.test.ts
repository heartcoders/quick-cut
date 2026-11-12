import { describe, expect, it } from 'vitest'
import { SerialQueue } from './queue'

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('SerialQueue', () => {
  it('führt Jobs nacheinander in Reihenfolge aus', async () => {
    const q = new SerialQueue()
    const log: string[] = []
    let running = 0
    const job = (name: string, ms: number) => async () => {
      running++
      expect(running).toBe(1)
      log.push(`start ${name}`)
      await tick(ms)
      log.push(`end ${name}`)
      running--
      return name
    }
    const results = await Promise.all([q.enqueue(job('a', 15)), q.enqueue(job('b', 1)), q.enqueue(job('c', 5))])
    expect(results).toEqual(['a', 'b', 'c'])
    expect(log).toEqual(['start a', 'end a', 'start b', 'end b', 'start c', 'end c'])
    expect(q.pending).toBe(0)
  })

  it('ein Fehler blockiert Folgejobs nicht', async () => {
    const q = new SerialQueue()
    const failed = q.enqueue(async () => {
      throw new Error('boom')
    })
    const ok = q.enqueue(async () => 42)
    await expect(failed).rejects.toThrow('boom')
    await expect(ok).resolves.toBe(42)
  })
})
