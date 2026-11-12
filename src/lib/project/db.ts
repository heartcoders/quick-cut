import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import { newId } from './id'
import type { ProjectRecord } from './types'

const DB_NAME = 'quick-cut'
const DB_VERSION = 2
/** Einziges Projekt in DB-Version 1. */
const LEGACY_KEY = 'current'

interface QuickCutDB extends DBSchema {
  blobs: { key: string; value: Blob }
  thumbs: { key: string; value: Blob }
  project: { key: string; value: ProjectRecord }
}

let dbPromise: Promise<IDBPDatabase<QuickCutDB>> | null = null

function db(): Promise<IDBPDatabase<QuickCutDB>> {
  dbPromise ??= openDB<QuickCutDB>(DB_NAME, DB_VERSION, {
    async upgrade(database, oldVersion, _newVersion, tx) {
      if (oldVersion < 1) {
        database.createObjectStore('blobs')
        database.createObjectStore('thumbs')
        database.createObjectStore('project')
      }
      if (oldVersion === 1) {
        // v1 kannte nur ein Projekt unter 'current' → unter seiner eigenen ID ablegen.
        const store = tx.objectStore('project')
        const legacy = await store.get(LEGACY_KEY)
        if (legacy) {
          const now = Date.now()
          await store.put({ ...legacy, createdAt: legacy.createdAt ?? now, updatedAt: legacy.updatedAt ?? now }, legacy.id)
          await store.delete(LEGACY_KEY)
        }
      }
    },
  })
  return dbPromise
}

/** Nur für Tests: Verbindung schließen und vergessen. */
export async function _resetDbForTests(): Promise<void> {
  if (dbPromise) (await dbPromise).close()
  dbPromise = null
}

export async function putBlob(key: string, blob: Blob): Promise<void> {
  await (await db()).put('blobs', blob, key)
}

export async function getBlob(key: string): Promise<Blob | undefined> {
  return (await db()).get('blobs', key)
}

export async function deleteBlob(key: string): Promise<void> {
  await (await db()).delete('blobs', key)
}

export async function putThumb(key: string, blob: Blob): Promise<void> {
  await (await db()).put('thumbs', blob, key)
}

export async function getThumb(key: string): Promise<Blob | undefined> {
  return (await db()).get('thumbs', key)
}

/** Löscht Video-Blob und alle Thumbnails eines Clips in einer Transaktion. */
export async function deleteClipData(blobKey: string, thumbKeys: string[]): Promise<void> {
  const tx = (await db()).transaction(['blobs', 'thumbs'], 'readwrite')
  await Promise.all([
    tx.objectStore('blobs').delete(blobKey),
    ...thumbKeys.map((k) => tx.objectStore('thumbs').delete(k)),
    tx.done,
  ])
}

export async function loadProject(id: string): Promise<ProjectRecord | undefined> {
  return (await db()).get('project', id)
}

export async function saveProject(project: ProjectRecord): Promise<void> {
  await (await db()).put('project', project, project.id)
}

/** Alle Projekte, zuletzt bearbeitete zuerst. */
export async function listProjects(): Promise<ProjectRecord[]> {
  const all = await (await db()).getAll('project')
  return all.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
}

export async function renameProject(id: string, name: string): Promise<void> {
  const d = await db()
  const rec = await d.get('project', id)
  if (!rec) return
  rec.name = name.trim() || undefined
  await d.put('project', rec, id)
}

/** Alle Blob-Schlüssel eines Projekts (Clips, Musik, Voiceover). */
function blobKeysOf(p: ProjectRecord): string[] {
  return [...p.clips.map((c) => c.blobKey), p.music?.blobKey, p.voiceover?.blobKey].filter((k): k is string => !!k)
}

/** Löscht ein Projekt samt Videos, Thumbnails und Audio in einer Transaktion. */
export async function deleteProject(id: string): Promise<void> {
  const tx = (await db()).transaction(['project', 'blobs', 'thumbs'], 'readwrite')
  const rec = await tx.objectStore('project').get(id)
  if (rec) {
    await Promise.all([
      ...blobKeysOf(rec).map((k) => tx.objectStore('blobs').delete(k)),
      ...rec.clips.flatMap((c) => c.thumbKeys).map((k) => tx.objectStore('thumbs').delete(k)),
      tx.objectStore('project').delete(id),
    ])
  }
  await tx.done
}

/**
 * Kopiert ein Projekt mit allen Daten unter neuen Schlüsseln, damit beide
 * unabhängig voneinander bearbeitet und gelöscht werden können.
 */
export async function duplicateProject(id: string, name: string): Promise<ProjectRecord | undefined> {
  const d = await db()
  const src = await d.get('project', id)
  if (!src) return undefined
  const blobMap = new Map<string, string>()
  const thumbMap = new Map<string, string>()
  for (const key of blobKeysOf(src)) blobMap.set(key, `${key.replace(/-.*$/, '')}-${newId()}`)
  for (const key of src.clips.flatMap((c) => c.thumbKeys)) thumbMap.set(key, `thumb-${newId()}`)

  // Blobs nacheinander lesen und schreiben, statt alles auf einmal im RAM zu halten.
  for (const [from, to] of blobMap) {
    const blob = await d.get('blobs', from)
    if (blob) await d.put('blobs', blob, to)
  }
  for (const [from, to] of thumbMap) {
    const blob = await d.get('thumbs', from)
    if (blob) await d.put('thumbs', blob, to)
  }

  const now = Date.now()
  const copy: ProjectRecord = {
    ...structuredClone(src),
    id: newId(),
    name,
    createdAt: now,
    updatedAt: now,
  }
  copy.clips = copy.clips.map((c) => ({
    ...c,
    id: newId(),
    blobKey: blobMap.get(c.blobKey)!,
    thumbKeys: c.thumbKeys.map((k) => thumbMap.get(k)!),
  }))
  if (copy.music) copy.music.blobKey = blobMap.get(copy.music.blobKey)!
  if (copy.voiceover) copy.voiceover.blobKey = blobMap.get(copy.voiceover.blobKey)!
  await d.put('project', copy, copy.id)
  return copy
}

/** Bittet den Browser, die Daten nicht bei Speicherknappheit zu verwerfen (v. a. iOS). */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (navigator.storage?.persisted && (await navigator.storage.persisted())) return true
    return (await navigator.storage?.persist?.()) ?? false
  } catch {
    return false
  }
}
