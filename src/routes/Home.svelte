<script lang="ts">
  import { onMount, tick } from 'svelte'
  import { beginInstantHold } from '../lib/capture/instantHold'
  import { importFiles } from '../lib/import/importFiles'
  import * as db from '../lib/project/db'
  import { store } from '../lib/project/store.svelte'
  import { playableRecords, projectDuration, projectTitle } from '../lib/project/summary'
  import type { ProjectRecord } from '../lib/project/types'
  import { router } from '../lib/router.svelte'
  import { formatClock } from '../ui/format'
  import { toasts } from '../ui/toast.svelte'

  let projects = $state<ProjectRecord[] | null>(null)
  /** Projekt-ID → Object-URL des ersten Thumbnails */
  let thumbs = $state<Record<string, string>>({})
  let fileInput: HTMLInputElement | undefined = $state()
  let importing = $state(false)
  let busy = $state(false)
  // Aktions-Sheet
  let selected = $state<ProjectRecord | null>(null)
  let nameDraft = $state('')
  let confirmDelete = $state(false)
  let destroyed = false

  async function refresh() {
    const list = await db.listProjects()
    const next: Record<string, string> = {}
    for (const p of list) {
      const key = p.clips.find((c) => c.thumbKeys.length)?.thumbKeys[0]
      const blob = key ? await db.getThumb(key) : undefined
      if (blob) next[p.id] = URL.createObjectURL(blob)
    }
    if (destroyed) return revokeAll(next)
    revokeAll(thumbs)
    thumbs = next
    projects = list
  }

  function revokeAll(map: Record<string, string>) {
    for (const url of Object.values(map)) URL.revokeObjectURL(url)
  }

  onMount(() => {
    // Erst warten, bis das eben geschlossene Projekt gespeichert ist.
    void tick()
      .then(() => store.whenSaved())
      .then(refresh)
    return () => {
      destroyed = true
      revokeAll(thumbs)
    }
  })

  function openProject(p: ProjectRecord) {
    router.go(playableRecords(p).length ? 'cut' : 'record', { projectId: p.id })
  }

  // --- Neu ---------------------------------------------------------------

  /** Halten = sofort filmen, Tippen = Kamera öffnen. Immer ein neues Projekt. */
  function onRecordDown(e: PointerEvent) {
    if (!e.isPrimary || importing) return
    e.preventDefault()
    beginInstantHold(e)
    router.go('record', { projectId: store.createNew() })
  }

  /** Tastatur/Screenreader: nur Kamera öffnen. */
  function onRecordClick(e: MouseEvent) {
    if (e.detail !== 0 || importing) return
    router.go('record', { projectId: store.createNew() })
  }

  async function onFilesChosen(e: Event) {
    const input = e.currentTarget as HTMLInputElement
    const files = Array.from(input.files ?? [])
    input.value = ''
    if (!files.length) return
    const id = store.createNew()
    importing = true
    const ready = await importFiles(files, {
      onFirstReady: () => router.go('cut', { projectId: id }),
    })
    if (ready === 0 && store.project.id === id) {
      // Nichts Brauchbares dabei – kein leeres Projekt zurücklassen.
      await store.discard()
    }
    importing = false
  }

  // --- Aktionen ------------------------------------------------------------

  function openActions(p: ProjectRecord) {
    selected = p
    nameDraft = p.name ?? ''
    confirmDelete = false
  }

  function closeActions() {
    selected = null
  }

  async function run(action: () => Promise<unknown>, error: string) {
    busy = true
    try {
      await action()
    } catch (err) {
      console.error(err)
      toasts.show(error, 'error')
    }
    busy = false
    closeActions()
    await refresh()
  }

  function rename(e: SubmitEvent) {
    e.preventDefault()
    const p = selected
    if (p) void run(() => db.renameProject(p.id, nameDraft), 'Umbenennen fehlgeschlagen.')
  }

  function duplicate() {
    const p = selected
    if (p) void run(() => db.duplicateProject(p.id, `Kopie von ${projectTitle(p)}`), 'Kopieren fehlgeschlagen (Speicher voll?).')
  }

  function remove() {
    const p = selected
    if (!p) return
    if (!confirmDelete) {
      confirmDelete = true
      return
    }
    void run(() => db.deleteProject(p.id), 'Löschen fehlgeschlagen.')
  }
</script>

