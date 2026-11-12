<script lang="ts">
  import { onMount, untrack } from 'svelte'
  import { resumePendingClips } from './lib/media/pipeline'
  import { requestPersistentStorage } from './lib/project/db'
  import { store } from './lib/project/store.svelte'
  import { router } from './lib/router.svelte'
  import Cut from './routes/Cut.svelte'
  import Export from './routes/Export.svelte'
  import Home from './routes/Home.svelte'
  import Record from './routes/Record.svelte'
  import Settings from './routes/Settings.svelte'
  import Toasts from './ui/Toasts.svelte'

  onMount(() => {
    const stopRouter = router.start()
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

  // Projekt aus der URL öffnen; ohne Projekt in der URL das offene schließen.
  // Ein gerade neu angelegtes Projekt ist schon offen und wird nicht geladen.
  let opening: string | null = null
  $effect(() => {
    const id = router.projectId
    untrack(() => {
      if (!id) {
        opening = null
        if (store.loaded) store.close()
        return
      }
      if ((store.loaded && store.project.id === id) || opening === id) return
      opening = id
      void store.open(id).then((ok) => {
        if (opening !== id) return
        opening = null
        if (ok) resumePendingClips()
        else router.go('home', { replace: true })
      })
    })
  })

  const ready = $derived(store.loaded && store.project.id === router.projectId)

  // Guard: Cut und Export brauchen mindestens einen abspielbaren Clip.
  $effect(() => {
    if (ready && (router.current === 'cut' || router.current === 'export') && !store.hasPlayableClips) {
      router.go('record', { replace: true })
    }
  })
</script>

<Toasts />

{#if router.current === 'home'}
  <Home />
{:else if router.current === 'settings'}
  <Settings />
{:else if !ready}
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
