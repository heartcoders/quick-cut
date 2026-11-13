<script lang="ts">
  import { faceStore } from '../lib/faces/faceStore.svelte'
  import { normalizeFaces } from '../lib/faces/settings'
  import { STICKERS } from '../lib/faces/stickers'
  import { facesAt } from '../lib/faces/track'
  import { store } from '../lib/project/store.svelte'
  import type { FaceMode, FaceTrackRecord } from '../lib/project/types'
  import ProgressRing from './ProgressRing.svelte'
  import { toasts } from './toast.svelte'

  /**
   * Gesichter eines Clips: erkennen, Effekt wählen, einzelne Gesichter
   * ausnehmen (als Chips im Sheet oder direkt im Vorschaubild antippen).
   */
  let {
    clipId,
    video,
    time,
    onclose,
  }: {
    clipId: string
    /** Einzelvorschau (object-fit: contain) – für die antippbaren Ellipsen */
    video: HTMLVideoElement | undefined
    /** lokale Clip-Zeit der Vorschau */
    time: number
    onclose: () => void
  } = $props()

  const MODES: { id: FaceMode; label: string }[] = [
    { id: 'off', label: 'Aus' },
    { id: 'blur', label: 'Weich' },
    { id: 'pixel', label: 'Pixel' },
    { id: 'sticker', label: 'Emoji' },
  ]

  const clip = $derived(store.getClip(clipId))
  const index = $derived(store.project.clips.findIndex((c) => c.id === clipId))
  const multi = $derived(store.project.clips.length > 1)
  const settings = $derived(normalizeFaces(clip?.faces))
  const excluded = $derived(new Set(settings.excluded))
  const blobKey = $derived(clip?.blobKey ?? '')
  const progress = $derived(blobKey ? faceStore.progress[blobKey] : undefined)

  let rec = $state.raw<FaceTrackRecord | null | undefined>(undefined) // undefined = lädt
  let thumbs = $state<Record<number, string>>({})

  // Ergebnis laden – neu, sobald eine Analyse fertig ist (revision).
  $effect(() => {
    const key = blobKey
    void faceStore.revision
    if (!key) return
    let cancelled = false
    void faceStore.get(key).then((r) => {
      if (cancelled) return
      rec = r
      const urls: Record<number, string> = {}
      for (const [id, b] of Object.entries(r?.thumbs ?? {})) urls[Number(id)] = URL.createObjectURL(b)
      thumbs = urls
    })
    return () => {
      cancelled = true
      for (const u of Object.values(thumbs)) URL.revokeObjectURL(u)
    }
  })

  async function analyze(key = blobKey, duration = clip?.duration ?? 0) {
    try {
      const r = await faceStore.analyze(key, duration)
      // Nach der ersten Erkennung gleich einen Effekt zeigen.
      if (r && r.tracks.length > 0 && key === blobKey && settings.mode === 'off') store.setFaces(clipId, { mode: 'blur' })
    } catch (err) {
      console.error('Gesichtserkennung fehlgeschlagen', err)
      toasts.show('Gesichtserkennung ist auf diesem Gerät nicht möglich.', 'error')
    }
  }

  function applyAll() {
    store.applyFacesToAll(clipId)
    // Clips ohne Analyse gleich mit erkennen lassen.
    for (const c of store.project.clips) {
      if (c.id === clipId || c.status !== 'ready') continue
      void faceStore.get(c.blobKey).then((r) => {
        if (!r && !faceStore.running(c.blobKey)) void analyze(c.blobKey, c.duration)
      })
    }
  }

  const pct = (v: number) => Math.round(v * 100)

  // --- Antippbare Ellipsen über der Vorschau -------------------------------
  let rect = $state<{ x: number; y: number; w: number; h: number } | null>(null)

  $effect(() => {
    const el = video
    if (!el) return
    const update = () => {
      const r = el.getBoundingClientRect()
      const vw = el.videoWidth
      const vh = el.videoHeight
      if (!vw || !vh || !r.width || !r.height) return (rect = null)
      const k = Math.min(r.width / vw, r.height / vh) // object-fit: contain
      const w = vw * k
      const h = vh * k
      rect = { x: r.left + (r.width - w) / 2, y: r.top + (r.height - h) / 2, w, h }
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    el.addEventListener('loadedmetadata', update)
    window.addEventListener('resize', update)
    return () => {
      ro.disconnect()
      el.removeEventListener('loadedmetadata', update)
      window.removeEventListener('resize', update)
    }
  })

  const visible = $derived(rec && rect ? facesAt(rec.tracks, time) : [])
</script>

<div class="backdrop" onclick={onclose} role="presentation"></div>

{#if rect}
  {#each visible as f (f.id)}
    <button
      class="face"
      class:off={excluded.has(f.id)}
      style:left="{rect.x + (f.cx - f.rx) * rect.w}px"
      style:top="{rect.y + (f.cy - f.ry) * rect.h}px"
      style:width="{2 * f.rx * rect.w}px"
      style:height="{2 * f.ry * rect.h}px"
      onclick={() => store.toggleFace(clipId, f.id)}
      aria-label="Gesicht {f.id} {excluded.has(f.id) ? 'einschließen' : 'ausnehmen'}"
    ></button>
  {/each}
{/if}

<div class="sheet" role="dialog" aria-label="Gesichter für Clip {index + 1}">
  <header>
    <strong>Gesichter · Clip {index + 1}</strong>
    <button class="done" onclick={onclose}>Fertig</button>
  </header>

  {#if clip}
    {#if progress !== undefined}
      <div class="busy">
        <ProgressRing progress={progress} size={44} stroke={4} color="var(--accent)" />
        <span>Gesichter werden erkannt … {pct(progress)} %</span>
        <button onclick={() => faceStore.cancel(blobKey)}>Abbrechen</button>
      </div>
    {:else if rec === null}
      <p class="hint">
        Gesichter im Clip finden, um sie weichzuzeichnen, zu verpixeln oder mit einem Emoji zu verdecken. Läuft komplett
        auf dem Gerät; beim ersten Mal wird das Erkennungsmodell geladen.
      </p>
      <button class="primary" onclick={() => analyze()}>Gesichter erkennen</button>
    {:else if rec && rec.tracks.length === 0}
      <p class="hint">Keine Gesichter gefunden.</p>
      <button onclick={() => analyze()}>Erneut erkennen</button>
    {:else if rec}
      <div class="modes" role="radiogroup" aria-label="Effekt">
        {#each MODES as m (m.id)}
          <button
            role="radio"
            aria-checked={settings.mode === m.id}
            class:on={settings.mode === m.id}
            onclick={() => store.setFaces(clipId, { mode: m.id })}>{m.label}</button
          >
        {/each}
      </div>

      {#if settings.mode === 'blur' || settings.mode === 'pixel'}
        <label class="slider">
          <span>Stärke</span>
          <input
            type="range"
            min="0"
            max="100"
            step="1"
            value={pct(settings.strength)}
            oninput={(e) => store.setFaces(clipId, { strength: Number(e.currentTarget.value) / 100 })}
            aria-label="Stärke"
          />
          <output>{pct(settings.strength)} %</output>
        </label>
      {:else if settings.mode === 'sticker'}
        <div class="stickers" role="radiogroup" aria-label="Emoji">
          {#each STICKERS as s (s)}
            <button
              role="radio"
              aria-checked={settings.sticker === s}
              class:on={settings.sticker === s}
              onclick={() => store.setFaces(clipId, { sticker: s })}>{s}</button
            >
          {/each}
        </div>
      {/if}

      <div class="people">
        <span class="title">Gesichter ({rec.tracks.length})</span>
        <div class="chips">
          {#each rec.tracks as t, i (t.id)}
            <button
              class="chip"
              class:off={excluded.has(t.id)}
              onclick={() => store.toggleFace(clipId, t.id)}
              aria-pressed={!excluded.has(t.id)}
              aria-label="Gesicht {i + 1} {excluded.has(t.id) ? 'ausgenommen' : 'bearbeitet'}"
            >
              {#if thumbs[t.id]}
                <img src={thumbs[t.id]} alt="" draggable="false" />
              {:else}
                <span>{i + 1}</span>
              {/if}
            </button>
          {/each}
        </div>
        <span class="hint small">Antippen nimmt ein Gesicht aus – auch direkt im Bild.</span>
      </div>

      <div class="actions">
        <button onclick={() => analyze()}>Neu erkennen</button>
        <button onclick={applyAll} disabled={!multi}>Auf alle Clips anwenden</button>
      </div>
    {/if}
  {/if}
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 40;
    background: transparent;
  }
  .face {
    position: fixed;
    z-index: 42;
    padding: 0;
    border-radius: 50%;
    border: 2px solid var(--accent);
    background: rgba(255, 214, 10, 0.12);
  }
  .face.off {
    border: 2px dashed rgba(255, 255, 255, 0.8);
    background: transparent;
  }
  .sheet {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 41;
    max-height: 62dvh;
    overflow-y: auto;
    padding: 14px 16px calc(16px + var(--safe-bottom));
    background: var(--surface);
    border-radius: 18px 18px 0 0;
    box-shadow: 0 -8px 30px rgba(0, 0, 0, 0.5);
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .done,
  .primary {
    background: var(--accent);
    color: #000;
    font-weight: 600;
  }
  .hint {
    margin: 0;
    color: var(--muted);
    font-size: 0.9rem;
  }
  .hint.small {
    font-size: 0.8rem;
  }
  .busy {
    display: flex;
    align-items: center;
    gap: 12px;
    font-size: 0.9rem;
  }
  .busy span {
    flex: 1;
    font-variant-numeric: tabular-nums;
  }
  .modes {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 6px;
  }
  .modes .on,
  .stickers .on {
    background: var(--accent);
    color: #000;
    font-weight: 600;
  }
  .stickers {
    display: grid;
    grid-template-columns: repeat(6, 1fr);
    gap: 6px;
  }
  .stickers button {
    font-size: 1.5rem;
    padding: 6px 0;
  }
  .slider {
    display: grid;
    grid-template-columns: 80px 1fr 48px;
    align-items: center;
    gap: 10px;
    font-size: 0.9rem;
  }
  .slider input {
    width: 100%;
    accent-color: var(--accent);
  }
  .slider output {
    text-align: right;
    font-variant-numeric: tabular-nums;
    font-size: 0.8rem;
  }
  .people {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .title {
    font-size: 0.8rem;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .chips {
    display: flex;
    gap: 8px;
    overflow-x: auto;
    padding-bottom: 4px;
    scrollbar-width: none;
  }
  .chip {
    flex: 0 0 auto;
    width: 56px;
    height: 56px;
    padding: 0;
    border-radius: 50%;
    overflow: hidden;
    border: 2px solid var(--accent);
    position: relative;
  }
  .chip img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .chip.off {
    border: 2px dashed var(--muted);
  }
  .chip.off img {
    opacity: 0.4;
    filter: grayscale(1);
  }
  .chip.off::after {
    content: '✕';
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    font-size: 1.4rem;
    color: #fff;
  }
  .actions {
    display: flex;
    gap: 8px;
  }
</style>
