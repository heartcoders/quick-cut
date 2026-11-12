import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { ProjectRecord } from './types'

const DB_NAME = 'quick-cut'
const DB_VERSION = 1
const PROJECT_KEY = 'current'

interface QuickCutDB extends DBSchema {
  blobs: { key: string; value: Blob }
  thumbs: { key: string; value: Blob }
  project: { key: string; value: ProjectRecord }
}

let dbPromise: Promise<IDBPDatabase<QuickCutDB>> | null = null

function db(): Promise<IDBPDatabase<QuickCutDB>> {
  dbPromise ??= openDB<QuickCutDB>(DB_NAME, DB_VERSION, {
    upgrade(database) {
      database.createObjectStore('blobs')
      database.createObjectStore('thumbs')
      database.createObjectStore('project')
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

export async function loadProject(): Promise<ProjectRecord | undefined> {
  return (await db()).get('project', PROJECT_KEY)
}

export async function saveProject(project: ProjectRecord): Promise<void> {
  await (await db()).put('project', project, PROJECT_KEY)
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
