<script lang="ts">
  import { onMount } from 'svelte'
  import { RenderCancelled, startRender, type RenderJob } from '../lib/export/exportV1'
  import { exportV2, supportsExportV2 } from '../lib/export/exportV2'
  import { buildRenderClips, plainTransitions } from '../lib/export/renderInput'
  import { getClipAudio } from '../lib/media/clipAudio'
  import { canShareFile, isIOS, saveVideo, toFile } from '../lib/platform/save'
  import { acquireWakeLock } from '../lib/platform/wakeLock'
  import { store } from '../lib/project/store.svelte'
  import { AudioGraph } from '../lib/renderer/audioGraph'
  import { createRenderer } from '../lib/renderer/createRenderer'
  import type { RenderClip, Renderer } from '../lib/renderer/types'
  import { router } from '../lib/router.svelte'
  import { formatPrecise } from '../ui/format'
  import Screen from '../ui/Screen.svelte'
  import SourceVideos from '../ui/SourceVideos.svelte'
  import { toasts } from '../ui/toast.svelte'

  type Phase = 'ready' | 'preview' | 'exporting' | 'done' | 'error'

  let phase = $state<Phase>('ready')
  let progress = $state(0)
  let errorText = $state('')
  let result = $state<{ file: File; url: string; canShare: boolean } | null>(null)
  let renderClips = $state<RenderClip[] | null>(null)
  const transitions = $derived(plainTransitions(store.playableTransitions))

  let stage: HTMLDivElement | undefined = $state()
  let videoA: HTMLVideoElement | undefined = $state()
  let videoB: HTMLVideoElement | undefined = $state()
  let renderer = $state.raw<Renderer | null>(null)
  let audio: AudioGraph | null = null
  let job: RenderJob | null = null
  let releaseWakeLock: (() => void) | null = null

  /** `?export=v1` erzwingt den Echtzeit-Export (Tests, Fehlersuche). */
  const forceV1 = new URLSearchParams(location.search).get('export') === 'v1'
  let v2Supported = $state<boolean | null>(null)
  let v2Failed = $state(false)
  const useV2 = $derived(!forceV1 && !v2Failed && v2Supported === true)

  const aspect = $derived(store.project.outputAspect)

  // Feature-Detection je Format (Encoder-Unterstützung hängt von der Auflösung ab).
  $effect(() => {
    const a = aspect
    if (forceV1) return void (v2Supported = false)
    let cancelled = false
    void supportsExportV2(a).then((ok) => {
      if (!cancelled) v2Supported = ok
    })
    return () => (cancelled = true)
  })
  const total = $derived(store.totalDuration)
  const busy = $derived(phase === 'preview' || phase === 'exporting')

  // Clip-URLs auflösen; bei Trim-Änderung neu zusammenstellen.
  $effect(() => {
    let cancelled = false
    void buildRenderClips(store.playableClips).then((r) => {
      if (cancelled) return
      renderClips = r
      for (const c of r) void getClipAudio(c.blobKey) // Ton vorab dekodieren
    })
    return () => (cancelled = true)
  })

  // Canvas in die Bühne hängen – auch nach „Neu exportieren“, wenn die Bühne neu entsteht.
  $effect(() => {
    if (stage && renderer && renderer.canvas.parentElement !== stage) stage.append(renderer.canvas)
  })

  // Standbild im gewählten Format (t = 0) zeigen.
  $effect(() => {
    const clips = renderClips
    const a = aspect
    const tr = transitions
    if (!renderer || !clips || busy) return
    void renderer.load({ clips, transitions: tr, outputAspect: a }).then(() => renderer?.renderFrame(0))
  })

  onMount(() => {
    try {
      renderer = createRenderer()
      renderer.canvas.classList.add('stage-canvas')
    } catch (err) {
      console.error(err)
      phase = 'error'
      errorText = 'Dieser Browser kann keine Videos rendern.'
    }
    const onHidden = () => {
      if (document.visibilityState === 'hidden' && phase === 'exporting') {
        job?.cancel('App wurde in den Hintergrund gelegt')
      }
    }
    document.addEventListener('visibilitychange', onHidden)
    return () => {
      document.removeEventListener('visibilitychange', onHidden)
      job?.cancel()
      releaseWakeLock?.()
      renderer?.dispose()
      audio?.close()
      if (result) URL.revokeObjectURL(result.url)
    }
  })

  function ensureAudio(): AudioGraph | null {
    if (audio) return audio
    audio = AudioGraph.tryCreate()
    if (!audio) toasts.show('Ton kann in diesem Browser nicht exportiert werden.', 'warn')
    return audio
  }

  function run(record: boolean) {
    if (!renderer || !renderClips?.length || !videoA || !videoB) return
    job?.cancel()
    progress = 0
    phase = record ? 'exporting' : 'preview'
    if (record && useV2) return runV2()
    // Alles bis hier synchron im Tap (iOS: AudioContext + play()).
    job = startRender({
      clips: renderClips,
      transitions,
      aspect,
      renderer,
      videos: [videoA, videoB],
      audio: ensureAudio(),
      record,
      onProgress: (t) => (progress = t),
    })
    if (record) void acquireWakeLock().then((r) => (releaseWakeLock = r))
    handle(job.done, false)
  }

  /** Schnell-Export: Frame für Frame, schneller als Echtzeit, ohne Abspielen. */
  function runV2() {
    const ac = new AbortController()
    job = { done: Promise.resolve(null), cancel: (reason) => ac.abort(new RenderCancelled(reason)) }
    void acquireWakeLock().then((r) => (releaseWakeLock = r))
    const done = exportV2({
      clips: renderClips!,
      transitions,
      aspect,
      renderer: renderer!,
      signal: ac.signal,
      onProgress: (t) => (progress = t),
    }).catch((err) => {
      // Abbruch über den Signal-Grund weiterreichen (z. B. „App im Hintergrund“).
      throw ac.signal.aborted && ac.signal.reason instanceof RenderCancelled ? ac.signal.reason : err
    })
    handle(done, true)
  }

  function handle(done: Promise<{ blob: Blob; mimeType: string } | null>, isV2: boolean) {
    done
      .then((res) => {
        if (!res) {
          phase = 'ready'
          return
        }
        if (result) URL.revokeObjectURL(result.url)
        const file = toFile(res.blob, res.mimeType)
        result = { file, url: URL.createObjectURL(file), canShare: canShareFile(file) }
        phase = 'done'
      })
      .catch((err) => {
        if (err instanceof RenderCancelled) {
          if (err.message !== 'Abgebrochen') toasts.show(`Export abgebrochen: ${err.message}.`, 'warn')
          phase = 'ready'
        } else if (isV2) {
          // Kein automatischer Neustart: v1 braucht einen frischen Tap (iOS-Autoplay).
          console.error('Export v2 fehlgeschlagen', err)
          v2Failed = true
          toasts.show('Schnell-Export nicht möglich – bitte erneut auf „Exportieren“ tippen (Echtzeit-Export).', 'warn', 7000)
          phase = 'ready'
        } else {
          console.error(err)
          errorText = err instanceof Error ? err.message : String(err)
          phase = 'error'
        }
      })
      .finally(() => {
        job = null
        releaseWakeLock?.()
        releaseWakeLock = null
        // Standbild nach dem Export wiederherstellen (v2 hat das Canvas überschrieben).
        void renderer?.renderFrame(0)
      })
  }

  async function save() {
    if (!result) return
    try {
      const outcome = await saveVideo(result.file)
      if (outcome === 'shared') toasts.show('Gespeichert.', 'info')
      if (outcome === 'downloaded') toasts.show(`Heruntergeladen: ${result.file.name}`, 'info')
    } catch (err) {
      console.error(err)
      toasts.show('Speichern fehlgeschlagen.', 'error')
    }
  }

  function again() {
    if (result) URL.revokeObjectURL(result.url)
    result = null
    phase = 'ready'
  }

  const sizeMb = $derived(result ? (result.file.size / 1024 / 1024).toFixed(1) : '')
