import { describe, expect, it } from 'vitest'
import { projectDuration, projectTitle } from './summary'
import type { ClipRecord, ProjectRecord } from './types'

function clip(id: string, over: Partial<ClipRecord> = {}): ClipRecord {
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

function project(clips: ClipRecord[], transitions: ProjectRecord['transitions'] = []): ProjectRecord {
  return { id: 'p', clips, transitions, outputAspect: '9:16' }
}

describe('projectDuration', () => {
  it('zählt nur abspielbare, verarbeitete Clips und zieht Übergänge ab', () => {
    const p = project(
      [clip('a', { trimStart: 1 }), clip('x', { playable: false }), clip('b'), clip('y', { duration: 0, trimEnd: 0 })],
      [
        { type: 'crossfade', duration: 0.5 }, // a → (x übersprungen) → b
        { type: 'none', duration: 0 },
        { type: 'wipe', duration: 1 },
      ],
    )
    expect(projectDuration(p)).toBe(3 + 4 - 0.5)
  })

  it('leeres Projekt → 0', () => {
    expect(projectDuration(project([]))).toBe(0)
  })
})

describe('projectTitle', () => {
  it('eigener Name gewinnt', () => {
    expect(projectTitle({ name: 'Urlaub', createdAt: 0 })).toBe('Urlaub')
  })

  it('sonst Erstellungsdatum', () => {
    const t = new Date(2026, 10, 12, 14, 32).getTime()
    expect(projectTitle({ createdAt: t })).toMatch(/12\. Nov.*14:32/)
  })
})
