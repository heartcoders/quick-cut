import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as db from './db'

// jsdom kann kein Audio dekodieren: Dauer vorgeben, `decodable = false` simuliert eine kaputte Datei.
const audio = vi.hoisted(() => ({ decodable: true, duration: 100 }))
vi.mock('../media/clipAudio', () => ({
  getClipAudio: async () => (audio.decodable ? ({ duration: audio.duration } as AudioBuffer) : null),
  releaseClipAudio: () => {},
}))

import { store } from './store.svelte'
import { DEFAULT_LOOK, type ClipRecord } from './types'

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
  audio.decodable = true
  audio.duration = 100
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

describe('moveClip', () => {
  it('verschiebt Clips, Übergänge bleiben positionsgebunden und überleben einen Reload', async () => {
    store.addClip(rec('a'))
    store.addClip(rec('b', { duration: 1, trimEnd: 1 }))
    store.addClip(rec('c'))
    store.setTransition(1, { type: 'wipe', duration: 1.5 }) // b→c, max 0,5
    store.moveClip(1, 2) // a, c, b
    expect(store.project.clips.map((c) => c.id)).toEqual(['a', 'c', 'b'])
    expect(store.project.transitions[1]!.type).toBe('wipe')
    await store.flush()
    store._reset()
    await store.load()
    expect(store.project.clips.map((c) => c.id)).toEqual(['a', 'c', 'b'])
  })

  it('setLook klemmt Werte und persistiert den Look', async () => {
    store.addClip(rec('a'))
    store.setLook('a', { filter: 'warm', amount: 1.5, grain: -0.2, vignette: 0.4 })
    expect(store.getClip('a')!.look).toEqual({ ...DEFAULT_LOOK, filter: 'warm', amount: 1, vignette: 0.4 })
    store.setLook('a', { vhs: 0.5 })
    expect(store.getClip('a')!.look?.vignette).toBe(0.4)
    await store.flush()
    store._reset()
    await store.load()
    expect(store.getClip('a')!.look).toEqual({ ...DEFAULT_LOOK, filter: 'warm', amount: 1, vignette: 0.4, vhs: 0.5 })
  })

  it('applyLookToAll überträgt den Look auf alle Clips', () => {
    store.addClip(rec('a'))
    store.addClip(rec('b'))
    store.addClip(rec('c'))
    store.setLook('b', { filter: 'noir', glitch: 0.3 })
    store.applyLookToAll('b')
    for (const id of ['a', 'b', 'c']) expect(store.getClip(id)!.look).toEqual({ ...DEFAULT_LOOK, filter: 'noir', glitch: 0.3 })
    // eigene Kopie je Clip
    store.setLook('a', { grain: 1 })
    expect(store.getClip('c')!.look?.grain).toBe(0)
  })

  it('lädt alte Projekte ohne Look', async () => {
    store.addClip(rec('a'))
    await store.flush()
    store._reset()
    await store.load()
    expect(store.getClip('a')!.look).toBeUndefined()
  })

  it('setVolume klemmt, setVolumeAll setzt alle', () => {
    store.addClip(rec('a'))
    store.addClip(rec('b'))
    store.setVolume('a', 1.7)
    expect(store.getClip('a')!.volume).toBe(1)
    store.setVolume('a', -1)
    expect(store.getClip('a')!.volume).toBe(0)
    store.setVolumeAll(0.4)
    expect([store.getClip('a')!.volume, store.getClip('b')!.volume]).toEqual([0.4, 0.4])
  })

  it('Musik: setzen, Offset begrenzen, ersetzen löscht den alten Blob', async () => {
    store.addClip(rec('a')) // 4 s Video
    await store.setMusic(new File(['x'], 'Mein Song.mp3', { type: 'audio/mpeg' }))
    const first = store.project.music!
    expect(first).toMatchObject({ name: 'Mein Song', duration: 100, offset: 0, volume: 0.6, fadeOut: true, duck: true })
    expect(await db.getBlob(first.blobKey)).toBeDefined()

    store.updateMusic({ offset: 500, volume: 2 })
    expect(store.project.music!.offset).toBe(96)
    expect(store.project.music!.volume).toBe(1)

    await store.setMusic(new File(['y'], 'B.m4a'))
    expect(store.project.music!.blobKey).not.toBe(first.blobKey)
    expect(store.project.music!.volume).toBe(1) // Einstellungen bleiben
    expect(await db.getBlob(first.blobKey)).toBeUndefined()

    const key = store.project.music!.blobKey
    await store.removeMusic()
    expect(store.project.music).toBeUndefined()
    expect(await db.getBlob(key)).toBeUndefined()
  })

  it('Musik: nicht dekodierbare Datei wird abgelehnt und nicht gespeichert', async () => {
    audio.decodable = false
    await expect(store.setMusic(new File(['x'], 'kaputt.mp3'))).rejects.toThrow()
    expect(store.project.music).toBeUndefined()
  })

  it('Voiceover: neue Aufnahme ersetzt die alte, Werte werden begrenzt', async () => {
    audio.duration = 8
    await store.setVoiceover(new Blob(['a'], { type: 'audio/mp4' }), { start: -1, skip: 0.3 })
    const first = store.project.voiceover!
    expect(first).toMatchObject({ start: 0, skip: 0.3, duration: 8, volume: 1, mimeType: 'audio/mp4' })
    store.updateVoiceover({ volume: 0.5 })
    await store.setVoiceover(new Blob(['b']), { start: 0.1, skip: 0, mimeType: 'audio/webm' })
    expect(store.project.voiceover).toMatchObject({ start: 0.1, volume: 0.5, mimeType: 'audio/webm' })
    expect(await db.getBlob(first.blobKey)).toBeUndefined()

    await store.flush()
    store._reset()
    await store.load()
    expect(store.project.voiceover).toMatchObject({ start: 0.1, volume: 0.5 })

    const key = store.project.voiceover!.blobKey
    await store.removeVoiceover()
    expect(store.project.voiceover).toBeUndefined()
    expect(await db.getBlob(key)).toBeUndefined()
  })
})
