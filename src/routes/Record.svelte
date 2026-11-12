<script lang="ts">
  import { createDevClip } from '../lib/project/devClip'
  import { store } from '../lib/project/store.svelte'
  import { router } from '../lib/router.svelte'
  import ClipList from '../ui/ClipList.svelte'
  import Screen from '../ui/Screen.svelte'

  async function addTestClip() {
    const { record, thumbUrl } = await createDevClip()
    store.addClip(record, 'ready', [thumbUrl])
  }
</script>

<Screen title="Aufnahme">
  {#snippet actions()}
    <button class="primary" disabled={!store.hasClips} onclick={() => router.go('cut')}>Weiter</button>
  {/snippet}

  <p class="hint">Kamera und Record-Button folgen in Phase 2.</p>
  {#if import.meta.env.DEV}
    <button onclick={addTestClip}>Test-Clip anlegen</button>
  {/if}
  <div class="list"><ClipList removable /></div>
</Screen>

<style>
  .hint {
    color: var(--muted);
  }
  .list {
    margin-top: 1rem;
  }
</style>
