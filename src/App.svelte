<script lang="ts">
  import { onMount } from 'svelte'
  import { resumePendingClips } from './lib/media/pipeline'
  import { requestPersistentStorage } from './lib/project/db'
  import { store } from './lib/project/store.svelte'
  import { router } from './lib/router.svelte'
  import Cut from './routes/Cut.svelte'
  import Export from './routes/Export.svelte'
  import Record from './routes/Record.svelte'
  import Toasts from './ui/Toasts.svelte'

  onMount(() => {
    const stopRouter = router.start()
    void store.load().then(resumePendingClips)
    void requestPersistentStorage()

    // Ausstehende Änderungen sichern, bevor iOS die Seite einfriert.
    const flush = () => void store.flush()
    const onVisibility = () => document.visibilityState === 'hidden' && flush()
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stopRouter()
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  })

  // Guard: Cut und Export brauchen mindestens einen abspielbaren Clip.
  $effect(() => {
    if (store.loaded && router.current !== 'record' && !store.hasPlayableClips) {
      router.go('record', { replace: true })
    }
  })
</script>

<Toasts />

{#if !store.loaded}
  <div class="loading">Lade Projekt …</div>
{:else if router.current === 'record'}
  <Record />
{:else if router.current === 'cut'}
  <Cut />
{:else}
  <Export />
{/if}

<style>
  .loading {
    display: grid;
    place-items: center;
    height: 100%;
    color: var(--muted);
  }
</style>
