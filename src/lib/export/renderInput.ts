import { getClipUrl } from '../media/clipUrls'
import type { Clip, Transition } from '../project/types'
import type { RenderClip } from '../renderer/types'
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
  }))
  const urls = await Promise.all(snap.map((c) => getClipUrl(c)))
  return snap.flatMap((c, i) => (urls[i] ? [{ ...c, url: urls[i]! }] : []))
}

export function plainTransitions(ts: readonly Transition[]): TransitionSpec[] {
  return ts.map((t) => ({ type: t.type, duration: t.duration }))
}
