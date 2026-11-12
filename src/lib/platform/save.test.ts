import { describe, expect, it } from 'vitest'
import { exportFileName, toFile } from './save'

describe('exportFileName', () => {
  const d = new Date(2026, 10, 12, 9, 4)
  it('mp4', () => expect(exportFileName(d, 'video/mp4;codecs=avc1,mp4a')).toBe('quickcut-2026-11-12-0904.mp4'))
  it('webm', () => expect(exportFileName(d, 'video/webm')).toBe('quickcut-2026-11-12-0904.webm'))
  it('File mit Basis-MIME', () => {
    const f = toFile(new Blob(['x']), 'video/mp4;codecs=avc1', d)
    expect(f.type).toBe('video/mp4')
    expect(f.name).toBe('quickcut-2026-11-12-0904.mp4')
  })
})
