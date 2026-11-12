<script lang="ts">
  import { tick } from 'svelte'
  import { UNPLAYABLE_HINT } from '../lib/import/importFiles'
  import { store } from '../lib/project/store.svelte'
  import type { Clip } from '../lib/project/types'
  import { formatShort } from './format'
  import { toasts } from './toast.svelte'

  let {
    selectedId = null,
    onselect,
    removable = true,
  }: { selectedId?: string | null; onselect?: (id: string) => void; removable?: boolean } = $props()

  let scroller: HTMLDivElement | undefined = $state()
  let lastCount = 0

  function select(clip: Clip) {
    if (clip.status === 'error') toasts.show(UNPLAYABLE_HINT, 'error', 7000)
    else if (clip.status === 'ready') onselect?.(clip.id)
  }

  // Bei neuem Clip ans Ende scrollen.
  $effect(() => {
    const count = store.project.clips.length
    if (count > lastCount && scroller) {
      void tick().then(() => scroller?.scrollTo({ left: scroller.scrollWidth, behavior: 'smooth' }))
    }
    lastCount = count
  })
</script>

<div class="strip" bind:this={scroller}>
  {#each store.project.clips as clip (clip.id)}
    <div class="tile" class:selected={clip.id === selectedId} class:error={clip.status === 'error'}>
      <button
        class="thumb"
        onclick={() => select(clip)}
        aria-label="Clip {formatShort(clip.trimEnd - clip.trimStart)}"
      >
        {#if clip.thumbnails[0]}
          <img src={clip.thumbnails[0]} alt="" draggable="false" />
        {/if}
        {#if clip.status === 'processing'}
          <span class="spinner" aria-label="Wird verarbeitet"></span>
        {:else if clip.status === 'error'}
          <span class="badge" title="Format nicht unterstützt">!</span>
        {:else}
          <span class="dur">{formatShort(clip.trimEnd - clip.trimStart)}</span>
        {/if}
      </button>
      {#if removable}
        <button class="remove" onclick={() => store.removeClip(clip.id)} aria-label="Clip löschen">✕</button>
      {/if}
    </div>
  {/each}
</div>

<style>
  .strip {
    display: flex;
    gap: 6px;
    overflow-x: auto;
    padding: 10px 2px 2px;
    scrollbar-width: none;
    -webkit-overflow-scrolling: touch;
  }
  .strip::-webkit-scrollbar {
    display: none;
  }
  .tile {
    position: relative;
    flex: 0 0 auto;
  }
  .thumb {
    position: relative;
    width: 48px;
    height: 72px;
    min-height: 0;
    padding: 0;
    overflow: hidden;
    border-radius: 8px;
    background: var(--surface-2);
    outline: 2px solid transparent;
    outline-offset: 1px;
  }
  .selected .thumb {
    outline-color: var(--accent);
  }
  .error .thumb {
    outline-color: var(--danger);
  }
  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    -webkit-user-drag: none;
  }
  .dur {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    font-size: 0.65rem;
    text-align: center;
    background: linear-gradient(transparent, rgba(0, 0, 0, 0.75));
    padding: 6px 0 2px;
  }
  .badge {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    font-weight: 700;
    color: var(--danger);
    background: rgba(0, 0, 0, 0.5);
  }
  .spinner {
    position: absolute;
    inset: 0;
    margin: auto;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    border: 2px solid rgba(255, 255, 255, 0.3);
    border-top-color: #fff;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  .remove {
    position: absolute;
    top: -8px;
    right: -8px;
    width: 22px;
    height: 22px;
    min-height: 0;
    padding: 0;
    border-radius: 50%;
    font-size: 0.65rem;
    background: rgba(40, 40, 40, 0.95);
    border: 1px solid rgba(255, 255, 255, 0.25);
  }
  /* größere Trefferfläche für den kleinen Löschen-Knopf */
  .remove::after {
    content: '';
    position: absolute;
    inset: -10px;
  }
</style>
