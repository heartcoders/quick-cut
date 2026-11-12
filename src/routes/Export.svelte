<script lang="ts">
  import { onMount } from 'svelte'
  import { RenderCancelled, startRender, type RenderJob } from '../lib/export/exportV1'
  import { getClipUrl } from '../lib/media/clipUrls'
  import { canShareFile, isIOS, saveVideo, toFile } from '../lib/platform/save'
  import { acquireWakeLock } from '../lib/platform/wakeLock'
  import { store } from '../lib/project/store.svelte'
  import type { AspectRatio } from '../lib/project/types'
  import { AudioGraph } from '../lib/renderer/audioGraph'
  import { createRenderer } from '../lib/renderer/createRenderer'
  import type { RenderClip, Renderer } from '../lib/renderer/types'
  import { router } from '../lib/router.svelte'
  import AspectPicker from '../ui/AspectPicker.svelte'
  import { formatPrecise } from '../ui/format'
  import Screen from '../ui/Screen.svelte'
  import { toasts } from '../ui/toast.svelte'

  type Phase = 'ready' | 'preview' | 'exporting' | 'done' | 'error'

  let phase = $state<Phase>('ready')
  let progress = $state(0)
  let errorText = $state('')
  let result = $state<{ file: File; url: string; canShare: boolean } | null>(null)
  let renderClips = $state<RenderClip[] | null>(null)

  let stage: HTMLDivElement | undefined = $state()
  let videoA: HTMLVideoElement | undefined = $state()
  let videoB: HTMLVideoElement | undefined = $state()
  let renderer: Renderer | null = null
  let audio: AudioGraph | null = null
  let job: RenderJob | null = null
  let releaseWakeLock: (() => void) | null = null

  const aspect = $derived(store.project.outputAspect)
  const total = $derived(store.totalDuration)
  const busy = $derived(phase === 'preview' || phase === 'exporting')

  // Clip-URLs auflösen; bei Trim-Änderung neu zusammenstellen.
  $effect(() => {
    const clips = store.playableClips.map((c) => ({ ...c }))
    let cancelled = false
    void Promise.all(clips.map((c) => getClipUrl(c))).then((urls) => {
      if (cancelled) return
      renderClips = clips.flatMap((c, i) =>
        urls[i] ? [{ url: urls[i]!, duration: c.duration, trimStart: c.trimStart, trimEnd: c.trimEnd, rotation: c.rotation }] : [],
      )
    })
    return () => (cancelled = true)
  })

  // Standbild im gewählten Format (t = 0) zeigen.
  $effect(() => {
    const clips = renderClips
    const a = aspect
    if (!renderer || !clips || busy) return
    void renderer.load({ clips, outputAspect: a }).then(() => renderer?.renderFrame(0))
  })

  onMount(() => {
    try {
      renderer = createRenderer()
      renderer.canvas.classList.add('stage-canvas')
      stage?.append(renderer.canvas)
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
    try {
      audio = new AudioGraph()
    } catch (err) {
      console.warn('Web Audio nicht verfügbar – Export ohne Ton', err)
      toasts.show('Ton kann in diesem Browser nicht exportiert werden.', 'warn')
    }
    return audio
  }

  function run(record: boolean) {
    if (!renderer || !renderClips?.length || !videoA || !videoB) return
    job?.cancel()
    progress = 0
    phase = record ? 'exporting' : 'preview'
    // Alles bis hier synchron im Tap (iOS: AudioContext + play()).
    job = startRender({
      clips: renderClips,
      aspect,
      renderer,
      videos: [videoA, videoB],
      audio: ensureAudio(),
      record,
      onProgress: (t) => (progress = t),
    })
    if (record) void acquireWakeLock().then((r) => (releaseWakeLock = r))

    job.done
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

  function setAspect(a: AspectRatio) {
    store.setAspect(a)
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
        <p class="meta">Exportiere … {formatPrecise(progress)} / {formatPrecise(total)} · App bitte offen lassen</p>
        <div class="actions"><button onclick={() => job?.cancel()}>Abbrechen</button></div>
      {:else}
        <AspectPicker value={aspect} onchange={setAspect} disabled={busy} />
        <p class="meta">{store.playableClips.length} Clips · {formatPrecise(total)} · {aspect} · 1080p</p>
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

    <!-- Quellen für den Renderer: eingehängt, aber unsichtbar (iOS dekodiert sonst nicht). -->
    <!-- svelte-ignore a11y_media_has_caption -->
    <video bind:this={videoA} class="source" playsinline preload="auto"></video>
    <!-- svelte-ignore a11y_media_has_caption -->
    <video bind:this={videoB} class="source" playsinline preload="auto"></video>
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
  .source {
    position: fixed;
    left: 0;
    top: 0;
    width: 1px;
    height: 1px;
    opacity: 0;
    pointer-events: none;
  }
</style>
