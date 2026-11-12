import { once } from './video'

export interface ProbeResult {
  duration: number
  width: number
  height: number
  playable: boolean
}

/**
 * Liest Dauer und Größe aus einem bereits geöffneten Video.
 * MediaRecorder-WebM meldet oft `duration = Infinity`: dann ans Ende
 * springen, bis der Browser die echte Dauer kennt.
 */
export async function probe(video: HTMLVideoElement, fallbackDuration?: number): Promise<ProbeResult> {
  let duration = video.duration
  if (!Number.isFinite(duration) || duration <= 0) {
    const changed = once(video, ['durationchange', 'timeupdate', 'seeked'], 3000)
    video.currentTime = 1e9
    await changed
    duration = video.duration
    video.currentTime = 0
    if (!Number.isFinite(duration) || duration <= 0) duration = fallbackDuration ?? 0
  }
  const width = video.videoWidth
  const height = video.videoHeight
  return {
    duration: Math.round(duration * 1000) / 1000,
    width,
    height,
    playable: width > 0 && height > 0 && duration > 0,
  }
}
