import { getClipAudio } from '../media/clipAudio'
import { getClipUrl } from '../media/clipUrls'
import type { Clip, MusicTrack, ProjectRecord, Transition, VoiceoverTrack } from '../project/types'
import { normalizeLook } from '../renderer/looks'
import type { RenderClip } from '../renderer/types'
import type { ProjectAudioInput } from '../timeline/audioSchedule'
import type { TransitionSpec } from '../timeline/timeline'

/** Wandelt Store-Clips in Renderer-Eingaben (mit aufgelösten Object-URLs). */
export async function buildRenderClips(clips: readonly Clip[]): Promise<RenderClip[]> {
  const snap = clips.map((c) => ({
    blobKey: c.blobKey,
    duration: c.duration,
    trimStart: c.trimStart,
    trimEnd: c.trimEnd,
    rotation: c.rotation,
    panX: c.panX ?? 0.5,
    panY: c.panY ?? 0.5,
    look: normalizeLook(c.look),
    volume: c.volume ?? 1,
  }))
  const urls = await Promise.all(snap.map((c) => getClipUrl(c)))
  return snap.flatMap((c, i) => (urls[i] ? [{ ...c, url: urls[i]! }] : []))
}

export function plainTransitions(ts: readonly Transition[]): TransitionSpec[] {
  return ts.map((t) => ({ type: t.type, duration: t.duration }))
}

/** Musik und Voiceover des Projekts (einfache Kopien, unabhängig vom Store). */
export interface AudioTracks {
  music?: MusicTrack
  voiceover?: VoiceoverTrack
}

export function buildAudioTracks(project: Pick<ProjectRecord, 'music' | 'voiceover'>): AudioTracks {
  return {
    music: project.music ? { ...project.music } : undefined,
    voiceover: project.voiceover ? { ...project.voiceover } : undefined,
  }
}

/** Alle Tonquellen dekodieren (aus dem Cache von getClipAudio) für scheduleProjectAudio. */
export async function loadProjectAudio(
  clips: readonly RenderClip[],
  transitions: readonly TransitionSpec[],
  tracks: AudioTracks = {},
): Promise<ProjectAudioInput> {
  const { music, voiceover } = tracks
  const [clipBuffers, musicBuf, voBuf] = await Promise.all([
    Promise.all(clips.map((c) => getClipAudio(c.blobKey))),
    music ? getClipAudio(music.blobKey) : null,
    voiceover ? getClipAudio(voiceover.blobKey) : null,
  ])
  return {
    clips,
    clipBuffers,
    transitions,
    music: music && musicBuf ? { ...music, buffer: musicBuf } : null,
    voiceover: voiceover && voBuf ? { ...voiceover, buffer: voBuf } : null,
  }
}

/** true, wenn überhaupt etwas zu hören ist. */
export function hasAudio(input: ProjectAudioInput): boolean {
  return input.clipBuffers.some((b, i) => b && (input.clips[i]?.volume ?? 1) > 0) || !!input.music || !!input.voiceover
}
