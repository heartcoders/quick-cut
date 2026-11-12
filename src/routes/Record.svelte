<script lang="ts">
  import { onMount } from 'svelte'
  import { CameraError, isStreamLive, openCamera, stopStream, type CameraErrorKind, type Facing } from '../lib/capture/camera'
  import RecordButton from '../lib/capture/RecordButton.svelte'
  import { startRecording, type ActiveRecording } from '../lib/capture/recorder'
  import { importFiles } from '../lib/import/importFiles'
  import { ingestBlob } from '../lib/media/pipeline'
  import { pickRecorderMimeType } from '../lib/platform/mediaFormat'
  import { createDevClip } from '../lib/project/devClip'
  import { store } from '../lib/project/store.svelte'
  import { router } from '../lib/router.svelte'
  import ClipStrip from '../ui/ClipStrip.svelte'
  import { outputSize } from '../lib/renderer/geometry'

  const ERROR_TEXT: Record<CameraErrorKind, string> = {
    insecure: 'Kamera braucht HTTPS. Bitte die App über https:// öffnen.',
    denied: 'Kein Zugriff auf Kamera/Mikrofon. Bitte in den Browser-Einstellungen erlauben.',
    notfound: 'Keine passende Kamera gefunden.',
    busy: 'Die Kamera wird gerade von einer anderen App benutzt.',
    other: 'Kamera konnte nicht gestartet werden.',
  }

  let facing = $state<Facing>('user')
  let stream = $state<MediaStream | null>(null)
  let cameraError = $state<CameraErrorKind | null>(null)
  let reopen = $state(0) // erhöhen → Kamera neu öffnen
  let videoEl: HTMLVideoElement | undefined = $state()
  let recording: ActiveRecording | null = null
  let isRecording = $state(false)
  let fileInput: HTMLInputElement | undefined = $state()

  const mimeType = pickRecorderMimeType()
  // Vorschau im Zielformat zeigen: was man sieht, landet (mittig) im Video.
  const out = $derived(outputSize(store.project.outputAspect))
  const debug = new URLSearchParams(location.search).has('debug')
  const camInfo = $derived.by(() => {
    const s = stream?.getVideoTracks()[0]?.getSettings()
    return s ? `${s.width}×${s.height}` : ''
  })

  // Kamera öffnen, wenn facing wechselt oder neu angefordert wird.
  $effect(() => {
    void reopen
    const want = facing
    let cancelled = false
    let opened: MediaStream | null = null
    cameraError = null
    openCamera(want)
      .then((s) => {
        if (cancelled) return stopStream(s)
        opened = s
        stream = s
      })
      .catch((err) => {
        if (!cancelled) cameraError = err instanceof CameraError ? err.kind : 'other'
      })
    return () => {
      cancelled = true
      stopStream(opened)
      if (stream === opened) stream = null
    }
  })

  $effect(() => {
    if (videoEl) videoEl.srcObject = stream
  })

  onMount(() => {
    // iOS beendet die Kamera im Hintergrund: beim Zurückkehren neu öffnen.
    const onVisible = () => {
      if (document.visibilityState === 'visible' && !isStreamLive(stream)) reopen++
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  })

  function handleStart(): boolean {
    if (!stream || !isStreamLive(stream)) return false
    recording = startRecording(stream, mimeType)
    isRecording = true
    return true
  }

  async function handleStop() {
    const rec = recording
    recording = null
    isRecording = false
    if (!rec) return
    try {
      const { blob, elapsed } = await rec.stop()
      if (blob.size > 0) await ingestBlob(blob, 'recorded', { fallbackDuration: elapsed })
    } catch (err) {
      console.error('Aufnahme konnte nicht gespeichert werden', err)
    }
  }

  function onFilesChosen(e: Event) {
    const input = e.currentTarget as HTMLInputElement
    const files = Array.from(input.files ?? [])
    input.value = '' // dieselbe Datei erneut wählbar
    if (files.length) void importFiles(files)
  }

  function flip() {
    facing = facing === 'user' ? 'environment' : 'user'
  }

  async function addTestClip() {
    const { record, thumbUrl } = await createDevClip()
    store.addClip(record, 'ready', [thumbUrl])
  }
</script>

<section class="record">
  <!-- svelte-ignore a11y_media_has_caption -->
  <video
    bind:this={videoEl}
    autoplay
    playsinline
    muted
    class:mirror={facing === 'user'}
    style:--ar={out.width / out.height}
  ></video>
  {#if debug && camInfo}
    <div class="debug">Kamera {camInfo} → {out.width}×{out.height}</div>
  {/if}

  {#if cameraError}
    <div class="error">
      <p>{ERROR_TEXT[cameraError]}</p>
      <button onclick={() => reopen++}>Erneut versuchen</button>
    </div>
  {/if}

  <header>
    {#if import.meta.env.DEV}
      <button class="small" onclick={addTestClip} disabled={isRecording}>+ Test</button>
    {:else}
      <span></span>
    {/if}
    <button class="round" onclick={flip} disabled={isRecording} aria-label="Kamera wechseln">⟲</button>
  </header>

  <footer>
    {#if store.hasClips}
      <ClipStrip removable={!isRecording} reorderable={!isRecording} />
    {/if}
    <div class="controls">
      <button
        class="side"
        disabled={isRecording}
        onclick={() => fileInput?.click()}
        aria-label="Aus Galerie importieren">▦</button
      >
      <input bind:this={fileInput} type="file" accept="video/*" multiple hidden onchange={onFilesChosen} />
      <RecordButton disabled={!stream} onstart={handleStart} onstop={handleStop} />
      <button
        class="side primary"
        disabled={!store.hasPlayableClips || isRecording}
        onclick={() => router.go('cut')}>Weiter</button
      >
    </div>
  </footer>
</section>

<style>
  .record {
    position: relative;
    height: 100%;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    overflow: hidden;
  }
  /* Rahmen im Ausgabeformat, mittig; object-fit: cover = derselbe Zuschnitt wie der Renderer. */
  video {
    position: fixed;
    top: 50%;
    left: 50%;
    width: min(100vw, 100dvh * var(--ar));
    aspect-ratio: var(--ar);
    transform: translate(-50%, -50%);
    object-fit: cover;
    background: #000;
    z-index: 0;
  }
  /* Frontkamera nur in der Vorschau spiegeln, nicht in der Aufnahme. */
  video.mirror {
    transform: translate(-50%, -50%) scaleX(-1);
  }
  .debug {
    position: fixed;
    top: 4rem;
    left: 0.75rem;
    z-index: 1;
    font: 11px/1.3 ui-monospace, monospace;
    color: #0f0;
    background: rgba(0, 0, 0, 0.7);
    padding: 2px 6px;
    border-radius: 4px;
  }
  header,
  footer {
    position: relative;
    z-index: 1;
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.75rem;
  }
  footer {
    padding: 0 0.75rem 1rem;
    background: linear-gradient(transparent, rgba(0, 0, 0, 0.55));
  }
  .controls {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    margin-top: 1rem;
  }
  .side {
    justify-self: center;
    min-width: 64px;
    background: rgba(40, 40, 40, 0.7);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
  }
  .side.primary {
    background: var(--accent);
  }
  .round {
    width: 44px;
    height: 44px;
    padding: 0;
    border-radius: 50%;
    font-size: 1.3rem;
    background: rgba(40, 40, 40, 0.6);
  }
  .small {
    font-size: 0.8rem;
    padding: 0.3rem 0.7rem;
    min-height: 32px;
    background: rgba(40, 40, 40, 0.6);
  }
  .error {
    position: absolute;
    inset: 0;
    z-index: 2;
    display: grid;
    place-content: center;
    gap: 1rem;
    padding: 2rem;
    text-align: center;
    background: rgba(0, 0, 0, 0.85);
  }
</style>