</script>

<Screen title="Export" back={busy ? undefined : () => router.go('cut')}>
  <div class="export">
    {#if phase === 'done' && result}
      <div class="result">
        <!-- svelte-ignore a11y_media_has_caption -->
        <video src={result.url} controls playsinline></video>
      </div>
      <p class="meta">{result.file.name} · {sizeMb} MB</p>
      <div class="actions">
        <button class="primary big" onclick={save}>{result.canShare ? (isIOS() ? 'In Fotos sichern' : 'Teilen / Speichern') : 'Herunterladen'}</button>
        <button onclick={again}>Neu exportieren</button>
      </div>
    {:else}
      <div class="stage" bind:this={stage}></div>

      {#if phase === 'exporting'}
        <div class="bar"><div style:width="{(progress / Math.max(0.01, total)) * 100}%"></div></div>
        <p class="meta">
          {useV2 ? 'Schnell-Export' : 'Exportiere'} … {formatPrecise(progress)} / {formatPrecise(total)} · App bitte offen
          lassen
        </p>
        <div class="actions"><button onclick={() => job?.cancel()}>Abbrechen</button></div>
      {:else}
        <p class="meta">
          {store.playableClips.length} Clips · {transitions.filter((t) => t.type !== 'none').length} Übergänge ·
          {formatPrecise(total)} · {aspect} · 1080p ·
          <span class="mode">{v2Supported === null ? '…' : useV2 ? 'Schnell-Export' : 'Echtzeit-Export'}</span>
        </p>
        {#if phase === 'error'}
          <p class="error">{errorText}</p>
        {/if}
        <div class="actions">
          {#if phase === 'preview'}
            <button onclick={() => job?.cancel()}>■ Vorschau stoppen</button>
          {:else}
            <button onclick={() => run(false)} disabled={!renderClips?.length}>▶ Vorschau</button>
          {/if}
          <button class="primary big" onclick={() => run(true)} disabled={!renderClips?.length || phase === 'preview'}
            >Exportieren</button
          >
        </div>
      {/if}
    {/if}

    <SourceVideos bind:a={videoA} bind:b={videoB} />
  </div>
</Screen>

<style>
  .export {
    display: flex;
    flex-direction: column;
    gap: 12px;
    height: 100%;
  }
  .stage,
  .result {
    flex: 1;
    min-height: 0;
    display: grid;
    place-items: center;
    background: #0b0b0b;
    border-radius: var(--radius);
    overflow: hidden;
  }
  /* object-fit hält das Seitenverhältnis des Canvas, egal wie groß die Bühne ist */
  .stage :global(.stage-canvas) {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
  .result video {
    max-width: 100%;
    max-height: 100%;
  }
  .meta {
    margin: 0;
    text-align: center;
    color: var(--muted);
    font-size: 0.85rem;
    font-variant-numeric: tabular-nums;
  }
  .mode {
    color: var(--accent);
  }
  .error {
    margin: 0;
    color: var(--danger);
    text-align: center;
  }
  .actions {
    display: flex;
    gap: 8px;
    justify-content: center;
  }
  .big {
    min-width: 160px;
  }
  .bar {
    height: 6px;
    background: var(--surface-2);
    border-radius: 3px;
    overflow: hidden;
  }
  .bar div {
    height: 100%;
    background: var(--accent);
    transition: width 120ms linear;
  }
</style>
