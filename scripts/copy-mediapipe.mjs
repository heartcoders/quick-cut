// Kopiert die MediaPipe-WASM-Dateien nach public/mediapipe, damit die App sie
// selbst ausliefert (kein CDN, offline-fähig). Läuft vor dev und build.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(root, 'node_modules/@mediapipe/tasks-vision/wasm')
const dst = join(root, 'public/mediapipe')
mkdirSync(dst, { recursive: true })
for (const f of ['vision_wasm_internal.js', 'vision_wasm_internal.wasm']) {
  const from = join(src, f)
  if (!existsSync(from)) throw new Error(`MediaPipe-Datei fehlt: ${from}`)
  copyFileSync(from, join(dst, f))
}
