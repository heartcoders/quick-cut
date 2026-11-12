<script lang="ts">
  import { DEFAULT_TRANSITION_SECONDS, store } from '../lib/project/store.svelte'
  import type { Transition } from '../lib/project/types'
  import { formatPrecise } from './format'

  let {
    index,
    previewing = false,
    onpreview,
    onclose,
  }: { index: number; previewing?: boolean; onpreview: () => void; onclose: () => void } = $props()

  const MIN = 0.2
  const TYPES: { type: Transition['type']; label: string; icon: string }[] = [
    { type: 'none', label: 'Kein', icon: '│' },
    { type: 'crossfade', label: 'Überblenden', icon: '◐' },
    { type: 'slide', label: 'Schieben', icon: '⇤' },
    { type: 'wipe', label: 'Wischen', icon: '▧' },
  ]

  const tr = $derived(store.project.transitions[index])
  const max = $derived(store.maxTransitionAt(index))
  const tooShort = $derived(max < MIN)

  function setType(type: Transition['type']) {
    const duration = tr && tr.duration > 0 ? tr.duration : Math.min(DEFAULT_TRANSITION_SECONDS, max)
    store.setTransition(index, { type, duration })
  }

  function setDuration(e: Event) {
    store.setTransition(index, { duration: Number((e.currentTarget as HTMLInputElement).value) })
  }

  function applyAll() {
    if (tr) store.setAllTransitions({ ...tr })
  }
</script>

<div class="backdrop" onclick={onclose} role="presentation"></div>
<div class="sheet" role="dialog" aria-label="Übergang {index + 1}">
  <header>
    <strong>Übergang {index + 1} → {index + 2}</strong>
    <button class="done" onclick={onclose}>Fertig</button>
  </header>

  {#if tr}
    <div class="types" role="radiogroup" aria-label="Art des Übergangs">
      {#each TYPES as t (t.type)}
        <button
          role="radio"
          aria-checked={tr.type === t.type}
          class:on={tr.type === t.type}
          disabled={t.type !== 'none' && tooShort}
          onclick={() => setType(t.type)}
        >
          <span class="icon">{t.icon}</span>
          <span>{t.label}</span>
        </button>
      {/each}
    </div>

    {#if tooShort}
      <p class="hint">Die Clips sind zu kurz für einen Übergang (max. halbe Cliplänge).</p>
    {:else}
      <label class="duration" class:off={tr.type === 'none'}>
        <span>Dauer</span>
        <input
          type="range"
          min={MIN}
          max={max}
          step="0.1"
          value={Math.min(tr.duration || DEFAULT_TRANSITION_SECONDS, max)}
          disabled={tr.type === 'none'}
          oninput={setDuration}
          aria-label="Dauer des Übergangs"
        />
        <output>{formatPrecise(tr.type === 'none' ? 0 : tr.duration)}</output>
      </label>
    {/if}

    <div class="actions">
      <button onclick={onpreview} disabled={tr.type === 'none'}>{previewing ? '■ Stopp' : '▶ Vorschau'}</button>
      <button onclick={applyAll}>Für alle übernehmen</button>
    </div>
  {/if}
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 40;
    background: rgba(0, 0, 0, 0.3);
  }
  .sheet {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 41;
    padding: 14px 16px calc(16px + var(--safe-bottom));
    background: var(--surface);
    border-radius: 18px 18px 0 0;
    box-shadow: 0 -8px 30px rgba(0, 0, 0, 0.5);
    display: flex;
    flex-direction: column;
    gap: 14px;
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
  .types {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 6px;
  }
  .types button {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: 0.5rem 0.2rem;
    font-size: 0.75rem;
  }
  .types .icon {
    font-size: 1.2rem;
  }
  .types .on {
    background: var(--accent);
    color: #000;
    font-weight: 600;
  }
  .duration {
    display: grid;
    grid-template-columns: auto 1fr 52px;
    align-items: center;
    gap: 10px;
    font-size: 0.9rem;
  }
  .duration.off {
    opacity: 0.4;
  }
  .duration input {
    width: 100%;
    accent-color: var(--accent);
  }
  .duration output {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .hint {
    margin: 0;
    color: var(--muted);
    font-size: 0.85rem;
  }
  .actions {
    display: flex;
    gap: 8px;
  }
  .actions button {
    flex: 1;
  }
</style>
