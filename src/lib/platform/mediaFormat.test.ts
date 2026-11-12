import { describe, expect, it } from 'vitest'
import { baseMime, extensionFor, pickAudioRecorderMimeType, pickRecorderMimeType } from './mediaFormat'

describe('pickRecorderMimeType', () => {
  it('nimmt MP4 mit Codecs, wenn verfügbar (Safari)', () => {
    expect(pickRecorderMimeType(() => true)).toBe('video/mp4;codecs=avc1,mp4a')
  })
  it('fällt auf WebM zurück (älteres Chrome)', () => {
    const supported = new Set(['video/webm', 'video/webm;codecs=vp9,opus'])
    expect(pickRecorderMimeType((t) => supported.has(t))).toBe('video/webm;codecs=vp9,opus')
  })
  it('nimmt einfaches MP4 vor WebM', () => {
    const supported = new Set(['video/mp4', 'video/webm'])
    expect(pickRecorderMimeType((t) => supported.has(t))).toBe('video/mp4')
  })
  it('liefert undefined, wenn nichts passt', () => {
    expect(pickRecorderMimeType(() => false)).toBeUndefined()
  })
})

describe('extensionFor / baseMime', () => {
  it.each([
    ['video/mp4;codecs=avc1,mp4a', 'mp4'],
    ['video/webm;codecs=vp9,opus', 'webm'],
    ['video/quicktime', 'mov'],
    ['', 'mp4'],
  ])('%s → %s', (mime, ext) => {
    expect(extensionFor(mime)).toBe(ext)
  })
  it('entfernt Parameter', () => {
    expect(baseMime('Video/MP4; codecs="avc1"')).toBe('video/mp4')
  })
})

describe('pickAudioRecorderMimeType', () => {
  it('bevorzugt AAC/MP4 (Safari)', () => {
    expect(pickAudioRecorderMimeType(() => true)).toBe('audio/mp4')
  })
  it('nimmt sonst Opus in WebM (Chrome)', () => {
    const supported = new Set(['audio/webm', 'audio/webm;codecs=opus'])
    expect(pickAudioRecorderMimeType((t) => supported.has(t))).toBe('audio/webm;codecs=opus')
  })
  it('liefert undefined, wenn nichts passt', () => {
    expect(pickAudioRecorderMimeType(() => false)).toBeUndefined()
  })
})