<section class="home">
  <header>
    <h1>Quick Cut</h1>
    <button class="round" onclick={() => router.go('settings')} aria-label="Einstellungen">⚙</button>
  </header>

  <main>
    {#if projects && projects.length === 0}
      <p class="empty">Halte den Button zum Filmen oder starte mit Videos aus der Galerie.</p>
    {:else if projects}
      <ul class="list">
        {#each projects as p (p.id)}
          {@const clips = p.clips.length}
          <li>
            <button class="card" onclick={() => openProject(p)}>
              <span class="thumb">
                {#if thumbs[p.id]}
                  <img src={thumbs[p.id]} alt="" />
                {/if}
              </span>
              <span class="info">
                <strong>{projectTitle(p)}</strong>
                <span class="meta">
                  {formatClock(projectDuration(p))} · {clips} {clips === 1 ? 'Clip' : 'Clips'}
                </span>
                {#if p.name && p.updatedAt}
                  <span class="meta">{projectTitle({ updatedAt: p.updatedAt })}</span>
                {/if}
              </span>
            </button>
            <button class="more" onclick={() => openActions(p)} aria-label="Aktionen für {projectTitle(p)}">⋯</button>
          </li>
        {/each}
      </ul>
    {/if}
  </main>

  <footer>
    <div class="controls">
      <button class="side" disabled={importing} onclick={() => fileInput?.click()}>▦ Aus Videos</button>
      <input bind:this={fileInput} type="file" accept="video/*" multiple hidden onchange={onFilesChosen} />
      <button
        class="record"
        disabled={importing}
        aria-label="Aufnehmen (halten zum sofortigen Filmen)"
        onpointerdown={onRecordDown}
        onclick={onRecordClick}
        oncontextmenu={(e) => e.preventDefault()}
      >
        <span class="dot"></span>
      </button>
      <span></span>
    </div>
    <p class="hint">Halten zum Filmen · Tippen öffnet die Kamera</p>
  </footer>

  {#if importing}
    <div class="overlay" role="status">Importiere …</div>
  {/if}
</section>

{#if selected}
  <div class="backdrop" onclick={closeActions} role="presentation"></div>
  <div class="sheet" role="dialog" aria-label="Projekt {projectTitle(selected)}">
    <form onsubmit={rename}>
      <input bind:value={nameDraft} placeholder={projectTitle({ createdAt: selected.createdAt, updatedAt: selected.updatedAt })} aria-label="Name" enterkeyhint="done" />
      <button type="submit" class="primary" disabled={busy}>Umbenennen</button>
    </form>
    <button onclick={duplicate} disabled={busy}>Duplizieren</button>
    <button class="danger" class:confirm={confirmDelete} onclick={remove} disabled={busy}>
      {confirmDelete ? 'Wirklich löschen? Videos sind dann weg.' : 'Löschen'}
    </button>
    <button onclick={closeActions} disabled={busy}>Abbrechen</button>
  </div>
{/if}

<style>
  .home {
    position: relative;
    display: flex;
    flex-direction: column;
    height: 100%;
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.75rem 0.75rem 0.25rem 1rem;
  }
  h1 {
    margin: 0;
    font-size: 1.4rem;
  }
  main {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 0.5rem 0.75rem;
  }
  .empty {
    margin: 30vh 1.5rem 0;
    text-align: center;
    color: var(--muted);
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.5rem;
  }
  .list li {
    display: flex;
    align-items: stretch;
    background: var(--surface);
    border-radius: var(--radius);
    overflow: hidden;
  }
  .card {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.5rem;
    text-align: left;
    background: transparent;
    border-radius: 0;
  }
  .thumb {
    flex: none;
    width: 54px;
    height: 72px;
    border-radius: 8px;
    background: var(--surface-2);
    overflow: hidden;
  }
  .thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .info {
    min-width: 0;
    display: grid;
    gap: 2px;
  }
  .info strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .meta {
    font-size: 0.85rem;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  .more {
    flex: none;
    width: 48px;
    padding: 0;
    font-size: 1.3rem;
    background: transparent;
    border-radius: 0;
  }
  footer {
    padding: 0.5rem 0.75rem 1rem;
  }
  .controls {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
  }
  .side {
    justify-self: center;
    font-size: 0.9rem;
  }
  .record {
    width: 88px;
    height: 88px;
    padding: 0;
    border-radius: 50%;
    background: transparent;
    border: 4px solid rgba(255, 255, 255, 0.85);
    display: grid;
    place-items: center;
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
  }
  .dot {
    width: 66px;
    height: 66px;
    border-radius: 50%;
    background: var(--danger);
    transition: transform 150ms ease;
  }
  .record:active .dot {
    transform: scale(0.82);
  }
  .hint {
    margin: 0.5rem 0 0;
    text-align: center;
    font-size: 0.8rem;
    color: var(--muted);
  }
  .round {
    width: 44px;
    height: 44px;
    padding: 0;
    border-radius: 50%;
    font-size: 1.2rem;
  }
  .overlay {
    position: absolute;
    inset: 0;
    z-index: 5;
    display: grid;
    place-items: center;
    background: rgba(0, 0, 0, 0.7);
  }
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
    gap: 10px;
  }
  form {
    display: flex;
    gap: 8px;
  }
  form input {
    flex: 1;
    min-width: 0;
    font: inherit;
    font-size: 16px; /* iOS zoomt sonst beim Fokussieren */
    color: inherit;
    background: var(--surface-2);
    border: 0;
    border-radius: var(--radius);
    padding: 0 0.8rem;
  }
  .danger {
    color: var(--danger);
  }
  .danger.confirm {
    background: var(--danger);
    color: #fff;
    font-weight: 600;
  }
</style>
