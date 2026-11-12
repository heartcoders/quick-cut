<script lang="ts">
  import { store } from '../lib/project/store.svelte'
  import { DEFAULT_LOOK, type FilterId } from '../lib/project/types'
  import { canvasFilter, EFFECTS, FILTER_IDS, FILTERS, isNeutral, normalizeLook, type EffectKey } from '../lib/renderer/looks'

  let { clipId, onclose }: { clipId: string; onclose: () => void } = $props()

  const clip = $derived(store.getClip(clipId))
  const look = $derived(normalizeLook(clip?.look))
  const thumb = $derived(clip?.thumbnails[0])
  const index = $derived(store.project.clips.findIndex((c) => c.id === clipId))
  const multi = $derived(store.project.clips.length > 1)

  function setFilter(filter: FilterId) {
    // Beim Wechsel volle Stärke, damit der Filter sofort sichtbar ist.
    store.setLook(clipId, { filter, amount: look.filter === filter ? look.amount : 1 })
  }

  function slide(key: 'amount' | EffectKey) {
    return (e: Event) => store.setLook(clipId, { [key]: Number((e.currentTarget as HTMLInputElement).value) / 100 })
  }

  const pct = (v: number) => Math.round(v * 100)
</script>

<div class="backdrop" onclick={onclose} role="presentation"></div>
<div class="sheet" role="dialog" aria-label="Look für Clip {index + 1}">
  <header>
    <strong>Look · Clip {index + 1}</strong>
    <button class="done" onclick={onclose}>Fertig</button>
  </header>

  {#if clip}
    <div class="filters" role="radiogroup" aria-label="Filter">
      {#each FILTER_IDS as id (id)}
        <button
          role="radio"
          aria-checked={look.filter === id}
          class:on={look.filter === id}
          onclick={() => setFilter(id)}
        >
          <span class="tile">
            {#if thumb}
              <img src={thumb} alt="" draggable="false" style:filter={canvasFilter({ ...DEFAULT_LOOK, filter: id })} />
            {/if}
          </span>
          <span class="name">{FILTERS[id].label}</span>
        </button>
      {/each}
    </div>

    <label class="slider" class:off={look.filter === 'none'}>
      <span>Stärke</span>
      <input
        type="range"
        min="0"
        max="100"
        step="1"
        value={pct(look.amount)}
        disabled={look.filter === 'none'}
        oninput={slide('amount')}
        aria-label="Stärke des Filters"
      />
      <output>{look.filter === 'none' ? '–' : `${pct(look.amount)} %`}</output>
    </label>

    <div class="effects">
      <span class="title">Effekte</span>
      {#each EFFECTS as fx (fx.key)}
        <label class="slider" class:off={look[fx.key] <= 0}>
          <span>{fx.label}</span>
          <input
            type="range"
            min="0"
            max="100"
            step="1"
            value={pct(look[fx.key])}
            oninput={slide(fx.key)}
            aria-label={fx.label}
          />
          <output>{pct(look[fx.key])} %</output>
        </label>
      {/each}
    </div>

    <div class="actions">
      <button onclick={() => store.setLook(clipId, DEFAULT_LOOK)} disabled={isNeutral(look)}>Zurücksetzen</button>
      <button onclick={() => store.applyLookToAll(clipId)} disabled={!multi}>Auf alle Clips anwenden</button>
    </div>
  {/if}
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 40;
    /* durchsichtig: die Vorschau oben soll sichtbar bleiben */
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
  .done {
    background: var(--accent);
    color: #000;
    font-weight: 600;
  }
  .filters {
    display: flex;
    gap: 8px;
    overflow-x: auto;
    padding-bottom: 4px;
    scrollbar-width: none;
  }
  .filters button {
    flex: 0 0 auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 0;
    background: none;
    font-size: 0.75rem;
    color: var(--muted);
  }
  .tile {
    width: 56px;
    height: 72px;
    border-radius: 8px;
    overflow: hidden;
    background: var(--surface-2);
    border: 2px solid transparent;
  }
  .tile img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .filters .on {
    color: var(--text);
    font-weight: 600;
  }
  .filters .on .tile {
    border-color: var(--accent);
  }
  .effects {
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
  .slider {
    display: grid;
    grid-template-columns: 80px 1fr 48px;
    align-items: center;
    gap: 10px;
    font-size: 0.9rem;
  }
  .slider.off span,
  .slider.off output {
    opacity: 0.5;
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
  .actions {
    display: flex;
    gap: 8px;
  }
  .actions button {
    flex: 1;
  }
</style>
