import { describe, expect, it, vi } from 'vitest'

vi.mock('../media/pipeline', () => ({ ingestBlob: vi.fn() }))
vi.mock('../project/store.svelte', () => ({ store: { totalDuration: 0 } }))
vi.mock('../../ui/toast.svelte', () => ({ toasts: { show: vi.fn() } }))

const { clipWarnings, mimeFromFile } = await import('./importFiles')

describe('mimeFromFile', () => {
  it.each([
    [{ name: 'a.MOV', type: '' }, 'video/quicktime'],
    [{ name: 'a.webm', type: '' }, 'video/webm'],
    [{ name: 'a.m4v', type: '' }, 'video/mp4'],
    [{ name: 'noext', type: '' }, 'video/mp4'],
    [{ name: 'a.mov', type: 'video/mp4' }, 'video/mp4'],
  ])('%o → %s', (file, mime) => {
    expect(mimeFromFile(file)).toBe(mime)
  })
})

describe('clipWarnings', () => {
  it('keine Hinweise im Normalfall', () => {
    expect(clipWarnings({ duration: 30, width: 1080, height: 1920 })).toEqual([])
  })
  it('warnt bei > 2 min und > 4K', () => {
    const w = clipWarnings({ duration: 121, width: 4096, height: 2160 })
    expect(w).toHaveLength(2)
  })
  it('genau 2 min und 4K sind ok', () => {
    expect(clipWarnings({ duration: 120, width: 3840, height: 2160 })).toEqual([])
  })
})
