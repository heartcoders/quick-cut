import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import * as db from './db'
import { store } from './store.svelte'
import type { ClipRecord } from './types'

function rec(id: string, over: Partial<ClipRecord> = {}): ClipRecord {
  return {
    id,
    blobKey: `blob-${id}`,
    mimeType: 'video/mp4',
    duration: 4,
    width: 1080,
    height: 1920,
    rotation: 0,
    trimStart: 0,
    trimEnd: 4,
    source: 'recorded',
    thumbKeys: [],
    playable: true,
    ...over,
  }
}

beforeEach(async () => {
  store._reset()
  await db._resetDbForTests()
  indexedDB.deleteDatabase('quick-cut')
})

describe('ProjectStore', () => {
  it('persistiert Clips, Trim und Format über einen Reload', async () => {
    await db.putBlob('blob-a', new Blob(['x'], { type: 'video/mp4' }))
    await db.putThumb('thumb-a', new Blob(['t'], { type: 'image/jpeg' }))
    store.addClip(rec('a', { thumbKeys: ['thumb-a'] }))
    store.addClip(rec('b'))
    store.setTrim('a', 1, 3)
    store.setAspect('1:1')
    await store.flush()

    store._reset()
    expect(store.project.clips).toHaveLength(0)
    await store.load()

    expect(store.project.clips.map((c) => c.id)).toEqual(['a', 'b'])
    const a = store.getClip('a')!
    expect([a.trimStart, a.trimEnd]).toEqual([1, 3])
    expect(a.thumbnails).toHaveLength(1)
    expect(a.status).toBe('ready')
    expect(store.project.outputAspect).toBe('1:1')
    expect(store.project.transitions).toHaveLength(1)
    expect(await db.getBlob('blob-a')).toBeDefined()
  })

  it('berechnet die Gesamtdauer aus getrimmten, abspielbaren Clips', () => {
    store.addClip(rec('a', { trimStart: 1, trimEnd: 3 }))
    store.addClip(rec('b'))
    store.addClip(rec('c', { playable: false }), 'error')
    store.addClip(rec('d', { duration: 0, trimEnd: 0 }), 'processing')
    expect(store.totalDuration).toBe(6)
    expect(store.playableClips.map((c) => c.id)).toEqual(['a', 'b'])
    expect(store.hasPlayableClips).toBe(true)
  })

  it('hasPlayableClips ist false, solange nur verarbeitet wird', () => {
    store.addClip(rec('a', { duration: 0, trimEnd: 0 }), 'processing')
    expect(store.hasClips).toBe(true)
    expect(store.hasPlayableClips).toBe(false)
  })

  it('löscht beim Entfernen Blob und Thumbnails und hält transitions synchron', async () => {
    await db.putBlob('blob-a', new Blob(['x']))
    await db.putThumb('t1', new Blob(['t']))
    store.addClip(rec('a', { thumbKeys: ['t1'] }))
    store.addClip(rec('b'))
    expect(store.project.transitions).toHaveLength(1)

    await store.removeClip('a')
    expect(store.project.clips.map((c) => c.id)).toEqual(['b'])
    expect(store.project.transitions).toHaveLength(0)
    expect(await db.getBlob('blob-a')).toBeUndefined()
    expect(await db.getThumb('t1')).toBeUndefined()
  })

  it('setzt Status nach dem Laden: ohne Dauer → processing, nicht abspielbar → error', async () => {
    store.addClip(rec('a', { duration: 0, trimEnd: 0 }), 'processing')
    store.addClip(rec('b', { playable: false }), 'error')
    store.addClip(rec('c'))
    await store.flush()
    store._reset()
    await store.load()
    expect(store.project.clips.map((c) => c.status)).toEqual(['processing', 'error', 'ready'])
  })
})

describe('Übergänge im Store', () => {
  it('setTransition begrenzt auf die halbe Länge des kürzeren Clips und setzt Standarddauer', () => {
    store.addClip(rec('a')) // 4 s
    store.addClip(rec('b', { duration: 2, trimEnd: 2 }))
    store.setTransition(0, { type: 'crossfade' })
    expect(store.project.transitions[0]).toEqual({ type: 'crossfade', duration: 0.5 })
    store.setTransition(0, { duration: 5 })
    expect(store.project.transitions[0]!.duration).toBe(1)
  })

  it('Gesamtdauer zieht Übergänge ab', () => {
    store.addClip(rec('a'))
    store.addClip(rec('b'))
    store.addClip(rec('c'))
    store.setAllTransitions({ type: 'wipe', duration: 0.8 })
    expect(store.totalDuration).toBe(12 - 1.6)
  })

  it('Trim kürzer als 2× Übergang → Übergang zählt nur bis zum Maximum', () => {
    store.addClip(rec('a'))
    store.addClip(rec('b'))
    store.setTransition(0, { type: 'crossfade', duration: 1.5 })
    store.setTrim('b', 0, 1) // max jetzt 0,5
    expect(store.totalDuration).toBe(5 - 0.5)
  })

  it('removeClip in der Mitte entfernt den passenden Übergang', () => {
    store.addClip(rec('a'))
    store.addClip(rec('b'))
    store.addClip(rec('c'))
    store.setTransition(0, { type: 'crossfade', duration: 0.5 }) // a→b
    store.setTransition(1, { type: 'wipe', duration: 0.7 }) // b→c
    void store.removeClip('b')
    expect(store.project.transitions).toEqual([{ type: 'crossfade', duration: 0.5 }])
  })

  it('nicht abspielbare Clips dazwischen werden übersprungen', () => {
    store.addClip(rec('a'))
    store.addClip(rec('x', { playable: false }), 'error')
    store.addClip(rec('b'))
    store.setTransition(0, { type: 'crossfade', duration: 0.5 })
    expect(store.playableTransitions).toEqual([{ type: 'crossfade', duration: 0.5 }])
    expect(store.totalDuration).toBe(7.5)
  })
})
