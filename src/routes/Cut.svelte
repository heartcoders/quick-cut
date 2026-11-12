<script lang="ts">
  import { router } from '../lib/router.svelte'
  import ClipList from '../ui/ClipList.svelte'
  import Screen from '../ui/Screen.svelte'
</script>

<Screen title="Schneiden" back={() => router.go('record')}>
  {#snippet actions()}
    <button class="primary" onclick={() => router.go('export')}>Export</button>
  {/snippet}

  <p class="hint">Trim-Editor folgt in Phase 4.</p>
  <ClipList />
</Screen>

<style>
  .hint {
    color: var(--muted);
  }
</style>
