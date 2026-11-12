<script lang="ts">
  import { store } from '../lib/project/store.svelte'
  import type { AspectRatio } from '../lib/project/types'
  import { router } from '../lib/router.svelte'
  import Screen from '../ui/Screen.svelte'

  const aspects: AspectRatio[] = ['9:16', '16:9', '1:1']
</script>

<Screen title="Export" back={() => router.go('cut')}>
  <p class="hint">Renderer und Export folgen in Phase 5.</p>
  <div class="aspects" role="radiogroup" aria-label="Ausgabeformat">
    {#each aspects as a (a)}
      <button
        role="radio"
        aria-checked={store.project.outputAspect === a}
        class:primary={store.project.outputAspect === a}
        onclick={() => store.setAspect(a)}>{a}</button
      >
    {/each}
  </div>
  <p class="hint">{store.project.clips.length} Clips · {store.totalDuration.toFixed(1)} s</p>
</Screen>

<style>
  .hint {
    color: var(--muted);
  }
  .aspects {
    display: flex;
    gap: 0.5rem;
  }
</style>
