<script lang="ts">
  import { store } from '../lib/project/store.svelte'

  let { removable = false }: { removable?: boolean } = $props()

  const fmt = (s: number) => `${s.toFixed(1)} s`
</script>

{#if store.project.clips.length === 0}
  <p class="empty">Noch keine Clips.</p>
{:else}
  <ul>
    {#each store.project.clips as clip (clip.id)}
      <li>
        {#if clip.thumbnails[0]}
          <img src={clip.thumbnails[0]} alt="" />
        {:else}
          <div class="ph"></div>
        {/if}
        <div class="meta">
          <strong>{clip.source === 'recorded' ? 'Aufnahme' : 'Import'}</strong>
          <span>{fmt(clip.trimEnd - clip.trimStart)} · {clip.width}×{clip.height} · {clip.mimeType}</span>
        </div>
        {#if removable}
          <button onclick={() => store.removeClip(clip.id)} aria-label="Clip löschen">✕</button>
        {/if}
      </li>
    {/each}
  </ul>
  <p class="total">Gesamt: {fmt(store.totalDuration)}</p>
{/if}

<style>
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.5rem;
  }
  li {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    background: var(--surface);
    border-radius: var(--radius);
    padding: 0.5rem;
  }
  img,
  .ph {
    width: 45px;
    height: 80px;
    object-fit: cover;
    border-radius: 6px;
    background: var(--surface-2);
  }
  .meta {
    flex: 1;
    display: flex;
    flex-direction: column;
    font-size: 0.85rem;
  }
  .meta span,
  .empty,
  .total {
    color: var(--muted);
  }
</style>
